/** Read under the website's existing collection/import lock; callers never accept a payload override. */
export async function collectionRepairScope(
  tx: { $queryRawUnsafe<T>(sql: string, ...values: unknown[]): Promise<T> },
  websiteId: string,
): Promise<string | null> {
  const [row] = await tx.$queryRawUnsafe<{ repair_scope_id: string }[]>(
    'SELECT repair_scope_id FROM liekan_history_repair_run WHERE website_id=$1::uuid',
    websiteId,
  );
  return row?.repair_scope_id || null;
}
