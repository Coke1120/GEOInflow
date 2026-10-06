import { analyticsPreheatTargets } from './cache-policy';
import type { PgBoss } from 'pg-boss';
import { analyticsRedis } from './analytics-redis';
import type { AnalyticsVersions } from './analytics-revision';
import { currentCacheContext } from './cache-context';
import { analyticsCacheKey, type CachedResult } from './query-cache';

export const ANALYTICS_QUEUE = 'liekan-analytics-refresh';
export const ANALYTICS_QUEUE_OPTIONS = {
  policy: 'exclusive' as const,
  retryLimit: 2,
  retryDelay: 5,
  retryBackoff: false,
  expireInSeconds: 45,
  retentionSeconds: 3600,
  deleteAfterSeconds: 86400,
};
export interface AnalyticsRefreshJob {
  websiteId: string;
  target: string;
  parameters: Record<string, any>;
  actorId?: string;
  shareId?: string;
  scopeHash: string;
  expectedStrongVersion: string;
  scheduledAt: number;
  fingerprint: string;
}
const ALLOWED_PARAMS = new Set([
  'startAt',
  'endAt',
  'timezone',
  'unit',
  'refresh',
  'resource',
  'chartPeriod',
  'kind',
  'type',
  'metric',
  'currency',
  'steps',
  'window',
  'startStep',
  'endStep',
  'fields',
  'model',
  'step',
  'column',
  'value',
  'mode',
  'urlPath',
  'limit',
  'compare',
  'eventType',
  'dimension',
  'attributionStep',
  'attributionModel',
  'attributionType',
  'attributionSource',
]);
const NATIVE = analyticsPreheatTargets.native;
const FEATURE = analyticsPreheatTargets.feature;
const HOT_WINDOW = 900000;
function namespace() {
  const url = new URL(process.env.DATABASE_URL);
  return `liekan:analytics:hot:${analyticsCacheKey('database-v1', [url.protocol, url.host, url.pathname, url.searchParams.get('schema') || 'public'])}`;
}
function keys(websiteId: string) {
  const root = namespace(),
    site = `${root}:${websiteId}`;
  return {
    site,
    counts: `${site}:counts`,
    recent: `${site}:recent`,
    tasks: `${site}:tasks`,
    due: `${root}:due`,
  };
}
const member = (job: Pick<AnalyticsRefreshJob, 'websiteId' | 'fingerprint'>) =>
  `${job.websiteId}|${job.fingerprint}`;

const RECORD = `
local function remove(f)
  redis.call('HDEL',KEYS[1],f); redis.call('ZREM',KEYS[2],f); redis.call('HDEL',KEYS[3],f)
  redis.call('ZREM',KEYS[4],ARGV[7]..'|'..f)
end
for _,f in ipairs(redis.call('ZRANGEBYSCORE',KEYS[2],'-inf',ARGV[4])) do remove(f) end
local old=redis.call('HGET',KEYS[1],ARGV[1]); local v=old and cjson.decode(old) or {round='',visits={}}
local visits={}; for _,at in ipairs(v.visits or {}) do if at>tonumber(ARGV[4]) then table.insert(visits,at) end end
if v.round~=ARGV[2] then table.insert(visits,tonumber(ARGV[3])); v.round=ARGV[2] end
while #visits>100 do table.remove(visits,1) end
v.visits=visits; v.count=math.min(3,#visits); v.heat=#visits
redis.call('HSET',KEYS[1],ARGV[1],cjson.encode(v)); redis.call('ZADD',KEYS[2],ARGV[3],ARGV[1])
local extra=redis.call('ZCARD',KEYS[2])-4
if extra>0 then for _,f in ipairs(redis.call('ZRANGE',KEYS[2],0,extra-1)) do remove(f) end end
if v.count>=3 and redis.call('ZSCORE',KEYS[2],ARGV[1]) then
  local job=cjson.decode(ARGV[5]); local previous=redis.call('HGET',KEYS[3],ARGV[1])
  if previous then
    local p=cjson.decode(previous)
    job.scheduledAt=math.min(p.scheduledAt,job.scheduledAt)
    if p.expectedStrongVersion~=job.expectedStrongVersion then job.scheduledAt=tonumber(ARGV[3]) end
  end
  redis.call('HSET',KEYS[3],ARGV[1],cjson.encode(job))
  if not previous or cjson.decode(previous).expectedStrongVersion~=job.expectedStrongVersion
    or job.scheduledAt<cjson.decode(previous).scheduledAt then
    redis.call('ZADD',KEYS[4],job.scheduledAt,ARGV[7]..'|'..ARGV[1])
  end
end
if v.count<3 then redis.call('HDEL',KEYS[3],ARGV[1]); redis.call('ZREM',KEYS[4],ARGV[7]..'|'..ARGV[1]) end
for i=1,3 do redis.call('PEXPIRE',KEYS[i],900000) end
return v.count`;

