import { clearAiWebsiteInTransaction } from './ai-lifecycle';
import { lockWritableWebsite, type WriteIdentity } from './server';
export async function resetLiekanStatistics(tx: any, websiteId: string, identity?: WriteIdentity) {
  const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('Invalid database schema');
  await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
  await lockWritableWebsite(tx, websiteId, identity);
  await clearAiWebsiteInTransaction(tx, websiteId);
  for (const table of [
    'liekan_crawler_finding_window',
    'liekan_crawler_finding',
    'liekan_crawler_quality',
    'liekan_crawler_catalog_snapshot',
    'liekan_crawler_analysis_state',
  ])
    await tx.$executeRawUnsafe(`DELETE FROM ${table} WHERE website_id=$1::uuid`, websiteId);
  await tx.$executeRawUnsafe(
    "UPDATE liekan_crawler_check SET state='cancelled',result=NULL,completed_at=now() WHERE website_id=$1::uuid AND state IN('queued','running')",
    websiteId,
  );
  await tx.$executeRawUnsafe(
    "DELETE FROM liekan_crawler_check WHERE website_id=$1::uuid AND state NOT IN('queued','running')",
    websiteId,
  );
  await tx.$executeRawUnsafe(
    'INSERT INTO liekan_log_state(website_id,epoch,reset_at,data_revision,policy_revision) VALUES($1::uuid,2,clock_timestamp(),1,1) ON CONFLICT(website_id) DO UPDATE SET epoch=liekan_log_state.epoch+1,reset_at=clock_timestamp(),data_revision=liekan_log_state.data_revision+1,policy_revision=liekan_log_state.policy_revision+1',
    websiteId,
  );
  await tx.$executeRawUnsafe(
    "UPDATE liekan_ingest_batch SET state='cancelled',payload=NULL WHERE website_id=$1::uuid AND state='pending'",
    websiteId,
  );
  await tx.$executeRawUnsafe('DELETE FROM liekan_log_grant WHERE website_id=$1::uuid', websiteId);
  await tx.$executeRawUnsafe(
    'UPDATE liekan_oauth_cleanup SET expires_at=clock_timestamp() WHERE website_id=$1::uuid',
    websiteId,
  );
  await tx.$executeRawUnsafe(
    'DELETE FROM liekan_log_interval WHERE website_id=$1::uuid',
    websiteId,
  );
  await tx.$executeRawUnsafe(
    "INSERT INTO liekan_log_interval(id,website_id,source_id,starts_at) SELECT gen_random_uuid(),website_id,id,clock_timestamp() FROM liekan_log_source WHERE website_id=$1::uuid AND state='active'",
    websiteId,
  );
  await tx.$executeRawUnsafe('DELETE FROM liekan_log WHERE website_id=$1::uuid', websiteId);
  await tx.$executeRawUnsafe('DELETE FROM liekan_import WHERE website_id=$1::uuid', websiteId);
}
export async function stopWebsiteSources(tx: any, websiteId: string, deleted = false) {
  const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('Invalid database schema');
  await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
  await lockWritableWebsite(tx, websiteId);
  await tx.$executeRawUnsafe(
    'UPDATE liekan_crawler_state SET generation=generation+1,deleted_at=CASE WHEN $2 THEN now() ELSE deleted_at END,updated_at=now() WHERE website_id=$1::uuid',
    websiteId,
    deleted,
  );
  await tx.$executeRawUnsafe(
    "UPDATE liekan_crawler_connection SET state='frozen',token_encrypted=NULL,updated_at=now() WHERE website_id=$1::uuid AND state IN('active','cleanup')",
    websiteId,
  );
  await tx.$executeRawUnsafe(
    "UPDATE liekan_crawler_deployment SET state='failed',error_code='website-changed',completed_at=now(),updated_at=now() WHERE website_id=$1::uuid AND state='queued'",
    websiteId,
  );
  await tx.$executeRawUnsafe(
    "UPDATE liekan_crawler_check SET state='cancelled',result=NULL,completed_at=now() WHERE website_id=$1::uuid AND state IN('queued','running')",
    websiteId,
  );
  await tx.$executeRawUnsafe(
    'DELETE FROM liekan_crawler_domain_verification WHERE website_id=$1::uuid',
    websiteId,
  );
  await tx.$queryRawUnsafe(
    `UPDATE liekan_log_source SET state=$2,credential_hash=NULL,error_code='website-changed' WHERE website_id=$1::uuid AND state!='disconnected' RETURNING id,kind,provider_job_id`,
    websiteId,
    deleted ? 'disconnected' : 'paused',
  );
  await tx.$executeRawUnsafe(
    'UPDATE liekan_log_interval SET ends_at=clock_timestamp() WHERE website_id=$1::uuid AND ends_at IS NULL',
    websiteId,
  );
  await tx.$executeRawUnsafe(
    "UPDATE liekan_ingest_batch SET state='cancelled',payload=NULL WHERE website_id=$1::uuid AND state='pending'",
    websiteId,
  );
  await tx.$executeRawUnsafe('DELETE FROM liekan_log_grant WHERE website_id=$1::uuid', websiteId);
  await tx.$executeRawUnsafe(
    'UPDATE liekan_oauth_cleanup SET expires_at=clock_timestamp() WHERE website_id=$1::uuid',
    websiteId,
  );
  await tx.$executeRawUnsafe(
    'UPDATE liekan_log_state SET policy_revision=policy_revision+1 WHERE website_id=$1::uuid',
    websiteId,
  );
  // Provider cleanup is reconciled from these durable source rows by the worker.
}
