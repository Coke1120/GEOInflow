import type { AiTx } from '../upstream/ai-db';
export function occurrenceAfter(previous: any, current: any, triggered: boolean) {
  const resolved =
    previous?.state === 'resolved'
      ? new Date(
          Math.max(
            +new Date(previous.window_end),
            previous.resolved_window_end ? +new Date(previous.resolved_window_end) : 0,
          ),
        )
      : (previous?.resolved_window_end ?? null);
  const recurrent =
    !!(previous?.state === 'resolved' || previous?.recurrence_pending) &&
    current.state === 'active' &&
    triggered &&
    +new Date(current.facts.windowEnd) > +new Date(resolved);
  return {
    recurrencePending:
      current.state === 'resolved' ||
      (!recurrent && !!(previous?.state === 'resolved' || previous?.recurrence_pending)),
    occurrenceVersion: (previous?.occurrence_version ?? 1) + (recurrent ? 1 : 0),
    resolvedWindowEnd:
      current.state === 'resolved'
        ? new Date(Math.max(+new Date(current.window_end), resolved ? +new Date(resolved) : 0))
        : resolved,
  };
}
export async function reconcileFindingWorkflow(
  tx: AiTx,
  websiteId: string,
  before: any[],
  triggered: Set<string>,
  epoch: number,
) {
  const old = new Map(before.map(row => [row.key, row]));
  const transitions = [];
  const clear = [];
  for (const current of await tx.query(
    'SELECT * FROM liekan_crawler_finding WHERE website_id=$1::uuid FOR UPDATE',
    websiteId,
  )) {
    const transition = occurrenceAfter(old.get(current.key), current, triggered.has(current.key));
    if (
      current.occurrence_version !== transition.occurrenceVersion ||
      current.recurrence_pending !== transition.recurrencePending ||
      +new Date(current.resolved_window_end) !== +new Date(transition.resolvedWindowEnd)
    )
      transitions.push({
        key: current.key,
        occurrence: transition.occurrenceVersion,
        resolved: transition.resolvedWindowEnd,
        pending: transition.recurrencePending,
      });
    if (old.get(current.key)?.state === 'resolved' || current.state !== 'active')
      clear.push(current.key);
  }
  if (transitions.length)
    await tx.execute(
      `UPDATE liekan_crawler_finding f SET occurrence_version=t.occurrence,resolved_window_end=t.resolved,recurrence_pending=t.pending
    FROM jsonb_to_recordset($2::jsonb) AS t(key text,occurrence integer,resolved timestamptz,pending boolean)
    WHERE f.website_id=$1::uuid AND f.key=t.key`,
      websiteId,
      JSON.stringify(transitions),
    );
  if (clear.length)
    await tx.execute(
      "UPDATE liekan_crawler_finding_workflow SET state='pending',snoozed_until=NULL,workflow_revision=workflow_revision+1,updated_at=now() WHERE website_id=$1::uuid AND finding_key=ANY($2::text[]) AND (state<>'pending' OR snoozed_until IS NOT NULL)",
      websiteId,
      clear,
    );
  await tx.execute(
    `UPDATE liekan_crawler_finding_workflow w SET state='pending',snoozed_until=NULL,workflow_revision=w.workflow_revision+1,updated_at=now()
    FROM liekan_crawler_finding f WHERE f.website_id=$1::uuid AND w.website_id=f.website_id AND w.finding_key=f.key AND (w.state<>'pending' OR w.snoozed_until IS NOT NULL)
    AND (w.occurrence_version<>f.occurrence_version OR w.epoch<>$2 OR w.classification_version IS DISTINCT FROM f.facts->'lastQuality'->>'classificationVersion'
      OR (CASE f.grade WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END)>(CASE w.bound_grade WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END))`,
    websiteId,
    epoch,
  );
}
