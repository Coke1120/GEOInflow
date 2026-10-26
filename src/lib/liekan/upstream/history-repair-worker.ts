import {
  emptyLogImpact,
  logImpactCategories,
  addLogImpact,
  distinctLogKey,
} from '../history-repair/log-impact';
import { randomUUID } from 'node:crypto';
import { lockWritableWebsite, LiekanError } from './server';
import { withPublishedRegistry } from './crawler-registry-context';
import { bumpAnalyticsRevision } from './analytics-revision';
import { invalidateWebsiteAnalytics } from './query-cache';
import {
  HISTORY_REPAIR_CAMPAIGN,
  HISTORY_REPAIR_ENGINE,
  type HistoryRepairPreview,
  type HistoryRepairDay,
} from '../contracts/history-repair';
import {
  addCounts,
  emptyCounts,
  publicRepairCounts,
  eventDecision,
  fraction,
  hash,
  includedEvent,
  includedBrowserMetricEvent,
  logDecision,
  terminalStatuses,
  workingStatuses,
  type EventVerdict,
  type LogVerdict,
} from '../history-repair/model';
import {
  repairTransaction,
  runForSite,
  assertSnapshot,
  audit,
  enqueueRepair,
  saveRun,
  requireCompatibleRepairWorker,
  unreferencedRepairInputSql,
  currentRepairInputSql,
  type RepairTx,
  type RunRow,
} from './history-repair-db';
import type { SavedEvidence } from './history-repair-evidence';
const EVENT_SCOPE = `q.website_id=$1::uuid AND q.repair_scope_id IS NULL`;
const LOG_SCOPE = `l.website_id=$1::uuid AND i.repair_scope_id IS NULL`;
interface EventRow {
  id: string;
  time: string;
  day: string;
  session_id: string;
  event_type: number;
  hostname: string | null;
  origin_hostname: string | null;
  excluded: boolean;
  identity_available: boolean;
  identity_scope: string | null;
  classification: EventVerdict['classification'];
  source: string;
  reasons: string[];
  rule_version: string;
  current_classification: EventVerdict['classification'];
  current_reasons: string[];
  current_rule_version: string;
}
interface LogRow {
  id: string;
  time: string;
  day: string;
  user_agent: string;
  bot: string;
  vendor: string;
  bot_type: string;
  ai_eligible: boolean | null;
  crawler_id: string | null;
  recognition_state: string | null;
  recognition_candidates: string[] | null;
  verification: string;
  verification_version: string | null;
  verification_observed_at: string | null;
  verification_reason: string | null;
  path: string;
  catalog_version: string | null;
  identity_evidence: { subjectId?: string; status?: string } | null;
}
interface ResultWrite {
  id: string;
  kind: 'event' | 'log';
  before: unknown;
  after: unknown;
  proof: unknown;
  issue: string | null;
}
interface DayWrite {
  day: string;
  beforePV: number;
  afterPV: number;
  beforeIdentityMissingPV: number;
  afterIdentityMissingPV: number;
  events: number;
  logs: number;
  changedEvents: number;
  changedLogs: number;
  evidence: number;
  logEvidence: number;
}
interface VisitorWrite {
  itemKey?: string;
  day: string;
  session: string;
  before: boolean;
  after: boolean;
}
async function writeResults(tx: RepairTx, row: RunRow, values: ResultWrite[]) {
  if (!values.length) return;
  await tx.$executeRawUnsafe(
    `INSERT INTO liekan_history_repair_result(run_id,website_id,generation,kind,record_id,before_value,after_value,proof,issue)
 SELECT $1::uuid,$2::uuid,$3::uuid,r.kind,r.id,r.before,r.after,r.proof,r.issue FROM jsonb_to_recordset($4::jsonb) r(id text,kind text,before jsonb,after jsonb,proof jsonb,issue text)
 ON CONFLICT(run_id,generation,kind,record_id) DO NOTHING`,
    row.id,
    row.website_id,
    row.generation,
    JSON.stringify(values),
  );
}
async function writeDays(tx: RepairTx, row: RunRow, values: DayWrite[]) {
  if (!values.length) return;
  await tx.$executeRawUnsafe(
    `INSERT INTO liekan_history_repair_day(run_id,website_id,generation,day,before_pv,after_pv,before_identity_missing_pv,after_identity_missing_pv,event_rows,log_rows,changed_events,changed_logs,evidence_rows,log_evidence_rows)
 SELECT $1::uuid,$2::uuid,$3::uuid,r.day::date,sum(r."beforePV"),sum(r."afterPV"),sum(r."beforeIdentityMissingPV"),sum(r."afterIdentityMissingPV"),sum(r.events),sum(r.logs),sum(r."changedEvents"),sum(r."changedLogs"),sum(r.evidence),sum(r."logEvidence") FROM jsonb_to_recordset($4::jsonb) r(day text,"beforePV" integer,"afterPV" integer,"beforeIdentityMissingPV" integer,"afterIdentityMissingPV" integer,events integer,logs integer,"changedEvents" integer,"changedLogs" integer,evidence integer,"logEvidence" integer) GROUP BY r.day
 ON CONFLICT(run_id,generation,day) DO UPDATE SET before_pv=liekan_history_repair_day.before_pv+EXCLUDED.before_pv,after_pv=liekan_history_repair_day.after_pv+EXCLUDED.after_pv,before_identity_missing_pv=coalesce(liekan_history_repair_day.before_identity_missing_pv,0)+EXCLUDED.before_identity_missing_pv,after_identity_missing_pv=coalesce(liekan_history_repair_day.after_identity_missing_pv,0)+EXCLUDED.after_identity_missing_pv,event_rows=liekan_history_repair_day.event_rows+EXCLUDED.event_rows,log_rows=liekan_history_repair_day.log_rows+EXCLUDED.log_rows,changed_events=liekan_history_repair_day.changed_events+EXCLUDED.changed_events,changed_logs=liekan_history_repair_day.changed_logs+EXCLUDED.changed_logs,evidence_rows=liekan_history_repair_day.evidence_rows+EXCLUDED.evidence_rows,log_evidence_rows=liekan_history_repair_day.log_evidence_rows+EXCLUDED.log_evidence_rows`,
    row.id,
    row.website_id,
    row.generation,
    JSON.stringify(values),
  );
}
async function writeVisitors(tx: RepairTx, row: RunRow, values: VisitorWrite[]) {
  if (!values.length) return;
  await tx.$executeRawUnsafe(
    `INSERT INTO liekan_history_repair_visitor(run_id,website_id,generation,scope_day,session_id,item_key,before_included,after_included)
 SELECT $1::uuid,$2::uuid,$3::uuid,r.day,r.session::uuid,coalesce(r."itemKey",''),bool_or(r.before),bool_or(r.after) FROM jsonb_to_recordset($4::jsonb) r(day text,session text,"itemKey" text,before boolean,after boolean) GROUP BY r.day,r.session,r."itemKey"
 ON CONFLICT(run_id,generation,scope_day,session_id,item_key) DO UPDATE SET before_included=liekan_history_repair_visitor.before_included OR EXCLUDED.before_included,after_included=liekan_history_repair_visitor.after_included OR EXCLUDED.after_included`,
    row.id,
    row.website_id,
    row.generation,
    JSON.stringify(values),
  );
}
async function prepareBoundary(tx: RepairTx, row: RunRow) {
  const batches = await tx.$queryRawUnsafe<{ id: string; state: string }[]>(
    `SELECT id::text,state FROM liekan_ingest_batch WHERE website_id=$1::uuid AND repair_scope_id IS NULL ORDER BY id`,
    row.website_id,
  );
  if (batches.some(batch => batch.state === 'pending')) {
    row.error_code = 'waiting-old-batches';
    await enqueueRepair(tx, row, 5);
    return;
  }
  row.excluded_batches = batches
    .filter(batch => ['failed', 'cancelled'].includes(batch.state))
    .map(batch => batch.id);
  const [counts] = await tx.$queryRawUnsafe<{ events: string; logs: string; missing: string }[]>(
    `SELECT
  (SELECT count(*)::text FROM liekan_event_quality q WHERE ${EVENT_SCOPE}) AS events,
  (SELECT count(*)::text FROM liekan_effective_log l JOIN liekan_import i ON i.id=l.import_id AND i.website_id=l.website_id WHERE ${LOG_SCOPE}) AS logs,
  (SELECT count(*)::text FROM website_event e LEFT JOIN liekan_event_quality q ON q.event_id=e.event_id AND q.website_id=e.website_id WHERE e.website_id=$1::uuid AND q.event_id IS NULL) AS missing`,
    row.website_id,
  );
  row.counts = {
    ...emptyCounts(),
    events: counts.events,
    logs: counts.logs,
    missingQuality: counts.missing,
  };
  row.scope_finalized = true;
  row.phase = 'events';
  row.status = 'preparing';
  row.cursor = { membership: hash([row.repair_scope_id, row.excluded_batches, counts]) };
  row.error_code = null;
  await tx.$executeRawUnsafe(
    `UPDATE liekan_history_repair_run SET scope_finalized=true,excluded_batches=$2::uuid[] WHERE id=$1::uuid`,
    row.id,
    row.excluded_batches,
  );
}
async function eventBatch(tx: RepairTx, row: RunRow) {
  const rows = await tx.$queryRawUnsafe<EventRow[]>(
    `SELECT e.event_id::text AS id,to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS time,to_char(e.created_at AT TIME ZONE $2,'YYYY-MM-DD') AS day,e.session_id::text,e.event_type,coalesce(q.hostname,h.hostname) AS hostname,q.classification,q.source,q.reasons,q.rule_version,
 env.origin_hostname,env.scope AS identity_scope,coalesce(env.identity_available,false) AS identity_available,
 EXISTS(SELECT 1 FROM liekan_traffic_exclusion_member m JOIN liekan_traffic_exclusion x ON x.id=m.collection_id AND x.website_id=m.website_id LEFT JOIN liekan_log_state ls ON ls.website_id=x.website_id WHERE m.website_id=e.website_id AND m.event_id=e.event_id AND x.state='active' AND x.epoch=coalesce(ls.epoch,1)) AS excluded,
 coalesce(active.after_value->>'classification',q.classification) AS current_classification,
 CASE WHEN active.record_id IS NULL THEN q.reasons ELSE ARRAY(SELECT jsonb_array_elements_text(active.after_value->'reasons')) END AS current_reasons,
 coalesce(active.after_value->>'ruleVersion',q.rule_version) AS current_rule_version
 FROM liekan_event_quality q JOIN website_event e ON e.website_id=q.website_id AND e.event_id=q.event_id
 LEFT JOIN liekan_event_environment env ON env.website_id=e.website_id AND env.event_id=e.event_id
 LEFT JOIN liekan_collection_hostname h ON h.website_id=e.website_id AND q.hostname IS NULL AND h.reported_hash=encode(sha256(convert_to(e.hostname,'UTF8')),'hex')
 LEFT JOIN liekan_history_repair_result active ON active.run_id=$5::uuid AND active.generation=$6::uuid AND active.kind='event' AND active.record_id=e.event_id::text AND active.issue IS NULL
 WHERE ${EVENT_SCOPE} AND e.created_at IS NOT NULL AND ($3::timestamptz IS NULL OR (e.created_at,e.event_id)>($3::timestamptz,$4::uuid))
 ORDER BY e.created_at,e.event_id LIMIT $7`,
    row.website_id,
    row.snapshot.timezone,
    row.cursor.time || null,
    row.cursor.id || null,
    row.id,
    row.active_generation,
    row.batch_size,
  );
  if (!rows.length) {
    row.phase = 'undated-events';
    row.cursor = { membership: row.cursor.membership };
    return;
  }
  const ids = rows.map(value => value.id);
  const evidence = await tx.$queryRawUnsafe<{ record: SavedEvidence }[]>(
    `SELECT DISTINCT ON(wanted.id) r.record FROM unnest($2::text[]) wanted(id)
     JOIN liekan_history_repair_input i ON i.run_id=$1::uuid AND i.state='finalized' AND i.rulepack_hash=$3 AND ${currentRepairInputSql} AND i.records @> jsonb_build_array(jsonb_build_object('eventId',wanted.id))
     CROSS JOIN LATERAL jsonb_array_elements(i.records) r(record) WHERE r.record->>'eventId'=wanted.id ORDER BY wanted.id,i.upload_id,i.sequence`,
    row.id,
    ids,
    row.snapshot.rulepack.hash,
  );
  const supplied = new Map(evidence.map(item => [item.record.eventId, item.record]));
  const results: ResultWrite[] = [],
    days: DayWrite[] = [],
    visitors: VisitorWrite[] = [];
  let changed = 0,
    covered = 0,
    conflicts = 0,
    beforePV = 0,
    afterPV = 0,
    beforeIdentityMissingPV = 0,
    afterIdentityMissingPV = 0;
  for (const event of rows) {
    const original: EventVerdict = {
      classification: event.classification,
      source: event.source,
      reasons: event.reasons,
      ruleVersion: event.rule_version,
    };
    const decision = eventDecision(original, row.snapshot.rulepack, supplied.get(event.id));
    if (decision.changed || decision.issue)
      results.push({
        id: event.id,
        kind: 'event',
        before: decision.before,
        after: decision.after,
        proof: supplied.has(event.id)
          ? { ...decision.proof, catalogVersion: row.snapshot.rulepack.catalogVersion }
          : decision.proof,
        issue: decision.issue,
      });
    const before = {
      ...original,
      classification: event.current_classification,
      reasons: event.current_reasons,
      ruleVersion: event.current_rule_version,
    };
    const pv = event.event_type === 1;
    const beforeAdmissible =
      pv &&
      includedEvent(before, event.event_type, event.hostname, row.snapshot.policy, {
        originHostname: event.origin_hostname,
        excluded: event.excluded,
      });
    const afterAdmissible =
      pv &&
      includedEvent(decision.after, event.event_type, event.hostname, row.snapshot.policy, {
        originHostname: event.origin_hostname,
        excluded: event.excluded,
      });
    const metricContext = {
      originHostname: event.origin_hostname,
      excluded: event.excluded,
      identityScope: event.identity_scope,
      identityAvailable: event.identity_available,
    };
    const beforeIncluded =
      pv &&
      includedBrowserMetricEvent(
        before,
        event.event_type,
        event.hostname,
        row.snapshot.policy,
        metricContext,
      );
    const afterIncluded =
      pv &&
      includedBrowserMetricEvent(
        decision.after,
        event.event_type,
        event.hostname,
        row.snapshot.policy,
        metricContext,
      );
    if (pv)
      visitors.push(
        {
          day: event.day,
          session: event.session_id,
          before: beforeIncluded && event.identity_available,
          after: afterIncluded && event.identity_available,
        },
        {
          day: 'all',
          session: event.session_id,
          before: beforeIncluded && event.identity_available,
          after: afterIncluded && event.identity_available,
        },
      );
    changed += +decision.changed;
    covered += +decision.evidence;
    conflicts += +!!decision.issue;
    beforePV += +beforeIncluded;
    afterPV += +afterIncluded;
    beforeIdentityMissingPV += +(beforeAdmissible && !beforeIncluded);
    afterIdentityMissingPV += +(afterAdmissible && !afterIncluded);
    days.push({
      day: event.day,
      beforePV: +beforeIncluded,
      afterPV: +afterIncluded,
      beforeIdentityMissingPV: +(beforeAdmissible && !beforeIncluded),
      afterIdentityMissingPV: +(afterAdmissible && !afterIncluded),
      events: 1,
      logs: 0,
      changedEvents: +decision.changed,
      changedLogs: 0,
      evidence: +decision.evidence,
      logEvidence: 0,
    });
  }
  await writeResults(tx, row, results);
  await writeDays(tx, row, days);
  await writeVisitors(tx, row, visitors);
  row.counts = addCounts(row.counts, {
    processed: String(rows.length),
    changedEvents: String(changed),
    browserEvidence: String(covered),
    conflicts: String(conflicts),
    beforePV: String(beforePV),
    afterPV: String(afterPV),
    beforeIdentityMissingPV: String(beforeIdentityMissingPV),
    afterIdentityMissingPV: String(afterIdentityMissingPV),
  });
  const last = rows.at(-1);
  row.cursor = {
    time: last.time,
    id: last.id,
    membership: hash([row.cursor.membership, rows.map(value => [value.id, value.time])]),
  };
}
async function undatedEventBatch(tx: RepairTx, row: RunRow) {
  const rows = await tx.$queryRawUnsafe<
    {
      id: string;
      classification: EventVerdict['classification'];
      source: string;
      reasons: string[];
      rule_version: string;
    }[]
  >(
    `SELECT e.event_id::text AS id,q.classification,q.source,q.reasons,q.rule_version FROM liekan_event_quality q JOIN website_event e ON e.event_id=q.event_id AND e.website_id=q.website_id WHERE ${EVENT_SCOPE} AND e.created_at IS NULL AND ($2::uuid IS NULL OR e.event_id>$2::uuid) ORDER BY e.event_id LIMIT $3`,
    row.website_id,
    row.cursor.id || null,
    row.batch_size,
  );
  if (!rows.length) {
    row.phase = 'logs';
    row.cursor = { membership: row.cursor.membership };
    return;
  }
  await writeResults(
    tx,
    row,
    rows.map(event => {
      const original: EventVerdict = {
        classification: event.classification,
        source: event.source,
        reasons: event.reasons,
        ruleVersion: event.rule_version,
      };
      return {
        id: event.id,
        kind: 'event',
        before: original,
        after: original,
        proof: { kind: 'undated-original', originalRuleVersion: event.rule_version },
        issue: 'missing-event-time',
      };
    }),
  );
  row.counts = addCounts(row.counts, {
    processed: String(rows.length),
    undatedEvents: String(rows.length),
  });
  row.cursor = {
    id: rows.at(-1).id,
    membership: hash([row.cursor.membership, rows.map(event => [event.id, null])]),
  };
}
async function logBatch(tx: RepairTx, row: RunRow) {
  const logs = await tx.$queryRawUnsafe<LogRow[]>(
    `SELECT l.id,to_char(l.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS time,to_char(l.created_at AT TIME ZONE $2,'YYYY-MM-DD') AS day,l.user_agent,l.path,e.catalog_version::text,l.bot,l.vendor,l.bot_type,l.ai_eligible,e.crawler_id,l.recognition_state,l.recognition_candidates,l.verification,l.verification_version,to_char(l.verification_observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS verification_observed_at,l.verification_reason,e.identity_evidence
 FROM liekan_effective_log l JOIN liekan_import i ON i.id=l.import_id AND i.website_id=l.website_id LEFT JOIN liekan_crawler_evidence e ON e.website_id=l.website_id AND e.log_id=l.id
 WHERE ${LOG_SCOPE} AND ($3::timestamptz IS NULL OR (l.created_at,l.id)>($3::timestamptz,$4)) ORDER BY l.created_at,l.id LIMIT $5`,
    row.website_id,
    row.snapshot.timezone,
    row.cursor.time || null,
    row.cursor.id || null,
    row.batch_size,
  );
  if (!logs.length) {
    row.phase = 'visitors';
    row.cursor = { membership: row.cursor.membership };
    return;
  }
  let changed = 0,
    covered = 0,
    conflicts = 0;
  const originalForms = await tx.$queryRawUnsafe<{ version: string; id: string; form: string }[]>(
    `SELECT DISTINCT v.version::text,identity->>'id' AS id,identity->>'productForm' AS form FROM jsonb_to_recordset($1::jsonb) wanted(version uuid,id text) JOIN liekan_crawler_registry_version v ON v.version=wanted.version CROSS JOIN LATERAL jsonb_array_elements(v.payload->'identities') identity WHERE identity->>'id'=wanted.id`,
    JSON.stringify(
      logs
        .filter(log => log.catalog_version && log.crawler_id)
        .map(log => ({ version: log.catalog_version, id: log.crawler_id })),
    ),
  );
  const beforeForms = new Map(originalForms.map(item => [`${item.version}:${item.id}`, item.form]));
  const pinnedForms = await tx.$queryRawUnsafe<{ id: string; form: string }[]>(
    `SELECT identity->>'id' AS id,identity->>'productForm' AS form FROM liekan_crawler_registry_version v CROSS JOIN LATERAL jsonb_array_elements(v.payload->'identities') identity WHERE v.version=$1::uuid`,
    row.snapshot.rulepack.catalogVersion,
  );
  const afterForms = new Map(pinnedForms.map(item => [item.id, item.form]));
  const results: ResultWrite[] = [],
    days: DayWrite[] = [],
    visitors: VisitorWrite[] = [];
  row.log_impact = { ...emptyLogImpact(), ...row.log_impact };
  for (const log of logs) {
    const original: LogVerdict = {
      bot: log.bot,
      vendor: log.vendor,
      botType: log.bot_type,
      aiEligible: log.ai_eligible,
      crawlerId: log.crawler_id,
      recognitionState: log.recognition_state,
      recognitionCandidates: log.recognition_candidates || [],
      verification: log.verification,
      verificationVersion: log.verification_version,
      verificationObservedAt: log.verification_observed_at,
      verificationReason: log.verification_reason,
    };
    const decision = logDecision(
      original,
      log.user_agent,
      row.snapshot.rulepack,
      log.identity_evidence,
      {
        originalVersion: log.catalog_version,
        originalProductForm: beforeForms.get(`${log.catalog_version}:${log.crawler_id}`) || null,
        forms: afterForms,
      },
    );
    const before = logImpactCategories(original, decision.productForm.before);
    const after = logImpactCategories(decision.after, decision.productForm.after);
    row.log_impact = addLogImpact(row.log_impact, before, after);
    for (const identity of new Set([before.identity, after.identity].filter(Boolean)))
      visitors.push({
        day: 'log:identities',
        ...distinctLogKey('identity', identity),
        before: before.identity === identity,
        after: after.identity === identity,
      });
    if (before.ai || after.ai)
      visitors.push({
        day: 'log:ai-pages',
        ...distinctLogKey('ai-page', log.path),
        before: before.ai,
        after: after.ai,
      });
    if (decision.changed || decision.issue)
      results.push({
        id: log.id,
        kind: 'log',
        before: decision.before,
        after: decision.after,
        proof: decision.proof,
        issue: decision.issue,
      });
    changed += +decision.changed;
    covered += +decision.evidence;
    conflicts += +(decision.issue === 'identity-conflict');
    days.push({
      day: log.day,
      beforePV: 0,
      afterPV: 0,
      beforeIdentityMissingPV: 0,
      afterIdentityMissingPV: 0,
      events: 0,
      logs: 1,
      changedEvents: 0,
      changedLogs: +decision.changed,
      evidence: 0,
      logEvidence: +decision.evidence,
    });
  }
  await writeResults(tx, row, results);
  await writeDays(tx, row, days);
  await writeVisitors(tx, row, visitors);
  row.counts = addCounts(row.counts, {
    processed: String(logs.length),
    changedLogs: String(changed),
    logEvidence: String(covered),
    conflicts: String(conflicts),
  });
  const last = logs.at(-1);
  row.cursor = {
    time: last.time,
    id: last.id,
    membership: hash([row.cursor.membership, logs.map(value => [value.id, value.time])]),
  };
}
async function visitorBatch(tx: RepairTx, row: RunRow) {
  const visitors = await tx.$queryRawUnsafe<
    { scope_day: string; session_id: string; before_included: boolean; after_included: boolean }[]
  >(
    `SELECT scope_day,session_id::text,before_included,after_included FROM liekan_history_repair_visitor WHERE run_id=$1::uuid AND generation=$2::uuid AND scope_day NOT LIKE 'log:%' AND ($3::text IS NULL OR (scope_day,session_id)>($3::text,$4::uuid)) ORDER BY scope_day,session_id LIMIT $5`,
    row.id,
    row.generation,
    row.cursor.visitorsAfter || null,
    row.cursor.visitorSession || null,
    row.batch_size,
  );
  if (visitors.length) {
    const all = visitors.filter(visitor => visitor.scope_day === 'all');
    row.counts = addCounts(row.counts, {
      beforeUV: String(all.filter(visitor => visitor.before_included).length),
      afterUV: String(all.filter(visitor => visitor.after_included).length),
    });
    const daily = visitors.filter(visitor => visitor.scope_day !== 'all');
    if (daily.length)
      await tx.$executeRawUnsafe(
        `UPDATE liekan_history_repair_day d SET before_uv=d.before_uv+v.before_uv,after_uv=d.after_uv+v.after_uv FROM (SELECT r.day,count(*) FILTER(WHERE r.before) AS before_uv,count(*) FILTER(WHERE r.after) AS after_uv FROM jsonb_to_recordset($3::jsonb) r(day text,before boolean,after boolean) GROUP BY r.day) v WHERE d.run_id=$1::uuid AND d.generation=$2::uuid AND d.day=v.day::date`,
        row.id,
        row.generation,
        JSON.stringify(
          daily.map(visitor => ({
            day: visitor.scope_day,
            before: visitor.before_included,
            after: visitor.after_included,
          })),
        ),
      );
    const last = visitors.at(-1);
    row.cursor.visitorsAfter = last.scope_day;
    row.cursor.visitorSession = last.session_id;
    return;
  }
  row.phase = 'log-impact';
}
async function logImpactBatch(tx: RepairTx, row: RunRow) {
  const rows = await tx.$queryRawUnsafe<
    { scope_day: string; item_key: string; before_included: boolean; after_included: boolean }[]
  >(
    `SELECT scope_day,item_key,before_included,after_included FROM liekan_history_repair_visitor WHERE run_id=$1::uuid AND generation=$2::uuid AND scope_day LIKE 'log:%' AND ($3::text IS NULL OR (scope_day,item_key)>($3,$4)) ORDER BY scope_day,item_key LIMIT $5`,
    row.id,
    row.generation,
    row.cursor.impactScope || null,
    row.cursor.impactKey || null,
    row.batch_size,
  );
  if (!rows.length) {
    row.phase = 'days';
    return;
  }
  row.log_impact = { ...emptyLogImpact(), ...row.log_impact };
  for (const value of rows) {
    const prefix = value.scope_day === 'log:identities' ? 'Identities' : 'AiPages';
    const before = `before${prefix}` as 'beforeIdentities' | 'beforeAiPages',
      after = `after${prefix}` as 'afterIdentities' | 'afterAiPages';
    row.log_impact[before] = (
      BigInt(row.log_impact[before]) + BigInt(+value.before_included)
    ).toString();
    row.log_impact[after] = (
      BigInt(row.log_impact[after]) + BigInt(+value.after_included)
    ).toString();
  }
  row.cursor.impactScope = rows.at(-1).scope_day;
  row.cursor.impactKey = rows.at(-1).item_key;
}
async function finishPreview(tx: RepairTx, row: RunRow) {
  const days = await tx.$queryRawUnsafe<{ day: string }[]>(
    `SELECT day::text FROM liekan_history_repair_day WHERE run_id=$1::uuid AND generation=$2::uuid AND ($3::date IS NULL OR day>$3::date) ORDER BY day LIMIT 30`,
    row.id,
    row.generation,
    row.cursor.daysAfter || null,
  );
  if (days.length) {
    await tx.$executeRawUnsafe(
      `UPDATE liekan_history_repair_day SET coverage=CASE WHEN evidence_rows+log_evidence_rows=0 THEN 'missing' WHEN evidence_rows+log_evidence_rows=event_rows+log_rows THEN 'complete' ELSE 'partial' END WHERE run_id=$1::uuid AND generation=$2::uuid AND day=ANY($3::date[])`,
      row.id,
      row.generation,
      days.map(day => day.day),
    );
    row.cursor.daysAfter = days.at(-1).day;
    return;
  }
  const limitations: string[] = [];
  if (BigInt(row.counts.browserEvidence) < BigInt(row.counts.events))
    limitations.push('browser-input-incomplete');
  if (BigInt(row.counts.logEvidence) < BigInt(row.counts.logs))
    limitations.push('log-input-incomplete');
  if (BigInt(row.counts.missingQuality)) limitations.push('missing-quality-scan-time-only');
  if (BigInt(row.counts.undatedEvents)) limitations.push('undated-events');
  if (BigInt(row.counts.conflicts)) limitations.push('evidence-conflicts-retained');
  if (row.excluded_batches.length) limitations.push('excluded-old-batches');
  if (
    BigInt(row.counts.beforeIdentityMissingPV ?? '0') ||
    BigInt(row.counts.afterIdentityMissingPV ?? '0')
  )
    limitations.push('identity-input-incomplete');
  if (row.snapshot.rulepack.botCheckDisabled) limitations.push('bot-check-disabled');
  const sourceUploads = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT DISTINCT upload_id::text AS id FROM liekan_history_repair_input i WHERE run_id=$1::uuid AND state='finalized' AND rulepack_hash=$2 AND ${currentRepairInputSql} ORDER BY id LIMIT 100`,
    row.id,
    row.snapshot.rulepack.hash,
  );
  const preview: HistoryRepairPreview = {
    generation: row.generation,
    revision: row.revision,
    digest: '',
    complete: true,
    metricScope: 'qualified-browser',
    counts: publicRepairCounts(row.counts, 'qualified-browser'),
    logImpact: { ...emptyLogImpact(), ...row.log_impact },
    sourceUploads: sourceUploads.map(source => source.id),
    browserCoverage: fraction(row.counts.browserEvidence, row.counts.events),
    logCoverage: fraction(row.counts.logEvidence, row.counts.logs),
    partial: limitations.length > 0,
    limitations,
    excludedBatches: row.excluded_batches,
    timezone: row.snapshot.timezone,
    policy: row.snapshot.policy,
    rulepack: {
      engine: row.snapshot.rulepack.engine,
      matcher: row.snapshot.rulepack.matcher,
      detector: row.snapshot.rulepack.detector,
      botCheckDisabled: row.snapshot.rulepack.botCheckDisabled,
      catalogVersion: row.snapshot.rulepack.catalogVersion,
      rulesRevision: row.snapshot.rulepack.rulesRevision,
      hash: row.snapshot.rulepack.hash,
    },
  };
  preview.digest = hash([
    preview,
    row.cursor.membership,
    row.scope_revision.toString(),
    row.input_revision,
    row.snapshot.authorityHash,
  ]);
  row.preview = preview;
  row.membership_digest = row.cursor.membership;
  row.phase = 'preview';
  const total = BigInt(row.counts.events) + BigInt(row.counts.logs),
    changes = BigInt(row.counts.changedEvents) + BigInt(row.counts.changedLogs),
    coverage = BigInt(row.counts.browserEvidence) + BigInt(row.counts.logEvidence);
  row.status =
    total === 0n
      ? BigInt(row.counts.missingQuality)
        ? 'unidentifiable'
        : 'empty'
      : changes > 0n
        ? 'ready'
        : coverage > 0n
          ? 'unchanged'
          : 'unidentifiable';
  if (terminalStatuses.includes(row.status)) row.completed_at = new Date();
  await tx.$executeRawUnsafe(
    `UPDATE liekan_history_repair_run SET membership_digest=$2 WHERE id=$1::uuid`,
    row.id,
    row.membership_digest,
  );
}
async function activate(tx: RepairTx, row: RunRow) {
  if (
    !row.preview?.complete ||
    row.preview.digest !== row.approved_digest ||
    row.preview.generation !== row.generation ||
    row.preview.revision !== row.revision
  )
    throw new LiekanError('候选摘要已变化', 409, 'history-repair-preview-changed');
  if (row.excluded_batches.length && !row.partial_confirmed)
    throw new LiekanError(
      '请确认历史缺口后继续',
      409,
      'history-repair-partial-confirmation-required',
    );
  await assertSnapshot(tx, row, false);
  const changed = await tx.$executeRawUnsafe(
    `UPDATE liekan_history_repair_run SET previous_generation=active_generation,active_generation=generation,active_revision=active_revision+1,status=$3,phase='complete',completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid AND lease_token=$2::uuid AND status='validating' AND confirmed_at IS NOT NULL AND NOT scope_changed`,
    row.id,
    row.lease_token,
    row.preview.partial ? 'completed_limited' : 'completed',
  );
  if (changed !== 1) throw new LiekanError('任务状态已变化', 409, 'history-repair-task-changed');
  await bumpAnalyticsRevision(tx, 'website', row.website_id);
  row.status = row.preview.partial ? 'completed_limited' : 'completed';
  row.phase = 'complete';
  row.previous_generation = row.active_generation;
  row.active_generation = row.generation;
  row.completed_at = new Date();
  await audit(
    tx,
    row,
    { userId: row.actor_id },
    'activate',
    { digest: row.approved_digest },
    { generation: row.generation, status: row.status },
    undefined,
    { digest: row.approved_digest },
  );
}
export async function historyRepairCapability() {
  const base = {
    supported: !process.env.CLICKHOUSE_URL,
    engineVersion: HISTORY_REPAIR_ENGINE,
    queue: 'liekan-history-repair',
    leaseSeconds: 60,
    heartbeatSeconds: 15,
    batchSize: 2000,
  };
  if (!base.supported) return { ...base, ready: false, reason: 'history-repair-unsupported' };
  try {
    await repairTransaction(tx => requireCompatibleRepairWorker(tx));
    return { ...base, ready: true, reason: null };
  } catch (error) {
    return {
      ...base,
      ready: false,
      reason: error instanceof LiekanError ? error.code : 'history-repair-worker-unavailable',
    };
  }
}
export async function processHistoryRepairJob(
  payload: { runId: string; stepId?: string } | string,
) {
  if (process.env.CLICKHOUSE_URL) return;
  const runId = typeof payload === 'string' ? payload : payload.runId;
  if (!/^[a-f0-9-]{36}$/i.test(runId)) return;
  const stepId = typeof payload === 'string' ? undefined : payload.stepId;
  const token = randomUUID();
  const acquired = await repairTransaction(async tx => {
    const [first] = await tx.$queryRawUnsafe<RunRow[]>(
      'SELECT * FROM liekan_history_repair_run WHERE id=$1::uuid',
      runId,
    );
    if (
      !first ||
      !workingStatuses.includes(first.status) ||
      +new Date(first.next_attempt_at) > Date.now() ||
      (stepId && first.queued_job_id !== stepId)
    )
      return null;
    const result = await tx.$executeRawUnsafe(
      `UPDATE liekan_history_repair_campaign SET lease_token=$2::uuid,lease_run_id=$3::uuid,lease_until=clock_timestamp()+interval '60 seconds' WHERE id=$1 AND (lease_until IS NULL OR lease_until<clock_timestamp())`,
      HISTORY_REPAIR_CAMPAIGN,
      token,
      runId,
    );
    if (!result) {
      const [waiting] = await tx.$queryRawUnsafe<RunRow[]>(
        `SELECT * FROM liekan_history_repair_run WHERE id=$1::uuid AND generation=$2::uuid AND revision=$3 AND actor_id=$4::uuid AND queued_job_id IS NOT DISTINCT FROM $5::uuid AND ($6::uuid IS NULL OR queued_job_id=$6::uuid) AND status IN('scanning','preparing','queued','running','validating') FOR NO KEY UPDATE SKIP LOCKED`,
        runId,
        first.generation,
        first.revision,
        first.actor_id,
        first.queued_job_id,
        stepId || null,
      );
      if (waiting) await enqueueRepair(tx, waiting, 5);
      return null;
    }
    const [claimed] = await tx.$queryRawUnsafe<RunRow[]>(
      `UPDATE liekan_history_repair_run SET lease_token=$2::uuid,lease_until=clock_timestamp()+interval '60 seconds' WHERE id=$1::uuid AND generation=$3::uuid AND revision=$4 AND actor_id=$5::uuid AND queued_job_id IS NOT DISTINCT FROM $6::uuid AND ($7::uuid IS NULL OR queued_job_id=$7::uuid) AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp()) AND status IN('scanning','preparing','queued','running','validating') RETURNING *`,
      runId,
      token,
      first.generation,
      first.revision,
      first.actor_id,
      first.queued_job_id,
      stepId || null,
    );
    if (!claimed) {
      await tx.$executeRawUnsafe(
        `UPDATE liekan_history_repair_campaign SET lease_token=NULL,lease_until=NULL,lease_run_id=NULL WHERE id=$1 AND lease_token=$2::uuid`,
        HISTORY_REPAIR_CAMPAIGN,
        token,
      );
      return null;
    }
    return claimed;
  });
  if (!acquired) return;
  let invalidated = false;
  let heartbeatPending: Promise<unknown> | undefined;
  const heartbeat = setInterval(() => {
    if (heartbeatPending) return;
    heartbeatPending = repairTransaction(tx =>
      tx.$executeRawUnsafe(
        `UPDATE liekan_history_repair_campaign SET lease_until=clock_timestamp()+interval '60 seconds' WHERE id=$1 AND lease_token=$2::uuid AND lease_until>clock_timestamp()`,
        HISTORY_REPAIR_CAMPAIGN,
        token,
      ),
    )
      .catch(() => {})
      .finally(() => {
        heartbeatPending = undefined;
      });
  }, 15000);
  heartbeat.unref();
  try {
    await withPublishedRegistry(
      () =>
        repairTransaction(async tx => {
          await lockWritableWebsite(
            tx,
            acquired.website_id,
            { userId: acquired.actor_id },
            acquired.status === 'validating' ? 'update' : 'share',
          );
          const row = await runForSite(tx, acquired.website_id);
          if (
            !row ||
            row.lease_token !== token ||
            !row.lease_until ||
            +row.lease_until < Date.now() ||
            !workingStatuses.includes(row.status)
          )
            return;
          if (row.snapshot.rulepack.engine !== HISTORY_REPAIR_ENGINE)
            throw new LiekanError('工作进程不支持该规则包', 409, 'history-repair-engine-changed');
          await assertSnapshot(tx, row, false);
          // Each lease commits one bounded work unit. SQL has a 5s deadline and the transaction a 30s deadline.
          if (row.status === 'queued' || row.status === 'running') {
            row.status = 'validating';
            row.phase = 'activation';
          } else if (row.status === 'validating') {
            await activate(tx, row);
            invalidated = true;
          } else if (row.phase === 'boundary') await prepareBoundary(tx, row);
          else if (row.phase === 'events') await eventBatch(tx, row);
          else if (row.phase === 'undated-events') await undatedEventBatch(tx, row);
          else if (row.phase === 'logs') await logBatch(tx, row);
          else if (row.phase === 'visitors') await visitorBatch(tx, row);
          else if (row.phase === 'log-impact') await logImpactBatch(tx, row);
          else if (row.phase === 'days') await finishPreview(tx, row);
          const [owned] = await tx.$queryRawUnsafe(
            `SELECT 1 FROM liekan_history_repair_campaign c JOIN liekan_history_repair_run r ON r.id=c.lease_run_id WHERE c.id=$1 AND c.lease_token=$2::uuid AND c.lease_until>clock_timestamp() AND r.lease_token=$2::uuid AND r.lease_until>clock_timestamp()`,
            HISTORY_REPAIR_CAMPAIGN,
            token,
          );
          if (!owned) throw new LiekanError('工作租约已失效', 409, 'history-repair-lease-lost');
          row.attempts = 0;
          await saveRun(tx, row);
          await tx.$executeRawUnsafe(
            `UPDATE liekan_history_repair_run SET lease_token=NULL,lease_until=NULL,attempts=0 WHERE id=$1::uuid AND lease_token=$2::uuid`,
            row.id,
            token,
          );
          if (workingStatuses.includes(row.status) && row.error_code !== 'waiting-old-batches')
            await enqueueRepair(tx, row);
        }),
      acquired.snapshot.rulepack.catalogVersion,
    );
  } catch (error) {
    const conflict = error instanceof LiekanError && [401, 403, 404, 409].includes(error.status);
    const lockWait = /lock timeout|55P03/i.test(
      String(error instanceof Error ? error.message : ''),
    );
    const timeout = /statement timeout|P2028|Transaction.*(closed|expired)/i.test(
      String(error instanceof Error ? error.message : ''),
    );
    await repairTransaction(async tx => {
      const rows = await tx.$queryRawUnsafe<RunRow[]>(
        'SELECT * FROM liekan_history_repair_run WHERE id=$1::uuid AND lease_token=$2::uuid FOR NO KEY UPDATE',
        runId,
        token,
      );
      const row = rows[0];
      if (!row || !workingStatuses.includes(row.status)) return;
      const attempts = row.attempts + (lockWait ? 0 : 1);
      const code = lockWait
        ? 'history-repair-collection-priority'
        : conflict
          ? (error as LiekanError).code
          : timeout
            ? 'history-repair-query-timeout'
            : 'history-repair-worker-failed';
      const nextStep = !conflict && attempts < 4 ? await enqueueRepair(tx, row, 5, false) : null;
      await tx.$executeRawUnsafe(
        `UPDATE liekan_history_repair_run SET status=$3,error_code=$4,attempts=$5,batch_size=CASE WHEN $6 THEN greatest(100,batch_size/2) ELSE batch_size END,lease_token=NULL,lease_until=NULL,next_attempt_at=clock_timestamp()+interval '5 seconds',completed_at=CASE WHEN $3='invalidated' THEN clock_timestamp() ELSE completed_at END,queued_job_id=coalesce($7::uuid,queued_job_id),updated_at=clock_timestamp() WHERE id=$1::uuid AND lease_token=$2::uuid`,
        row.id,
        token,
        conflict ? 'invalidated' : attempts >= 4 ? 'failed' : row.status,
        code,
        attempts,
        timeout,
        nextStep,
      );
      if (!lockWait)
        await audit(tx, row, null, 'worker-failure', { code, attempts }, { code, attempts });
    });
  } finally {
    clearInterval(heartbeat);
    if (heartbeatPending) await heartbeatPending;
    await repairTransaction(async tx => {
      await tx.$executeRawUnsafe(
        `UPDATE liekan_history_repair_campaign SET lease_token=NULL,lease_until=NULL,lease_run_id=NULL WHERE id=$1 AND lease_token=$2::uuid`,
        HISTORY_REPAIR_CAMPAIGN,
        token,
      );
      await tx.$executeRawUnsafe(
        `UPDATE liekan_history_repair_run SET lease_token=NULL,lease_until=NULL WHERE id=$1::uuid AND lease_token=$2::uuid`,
        runId,
        token,
      );
    });
  }
  if (invalidated) invalidateWebsiteAnalytics(acquired.website_id);
}
export async function reconcileHistoryRepairs() {
  if (process.env.CLICKHOUSE_URL) return;
  const unreferencedInput = unreferencedRepairInputSql;
  await repairTransaction(async tx => {
    await tx.$executeRawUnsafe(
      `UPDATE liekan_history_repair_run r SET scope_changed=true,scope_revision=scope_revision+1,error_code=CASE WHEN active_generation IS NOT NULL THEN 'active-scope-gap' ELSE 'scope-changed' END WHERE NOT scope_changed AND EXISTS(SELECT 1 FROM liekan_history_repair_action a WHERE a.run_id=r.id AND a.generation=r.generation AND a.action='scope-gap')`,
    );
    await tx.$executeRawUnsafe(
      `UPDATE liekan_history_repair_run SET status='expired',error_code='history-repair-idle-expired',preview=NULL,snapshot=jsonb_set(snapshot,'{inputNotBefore}',to_jsonb(clock_timestamp())),completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id IN(SELECT id FROM liekan_history_repair_run WHERE status IN('ready','failed','paused') AND confirmed_at IS NULL AND updated_at<clock_timestamp()-interval '7 days' ORDER BY updated_at,id LIMIT 20 FOR NO KEY UPDATE SKIP LOCKED)`,
    );
    await tx.$executeRawUnsafe(
      `UPDATE liekan_history_repair_run SET snapshot=jsonb_set(snapshot,'{inputNotBefore}',to_jsonb(clock_timestamp())) WHERE id IN(SELECT id FROM liekan_history_repair_run WHERE status IN('unchanged','unidentifiable','empty','cancelled','invalidated') AND updated_at<clock_timestamp()-interval '7 days' AND (snapshot->>'inputNotBefore' IS NULL OR (snapshot->>'inputNotBefore')::timestamptz<updated_at) ORDER BY updated_at,id LIMIT 20 FOR NO KEY UPDATE SKIP LOCKED)`,
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM liekan_history_repair_visitor v WHERE v.ctid IN(SELECT v.ctid FROM liekan_history_repair_visitor v JOIN liekan_history_repair_run r ON r.id=v.run_id WHERE (r.completed_at<clock_timestamp()-interval '7 days' AND r.status IN('completed','completed_limited','unchanged','unidentifiable','empty','cancelled','rolled_back','expired','invalidated')) OR (v.generation<>r.generation AND v.created_at<clock_timestamp()-interval '7 days') LIMIT 2000)`,
    );
    const obsolete = `SELECT r.id AS run_id,a.key::uuid AS generation FROM liekan_history_repair_run r CROSS JOIN LATERAL jsonb_each(r.generation_archive) a WHERE a.value->>'confirmedAt' IS NULL AND (a.value->>'archivedAt')::timestamptz<clock_timestamp()-interval '7 days' AND a.key<>r.generation::text AND a.key IS DISTINCT FROM r.active_generation::text AND a.key IS DISTINCT FROM r.previous_generation::text`;
    await tx.$executeRawUnsafe(
      `WITH obsolete AS (${obsolete}) DELETE FROM liekan_history_repair_result p WHERE p.ctid IN(SELECT p.ctid FROM liekan_history_repair_result p JOIN obsolete o ON o.run_id=p.run_id AND o.generation=p.generation LIMIT 2000)`,
    );
    await tx.$executeRawUnsafe(
      `WITH obsolete AS (${obsolete}) DELETE FROM liekan_history_repair_visitor p WHERE p.ctid IN(SELECT p.ctid FROM liekan_history_repair_visitor p JOIN obsolete o ON o.run_id=p.run_id AND o.generation=p.generation LIMIT 2000)`,
    );
    await tx.$executeRawUnsafe(
      `WITH obsolete AS (${obsolete}) DELETE FROM liekan_history_repair_input i WHERE i.ctid IN(SELECT i.ctid FROM liekan_history_repair_input i JOIN obsolete o ON o.run_id=i.run_id AND o.generation=i.generation JOIN liekan_history_repair_run r ON r.id=i.run_id WHERE (i.state='discarded' OR i.created_at<=(r.snapshot->>'inputNotBefore')::timestamptz) AND ${unreferencedInput} LIMIT 100)`,
    );
    // Expiry drops unsubmitted material. Active and previous result/proof generations stay readable.
    await tx.$executeRawUnsafe(
      `DELETE FROM liekan_history_repair_result v WHERE v.ctid IN(SELECT v.ctid FROM liekan_history_repair_result v JOIN liekan_history_repair_run r ON r.id=v.run_id WHERE (r.status='expired' OR v.created_at<=(r.snapshot->>'inputNotBefore')::timestamptz) AND v.generation IS DISTINCT FROM r.active_generation AND v.generation IS DISTINCT FROM r.previous_generation LIMIT 2000)`,
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM liekan_history_repair_day v WHERE v.ctid IN(SELECT v.ctid FROM liekan_history_repair_day v JOIN liekan_history_repair_run r ON r.id=v.run_id WHERE r.status='expired' AND v.generation IS DISTINCT FROM r.active_generation AND v.generation IS DISTINCT FROM r.previous_generation LIMIT 2000)`,
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM liekan_history_repair_input i WHERE i.ctid IN(SELECT i.ctid FROM liekan_history_repair_input i JOIN liekan_history_repair_run r ON r.id=i.run_id WHERE (r.status='expired' OR i.created_at<=(r.snapshot->>'inputNotBefore')::timestamptz) AND ${unreferencedInput} LIMIT 100)`,
    );
    await tx.$executeRawUnsafe(
      `UPDATE liekan_history_repair_input i SET state='discarded',records='[]' WHERE i.ctid IN(SELECT i.ctid FROM liekan_history_repair_input i JOIN liekan_history_repair_run r ON r.id=i.run_id WHERE (r.status='expired' OR i.created_at<=(r.snapshot->>'inputNotBefore')::timestamptz) AND i.state<>'discarded' AND ${unreferencedInput} LIMIT 100)`,
    );
    await tx.$executeRawUnsafe(
      `UPDATE liekan_history_repair_run r SET counts=$1::jsonb,cursor='{}',generation_archive=coalesce((SELECT jsonb_object_agg(a.key,a.value) FROM jsonb_each(r.generation_archive) a WHERE a.key IN(r.active_generation::text,r.previous_generation::text)),'{}'::jsonb) WHERE status='expired'`,
      JSON.stringify(emptyCounts()),
    );
    const rows = await tx.$queryRawUnsafe<RunRow[]>(
      `SELECT * FROM liekan_history_repair_run WHERE status IN('scanning','preparing','queued','running','validating') AND attempts<4 AND next_attempt_at<=clock_timestamp() AND updated_at<clock_timestamp()-interval '60 seconds' AND (lease_until IS NULL OR lease_until<clock_timestamp()) ORDER BY updated_at,id LIMIT 20 FOR NO KEY UPDATE SKIP LOCKED`,
    );
    for (const row of rows) {
      const [job] = row.queued_job_id
        ? await tx.$queryRawUnsafe<{ state: string }[]>(
            'SELECT state::text FROM liekan_jobs.job WHERE id=$1::uuid AND name=$2',
            row.queued_job_id,
            'liekan-history-repair',
          )
        : [];
      if (job && ['created', 'retry', 'active'].includes(job.state)) continue;
      if (job && ['cancelled', 'failed'].includes(job.state)) {
        await tx.$executeRawUnsafe(
          `UPDATE liekan_history_repair_run SET status='failed',error_code=$2,updated_at=clock_timestamp() WHERE id=$1::uuid`,
          row.id,
          job.state === 'cancelled'
            ? 'history-repair-queue-cancelled'
            : 'history-repair-queue-exhausted',
        );
        continue;
      }
      await enqueueRepair(tx, row);
      await tx.$executeRawUnsafe(
        'UPDATE liekan_history_repair_run SET updated_at=clock_timestamp() WHERE id=$1::uuid',
        row.id,
      );
    }
  });
}
export function dayDto(row: Record<string, unknown>, metricScope?: 'qualified-browser'): HistoryRepairDay {
  const counts = publicRepairCounts({
    ...emptyCounts(),
    beforeUV: row.before_uv == null ? null : String(row.before_uv),
    afterUV: row.after_uv == null ? null : String(row.after_uv),
    beforeIdentityMissingPV: row.before_identity_missing_pv == null ? null : String(row.before_identity_missing_pv),
    afterIdentityMissingPV: row.after_identity_missing_pv == null ? null : String(row.after_identity_missing_pv),
  }, metricScope);
  return {
    date: String(row.day),
    beforePV: String(row.before_pv),
    afterPV: String(row.after_pv),
    beforeUV: counts.beforeUV,
    afterUV: counts.afterUV,
    beforeQualifiedUV: counts.beforeQualifiedUV,
    afterQualifiedUV: counts.afterQualifiedUV,
    beforeIdentityMissingPV: counts.beforeIdentityMissingPV,
    afterIdentityMissingPV: counts.afterIdentityMissingPV,
    eventRows: String(row.event_rows),
    logRows: String(row.log_rows),
    changedEvents: String(row.changed_events),
    changedLogs: String(row.changed_logs),
    coverage: row.coverage as HistoryRepairDay['coverage'],
  };
}
