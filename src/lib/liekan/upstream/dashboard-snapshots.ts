import { analysisCapacity, analysisTransaction } from './analysis-rollups-db';
import type { AnalysisTx } from './analysis-rollups-model';
import { analysisQueryState, requestAnalysisQuery } from './analysis-queries';
import {
  analysisDigest,
  analysisQueryParameters,
  decodeAnalysisEnvelope,
} from './analysis-query-model';
import {
  dashboardWindow,
  defaultDashboardRange,
  DASHBOARD_FORMAT,
  DASHBOARD_INTERVAL,
} from './dashboard-snapshot-model';
import type { CrawlerActor } from './crawler-access';
import { noteBrowserPopulation } from './cache-context';
import { pageReportParts } from '../contracts/page-report';
import { withPublishedRegistry } from './crawler-registry-context';
import { LiekanError } from './errors';

type Snapshot = {
  website_id: string;
  query_key: string;
  actor_id: string;
  target: string;
  parameters: Record<string, any>;
  locale: 'zh-CN' | 'en-US';
  strong_version: string;
  epoch: bigint;
  calendar_day: string;
  result: unknown;
  result_bytes: number;
  generated_at: Date;
  data_through: Date;
  dependency_end: Date;
  fingerprint: string;
  job_id: string | null;
  pending_fingerprint: string | null;
  pending_through: Date;
  next_refresh_at: Date;
  error_code: string | null;
};

async function fingerprint(tx: AnalysisTx, row: Pick<Snapshot, 'website_id' | 'epoch'>, end: Date) {
  const [value] = await tx.$queryRawUnsafe<{ fingerprint: string }[]>(
    'SELECT liekan_dashboard_fingerprint($1::uuid,$2::bigint,$3::timestamptz) AS fingerprint',
    row.website_id,
    String(row.epoch),
    end,
  );
  return value.fingerprint;
}

function project(row: Snapshot, website: any, stale: boolean) {
  const envelope = decodeAnalysisEnvelope(row.result, row.website_id);
  const value: any = structuredClone(envelope.value);
  for (const population of envelope.populations) noteBrowserPopulation(row.website_id, population);
  const generatedAt = +new Date(row.generated_at);
  const expiresAt = Date.now() + DASHBOARD_INTERVAL;
  if (row.target === 'feature:page-report' && value) {
    value.website = {
      id: website.id,
      name: website.name,
      domain: website.domain,
      siteNumber: website.siteNumber,
    };
    value.meta = {
      ...value.meta,
      canManage: website.canManage,
      generatedAt,
      expiresAt,
      snapshot: {
        dataThrough: +new Date(row.data_through),
        state: stale ? 'updating' : 'ready',
        intervalMs: DASHBOARD_INTERVAL,
      },
    };
  }
  return {
    ready: true as const,
    value,
    generatedAt,
    expiresAt,
    dataThrough: +new Date(row.data_through),
    snapshotState: stale ? 'updating' : 'ready',
  };
}

