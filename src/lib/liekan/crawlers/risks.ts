import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  type CrawlerObservationQuality,
  type CrawlerRequestCounts,
  type CrawlerRiskFinding,
  type CrawlerRiskType,
  crawlerHasControlCharacters,
  crawlerPathSchema,
} from '../contracts/crawlers';
import { getCrawler } from './directory';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const count = z.number().int().min(0).max(1_000_000_000_000);
const timestamp = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const pathGroup = z
  .string()
  .min(1)
  .max(512)
  .refine(value => !crawlerHasControlCharacters(value));
export const crawlerQualitySchema = z.strictObject({
  state: z.enum(['complete', 'partial', 'unknown', 'missing', 'unsupported']),
  basis: z.enum(['event_time', 'ingestion_time', 'unknown']),
  classificationVersion: z.string().max(128),
  sourceVersion: z.string().max(128),
  timezone: z
    .string()
    .min(1)
    .max(80)
    .refine(value => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }),
});
export const crawlerCountsSchema = z
  .strictObject({
    requests: count,
    status1xx: count,
    status2xx: count,
    status3xx: count,
    status304: count,
    status4xx: count,
    status5xx: count,
    denied403429: count,
    head: count,
    successfulGets: count,
  })
  .refine(
    value =>
      value.status1xx +
        value.status2xx +
        value.status3xx +
        value.status304 +
        value.status4xx +
        value.status5xx ===
        value.requests &&
      value.denied403429 <= value.status4xx &&
      value.head <= value.requests &&
      value.successfulGets <= value.status2xx &&
      value.successfulGets + value.head <= value.requests,
    'Inconsistent request counts',
  );
const hourlyWindow = z
  .strictObject({
    startAt: timestamp,
    endAt: timestamp,
    counts: crawlerCountsSchema,
    intentionalDenied403429: count.default(0),
    quality: crawlerQualitySchema,
  })
  .refine(value => value.endAt - value.startAt === HOUR, 'Expected a 60 minute window')
  .refine(
    value => value.intentionalDenied403429 <= value.counts.denied403429,
    'Invalid intentional block count',
  );
const comparisonWindow = z
  .strictObject({
    startAt: timestamp,
    endAt: timestamp,
    requests: count,
    quality: crawlerQualitySchema,
  })
  .refine(value => value.endAt - value.startAt === HOUR, 'Expected a 60 minute window');
const catalogSnapshot = z
  .strictObject({
    startAt: timestamp,
    endAt: timestamp,
    pages: z
      .array(z.strictObject({ path: crawlerPathSchema.shape.value, validGets: count }))
      .max(10_000)
      .refine(pages => new Set(pages.map(page => page.path)).size === pages.length)
      .refine(
        pages => pages.reduce((total, page) => total + page.validGets, 0) <= 1_000_000_000_000,
      ),
    quality: crawlerQualitySchema,
  })
  .refine(value => value.endAt - value.startAt === 7 * DAY, 'Expected a seven day window');
const expectedPath = z
  .strictObject({
    pathGroup,
    expectedAccess: z.enum(['allow', 'block']),
    publicKeyPath: z.boolean(),
    verifiedSearchDenied: count,
    ownedTerminatingBlocks: count,
    startAt: timestamp,
    endAt: timestamp,
    quality: crawlerQualitySchema,
  })
  .refine(value => value.endAt - value.startAt === DAY, 'Expected a 24 hour window');
export const crawlerRiskFactsSchema = z.strictObject({
  botId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  pathGroup: pathGroup.default('all'),
  now: timestamp,
  hour: hourlyWindow.nullable(),
  sameHourHistory: z.array(comparisonWindow).max(14).default([]),
  coverage: z
    .strictObject({ current: catalogSnapshot.nullable(), previous: catalogSnapshot.nullable() })
    .optional(),
  expectedPaths: z.array(expectedPath).max(100).default([]),
  rangeMismatches: count.default(0),
  sensitivePathRequests: count.default(0),
});
export type CrawlerRiskFacts = z.input<typeof crawlerRiskFactsSchema>;

