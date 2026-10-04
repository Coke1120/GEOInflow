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
import {createAiConversation,getAiConversation} from '../../../src/lib/liekan/ai/conversations';
import {acceptAiRun,getAiRun,setAiRunStage,completeAiRun} from '../../../src/lib/liekan/ai/runs';
import {cleanupAiData,rotateAiKeys,resetRestoredAiData} from '../../../src/lib/liekan/ai/maintenance';
import {decryptAiKey} from '../../../src/lib/liekan/ai/crypto';
const url=new URL(process.env.DATABASE_URL!);
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'15439');assert.equal(url.pathname,'/liekan_ai_acceptance');
const primary:any=getRawQueryClient(prisma.client,{write:true});
const child=process.argv.includes('--schema-child');
if(!child){
 const schema='ai_lifecycle_'+randomUUID().replaceAll('-','');
 try{
  await primary.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  for(const table of ['user','team','team_user','website','liekan_log'])await primary.$executeRawUnsafe(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
  for(const migration of ['007_ai_connections.sql','008_ai_conversations.sql','009_ai_endpoint_limits.sql','010_ai_workspaces.sql','011_ai_config_audit.sql','012_ai_invariants_and_history.sql'])execFileSync('docker',['exec','-i','liekan-ai-acceptance-db','psql','-U','liekan_ai','-d','liekan_ai_acceptance','-v','ON_ERROR_STOP=1'],{input:`SET search_path TO "${schema}";\n`+readFileSync('db/liekan/migrations/'+migration,'utf8'),stdio:['pipe','pipe','pipe'],timeout:30000});
  const childUrl=new URL(url);childUrl.searchParams.set('schema',schema);
  const result=spawnSync(process.execPath,['--import','tsx','tests/liekan/ai/lifecycle.integration.ts','--schema-child'],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:childUrl.toString()},encoding:'utf8',timeout:60000});
  if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
  assert.equal(result.status,0,'isolated custom-schema lifecycle child must pass');
 }finally{
  await primary.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await prisma.client.$disconnect();
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
  await transferWebsiteWithAi(siteId,{userId:adminId},{userId:memberId,teamId:null});
  await assert.rejects(()=>getAiConversation(admin,oldConversation.id),{status:404});
  assert.equal((await primary.website.findUnique({where:{id:siteId}})).userId,memberId);
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
  await resetRestoredAiData();
  const count=await aiTransaction(tx=>tx.query('SELECT (SELECT count(*) FROM liekan_ai_conversation) AS conversations,(SELECT count(*) FROM liekan_ai_connection WHERE secret_envelope IS NOT NULL OR is_default OR verified_config_version IS NOT NULL) AS usable,(SELECT count(*) FROM liekan_log) AS logs'));
  assert.equal(count[0].conversations,0n);assert.equal(count[0].usable,0n);assert.equal(count[0].logs,1n);
  console.log('Lifecycle integration passed: non-public schema transfer, role and member revoke/restore late-write fences, ordinary/readonly roles, atomic key rotation rollback, bounded cleanup and AI-only restore reset preserving statistics; zero provider calls.');
 }finally{await prisma.client.$disconnect();}
}