/** Only metadata and task registration run in the foreground. Published values survive cache eviction. */
export async function requestDashboardSnapshot(
  websiteId: string,
  actor: CrawlerActor,
  target: string,
  input: Record<string, unknown>,
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
) {
  const parameters = analysisQueryParameters(target, input);
  if (Buffer.byteLength(JSON.stringify(parameters)) > 16384)
    throw new LiekanError('统计条件超出上限', 413);
  const window = dashboardWindow(target, parameters);
  const state = await analysisTransaction(tx => analysisQueryState(tx, websiteId, actor));
  if (state.mode === 'disabled')
    return requestAnalysisQuery(websiteId, actor, target, input, locale);
  const key = analysisDigest([
    DASHBOARD_FORMAT,
    websiteId,
    target,
    parameters,
    locale,
    state.strong,
    String(state.epoch),
    window.day,
  ]);
  let row = await analysisTransaction(async tx => {
    const [row] = await tx.$queryRawUnsafe<Snapshot[]>(
      `UPDATE liekan_dashboard_snapshot SET actor_id=$3::uuid,last_read_at=clock_timestamp()
       WHERE website_id=$1::uuid AND query_key=$2 RETURNING *`,
      websiteId,
      key,
      actor.id,
    );
    return row;
  });
  row ||= {
    website_id: websiteId,
    query_key: key,
    actor_id: actor.id,
    target,
    parameters,
    locale,
    strong_version: state.strong,
    epoch: state.epoch,
    calendar_day: window.day,
    dependency_end: new Date(window.dependencyEnd),
    result: null,
    job_id: null,
    error_code: null,
  } as Snapshot;
  const changed = Boolean(row.job_id || row.error_code);
  if (row.result != null) {
    // Access and strong versions are checked again immediately before returning a stored projection.
    const current = await analysisTransaction(tx => analysisQueryState(tx, websiteId, actor));
    if (current.strong !== state.strong || String(current.epoch) !== String(state.epoch))
      throw new LiekanError('统计条件已变化，请重新读取', 409);
    return project(
      row,
      current.website,
      changed || (+new Date(row.next_refresh_at) <= Date.now() && window.hot),
    );
  }
  const job = await enqueue(row, actor);
  if (job.ready) return job;
  return {
    ...job,
    ...(row.result != null ? { previousResult: project(row, state.website, true).value } : {}),
  };
}

async function enqueue(row: Snapshot, actor: CrawlerActor) {
  if (row.job_id) {
    const [active] = await analysisTransaction(tx =>
      tx.$queryRawUnsafe<{ parameters: Record<string, unknown> }[]>(
        "SELECT parameters FROM liekan_analysis_query WHERE id=$1::uuid AND status IN('queued','running')",
        row.job_id,
      ),
    );
    if (active)
      return requestAnalysisQuery(row.website_id, actor, row.target, active.parameters, row.locale);
  }
  const window = dashboardWindow(row.target, row.parameters);
  const end = new Date(window.dependencyEnd);
  const pin = await analysisTransaction(tx => fingerprint(tx, row, end));
  return requestAnalysisQuery(
    row.website_id,
    actor,
    row.target,
    { ...window.parameters, refresh: '1' },
    row.locale,
    async (tx, job) => {
      if (job.strong_version !== row.strong_version || String(job.epoch) !== String(row.epoch))
        throw new LiekanError('统计条件已变化，请重新读取', 409);
      // Admission, per-site capacity, result identity and the queued producer commit together.
      await tx.$queryRawUnsafe(
        'SELECT website_id FROM liekan_analysis_site WHERE website_id=$1::uuid FOR UPDATE',
        row.website_id,
      );
      const [existing] = await tx.$queryRawUnsafe(
        'SELECT 1 FROM liekan_dashboard_snapshot WHERE website_id=$1::uuid AND query_key=$2',
        row.website_id,
        row.query_key,
      );
      if (!existing) {
        const [count] = await tx.$queryRawUnsafe(
          'SELECT count(*)::int AS n FROM liekan_dashboard_snapshot WHERE website_id=$1::uuid',
          row.website_id,
        );
        if (count.n >= 200) {
          const evicted = await tx.$executeRawUnsafe(
            `DELETE FROM liekan_dashboard_snapshot WHERE (website_id,query_key) IN(
         SELECT website_id,query_key FROM liekan_dashboard_snapshot WHERE website_id=$1::uuid AND job_id IS NULL ORDER BY last_read_at LIMIT 1)`,
            row.website_id,
          );
          if (!evicted) throw new LiekanError('统计结果空间已达上限', 503);
        }
        const capacity = await analysisCapacity(tx, row.website_id);
        if (
          BigInt(capacity.globalBytes) >= BigInt(capacity.globalLimit) ||
          BigInt(capacity.siteBytes) >= BigInt(capacity.siteLimit)
        )
          throw new LiekanError('统计结果空间已达上限', 503);
        await tx.$executeRawUnsafe(
          `INSERT INTO liekan_dashboard_snapshot(website_id,query_key,actor_id,target,parameters,locale,strong_version,epoch,calendar_day,dependency_end)
       VALUES($1::uuid,$2,$3::uuid,$4,$5::jsonb,$6,$7,$8::bigint,$9,$10)`,
          row.website_id,
          row.query_key,
          actor.id,
          row.target,
          JSON.stringify(row.parameters),
          row.locale,
          row.strong_version,
          String(row.epoch),
          row.calendar_day,
          end,
        );
      }
      // An active producer keeps its originally pinned boundary and publication fence.
      await tx.$executeRawUnsafe(
        `UPDATE liekan_dashboard_snapshot SET job_id=$3::uuid,pending_fingerprint=$4,pending_through=$5,
       dependency_end=$6,next_refresh_at=$7,error_code=NULL
       WHERE website_id=$1::uuid AND query_key=$2 AND (job_id IS NULL
        OR NOT EXISTS(SELECT 1 FROM liekan_analysis_query q WHERE q.id=job_id AND q.status IN('queued','running')))`,
        row.website_id,
        row.query_key,
        job.id,
        pin,
        new Date(window.through),
        end,
        new Date(window.nextRefresh),
      );
      if (!window.computable)
        await tx.$executeRawUnsafe(
          `UPDATE liekan_analysis_query SET next_attempt_at=greatest(next_attempt_at,$2::timestamptz)
       WHERE id=$1::uuid AND status='queued'`,
          job.id,
          new Date(window.availableAt),
        );
      if (job.status === 'ready' && job.generated_at)
        await publishDashboardSnapshot(tx, { ...job, generated_at: job.generated_at });
    },
  );
}

