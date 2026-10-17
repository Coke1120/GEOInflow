import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
  workflowWriteSchema,
  contextWriteSchema,
  contextVoidSchema,
} from '../contracts/crawler-workflow';
import {
  crawlerTransaction,
  authorizeCrawler,
  type CrawlerActor,
} from '../upstream/crawler-access';
import type { AiTx } from '../upstream/ai-db';
import { LiekanError } from '../upstream/errors';
import { contentHash } from './evidence-read';
import { analyticsCache, websiteCacheTag } from '../upstream/query-cache';

export function findingFactVersion(finding: any, epoch: number) {
  return contentHash({
    facts: finding.facts,
    state: finding.state,
    grade: finding.grade,
    windowEnd: finding.window_end,
    occurrence: finding.occurrence_version,
    epoch,
  });
}
export async function findingWorkflow(tx: AiTx, websiteId: string, key: string, lock = false) {
  const [finding] = await tx.query(
    `SELECT * FROM liekan_crawler_finding WHERE website_id=$1::uuid AND key=$2${lock ? ' FOR UPDATE' : ''}`,
    websiteId,
    key,
  );
  if (!finding) throw new LiekanError('风险记录不存在', 404);
  const [state] = await tx.query(
    'SELECT epoch FROM liekan_log_state WHERE website_id=$1::uuid',
    websiteId,
  );
  const epoch = state?.epoch ?? 1;
  const classificationVersion = finding.facts?.lastQuality?.classificationVersion ?? null;
  const [stored] = await tx.query(
    `SELECT * FROM liekan_crawler_finding_workflow WHERE website_id=$1::uuid AND finding_key=$2${lock ? ' FOR UPDATE' : ''}`,
    websiteId,
    key,
  );
  const gradeRank = { info: 1, low: 1, medium: 2, high: 3 };
  const valid =
    stored &&
    (gradeRank[stored.bound_grade] ?? 0) >= gradeRank[finding.grade] &&
    stored.occurrence_version === finding.occurrence_version &&
    stored.epoch === epoch &&
    stored.classification_version === classificationVersion &&
    finding.state === 'active';
  const workflowState =
    valid && !(stored.state === 'snoozed' && +new Date(stored.snoozed_until) <= Date.now())
      ? stored.state
      : 'pending';
  return {
    finding,
    epoch,
    classificationVersion,
    workflowRevision: stored?.workflow_revision ?? 0,
    occurrenceVersion: finding.occurrence_version,
    factVersion: findingFactVersion(finding, epoch),
    state: workflowState,
    snoozedUntil: workflowState === 'snoozed' ? stored.snoozed_until : null,
    pending: finding.state === 'active' && workflowState === 'pending',
  };
}
async function lockWebsite(tx: AiTx, actor: CrawlerActor, websiteId: string) {
  await tx.query('SELECT website_id FROM website WHERE website_id=$1::uuid FOR UPDATE', websiteId);
  return authorizeCrawler(tx, actor, websiteId, 'draft');
}
async function replay(tx: AiTx, websiteId: string, requestId: string, hash: string) {
  const [old] = await tx.query(
    'SELECT request_hash,after_state FROM liekan_crawler_finding_action WHERE website_id=$1::uuid AND request_id=$2::uuid',
    websiteId,
    requestId,
  );
  if (old && old.request_hash !== hash) throw new LiekanError('请求标识已用于不同操作', 409);
  return old?.after_state;
}
async function audit(
  tx: AiTx,
  actor: CrawlerActor,
  websiteId: string,
  requestId: string,
  hash: string,
  action: string,
  before: unknown,
  after: unknown,
  key: string | null = null,
  note: string | null = null,
) {
  await tx.execute(
    'INSERT INTO liekan_crawler_finding_action(website_id,request_id,request_hash,finding_key,actor_id,action,note,before_state,after_state) VALUES($1::uuid,$2::uuid,$3,$4,$5::uuid,$6,$7,$8::jsonb,$9::jsonb)',
    websiteId,
    requestId,
    hash,
    key,
    actor.id,
    action,
    note,
    JSON.stringify(before),
    JSON.stringify(after),
  );
}
export async function changeFindingWorkflow(
  actor: CrawlerActor,
  websiteId: string,
  key: string,
  p: z.infer<typeof workflowWriteSchema>,
) {
  const result = await crawlerTransaction(async tx => {
    await lockWebsite(tx, actor, websiteId);
    const hash = contentHash({ actor: actor.id, key, p });
    const old = await replay(tx, websiteId, p.requestId, hash);
    if (old) return old;
    const current = await findingWorkflow(tx, websiteId, key, true);
    if (
      p.expectedWorkflowRevision !== current.workflowRevision ||
      p.occurrenceVersion !== current.occurrenceVersion ||
      p.factVersion !== current.factVersion
    )
      throw new LiekanError('风险或处理状态已变化，请重新读取', 409);
    if (p.action === 'resume' && current.finding.state === 'ignored')
      throw new LiekanError('请先使用既有权限解除忽略', 409);
    if (current.finding.state !== 'active' && p.action !== 'comment')
      throw new LiekanError('当前风险无需待处理操作', 409);
    const state =
      p.action === 'view'
        ? 'viewed'
        : p.action === 'snooze'
          ? 'snoozed'
          : p.action === 'resume'
            ? 'pending'
            : current.state;
    const until =
      p.action === 'snooze'
        ? new Date(Date.now() + p.hours * 3600000)
        : p.action === 'comment'
          ? current.snoozedUntil
          : null;
    await tx.execute(
      `INSERT INTO liekan_crawler_finding_workflow(website_id,finding_key,workflow_revision,occurrence_version,epoch,classification_version,state,snoozed_until,bound_grade)
      VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(website_id,finding_key) DO UPDATE SET workflow_revision=EXCLUDED.workflow_revision,occurrence_version=EXCLUDED.occurrence_version,epoch=EXCLUDED.epoch,classification_version=EXCLUDED.classification_version,state=EXCLUDED.state,snoozed_until=EXCLUDED.snoozed_until,bound_grade=EXCLUDED.bound_grade,updated_at=now()`,
      websiteId,
      key,
      current.workflowRevision + 1,
      current.occurrenceVersion,
      current.epoch,
      current.classificationVersion,
      state,
      until,
      current.finding.grade,
    );
    const after = await findingWorkflow(tx, websiteId, key);
    await audit(
      tx,
      actor,
      websiteId,
      p.requestId,
      hash,
      p.action,
      current,
      after,
      key,
      p.note ?? null,
    );
    return after;
  });
  analyticsCache.invalidate(websiteCacheTag(websiteId));
  return result;
}
export async function addCrawlerContext(
  actor: CrawlerActor,
  websiteId: string,
  p: z.infer<typeof contextWriteSchema>,
) {
  if (Date.parse(p.occurredAt) > Date.now())
    throw new LiekanError('实际发生时间不能晚于当前时间', 400);
  return crawlerTransaction(async tx => {
    await lockWebsite(tx, actor, websiteId);
    const hash = contentHash({ actor: actor.id, p });
    const old = await replay(tx, websiteId, p.requestId, hash);
    if (old) return old;
    const id = randomUUID();
    await tx.execute(
      'INSERT INTO liekan_crawler_context(id,website_id,title,note,occurred_at,created_by,epoch) VALUES($1::uuid,$2::uuid,$3,$4,$5::timestamptz,$6::uuid,coalesce((SELECT epoch FROM liekan_log_state WHERE website_id=$2::uuid),1))',
      id,
      websiteId,
      p.title,
      p.note,
      p.occurredAt,
      actor.id,
    );
    const after = { id, ...p, source: 'manual' };
    await audit(tx, actor, websiteId, p.requestId, hash, 'context_add', null, after);
    return after;
  });
}
export async function voidCrawlerContext(
  actor: CrawlerActor,
  websiteId: string,
  id: string,
  p: z.infer<typeof contextVoidSchema>,
) {
  return crawlerTransaction(async tx => {
    await lockWebsite(tx, actor, websiteId);
    const hash = contentHash({ actor: actor.id, id, p });
    const old = await replay(tx, websiteId, p.requestId, hash);
    if (old) return old;
    const [row] = await tx.query(
      'SELECT * FROM liekan_crawler_context WHERE website_id=$1::uuid AND id=$2::uuid FOR UPDATE',
      websiteId,
      id,
    );
    if (!row) throw new LiekanError('上下文记录不存在', 404);
    if (row.voided_at) throw new LiekanError('记录已经作废', 409);
    await tx.execute(
      'UPDATE liekan_crawler_context SET voided_at=now(),voided_by=$3::uuid,void_reason=$4 WHERE website_id=$1::uuid AND id=$2::uuid',
      websiteId,
      id,
      actor.id,
      p.reason,
    );
    const after = { id, voided: true, reason: p.reason };
    await audit(tx, actor, websiteId, p.requestId, hash, 'context_void', row, after);
    return after;
  });
}
