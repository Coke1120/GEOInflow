import { disconnectAiFactsClient } from '../../../src/lib/liekan/upstream/ai-facts-db';
import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import prisma,{getRawQueryClient} from '../../../src/lib/prisma';
import {aiTransaction} from '../../../src/lib/liekan/upstream/ai-db';
import {transferWebsiteWithAi} from '../../../src/lib/liekan/upstream/ai-lifecycle';
import {updateUser} from '../../../src/queries/prisma/user';
import {deleteTeamUser,createTeamUser,updateTeamUser} from '../../../src/queries/prisma/teamUser';
import {createAiConnection,listAiConnections} from '../../../src/lib/liekan/ai/connections';
import {createAiConversation,getAiConversation,listAiConversations} from '../../../src/lib/liekan/ai/conversations';
import {acceptAiRun,getAiRun,setAiRunStage,completeAiRun,expireAiRuns} from '../../../src/lib/liekan/ai/runs';
import {cleanupAiData,rotateAiKeys,resetRestoredAiData,aiMaintenanceCheck} from '../../../src/lib/liekan/ai/maintenance';
import {getAiAccessCatalog} from '../../../src/lib/liekan/upstream/ai-catalog';
import {decryptAiKey} from '../../../src/lib/liekan/ai/crypto';
const url=new URL(process.env.DATABASE_URL!);
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'15439');assert.equal(url.pathname,'/liekan_ai_acceptance');
const primary:any=getRawQueryClient(prisma.client,{write:true});
const child=process.argv.includes('--schema-child');
if(!child){
 const schema='ai_lifecycle_'+randomUUID().replaceAll('-','');
 try{
  await primary.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  for(const table of ['user','team','team_user','website','liekan_log','liekan_log_source','liekan_log_state','liekan_log_interval','liekan_ingest_batch','liekan_log_grant','liekan_oauth_cleanup'])await primary.$executeRawUnsafe(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
  for(const migration of ['007_ai_connections.sql','008_ai_conversations.sql','009_ai_endpoint_limits.sql','010_ai_workspaces.sql','011_ai_config_audit.sql','012_ai_invariants_and_history.sql','012_analytics_revision.sql'])execFileSync('docker',['exec','-i','liekan-ai-acceptance-db','psql','-U','liekan_ai','-d','liekan_ai_acceptance','-v','ON_ERROR_STOP=1'],{input:`SET search_path TO "${schema}";\n`+readFileSync('db/liekan/migrations/'+migration,'utf8'),stdio:['pipe','pipe','pipe'],timeout:30000});
  const childUrl=new URL(url);childUrl.searchParams.set('schema',schema);
  const result=spawnSync(process.execPath,['--import','tsx','tests/liekan/ai/lifecycle.integration.ts','--schema-child',...process.argv.filter(value=>value.startsWith('--review-'))],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:childUrl.toString()},encoding:'utf8',timeout:60000});
  if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
  assert.equal(result.status,0,'isolated custom-schema lifecycle child must pass');
 }finally{
  await primary.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await disconnectAiFactsClient(); await prisma.client.$disconnect();
 }
}else{
 assert.match(url.searchParams.get('schema')??'',/^ai_lifecycle_[a-f0-9]{32}$/);
 const adminId=randomUUID(),memberId=randomUUID(),teamId=randomUUID(),siteId=randomUUID(),teamSiteId=randomUUID();
 const admin={id:adminId,role:'admin'},member={id:memberId,role:'user'};
 const fixtureKey='isolated-lifecycle-credential';
 try{
  await primary.$queryRawUnsafe('SELECT 1');
  await aiTransaction(async tx=>{
   for(const [id,role] of [[adminId,'admin'],[memberId,'user']])await tx.execute('INSERT INTO "user"(user_id,username,password,role) VALUES($1::uuid,$2,$3,$4)',id,'isolated-lifecycle-'+id.slice(0,8),'fixture-disabled-login',role);
   await tx.execute('INSERT INTO team(team_id,name) VALUES($1::uuid,$2)',teamId,'Isolated lifecycle team');
   for(const [id,role] of [[adminId,'team-owner'],[memberId,'team-member']])await tx.execute('INSERT INTO team_user(team_user_id,team_id,user_id,role) VALUES($1::uuid,$2::uuid,$3::uuid,$4)',randomUUID(),teamId,id,role);
   await tx.execute('INSERT INTO website(website_id,name,domain,user_id) VALUES($1::uuid,$2,$3,$4::uuid)',siteId,'Isolated lifecycle website','lifecycle.example',adminId);
   await tx.execute('INSERT INTO website(website_id,name,domain,team_id) VALUES($1::uuid,$2,$3,$4::uuid)',teamSiteId,'Isolated lifecycle team website','team-lifecycle.example',teamId);
  });
  const config={name:'Isolated lifecycle API',provider:'openai',protocol:'openai-chat',baseUrl:'https://api.openai.com/v1',model:'gpt-5.4-mini',apiKey:fixtureKey};
  const personal=await createAiConnection(admin,{...config,space:{kind:'personal',id:adminId}});
  const team=await createAiConnection(admin,{...config,space:{kind:'team',id:teamId}});
  await assert.rejects(()=>createAiConnection(member,{...config,space:{kind:'team',id:teamId}}),{status:403});
  const memberList=await listAiConnections(member,{kind:'team',id:teamId});assert.equal(memberList.canManage,false);assert.equal(memberList.items[0].lastCall,null);
  const test=await acceptAiRun(admin,{operation:'test',targetId:personal.id,clientRequestId:randomUUID(),expectedConfigVersion:1});
  await setAiRunStage(admin,test,'preparing');await setAiRunStage(admin,test,'calling');
  await updateUser(adminId,{role:'view-only'});await updateUser(adminId,{role:'admin'});
  assert.equal((await getAiRun(admin,test.row.id)).state,'invalidated');
  await assert.rejects(()=>completeAiRun(admin,test,{text:'late'},{ttftMs:null,usage:null}),{status:409});
  const teamConversation=await createAiConversation(member,{websiteId:teamSiteId});
  const request={operation:'analysis' as const,targetId:teamConversation.id,clientRequestId:randomUUID(),expectedConfigVersion:1,question:'Isolated lifecycle check',startAt:new Date(Date.now()-86400000).toISOString(),endAt:new Date().toISOString(),timezone:'Asia/Shanghai'};
  const removed=await acceptAiRun(member,request);
  await deleteTeamUser(teamId,memberId);await assert.rejects(()=>getAiConversation(member,teamConversation.id),{status:404});
  const restored=await createTeamUser(memberId,teamId,'team-member');
  assert.equal((await getAiRun(member,removed.row.id)).state,'invalidated');
  await assert.rejects(()=>completeAiRun(member,removed,{summary:'late'},{ttftMs:null,usage:null,local:true}),{status:409});
  const downgraded=await acceptAiRun(member,{...request,clientRequestId:randomUUID()});
  await updateTeamUser(restored.id,{role:'team-view-only'});
  await assert.rejects(()=>acceptAiRun(member,{...request,clientRequestId:randomUUID()}),{status:403});
  await updateTeamUser(restored.id,{role:'team-member'});assert.equal((await getAiRun(member,downgraded.row.id)).state,'invalidated');
  const oldConversation=await createAiConversation(admin,{websiteId:siteId});
  const collector=randomUUID(),interval=randomUUID();
  await aiTransaction(async tx=>{
    await tx.execute("INSERT INTO liekan_log_source(id,website_id,kind,domain,created_by,owner_id,state,credential_hash) VALUES($1::uuid,$2::uuid,'server','example.com',$3::uuid,$3::uuid,'active','fixture-old-credential')",collector,siteId,adminId);
    await tx.execute("INSERT INTO liekan_log_interval(id,website_id,source_id,starts_at) VALUES($1::uuid,$2::uuid,$3::uuid,now())",interval,siteId,collector);
  });
  await transferWebsiteWithAi(siteId,{userId:adminId},{userId:memberId,teamId:null});
  const stopped=await aiTransaction(tx=>tx.query('SELECT state,credential_hash FROM liekan_log_source WHERE id=$1::uuid',collector));
  assert.equal(stopped[0].state,'paused');assert.equal(stopped[0].credential_hash,null);
  const closed=await aiTransaction(tx=>tx.query('SELECT ends_at FROM liekan_log_interval WHERE id=$1::uuid',interval));assert.ok(closed[0].ends_at);

  await assert.rejects(()=>getAiConversation(admin,oldConversation.id),{status:404});
  assert.equal((await primary.website.findUnique({where:{id:siteId}})).userId,memberId);
  if(process.argv.includes('--review-deadline')){
   const deadlineRun=await acceptAiRun(admin,{operation:'test',targetId:personal.id,clientRequestId:randomUUID(),expectedConfigVersion:1});
   await aiTransaction(tx=>tx.execute("UPDATE liekan_ai_run SET created_at=clock_timestamp()-interval '46 seconds' WHERE id=$1::uuid",deadlineRun.row.id));
   await assert.rejects(()=>completeAiRun(admin,deadlineRun,{text:'LIEKAN_OK late'},{ttftMs:null,usage:null}),{code:'timeout'});
   const blocked=await getAiRun(admin,deadlineRun.row.id);assert.notEqual(blocked.state,'completed');
   await aiTransaction(tx=>tx.execute("UPDATE liekan_ai_run SET state='failed',lease_until=NULL WHERE id=$1::uuid",deadlineRun.row.id));
   const crossing=await acceptAiRun(admin,{operation:'test',targetId:personal.id,clientRequestId:randomUUID(),expectedConfigVersion:1});
   await aiTransaction(async tx=>{
    await tx.execute("UPDATE liekan_ai_run SET created_at=clock_timestamp()-interval '44.9 seconds' WHERE id=$1::uuid",crossing.row.id);
    await tx.execute("CREATE FUNCTION review_slow_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.3); RETURN NEW; END $$");
    await tx.execute("CREATE TRIGGER review_slow_commit BEFORE UPDATE ON liekan_ai_run FOR EACH ROW WHEN (NEW.state='completed') EXECUTE FUNCTION review_slow_commit()");
   });
   await assert.rejects(()=>completeAiRun(admin,crossing,{text:'LIEKAN_OK across deadline'},{ttftMs:null,usage:null}),{code:'timeout'});
   assert.notEqual((await getAiRun(admin,crossing.row.id)).state,'completed');
   const verified=await aiTransaction(tx=>tx.query('SELECT verified_config_version FROM liekan_ai_connection WHERE id=$1::uuid',personal.id));
   assert.equal(verified[0].verified_config_version,null,'a deadline crossing must roll back connection verification');
   await aiTransaction(tx=>tx.execute("UPDATE liekan_ai_run SET state='failed',lease_until=NULL WHERE id=$1::uuid",crossing.row.id));
   const analysisConversation=await createAiConversation(member,{websiteId:siteId});
   const analysisCrossing=await acceptAiRun(member,{...request,targetId:analysisConversation.id,localOnly:true,clientRequestId:randomUUID()});
   await aiTransaction(tx=>tx.execute("UPDATE liekan_ai_run SET created_at=clock_timestamp()-interval '119.9 seconds' WHERE id=$1::uuid",analysisCrossing.row.id));
   await assert.rejects(()=>completeAiRun(member,analysisCrossing,{summary:'isolated late analysis'},{ttftMs:null,usage:null,local:true}),{code:'timeout'});
   const analysisMessage=await aiTransaction(tx=>tx.query('SELECT result FROM liekan_ai_message WHERE run_id=$1::uuid',analysisCrossing.row.id));
   assert.equal(analysisMessage[0].result,null,'deadline crossing must roll back the formal analysis answer');
   await aiTransaction(tx=>tx.execute("UPDATE liekan_ai_run SET state='failed',lease_until=NULL WHERE id=$1::uuid",analysisCrossing.row.id));
   const leaseCrossing=await acceptAiRun(admin,{operation:'test',targetId:personal.id,clientRequestId:randomUUID(),expectedConfigVersion:1});
   await aiTransaction(tx=>tx.execute("UPDATE liekan_ai_run SET lease_until=clock_timestamp()+interval '100 milliseconds' WHERE id=$1::uuid",leaseCrossing.row.id));
   await assert.rejects(()=>completeAiRun(admin,leaseCrossing,{text:'LIEKAN_OK across lease'},{ttftMs:null,usage:null}),{code:'interrupted'});
   assert.notEqual((await getAiRun(admin,leaseCrossing.row.id)).state,'completed');
   await aiTransaction(async tx=>{
    await tx.execute('DROP TRIGGER review_slow_commit ON liekan_ai_run');
    await tx.execute('DROP FUNCTION review_slow_commit()');
    await tx.execute("UPDATE liekan_ai_run SET state='failed',lease_until=NULL WHERE id=$1::uuid",leaseCrossing.row.id);
   });
   console.log('Review deadline integration passed: expired and commit-crossing test runs cannot complete or verify a connection.');
  }
  if(process.argv.includes('--review-cancel')){
   const cancellation=await acceptAiRun(admin,{operation:'test',targetId:personal.id,clientRequestId:randomUUID(),expectedConfigVersion:1});
   for(const cleaner of ['maintenance','expiry']){
    await aiTransaction(tx=>tx.execute("UPDATE liekan_ai_run SET state='cancel_requested',stage='cancel_requested',lease_until=now()-interval '1 second' WHERE id=$1::uuid",cancellation.row.id));
    if(cleaner==='maintenance') await cleanupAiData({apply:true});else await aiTransaction(expireAiRuns);
    const recovered=await getAiRun(admin,cancellation.row.id);assert.equal(recovered.state,'cancelled');assert.equal(recovered.stage,'cancelled');assert.equal(recovered.error?.code,'cancelled');
   }
   console.log('Review cancellation integration passed: both expiry paths preserve the cancelled terminal state.');
  }
  if(process.argv.includes('--review-catalog')){
   const extraWebsite=randomUUID(),extraTeam=randomUUID();
   await aiTransaction(async tx=>{
    await tx.execute("WITH teams AS (INSERT INTO team(team_id,name) SELECT gen_random_uuid(),'Z review team '||lpad(n::text,3,'0') FROM generate_series(1,101) n RETURNING team_id) INSERT INTO team_user(team_user_id,team_id,user_id,role) SELECT gen_random_uuid(),team_id,$1::uuid,'team-member' FROM teams",memberId);
    await tx.execute("INSERT INTO website(website_id,name,domain,user_id) SELECT gen_random_uuid(),'B review site '||lpad(n::text,3,'0'),'review.example',$1::uuid FROM generate_series(1,101) n",memberId);
    await tx.execute("INSERT INTO team(team_id,name) VALUES($1::uuid,'ZZ explicit selected team')",extraTeam);
    await tx.execute("INSERT INTO team_user(team_user_id,team_id,user_id,role) VALUES(gen_random_uuid(),$1::uuid,$2::uuid,'team-member')",extraTeam,memberId);
    await tx.execute("INSERT INTO website(website_id,name,domain,team_id) VALUES($1::uuid,'ZZ explicit selected website','selected.example',$2::uuid)",extraWebsite,extraTeam);
   });
   const first=await getAiAccessCatalog(member,{offset:0,websiteId:extraWebsite});
   assert.ok(first.websites.some(row=>row.id===extraWebsite),'explicit accessible website must survive catalog pagination');
   assert.ok(first.spaces.some(row=>row.id===extraTeam),'every returned website must include its space');
   assert.equal(first.nextOffset,100);
   const next=await getAiAccessCatalog(member,{offset:100});
   assert.ok(next.websites.length>0);assert.ok(next.spaces.some(row=>row.name==='Z review team 101'));
   const privateLookup=await getAiAccessCatalog(member,{websiteId:teamSiteId,offset:100});
   assert.ok(privateLookup.websites.some(row=>row.id===teamSiteId));
   const denied=await getAiAccessCatalog(member,{websiteId:personal.id});
   assert.ok(!denied.websites.some(row=>row.id===personal.id));
   console.log('Review catalog integration passed: 100+ websites and teams, explicit selection and complete ownership spaces.');
  }
  const oldKey=process.env.LIEKAN_AI_ENCRYPTION_KEY!,newKey=randomBytes(32).toString('hex');
  const activeConversation=await createAiConversation(member,{websiteId:siteId});
  process.env.LIEKAN_AI_ENABLED='false';
  const before=await aiTransaction(tx=>tx.query('SELECT id,secret_envelope FROM liekan_ai_connection ORDER BY id'));
  await assert.rejects(()=>rotateAiKeys(newKey,randomBytes(32).toString('hex')));
  const unchanged=await aiTransaction(tx=>tx.query('SELECT id,secret_envelope FROM liekan_ai_connection ORDER BY id'));assert.deepEqual(unchanged,before);
  assert.equal((await rotateAiKeys(newKey,oldKey)).rotated,2);
  const encrypted=await aiTransaction(tx=>tx.query('SELECT * FROM liekan_ai_connection ORDER BY id'));
  assert.ok(encrypted.every(row=>decryptAiKey(row.secret_envelope,{connectionId:row.id,space:row.team_id?{kind:'team',id:row.team_id}:{kind:'personal',id:row.owner_user_id}},newKey)===fixtureKey));
  await aiTransaction(async tx=>{
   await tx.execute('INSERT INTO liekan_log(id,website_id,import_id,created_at,path,method,status,bytes,ip_masked,ip_hash,user_agent,location,bot,vendor,bot_type,verification) VALUES($1,$2::uuid,$3::uuid,now(),$4,\'GET\',200,0,\'\',\'\',\'\',\'\',\'GPTBot\',\'OpenAI\',\'训练\',\'unverified\')',randomUUID(),siteId,randomUUID(),'/isolated-statistic');
   await tx.execute("INSERT INTO liekan_ai_message(id,conversation_id,question,origin,expires_at) SELECT gen_random_uuid(),$1::uuid,'isolated expired fixture','local',now()-interval '1 day' FROM generate_series(1,1001)",activeConversation.id);
  });
  const cleaned=await cleanupAiData({apply:true,requestBudget:true});assert.ok('deleted' in cleaned);assert.equal((cleaned as any).deleted+(cleaned as any).cleared,500);
  await aiTransaction(async tx=>{
   await tx.execute('DELETE FROM liekan_ai_message');
   await tx.execute("UPDATE liekan_ai_conversation SET expires_at=now()-interval '1 day' WHERE id=$1::uuid",activeConversation.id);
   await tx.execute("INSERT INTO liekan_ai_message(id,conversation_id,question,origin) SELECT gen_random_uuid(),$1::uuid,'isolated unexpired child fixture','local' FROM generate_series(1,1001)",activeConversation.id);
   await tx.execute("INSERT INTO liekan_ai_context(id,conversation_id,website_epoch,facts,checksum) SELECT gen_random_uuid(),$1::uuid,gen_random_uuid(),'{}'::jsonb,'fixture' FROM generate_series(1,1001)",activeConversation.id);
  });
  for (let batch=0; batch<5; batch++) {
   const beforeChildren=await aiTransaction(tx=>tx.query('SELECT (SELECT count(*) FROM liekan_ai_message WHERE conversation_id=$1::uuid)+(SELECT count(*) FROM liekan_ai_context WHERE conversation_id=$1::uuid)+(SELECT count(*) FROM liekan_ai_conversation WHERE id=$1::uuid) AS total',activeConversation.id));
   const batchResult=await cleanupAiData({apply:true,requestBudget:true});
   const afterChildren=await aiTransaction(tx=>tx.query('SELECT (SELECT count(*) FROM liekan_ai_message WHERE conversation_id=$1::uuid)+(SELECT count(*) FROM liekan_ai_context WHERE conversation_id=$1::uuid)+(SELECT count(*) FROM liekan_ai_conversation WHERE id=$1::uuid) AS total',activeConversation.id));
   assert.ok(beforeChildren[0].total-afterChildren[0].total<=500n,'expired parents must not cascade beyond the cleanup budget');
   assert.ok((batchResult as any).deleted+(batchResult as any).cleared<=500);
   const maintenance=await aiMaintenanceCheck();
   if(batch<4 && afterChildren[0].total>0n)assert.ok(BigInt((maintenance as any).backlog)>0n,'remaining expired-parent content must appear in maintenance backlog');
   if(batch===4){assert.equal(afterChildren[0].total,0n,'repeated bounded batches must drain the expired parent and its children');assert.equal((maintenance as any).backlog,'0');}

  }
  const retainedParent=randomUUID(),oldTitleParent=randomUUID();
  await aiTransaction(async tx=>{
   await tx.execute("INSERT INTO liekan_ai_conversation(id,creator_id,owner_user_id,website_id,website_epoch,title,expires_at) VALUES($1::uuid,$2::uuid,$2::uuid,$3::uuid,gen_random_uuid(),'isolated private expired question title',now()-interval '1 day')",retainedParent,adminId,siteId);
   await tx.execute("INSERT INTO liekan_ai_run(id,creator_id,identity_id,owner_user_id,client_request_id,request_hash,operation,connection_snapshot,config_version,conversation_id,state,stage) SELECT gen_random_uuid(),$2::uuid,$2::uuid,$2::uuid,gen_random_uuid(),'fixture','analysis','{}'::jsonb,1,$1::uuid,'completed','completed' FROM generate_series(1,501)",retainedParent,adminId);
   await tx.execute("INSERT INTO liekan_ai_conversation(id,creator_id,owner_user_id,team_id,website_id,website_epoch,title,created_at,expires_at) SELECT $1::uuid,$2::uuid,w.user_id,w.team_id,w.website_id,s.epoch,'isolated private first-question title',now()-interval '91 days',now()+interval '30 days' FROM website w JOIN liekan_ai_website_state s ON s.website_id=w.website_id WHERE w.website_id=$3::uuid",oldTitleParent,adminId,siteId);
  });
  assert.equal((await getAiConversation(admin,oldTitleParent)).title,'网站分析','read DTO must hide the expired first-question title before cleanup');
  process.env.LIEKAN_AI_ENABLED='true';
  assert.equal((await listAiConversations(admin,siteId)).items.find(row=>row.id===oldTitleParent)?.title,'网站分析','history must hide the expired title before cleanup');
  process.env.LIEKAN_AI_ENABLED='false';
  const retainedBacklog=await aiMaintenanceCheck();
  assert.ok(BigInt((retainedBacklog as any).backlog)>=503n,'retained run references and old question titles must remain in backlog');
  for(let batch=0;batch<2;batch++){
   const result=await cleanupAiData({apply:true});
   assert.ok((result as any).deleted+(result as any).cleared+(result as any).detached<=500,'all content clearing and reference detachment share one budget');
   const rows=await aiTransaction(tx=>tx.query('SELECT (SELECT count(*) FROM liekan_ai_conversation WHERE id=$1::uuid) AS parent,(SELECT count(*) FROM liekan_ai_run WHERE conversation_id=$1::uuid) AS linked,(SELECT count(*) FROM liekan_ai_run) AS runs,(SELECT title FROM liekan_ai_conversation WHERE id=$2::uuid) AS title',retainedParent,oldTitleParent));
   assert.equal(rows[0].title,'网站分析','continued conversations must clear their first-question title after 90 days');
   if(batch===0){assert.ok(rows[0].linked>0n);assert.ok(BigInt((await aiMaintenanceCheck() as any).backlog)>0n);}
   if(batch===1){assert.equal(rows[0].parent,0n);assert.equal(rows[0].linked,0n);assert.ok(rows[0].runs>=501n,'180-day run metadata remains after 90-day content cleanup');assert.equal((await aiMaintenanceCheck() as any).backlog,'0');}
  }
  console.log('Review retention integration passed: old question titles clear at 90 days and 501 retained run pointers drain in bounded batches while metadata remains.');
  await resetRestoredAiData();
  const count=await aiTransaction(tx=>tx.query('SELECT (SELECT count(*) FROM liekan_ai_conversation) AS conversations,(SELECT count(*) FROM liekan_ai_connection WHERE secret_envelope IS NOT NULL OR is_default OR verified_config_version IS NOT NULL) AS usable,(SELECT count(*) FROM liekan_log) AS logs'));
  assert.equal(count[0].conversations,0n);assert.equal(count[0].usable,0n);assert.equal(count[0].logs,1n);
  console.log('Lifecycle integration passed: non-public schema transfer, role and member revoke/restore late-write fences, ordinary/readonly roles, atomic key rotation rollback, bounded cleanup and AI-only restore reset preserving statistics; zero provider calls.');
 }finally{await disconnectAiFactsClient(); await prisma.client.$disconnect();}
}