export async function dashboardJobClock(tx: AnalysisTx, jobId: string) {
  const rows = await tx.$queryRawUnsafe<Snapshot[]>(
    'SELECT * FROM liekan_dashboard_snapshot WHERE job_id=$1::uuid FOR UPDATE',
    jobId,
  );
  for (const row of rows)
    await tx.$executeRawUnsafe(
      'UPDATE liekan_dashboard_snapshot SET pending_fingerprint=$3 WHERE website_id=$1::uuid AND query_key=$2',
      row.website_id,
      row.query_key,
      await fingerprint(tx, row, row.dependency_end),
    );
  return rows.length ? +new Date(rows[0].pending_through) : undefined;
}

/** Copy a complete result and its population evidence in the producer's publication transaction. */
export async function publishDashboardSnapshot(
  tx: AnalysisTx,
  job: { id: string; result: unknown; generated_at: Date; result_bytes: number },
) {
  const rows = await tx.$queryRawUnsafe<Snapshot[]>(
    'SELECT * FROM liekan_dashboard_snapshot WHERE job_id=$1::uuid FOR UPDATE',
    job.id,
  );
  if (rows.length) {
    const growth = rows.reduce(
      (bytes, row) => bytes + Math.max(0, job.result_bytes - row.result_bytes) * 2,
      0,
    );
    const capacity = await analysisCapacity(tx, rows[0].website_id);
    const physicalReserve = rows.length * job.result_bytes * 2;
    if (
      BigInt(capacity.globalBytes) + BigInt(physicalReserve) >= BigInt(capacity.globalLimit) ||
      BigInt(capacity.siteBytes) + BigInt(growth) >= BigInt(capacity.siteLimit)
    )
      throw new LiekanError('统计结果空间已达上限', 413, 'analysis-capacity-limited');
  }
  for (const row of rows) {
    const current = await fingerprint(tx, row, row.dependency_end);
    if (current !== row.pending_fingerprint) {
      await tx.$executeRawUnsafe(
        `UPDATE liekan_dashboard_snapshot SET job_id=NULL,next_refresh_at=clock_timestamp(),error_code='dashboard-input-changed'
         WHERE website_id=$1::uuid AND query_key=$2`,
        row.website_id,
        row.query_key,
      );
      continue;
    }
    await tx.$executeRawUnsafe(
      `UPDATE liekan_dashboard_snapshot SET result=$3::jsonb,result_bytes=$4,generated_at=$5,
       data_through=pending_through,fingerprint=pending_fingerprint,job_id=NULL,error_code=NULL,checked_at=clock_timestamp()
       WHERE website_id=$1::uuid AND query_key=$2`,
      row.website_id,
      row.query_key,
      JSON.stringify(job.result),
      job.result_bytes,
      job.generated_at,
    );
  }
}