/** Refresh jobs key versions and permissions on the UUID; the URL may carry the short site number. */
async function resolveWebsiteUuid(handle: string): Promise<string | null> {
  try {
    const { primary } = await import('./server');
    const website = await primary().website.findFirst({
      where: { siteNumber: Number(handle) },
      select: { id: true },
    });
    return website?.id ?? null;
  } catch {
    return null;
  }
}

/** A foreground observation owns the 15-minute window. Worker renewals never extend it. */
export async function rememberAnalyticsHot(
  result: CachedResult<unknown>,
  versions: AnalyticsVersions,
) {
  try {
    const context = currentCacheContext();
    const now = Date.now();
    if (
      !analyticsRedis.enabled ||
      context?.background ||
      !context?.request ||
      !context.actor ||
      result.expiresAt <= now
    )
      return;
    const match = new URL(context.request.url).pathname.match(
      /^\/api\/(liekan\/)?websites\/([a-f0-9-]{36}|\d{1,9})\/(.+)$/i,
    );
    if (!match || !(match[1] ? FEATURE : NATIVE).has(match[3])) return;
    const parameters = { ...context.parameters };
    for (const [key, value] of Object.entries({
      page: 1,
      cursor: '',
      seek: 'after',
      filter: '',
      search: '',
    }))
      if (parameters[key] === value || String(parameters[key]) === String(value))
        delete parameters[key];
    if (Object.keys(parameters).some(key => !ALLOWED_PARAMS.has(key))) return;
    delete parameters.refresh;
    if (
      parameters.resource === 'logs' ||
      (parameters.kind &&
        !['events', 'utm', 'sources', 'performance', 'attribution', 'heatmap-scroll'].includes(
          String(parameters.kind),
        ))
    )
      return;
    // Refresh jobs key versions and permissions on the UUID; resolve a numeric URL handle first.
    const rawId = match[2].toLowerCase();
    const websiteId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(rawId)
      ? rawId
      : await resolveWebsiteUuid(rawId);
    if (!websiteId) return;
    const target = `${match[1] ? 'feature' : 'native'}:${match[3]}`;
    const scopeHash = analyticsCacheKey('scope-v1', context.scope);
    const fingerprint = analyticsCacheKey('hot-query-v1', [
      target,
      websiteId,
      parameters,
      scopeHash,
    ]);
    const lead = result.expiresAt - result.generatedAt > 30000 ? 30000 : 5000;
    const job: AnalyticsRefreshJob = {
      websiteId,
      target,
      parameters,
      scopeHash,
      fingerprint,
      expectedStrongVersion: versions.strong,
      scheduledAt: Math.max(now, result.expiresAt - lead),
      ...((context.scope as any)?.shareId
        ? { shareId: context.actor }
        : { actorId: context.actor }),
    };
    // Bound payload size before persisting user-supplied aggregate conditions.
    if (JSON.stringify(job).length > 16384) return;
    const k = keys(websiteId);
    await analyticsRedis.command([
      'EVAL',
      RECORD,
      '4',
      k.counts,
      k.recent,
      k.tasks,
      k.due,
      fingerprint,
      String(Math.floor(now / 30000)),
      String(now),
      String(now - HOT_WINDOW),
      JSON.stringify(job),
      String(job.scheduledAt),
      websiteId,
    ]);
  } catch {
    /* Preheating failures do not affect a completed foreground result. */
  }
}

const GET_HOT = `
local last=redis.call('ZSCORE',KEYS[2],ARGV[1])
local job=redis.call('HGET',KEYS[3],ARGV[1]); local count=redis.call('HGET',KEYS[1],ARGV[1])
if not last or tonumber(last)<=tonumber(ARGV[2]) or not job or not count then
  redis.call('ZREM',KEYS[2],ARGV[1]); redis.call('HDEL',KEYS[1],ARGV[1]); redis.call('HDEL',KEYS[3],ARGV[1])
  redis.call('ZREM',KEYS[4],ARGV[3]); return nil
end
local c=cjson.decode(count); local heat=0
for _,at in ipairs(c.visits or {}) do if at>tonumber(ARGV[2]) then heat=heat+1 end end
if heat<3 then redis.call('HDEL',KEYS[3],ARGV[1]); redis.call('ZREM',KEYS[4],ARGV[3]); return nil end
return {job,tostring(heat)}`;
export async function readAnalyticsHot(
  job: Pick<AnalyticsRefreshJob, 'websiteId' | 'fingerprint'>,
  now = Date.now(),
) {
  const k = keys(job.websiteId);
  const reply = await analyticsRedis.command<[string, string]>([
    'EVAL',
    GET_HOT,
    '4',
    k.counts,
    k.recent,
    k.tasks,
    k.due,
    job.fingerprint,
    String(now - HOT_WINDOW),
    member(job),
  ]);
  if (!reply) return null;
  try {
    return { job: JSON.parse(reply[0]) as AnalyticsRefreshJob, priority: Number(reply[1]) };
  } catch {
    return null;
  }
}

