import { crawlerTransaction, authorizeCrawler } from '../upstream/crawler-access';
import { LiekanError } from '../upstream/errors';
import { hostname } from '../log-ingestion/protocol';
export async function maintainCrawlerRecords() {
  const connections = await crawlerTransaction(tx =>
    tx.query(
      "SELECT id,website_id,created_by,owner_user_id,team_id,domain FROM liekan_crawler_connection WHERE state='active' ORDER BY updated_at LIMIT 50",
    ),
  );
  for (const row of connections) {
    try {
      await crawlerTransaction(async tx => {
        const site = await authorizeCrawler(
          tx,
          { id: row.created_by, role: '' },
          row.website_id,
          'control',
        );
        if (
          hostname(site.domain) !== row.domain ||
          site.ownerUserId !== row.owner_user_id ||
          site.teamId !== row.team_id
        )
          throw new LiekanError('控制归属已变化', 409);
        await tx.execute(
          'UPDATE liekan_crawler_connection SET updated_at=now() WHERE id=$1::uuid',
          row.id,
        );
      });
    } catch (error) {
      if (!(error instanceof LiekanError) || ![401, 403, 404, 409].includes(error.status)) continue;
      await crawlerTransaction(async tx => {
        await tx.execute(
          "UPDATE liekan_crawler_connection SET state='frozen',token_encrypted=NULL,updated_at=now() WHERE id=$1::uuid AND state='active'",
          row.id,
        );
        await tx.execute(
          "UPDATE liekan_crawler_deployment SET state='failed',error_code='control-permission-changed',completed_at=now(),updated_at=now() WHERE connection_id=$1::uuid AND state='queued'",
          row.id,
        );
      });
    }
  }
  await crawlerTransaction(async tx => {
    await tx.execute(
      "UPDATE liekan_crawler_connection SET token_encrypted=NULL,state='disconnected',updated_at=now() WHERE state='cleanup' AND cleanup_until<now()",
    );
    await tx.execute(
      "DELETE FROM liekan_crawler_preview p WHERE expires_at<now()-interval '1 day' AND NOT EXISTS(SELECT 1 FROM liekan_crawler_deployment d WHERE d.preview_id=p.id)",
    );
    await tx.execute(
      "DELETE FROM liekan_crawler_check WHERE created_at<now()-interval '90 days' AND state NOT IN('queued','running')",
    );
    await tx.execute(
      "DELETE FROM liekan_crawler_finding_window WHERE window_end<now()-interval '90 days'",
    );
    await tx.execute(
      "DELETE FROM liekan_crawler_finding WHERE last_seen_at<now()-interval '90 days'",
    );
    await tx.execute(
      "DELETE FROM liekan_crawler_catalog_snapshot WHERE snapshot_at<now()-interval '90 days'",
    );
    await tx.execute("DELETE FROM liekan_crawler_quality WHERE ends_at<now()-interval '90 days'");
    await tx.execute(
      "DELETE FROM liekan_crawler_deployment WHERE completed_at<now()-interval '180 days' AND state IN('confirmed','failed','conflict') AND NOT EXISTS(SELECT 1 FROM liekan_crawler_policy p WHERE p.id=liekan_crawler_deployment.policy_id AND p.applied_version=liekan_crawler_deployment.policy_version)",
    );
    const expired = await tx.query(
      "SELECT website_id FROM liekan_crawler_state s WHERE deleted_at<now()-interval '180 days' AND NOT EXISTS(SELECT 1 FROM liekan_crawler_deployment d WHERE d.website_id=s.website_id AND d.state IN('queued','running','unknown','cleanup')) LIMIT 50 FOR UPDATE",
    );
    for (const row of expired) {
      for (const table of ['liekan_crawler_deployment', 'liekan_crawler_preview'])
        await tx.execute(`DELETE FROM ${table} WHERE website_id=$1::uuid`, row.website_id);
      await tx.execute(
        'DELETE FROM liekan_crawler_policy_version WHERE policy_id IN(SELECT id FROM liekan_crawler_policy WHERE website_id=$1::uuid)',
        row.website_id,
      );
      for (const table of [
        'liekan_crawler_policy',
        'liekan_crawler_connection',
        'liekan_crawler_domain_verification',
        'liekan_crawler_check',
        'liekan_crawler_finding_window',
        'liekan_crawler_finding',
        'liekan_crawler_quality',
        'liekan_crawler_catalog_snapshot',
        'liekan_crawler_analysis_state',
        'liekan_crawler_state',
      ])
        await tx.execute(`DELETE FROM ${table} WHERE website_id=$1::uuid`, row.website_id);
    }
  });
}