/** Persistent demand is revisited by the worker; ordinary page reads never start statistics SQL. */
export async function pumpDashboardSnapshots() {
  if (process.env.CLICKHOUSE_URL) return;
  await analysisTransaction(tx =>
    tx.$executeRawUnsafe(
      `DELETE FROM liekan_dashboard_snapshot WHERE (website_id,query_key) IN(
      SELECT website_id,query_key FROM (SELECT website_id,query_key,row_number() OVER(
       PARTITION BY website_id ORDER BY last_read_at DESC) AS rank FROM liekan_dashboard_snapshot WHERE job_id IS NULL) expired WHERE rank>200)`,
    ),
  );
  const rows = await analysisTransaction(tx =>
    tx.$queryRawUnsafe<Snapshot[]>(
      `SELECT d.* FROM liekan_dashboard_snapshot d JOIN website w USING(website_id)
     JOIN liekan_analysis_site s USING(website_id) WHERE w.deleted_at IS NULL AND s.mode='live' AND s.epoch=d.epoch
     AND d.next_refresh_at<=clock_timestamp() AND (d.job_id IS NULL OR NOT EXISTS(
      SELECT 1 FROM liekan_analysis_query q WHERE q.id=d.job_id AND q.status IN('queued','running')))
     ORDER BY d.next_refresh_at,d.website_id LIMIT 8`,
    ),
  );
  for (const row of rows) {
    try {
      await withPublishedRegistry(async () => {
        const actor = { id: row.actor_id, role: '' };
        const current = await analysisTransaction(tx =>
          analysisQueryState(tx, row.website_id, actor),
        );
        const window = dashboardWindow(row.target, row.parameters);
        if (row.calendar_day !== window.day) {
          // The previous day's published generation remains intact while default demand advances to the new day.
          await analysisTransaction(tx =>
            tx.$executeRawUnsafe(
              "UPDATE liekan_dashboard_snapshot SET next_refresh_at='9999-12-31'::timestamptz,error_code=NULL WHERE website_id=$1::uuid AND query_key=$2",
              row.website_id,
              row.query_key,
            ),
          );
          return;
        }
        if (row.strong_version !== current.strong || String(row.epoch) !== String(current.epoch)) {
          await requestDashboardSnapshot(
            row.website_id,
            actor,
            row.target,
            row.parameters,
            row.locale,
          );
          await analysisTransaction(tx =>
            tx.$executeRawUnsafe(
              'DELETE FROM liekan_dashboard_snapshot WHERE website_id=$1::uuid AND query_key=$2',
              row.website_id,
              row.query_key,
            ),
          );
          return;
        }
        const pin = await analysisTransaction(tx =>
          fingerprint(tx, row, new Date(window.dependencyEnd)),
        );
        if (
          row.result != null &&
          pin === row.fingerprint &&
          +new Date(row.data_through) === window.through
        ) {
          // Stable history stays published until its input or rule boundary changes.
          await analysisTransaction(tx =>
            tx.$executeRawUnsafe(
              `UPDATE liekan_dashboard_snapshot SET next_refresh_at=$3,checked_at=clock_timestamp(),dependency_end=$4
             WHERE website_id=$1::uuid AND query_key=$2`,
              row.website_id,
              row.query_key,
              new Date(window.nextRefresh),
              new Date(window.dependencyEnd),
            ),
          );
          return;
        }
        if (window.computable) await enqueue(row, actor);
      });
    } catch (error) {
      const status = (error as any)?.status;
      await analysisTransaction(tx =>
        tx.$executeRawUnsafe(
          [401, 403, 404].includes(status)
            ? 'DELETE FROM liekan_dashboard_snapshot WHERE website_id=$1::uuid AND query_key=$2'
            : `UPDATE liekan_dashboard_snapshot SET next_refresh_at=clock_timestamp()+interval '${status === 429 ? '5 seconds' : '5 minutes'}',error_code='dashboard-refresh-failed' WHERE website_id=$1::uuid AND query_key=$2`,
          row.website_id,
          row.query_key,
        ),
      );
    }
  }
}

