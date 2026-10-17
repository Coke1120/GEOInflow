import { crawlerTransaction } from './crawler-access';
/** Run before rolling back to a worker that cannot maintain workflow epochs. */
export async function invalidateCrawlerWorkflowForRollback() {
  return crawlerTransaction(
    async tx => {
      await tx.query(
        "SELECT website_id FROM website WHERE website_id IN(SELECT website_id FROM liekan_crawler_finding_workflow WHERE state<>'pending') ORDER BY website_id FOR UPDATE",
      );
      const rows =
        await tx.query(`WITH prior AS MATERIALIZED(SELECT * FROM liekan_crawler_finding_workflow WHERE state<>'pending' FOR UPDATE),
      changed AS(UPDATE liekan_crawler_finding_workflow w SET state='pending',snoozed_until=NULL,workflow_revision=w.workflow_revision+1,updated_at=now()
        FROM prior p WHERE w.website_id=p.website_id AND w.finding_key=p.finding_key RETURNING w.*)
      INSERT INTO liekan_crawler_finding_action(website_id,request_id,request_hash,finding_key,actor_id,action,note,before_state,after_state)
      SELECT p.website_id,gen_random_uuid(),'rollback-maintenance',p.finding_key,NULL,'rollback_invalidate','Application rollback',to_jsonb(p),to_jsonb(c)
      FROM prior p JOIN changed c USING(website_id,finding_key) RETURNING finding_key`);
      return { invalidated: rows.length };
    },
    { timeout: 30000 },
  );
}
