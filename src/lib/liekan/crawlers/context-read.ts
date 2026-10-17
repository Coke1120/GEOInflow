import { z } from 'zod';
import { sanitizeExportValue } from '../contracts/exports';
import type { contextQuerySchema } from '../contracts/crawler-workflow';
import {
  crawlerTransaction,
  authorizeCrawler,
  type CrawlerActor,
} from '../upstream/crawler-access';
import { findingWorkflow } from './workflow';
import { LiekanError } from '../upstream/errors';
export async function readCrawlerContext(
  actor: CrawlerActor,
  websiteId: string,
  p: z.infer<typeof contextQuerySchema>,
) {
  if (
    p.endAt <= p.startAt ||
    p.endAt - p.startAt > 92 * 86400000 ||
    p.endAt > Date.now() + 86400000
  )
    throw new LiekanError('上下文时间范围无效', 400);
  const result = await crawlerTransaction(
    async tx => {
      const access = await authorizeCrawler(tx, actor, websiteId);
      const workflow = p.findingKey ? await findingWorkflow(tx, websiteId, p.findingKey) : null;
      const [logState] = await tx.query(
        'SELECT epoch FROM liekan_log_state WHERE website_id=$1::uuid',
        websiteId,
      );
      const epoch = logState?.epoch ?? 1;
      const union = `SELECT id::text AS id,'manual' AS source,title,note,occurred_at,created_at,voided_at,void_reason,created_by::text AS actor,epoch
      FROM liekan_crawler_context WHERE website_id=$1::uuid AND occurred_at>=$2 AND occurred_at<$3 ${p.history === 'all' ? 'AND $4::int IS NOT NULL' : 'AND epoch=$4'}
      UNION ALL SELECT id::text,'policy',operation,state,coalesce(completed_at,created_at),created_at,NULL,NULL,actor_id::text,NULL::int
      FROM liekan_crawler_deployment WHERE website_id=$1::uuid AND coalesce(completed_at,created_at)>=$2 AND coalesce(completed_at,created_at)<$3
      UNION ALL SELECT id::text,'check','robots',state,coalesce(completed_at,created_at),created_at,NULL,NULL,actor_id::text,NULL::int
      FROM liekan_crawler_check WHERE website_id=$1::uuid AND coalesce(completed_at,created_at)>=$2 AND coalesce(completed_at,created_at)<$3
      UNION ALL SELECT snapshot_at::text,'catalog','catalog',jsonb_array_length(paths)::text,snapshot_at,snapshot_at,NULL,NULL,NULL,NULL::int
      FROM liekan_crawler_catalog_snapshot WHERE website_id=$1::uuid AND snapshot_at>=$2 AND snapshot_at<$3`;
      const args = [websiteId, new Date(p.startAt), new Date(p.endAt), epoch];
      const [count] = await tx.query(
        `SELECT count(*)::int AS total FROM (${union}) records`,
        ...args,
      );
      const rows = await tx.query(
        `SELECT * FROM (${union}) records ORDER BY occurred_at DESC,source,id LIMIT 20 OFFSET $5`,
        ...args,
        (p.page - 1) * 20,
      );
      const actions = p.findingKey
        ? await tx.query(
            'SELECT request_id,action,note,actor_id,occurred_at,before_state,after_state FROM liekan_crawler_finding_action WHERE website_id=$1::uuid AND finding_key=$2 ORDER BY occurred_at DESC,request_id LIMIT 20 OFFSET $3',
            websiteId,
            p.findingKey,
            (p.actionPage - 1) * 20,
          )
        : [];
      const [actionCount] = p.findingKey
        ? await tx.query(
            'SELECT count(*)::int AS total FROM liekan_crawler_finding_action WHERE website_id=$1::uuid AND finding_key=$2',
            websiteId,
            p.findingKey,
          )
        : [{ total: 0 }];
      let evidence = null;
      if (p.referenceId || p.referenceSource) {
        if (!p.referenceId || !p.referenceSource) throw new LiekanError('原始证据标识无效', 400);
        let record;
        if (p.referenceSource === 'catalog') {
          const timestamp = new Date(p.referenceId);
          if (!Number.isFinite(+timestamp)) throw new LiekanError('原始证据标识无效', 400);
          [record] = await tx.query(
            'SELECT snapshot_at,paths FROM liekan_crawler_catalog_snapshot WHERE website_id=$1::uuid AND snapshot_at=$2 AND snapshot_at>=$3 AND snapshot_at<$4',
            websiteId,
            timestamp,
            new Date(p.startAt),
            new Date(p.endAt),
          );
        } else {
          if (!z.uuid().safeParse(p.referenceId).success)
            throw new LiekanError('原始证据标识无效', 400);
          const table =
            p.referenceSource === 'check' ? 'liekan_crawler_check' : 'liekan_crawler_deployment';
          const fields =
            p.referenceSource === 'check'
              ? 'id,epoch,hostname,paths,state,result,error_code,created_at,completed_at'
              : 'id,policy_id,policy_version,operation,state,input_hash,before_snapshot,result,error_code,created_at,completed_at';
          [record] = await tx.query(
            `SELECT ${fields} FROM ${table} WHERE website_id=$1::uuid AND id=$2::uuid AND coalesce(completed_at,created_at)>=$3 AND coalesce(completed_at,created_at)<$4`,
            websiteId,
            p.referenceId,
            new Date(p.startAt),
            new Date(p.endAt),
          );
        }
        if (!record) throw new LiekanError('原始证据不存在或不在所选窗口', 404);
        if (Buffer.byteLength(JSON.stringify(record)) > 1024 * 1024)
          throw new LiekanError('原始证据超过显示上限', 413);
        evidence = {
          id: p.referenceId,
          source: p.referenceSource,
          record: sanitizeExportValue(JSON.parse(JSON.stringify(record))),
        };
      }
      return {
        evidence,
        rows,
        actions,
        actionTotal: actionCount.total,
        actionPage: p.actionPage,
        workflow,
        canDraft: access.canDraft,
        total: count.total,
        page: p.page,
        pageSize: 20,
        conditions: p,
      };
    },
    { repeatableRead: true },
  );
  await crawlerTransaction(tx => authorizeCrawler(tx, actor, websiteId));
  return result;
}