/** Half-open interval; the 15 minute ingestion grace is excluded from the complete hour. */
export function completeHourWindow(now: number) {
  timestamp.min(HOUR + 15 * 60_000).parse(now);
  const endAt = Math.floor((now - 15 * 60_000) / HOUR) * HOUR;
  return { startAt: endAt - HOUR, endAt };
}

export function summarizeCrawlerRequests(
  records: readonly { status: number; method: string }[],
): CrawlerRequestCounts {
  const parsed = z
    .array(
      z.strictObject({ status: z.number().int().min(100).max(599), method: z.string().max(20) }),
    )
    .max(100_000)
    .parse(records);
  const counts: CrawlerRequestCounts = {
    requests: parsed.length,
    status1xx: 0,
    status2xx: 0,
    status3xx: 0,
    status304: 0,
    status4xx: 0,
    status5xx: 0,
    denied403429: 0,
    head: 0,
    successfulGets: 0,
  };
  for (const { status, method } of parsed) {
    if (status === 304) counts.status304++;
    else if (status < 200) counts.status1xx++;
    else if (status < 300) counts.status2xx++;
    else if (status < 400) counts.status3xx++;
    else if (status < 500) counts.status4xx++;
    else counts.status5xx++;
    if (status === 403 || status === 429) counts.denied403429++;
    if (method === 'HEAD') counts.head++;
    if (method === 'GET' && status >= 200 && status < 300) counts.successfulGets++;
  }
  return counts;
}

export function completeEventQuality(quality: CrawlerObservationQuality) {
  return (
    quality.state === 'complete' &&
    quality.basis === 'event_time' &&
    !!quality.classificationVersion &&
    !!quality.sourceVersion &&
    !!quality.timezone
  );
}

export function comparableCrawlerQuality(
  current: CrawlerObservationQuality,
  previous: CrawlerObservationQuality,
) {
  return (
    completeEventQuality(current) &&
    completeEventQuality(previous) &&
    current.classificationVersion === previous.classificationVersion &&
    current.sourceVersion === previous.sourceVersion &&
    current.timezone === previous.timezone
  );
}

export function crawlerFindingKey(botId: string, type: CrawlerRiskType, group = 'all') {
  const identity = JSON.stringify([
    z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/).parse(botId),
    type,
    pathGroup.parse(group),
  ]);
  return `cr_${createHash('sha256').update(identity).digest('hex')}`;
}

function localWindowKey(time: number, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(time);
  const part = (name: string) => parts.find(value => value.type === name)?.value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: part('hour') };
}