const RESCHEDULE = `
local last=redis.call('ZSCORE',KEYS[1],ARGV[1]); local value=redis.call('HGET',KEYS[2],ARGV[1])
if not last or tonumber(last)<=tonumber(ARGV[2]) or not value then return 0 end
local job=cjson.decode(value)
-- A foreground invalidation may have replaced the demand while this job was running.
if job.scheduledAt~=tonumber(ARGV[3]) or job.expectedStrongVersion~=ARGV[4] then return 0 end
job.scheduledAt=tonumber(ARGV[5]); job.expectedStrongVersion=ARGV[6]
redis.call('HSET',KEYS[2],ARGV[1],cjson.encode(job)); redis.call('ZADD',KEYS[3],ARGV[5],ARGV[7]); return 1`;
export async function scheduleNextAnalyticsHot(
  job: AnalyticsRefreshJob,
  expiresAt: number,
  generatedAt: number,
  expectedStrongVersion = job.expectedStrongVersion,
  now = Date.now(),
) {
  const lead = expiresAt - generatedAt > 30000 ? 30000 : 5000;
  const scheduledAt = Math.max(now + 5000, job.scheduledAt + 30000, expiresAt - lead);
  const k = keys(job.websiteId);
  await analyticsRedis.command([
    'EVAL',
    RESCHEDULE,
    '3',
    k.recent,
    k.tasks,
    k.due,
    job.fingerprint,
    String(now - HOT_WINDOW),
    String(job.scheduledAt),
    job.expectedStrongVersion,
    String(scheduledAt),
    expectedStrongVersion,
    member(job),
  ]);
}

/** Merge a strong-version change into current demand after the old queued job ends. */
export async function renewAnalyticsHotVersion(
  job: AnalyticsRefreshJob,
  expectedStrongVersion: string,
  now = Date.now(),
) {
  const k = keys(job.websiteId);
  await analyticsRedis.command([
    'EVAL',
    RESCHEDULE,
    '3',
    k.recent,
    k.tasks,
    k.due,
    job.fingerprint,
    String(now - HOT_WINDOW),
    String(job.scheduledAt),
    job.expectedStrongVersion,
    String(now + 5000),
    expectedStrongVersion,
    member(job),
  ]);
}

export async function forgetAnalyticsHot(job: AnalyticsRefreshJob) {
  const k = keys(job.websiteId);
  await analyticsRedis.command([
    'EVAL',
    `local value=redis.call('HGET',KEYS[2],ARGV[1]); if not value then return 0 end
local current=cjson.decode(value)
if current.scheduledAt~=tonumber(ARGV[3]) or current.expectedStrongVersion~=ARGV[4]
  or (current.actorId or '')~=ARGV[5] or (current.shareId or '')~=ARGV[6] then return 0 end
redis.call('HDEL',KEYS[1],ARGV[1]); redis.call('HDEL',KEYS[2],ARGV[1]);
redis.call('ZREM',KEYS[3],ARGV[1]); redis.call('ZREM',KEYS[4],ARGV[2]); return 1`,
    '4',
    k.counts,
    k.tasks,
    k.recent,
    k.due,
    job.fingerprint,
    member(job),
    String(job.scheduledAt),
    job.expectedStrongVersion,
    job.actorId || '',
    job.shareId || '',
  ]);
}

const SITE_ROUND = `
local round=redis.call('GET',KEYS[1]); if round==ARGV[1] then return 1 end; if round then return 0 end
local count=tonumber(redis.call('GET',KEYS[2]) or '0'); if count>=2 then return 0 end
redis.call('SET',KEYS[1],ARGV[1],'PX',30000); redis.call('INCR',KEYS[2]); redis.call('PEXPIRE',KEYS[2],60000); return 1`;
export async function hotJobEligible(job: AnalyticsRefreshJob, now = Date.now()) {
  if (!Number.isFinite(job.scheduledAt) || now > job.scheduledAt + 30000 || now < job.scheduledAt)
    return false;
  const hot = await readAnalyticsHot(job, now);
  if (
    !hot ||
    hot.job.scheduledAt !== job.scheduledAt ||
    hot.job.expectedStrongVersion !== job.expectedStrongVersion
  )
    return false;
  const k = keys(job.websiteId);
  return (
    (await analyticsRedis.command<number>([
      'EVAL',
      SITE_ROUND,
      '2',
      `${k.site}:round`,
      `${k.site}:minute:${Math.floor(now / 60000)}`,
      `${job.fingerprint}:${job.scheduledAt}`,
    ])) === 1
  );
}

