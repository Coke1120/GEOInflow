import type { RepairTx } from './history-repair-db';
/** Lifecycle calls execute inside the same website mutation transaction. */
export async function clearHistoryRepair(tx: RepairTx, websiteId: string, deleted = false) {
  if (deleted) {
    await tx.$executeRawUnsafe(
      'DELETE FROM liekan_history_repair_run WHERE website_id=$1::uuid',
      websiteId,
    );
    await tx.$executeRawUnsafe(
      'DELETE FROM liekan_history_repair_action WHERE website_id=$1::uuid',
      websiteId,
    );
    return;
  }
  // Reset removes identifiers and all computed totals, retaining campaign eligibility.
  await tx.$executeRawUnsafe(
    'DELETE FROM liekan_history_repair_run WHERE website_id=$1::uuid',
    websiteId,
  );
  await tx.$executeRawUnsafe(
    'DELETE FROM liekan_history_repair_action WHERE website_id=$1::uuid',
    websiteId,
  );
}
export async function invalidateHistoryRepair(tx: RepairTx, websiteId: string) {
  await tx.$executeRawUnsafe(
    `UPDATE liekan_history_repair_run SET status=CASE WHEN status IN('completed','completed_limited','rolled_back') THEN status ELSE 'invalidated' END,revision=revision+1,lease_token=NULL,lease_until=NULL,error_code='history-repair-website-changed',completed_at=CASE WHEN active_generation IS NULL THEN clock_timestamp() ELSE completed_at END,updated_at=clock_timestamp() WHERE website_id=$1::uuid`,
    websiteId,
  );
}