export function evaluateCrawlerRisks(input: CrawlerRiskFacts): CrawlerRiskFinding[] {
  const facts = crawlerRiskFactsSchema.parse(input);
  const window = completeHourWindow(facts.now);
  const findings: CrawlerRiskFinding[] = [];
  const add = (
    type: CrawlerRiskType,
    grade: CrawlerRiskFinding['grade'],
    confidence: CrawlerRiskFinding['confidence'],
    reason: string,
    evidence: CrawlerRiskFinding['evidence'] = {},
    group = facts.pathGroup,
    bounds = window,
  ) => {
    findings.push({
      key: crawlerFindingKey(facts.botId, type, group),
      botId: facts.botId,
      type,
      pathGroup: group,
      grade,
      confidence,
      status: confidence === 'insufficient' ? 'pending' : 'active',
      reason,
      evidence,
      windowStart: bounds.startAt,
      windowEnd: bounds.endAt,
    });
  };
  const hour = facts.hour;
  const usableHour =
    hour &&
    completeEventQuality(hour.quality) &&
    hour.startAt === window.startAt &&
    hour.endAt === window.endAt;
  if (!usableHour) {
    add('observation', 'info', 'insufficient', 'Complete event-time hour is unavailable', {
      state: hour?.quality.state || 'missing',
      basis: hour?.quality.basis || 'unknown',
    });
    if (hour && hour.counts.denied403429 > hour.intentionalDenied403429) {
      add(
        'access',
        'info',
        'possible',
        'Observed HTTP 403/429 requests; complete-hour rate is unavailable',
        {
          denied: hour.counts.denied403429 - hour.intentionalDenied403429,
          state: hour.quality.state,
          basis: hour.quality.basis,
        },
        undefined,
        { startAt: hour.startAt, endAt: hour.endAt },
      );
    }
  } else {
    const counts = hour.counts;
    const denied = counts.denied403429 - hour.intentionalDenied403429;
    if (counts.requests >= 100 && denied >= 20 && denied / counts.requests >= 0.1) {
      add('access', 'medium', 'possible', 'HTTP 403/429 access threshold reached', {
        requests: counts.requests,
        denied,
        rate: denied / counts.requests,
      });
    }
    if (counts.requests >= 100 && counts.status5xx / counts.requests >= 0.05) {
      add('origin', 'medium', 'possible', 'HTTP 5xx threshold reached', {
        requests: counts.requests,
        errors: counts.status5xx,
        rate: counts.status5xx / counts.requests,
      });
    }
    if (counts.requests >= 1000) {
      const currentLocal = localWindowKey(hour.startAt, hour.quality.timezone);
      const dates = new Set<string>();
      const comparable = facts.sameHourHistory.filter(value => {
        const local = localWindowKey(value.startAt, hour.quality.timezone);
        if (
          !comparableCrawlerQuality(hour.quality, value.quality) ||
          value.endAt > hour.startAt ||
          value.startAt < hour.startAt - 14 * DAY ||
          local.hour !== currentLocal.hour ||
          dates.has(local.date)
        ) {
          return false;
        }
        dates.add(local.date);
        return true;
      });
      const sorted = comparable.map(value => value.requests).sort((a, b) => a - b);
      const median = sorted.length
        ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2
        : null;
      if (sorted.length < 7 || median === null || median === 0) {
        add(
          'surge',
          'info',
          'insufficient',
          'Comparable nonzero same-hour baseline is unavailable',
          {
            comparableWindows: sorted.length,
            median,
          },
        );
      } else if (counts.requests >= 5 * median) {
        add('surge', 'info', 'possible', 'Same-hour request surge threshold reached', {
          requests: counts.requests,
          median,
          comparableWindows: sorted.length,
          ratio: counts.requests / median,
        });
      }
    }
  }

  if (facts.coverage) {
    const { current, previous } = facts.coverage;
    if (
      !current ||
      !previous ||
      !comparableCrawlerQuality(current.quality, previous.quality) ||
      previous.endAt !== current.startAt ||
      current.endAt > window.endAt
    ) {
      add('coverage', 'info', 'insufficient', 'Comparable catalog snapshots are unavailable');
    } else {
      const priorPages = new Map(previous.pages.map(page => [page.path, page.validGets]));
      const common = current.pages.filter(page => priorPages.has(page.path));
      const baselineGets = common.reduce((total, page) => total + priorPages.get(page.path), 0);
      const before = common.filter(page => priorPages.get(page.path) > 0).length;
      const after = common.filter(page => page.validGets > 0).length;
      const evidence = { catalogPages: common.length, baselineGets, before, after };
      const bounds = { startAt: current.startAt, endAt: current.endAt };
      if (common.length < 20 || baselineGets < 100 || before < 20) {
        add(
          'coverage',
          'info',
          'insufficient',
          'Catalog baseline is insufficient',
          evidence,
          undefined,
          bounds,
        );
      } else if (after / before <= 0.5) {
        add(
          'coverage',
          'info',
          'possible',
          'Common-catalog successful GET coverage declined',
          {
            ...evidence,
            decline: 1 - after / before,
          },
          undefined,
          bounds,
        );
      }
    }
  }

  for (const path of facts.expectedPaths) {
    const bounds = { startAt: path.startAt, endAt: path.endAt };
    const explicitEvent =
      path.quality.basis === 'event_time' &&
      path.endAt <= facts.now &&
      path.endAt > facts.now - DAY;
    if (path.ownedTerminatingBlocks > 0 && explicitEvent) {
      if (path.expectedAccess === 'allow') {
        add(
          'expected_access',
          'high',
          'confirmed',
          'Owned terminating block conflicts with saved expected access',
          {
            ownedTerminatingBlocks: path.ownedTerminatingBlocks,
          },
          path.pathGroup,
          bounds,
        );
      } else {
        add(
          'execution',
          'info',
          'confirmed',
          'Owned terminating block matches saved expected access',
          {
            ownedTerminatingBlocks: path.ownedTerminatingBlocks,
          },
          path.pathGroup,
          bounds,
        );
      }
    } else if (
      path.expectedAccess === 'allow' &&
      path.publicKeyPath &&
      path.verifiedSearchDenied >= 3
    ) {
      const type = getCrawler(facts.botId).type;
      const usable =
        (type === 'search' || type === 'traditional_search') &&
        path.quality.basis === 'event_time' &&
        path.endAt <= facts.now &&
        path.endAt > facts.now - DAY;
      add(
        'expected_access',
        usable ? 'medium' : 'info',
        usable ? 'confirmed' : 'possible',
        usable
          ? 'Verified search access denied on a public key path'
          : 'Public key path observation is incomplete',
        { verifiedSearchDenied: path.verifiedSearchDenied },
        path.pathGroup,
        bounds,
      );
    }
  }
  if (facts.rangeMismatches) {
    add('identity', 'info', 'possible', 'Declared UA has an official range mismatch', {
      rangeMismatches: facts.rangeMismatches,
    });
  }
  if (facts.sensitivePathRequests) {
    add(
      'sensitive_path',
      'info',
      'possible',
      'Requests to configured sensitive paths require review',
      {
        sensitivePathRequests: facts.sensitivePathRequests,
      },
    );
  }
  return findings;
}