/** Scan due hot registrations only; bounded work survives queue outages and process restarts. */
export async function pumpAnalyticsHot(
  queue: Pick<PgBoss, 'send'>,
  readStrongVersion: (websiteId: string) => Promise<string>,
  now = Date.now(),
) {
  if (!analyticsRedis.enabled) return;
  const due = `${namespace()}:due`;
  const members = await analyticsRedis.command<string[]>([
    'ZRANGEBYSCORE',
    due,
    '-inf',
    String(now),
    'LIMIT',
    '0',
    '100',
  ]);
  if (!members) return;
  const jobs: Array<{ job: AnalyticsRefreshJob; priority: number }> = [];
  for (const value of members) {
    const [websiteId, fingerprint] = value.split('|');
    if (!/^[a-f0-9-]{36}$/.test(websiteId || '') || !/^[a-f0-9]{64}$/.test(fingerprint || '')) {
      await analyticsRedis.command(['ZREM', due, value]);
      continue;
    }
    const hot = await readAnalyticsHot({ websiteId, fingerprint }, now);
    if (hot) jobs.push(hot);
  }
  jobs.sort((a, b) => b.priority - a.priority || a.job.scheduledAt - b.job.scheduledAt);
  for (const hot of jobs.slice(0, 20)) {
    try {
      let job = hot.job;
      const version = await readStrongVersion(job.websiteId);
      if (version !== job.expectedStrongVersion || now > job.scheduledAt + 30000) {
        await renewAnalyticsHotVersion(job, version, now);
        const updated = await readAnalyticsHot(job, now);
        if (!updated) continue;
        job = updated.job;
      }
      const id = await queue.send(ANALYTICS_QUEUE, job, {
        ...ANALYTICS_QUEUE_OPTIONS,
        singletonKey: job.fingerprint,
        startAfter: new Date(job.scheduledAt),
        priority: hot.priority,
      });
      // Keep recoverable demand while pg-boss owns queued/active/retry deduplication.
      // A failed send leaves it due for the next five-second maintenance pass.
      if (id) {
        const k = keys(job.websiteId);
        await analyticsRedis.command([
          'EVAL',
          `local value=redis.call('HGET',KEYS[1],ARGV[1]); if not value then return 0 end
local current=cjson.decode(value)
if current.scheduledAt~=tonumber(ARGV[2]) or current.expectedStrongVersion~=ARGV[3] then return 0 end
redis.call('ZADD',KEYS[2],ARGV[4],ARGV[5]); return 1`,
          '2',
          k.tasks,
          due,
          job.fingerprint,
          String(job.scheduledAt),
          job.expectedStrongVersion,
          String(Math.max(now + 5000, job.scheduledAt + 35000)),
          member(job),
        ]);
      }
    } catch {
      /* Queue or primary failure leaves the Redis demand ready for retry. */
    }
  }
}

const INVALIDATE = `
for _,f in ipairs(redis.call('ZRANGEBYSCORE',KEYS[1],ARGV[1],'+inf')) do
  if redis.call('HEXISTS',KEYS[2],f)==1 then redis.call('ZADD',KEYS[3],ARGV[2],ARGV[3]..'|'..f) end
end; return 1`;
/** Write callbacks are non-blocking; the pump reads the committed primary version. */
export function notifyAnalyticsHotInvalidation(ids: string[]) {
  void (async () => {
    if (!analyticsRedis.enabled) return;
    const now = Date.now();
    for (const id of [...new Set(ids)]) {
      const k = keys(id);
      await analyticsRedis.command([
        'EVAL',
        INVALIDATE,
        '3',
        k.recent,
        k.tasks,
        k.due,
        String(now - HOT_WINDOW),
        String(now),
        id,
      ]);
    }
  })().catch(() => {});
}

export async function reserveWorkerComputation(now = Date.now()) {
  const script = `local n=tonumber(redis.call('GET',KEYS[1]) or '0'); if n>=20 then return 0 end;
redis.call('INCR',KEYS[1]); redis.call('PEXPIRE',KEYS[1],60000); return 1`;
  return (
    (await analyticsRedis.command<number>([
      'EVAL',
      script,
      '1',
      `${namespace()}:worker-budget:${Math.floor(now / 60000)}`,
    ])) === 1
  );
}
