import { lockWritableWebsite, type WriteIdentity } from './server';
export async function resetLiekanStatistics(tx: any, websiteId: string, identity?: WriteIdentity) {
  const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('Invalid database schema');
  await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
  await lockWritableWebsite(tx, websiteId, identity);
  await tx.$executeRawUnsafe("INSERT INTO liekan_log_state(website_id,epoch,reset_at,data_revision,policy_revision) VALUES($1::uuid,2,clock_timestamp(),1,1) ON CONFLICT(website_id) DO UPDATE SET epoch=liekan_log_state.epoch+1,reset_at=clock_timestamp(),data_revision=liekan_log_state.data_revision+1,policy_revision=liekan_log_state.policy_revision+1",websiteId);
  await tx.$executeRawUnsafe("UPDATE liekan_ingest_batch SET state='cancelled',payload=NULL WHERE website_id=$1::uuid AND state='pending'",websiteId);
  await tx.$executeRawUnsafe('DELETE FROM liekan_log_grant WHERE website_id=$1::uuid',websiteId);
  await tx.$executeRawUnsafe('DELETE FROM liekan_log_interval WHERE website_id=$1::uuid',websiteId);
  await tx.$executeRawUnsafe("INSERT INTO liekan_log_interval(id,website_id,source_id,starts_at) SELECT gen_random_uuid(),website_id,id,clock_timestamp() FROM liekan_log_source WHERE website_id=$1::uuid AND state='active'",websiteId);
  await tx.$executeRawUnsafe('DELETE FROM liekan_log WHERE website_id=$1::uuid', websiteId);
  await tx.$executeRawUnsafe('DELETE FROM liekan_import WHERE website_id=$1::uuid', websiteId);
}
export async function stopWebsiteSources(tx:any,websiteId:string,deleted=false) {
  const schema=new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
  if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema))throw new Error('Invalid database schema');
  await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
  await lockWritableWebsite(tx,websiteId);
  await tx.$queryRawUnsafe(`UPDATE liekan_log_source SET state=$2,credential_hash=NULL,error_code='website-changed' WHERE website_id=$1::uuid AND state!='disconnected' RETURNING id,kind,provider_job_id`,websiteId,deleted?'disconnected':'paused');
  await tx.$executeRawUnsafe('UPDATE liekan_log_interval SET ends_at=clock_timestamp() WHERE website_id=$1::uuid AND ends_at IS NULL',websiteId);
  await tx.$executeRawUnsafe("UPDATE liekan_ingest_batch SET state='cancelled',payload=NULL WHERE website_id=$1::uuid AND state='pending'",websiteId);
  await tx.$executeRawUnsafe('DELETE FROM liekan_log_grant WHERE website_id=$1::uuid',websiteId);
  await tx.$executeRawUnsafe('UPDATE liekan_log_state SET policy_revision=policy_revision+1 WHERE website_id=$1::uuid',websiteId);
  // Provider cleanup is reconciled from these durable source rows by the worker.
}
