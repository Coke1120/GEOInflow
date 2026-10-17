import { crawlerTransaction } from './crawler-access';
/** Bounded transactions allow ingestion and reset to proceed during catch-up cleanup. */
export async function pruneTrafficObservations(now = new Date()) {
  const cutoff = new Date(now.getTime() - 30 * 86400000);
  let deleted = 0;
  while (true) {
    const count = await crawlerTransaction(
      tx =>
        tx.execute(
          `DELETE FROM liekan_event_observation WHERE event_id IN(
      SELECT event_id FROM liekan_event_observation WHERE received_at<$1 ORDER BY received_at,event_id LIMIT 5000 FOR UPDATE SKIP LOCKED
    )`,
          cutoff,
        ),
      { timeout: 30000 },
    );
    deleted += count;
    if (count < 5000) break;
  }
  await crawlerTransaction(
    tx =>
      tx.execute(
        `UPDATE liekan_observation_state s SET pruned_before=greatest(coalesce(pruned_before,$1),$1)
    WHERE NOT EXISTS(SELECT 1 FROM liekan_event_observation o WHERE o.website_id=s.website_id AND o.received_at<$1)`,
        cutoff,
      ),
    { timeout: 30000 },
  );
  return { deleted, prunedBefore: cutoff.toISOString() };
}