export interface CrawlerRiskTransition {
  status: 'active' | 'pending' | 'resolved';
  goodCompleteWindows: number;
  lastWindowEnd: number | null;
  lastQuality: CrawlerObservationQuality | null;
}

/** Recovery requires consecutive complete hours with comparable source and classification. */
export function transitionRisk(
  previous: CrawlerRiskTransition,
  observation: {
    outcome: 'bad' | 'good' | 'unknown' | 'no_data';
    quality: CrawlerObservationQuality;
    windowStart: number;
    windowEnd: number;
  },
): CrawlerRiskTransition {
  z.strictObject({
    outcome: z.enum(['bad', 'good', 'unknown', 'no_data']),
    quality: crawlerQualitySchema,
    windowStart: timestamp,
    windowEnd: timestamp,
  })
    .refine(
      value => value.windowEnd - value.windowStart === HOUR,
      'Expected a complete hourly span',
    )
    .parse(observation);
  z.strictObject({
    status: z.enum(['active', 'pending', 'resolved']),
    goodCompleteWindows: z.number().int().min(0).max(2),
    lastWindowEnd: timestamp.nullable(),
    lastQuality: crawlerQualitySchema.nullable(),
  }).parse(previous);
  if (previous.lastWindowEnd !== null && observation.windowEnd <= previous.lastWindowEnd)
    return previous;
  if (observation.outcome === 'bad') {
    return {
      status: 'active',
      goodCompleteWindows: 0,
      lastWindowEnd: observation.windowEnd,
      lastQuality: { ...observation.quality },
    };
  }
  if (observation.outcome !== 'good' || !completeEventQuality(observation.quality)) {
    return {
      status: 'pending',
      goodCompleteWindows: 0,
      lastWindowEnd: observation.windowEnd,
      lastQuality: { ...observation.quality },
    };
  }
  const continuous =
    observation.windowStart === previous.lastWindowEnd &&
    previous.lastQuality !== null &&
    comparableCrawlerQuality(observation.quality, previous.lastQuality);
  const goodCompleteWindows = continuous ? Math.min(2, previous.goodCompleteWindows + 1) : 1;
  return {
    status: goodCompleteWindows === 2 ? 'resolved' : 'pending',
    goodCompleteWindows,
    lastWindowEnd: observation.windowEnd,
    lastQuality: { ...observation.quality },
  };
}
