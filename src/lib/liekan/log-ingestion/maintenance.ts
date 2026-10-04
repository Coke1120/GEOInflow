import { query, transaction, LiekanError } from '../upstream/server';
import { validateSource } from './service';
export async function reconcilePermissions() {
  const sources = await query(
    "SELECT id FROM liekan_log_source WHERE state IN ('active','configuring') ORDER BY last_permission_check_at NULLS FIRST LIMIT 100",
  );
  for (const source of sources) {
    try {
      await transaction(async tx => {
        await validateSource(tx, source.id, undefined, true);
        await tx.$executeRawUnsafe(
          'UPDATE liekan_log_source SET last_permission_check_at=now() WHERE id=$1::uuid',
          source.id,
        );
      });
    } catch (error) {
      if (!(error instanceof LiekanError) || ![401, 403, 404].includes(error.status)) continue;
      await transaction(async tx => {
        await tx.$queryRawUnsafe(
          'SELECT website_id FROM website WHERE website_id=(SELECT website_id FROM liekan_log_source WHERE id=$1::uuid) FOR UPDATE',
          source.id,
        );
        await tx.$executeRawUnsafe(
          "UPDATE liekan_log_source SET state='error',credential_hash=NULL,error_code='reauthorization-required',last_permission_check_at=now() WHERE id=$1::uuid",
          source.id,
        );
        await tx.$executeRawUnsafe(
          'UPDATE liekan_log_interval SET ends_at=clock_timestamp() WHERE source_id=$1::uuid AND ends_at IS NULL',
          source.id,
        );
        await tx.$executeRawUnsafe(
          "UPDATE liekan_ingest_batch SET state='cancelled',payload=NULL WHERE source_id=$1::uuid AND state='pending'",
          source.id,
        );
        await tx.$executeRawUnsafe(
          'UPDATE liekan_log_state SET policy_revision=policy_revision+1 WHERE website_id=(SELECT website_id FROM liekan_log_source WHERE id=$1::uuid)',
          source.id,
        );
      });
    }
  }
}