/** Warm the existing default pages before a new day is opened. Conditions outside these defaults stay demand-driven. */
export async function seedDashboardSnapshots() {
  const sites = await analysisTransaction(tx =>
    tx.$queryRawUnsafe<{ website_id: string; actor_id: string }[]>(
      `SELECT w.website_id,coalesce(w.user_id,(SELECT tu.user_id FROM team_user tu JOIN "user" u USING(user_id)
      WHERE tu.team_id=w.team_id AND u.deleted_at IS NULL ORDER BY tu.user_id LIMIT 1),
      (SELECT user_id FROM "user" WHERE role='admin' AND deleted_at IS NULL ORDER BY user_id LIMIT 1)) AS actor_id
     FROM website w JOIN liekan_analysis_site s USING(website_id) WHERE w.deleted_at IS NULL AND s.mode='live'
     ORDER BY s.dashboard_seed_checked_at NULLS FIRST,w.website_id LIMIT 8`,
    ),
  );
  for (const site of sites) {
    if (!site.actor_id) continue;
    const remembered = await analysisTransaction(tx =>
      tx.$queryRawUnsafe<{ timezone: string; locale: 'zh-CN' | 'en-US' }[]>(
        `SELECT DISTINCT parameters->>'timezone' AS timezone,locale FROM liekan_dashboard_snapshot
       WHERE website_id=$1::uuid AND last_read_at>clock_timestamp()-interval '7 days' ORDER BY 1,2 LIMIT 8`,
        site.website_id,
      ),
    );
    const scopes = [
      ...new Map(
        [{ timezone: 'Asia/Shanghai', locale: 'zh-CN' as const }, ...remembered]
          .filter(x => x.timezone)
          .map(x => [`${x.timezone}:${x.locale}`, x]),
      ).values(),
    ];
    for (const { timezone, locale } of scopes) {
      const range = defaultDashboardRange(timezone);
      for (const resource of Object.keys(pageReportParts).filter(
        x => !['logs', 'human/keywords'].includes(x),
      )) {
        try {
          await withPublishedRegistry(() =>
            requestDashboardSnapshot(
              site.website_id,
              { id: site.actor_id, role: '' },
              'feature:page-report',
              {
                ...range,
                timezone,
                resource,
                ...(resource.startsWith('ai/')
                  ? {
                      endAt: range.endAt + 1,
                      crawlerIdentityScope: 'all',
                      crawlerMetricsVersion: 1,
                    }
                  : {}),
              },
              locale,
            ),
          );
        } catch {
          /* Quotas and per-site permission failures leave other websites independent. */
        }
      }
    }
    await analysisTransaction(tx =>
      tx.$executeRawUnsafe(
        'UPDATE liekan_analysis_site SET dashboard_seed_checked_at=clock_timestamp() WHERE website_id=$1::uuid',
        site.website_id,
      ),
    );
  }
}
