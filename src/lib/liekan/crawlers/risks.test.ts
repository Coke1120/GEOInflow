import { describe, expect, it } from 'vitest';
import type { CrawlerObservationQuality } from '../contracts/crawlers';
import {
  type CrawlerRiskFacts,
  completeHourWindow,
  crawlerRiskFactsSchema,
  evaluateCrawlerRisks,
  summarizeCrawlerRequests,
  transitionRisk,
} from './risks';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.parse('2026-10-09T12:45:00Z');
const bounds = completeHourWindow(now);
const quality: CrawlerObservationQuality = {
  state: 'complete',
  basis: 'event_time',
  classificationVersion: 'rules-v1',
  sourceVersion: 'source-v1',
  timezone: 'UTC',
};
function counts(total = 100, denied = 20, errors = 0) {
  return {
    requests: total,
    status1xx: 0,
    status2xx: total - denied - errors,
    status3xx: 0,
    status304: 0,
    status4xx: denied,
    status5xx: errors,
    denied403429: denied,
    head: 0,
    successfulGets: total - denied - errors,
  };
}
function facts(patch: Partial<CrawlerRiskFacts> = {}): CrawlerRiskFacts {
  return { botId: 'oai-searchbot', now, hour: { ...bounds, counts: counts(), quality }, ...patch };
}
function expectedPath(patch = {}) {
  return {
    pathGroup: '/public',
    expectedAccess: 'allow' as const,
    publicKeyPath: true,
    verifiedSearchDenied: 3,
    ownedTerminatingBlocks: 0,
    startAt: bounds.endAt - DAY,
    endAt: bounds.endAt,
    quality,
    ...patch,
  };
}
function coverage(
  currentPaths: { path: string; validGets: number }[],
  previousPaths = currentPaths,
) {
  return {
    current: { startAt: bounds.endAt - 7 * DAY, endAt: bounds.endAt, pages: currentPaths, quality },
    previous: {
      startAt: bounds.endAt - 14 * DAY,
      endAt: bounds.endAt - 7 * DAY,
      pages: previousPaths,
      quality,
    },
  };
}
const history = (requests: number) =>
  Array.from({ length: 7 }, (_, index) => ({
    startAt: bounds.startAt - (index + 1) * DAY,
    endAt: bounds.endAt - (index + 1) * DAY,
    requests,
    quality,
  }));

describe('crawler facts and risk evaluation', () => {
  it('keeps 304 independent from 3xx and HEAD independent from successful GET', () => {
    const result = summarizeCrawlerRequests([
      { status: 101, method: 'GET' },
      { status: 200, method: 'GET' },
      { status: 200, method: 'HEAD' },
      { status: 301, method: 'GET' },
      { status: 304, method: 'GET' },
      { status: 403, method: 'GET' },
      { status: 429, method: 'HEAD' },
      { status: 500, method: 'GET' },
    ]);
    expect(result).toEqual({
      requests: 8,
      status1xx: 1,
      status2xx: 2,
      status3xx: 1,
      status304: 1,
      status4xx: 2,
      status5xx: 1,
      denied403429: 2,
      head: 2,
      successfulGets: 1,
    });
  });

  it('applies the ingestion grace and half-open complete hour', () => {
    expect(completeHourWindow(Date.parse('2026-10-09T12:14:59Z'))).toEqual({
      startAt: Date.parse('2026-10-09T10:00:00Z'),
      endAt: Date.parse('2026-10-09T11:00:00Z'),
    });
    expect(bounds).toEqual({
      startAt: Date.parse('2026-10-09T11:00:00Z'),
      endAt: Date.parse('2026-10-09T12:00:00Z'),
    });
  });

  it('evaluates exact access and origin boundaries without claiming cause', () => {
    const result = evaluateCrawlerRisks(
      facts({ hour: { ...bounds, counts: counts(100, 20, 5), quality } }),
    );
    expect(result.map(value => [value.type, value.grade, value.confidence])).toEqual([
      ['access', 'medium', 'possible'],
      ['origin', 'medium', 'possible'],
    ]);
    expect(
      evaluateCrawlerRisks(facts({ hour: { ...bounds, counts: counts(99, 20, 5), quality } })),
    ).toEqual([]);
    expect(
      evaluateCrawlerRisks(facts({ hour: { ...bounds, counts: counts(201, 20), quality } })),
    ).toEqual([]);
  });

  it('keeps observed failures when quality is unknown while withholding the ratio', () => {
    const result = evaluateCrawlerRisks(
      facts({ hour: { ...bounds, counts: counts(), quality: { ...quality, state: 'unknown' } } }),
    );
    expect(result.find(value => value.type === 'observation')).toMatchObject({
      confidence: 'insufficient',
      status: 'pending',
    });
    expect(result.find(value => value.type === 'access')).toMatchObject({
      grade: 'info',
      confidence: 'possible',
      evidence: { denied: 20, state: 'unknown' },
    });
    expect(result.find(value => value.type === 'access').evidence).not.toHaveProperty('rate');
  });

  it('distinguishes missing, unsupported and a complete zero', () => {
    expect(evaluateCrawlerRisks(facts({ hour: null }))[0].evidence.state).toBe('missing');
    expect(
      evaluateCrawlerRisks(
        facts({
          hour: { ...bounds, counts: counts(0, 0), quality: { ...quality, state: 'unsupported' } },
        }),
      )[0].evidence.state,
    ).toBe('unsupported');
    expect(
      evaluateCrawlerRisks(facts({ hour: { ...bounds, counts: counts(0, 0), quality } })),
    ).toEqual([]);
  });

  it('uses seven distinct comparable same-hour windows and a nonzero median', () => {
    const result = evaluateCrawlerRisks(
      facts({
        hour: { ...bounds, counts: counts(1000, 0), quality },
        sameHourHistory: history(200),
      }),
    );
    expect(result.find(value => value.type === 'surge')).toMatchObject({
      grade: 'info',
      confidence: 'possible',
      evidence: { median: 200, ratio: 5, comparableWindows: 7 },
    });
    const zero = evaluateCrawlerRisks(
      facts({ hour: { ...bounds, counts: counts(1000, 0), quality }, sameHourHistory: history(0) }),
    );
    expect(zero.find(value => value.type === 'surge')).toMatchObject({
      confidence: 'insufficient',
      evidence: { median: 0 },
    });
    const changed = history(10).map(value => ({
      ...value,
      quality: { ...quality, classificationVersion: 'new-rules' },
    }));
    expect(
      evaluateCrawlerRisks(
        facts({ hour: { ...bounds, counts: counts(1000, 0), quality }, sameHourHistory: changed }),
      ).find(value => value.type === 'surge').confidence,
    ).toBe('insufficient');
  });

  it('does not count duplicate history days or wrong local hours as comparable', () => {
    const repeated = Array(7).fill(history(100)[0]);
    const wrongHour = history(100).map(value => ({
      ...value,
      startAt: value.startAt - HOUR,
      endAt: value.endAt - HOUR,
    }));
    for (const sameHourHistory of [repeated, wrongHour]) {
      expect(
        evaluateCrawlerRisks(
          facts({ hour: { ...bounds, counts: counts(1000, 0), quality }, sameHourHistory }),
        ).find(value => value.type === 'surge').confidence,
      ).toBe('insufficient');
    }
  });

  it('compares the common catalog to avoid additions and deletions creating false decline', () => {
    const common = Array.from({ length: 20 }, (_, index) => ({
      path: `/p/${index}`,
      validGets: 5,
    }));
    const oldOnly = Array.from({ length: 30 }, (_, index) => ({
      path: `/old/${index}`,
      validGets: 5,
    }));
    const newOnly = Array.from({ length: 80 }, (_, index) => ({
      path: `/new/${index}`,
      validGets: 0,
    }));
    const stable = coverage([...common, ...newOnly], [...common, ...oldOnly]);
    expect(
      evaluateCrawlerRisks(facts({ hour: null, coverage: stable })).some(
        value => value.type === 'coverage',
      ),
    ).toBe(false);
    const decline = coverage(
      common.map((value, index) => ({ ...value, validGets: index < 10 ? 1 : 0 })),
      common,
    );
    expect(
      evaluateCrawlerRisks(facts({ coverage: decline })).find(value => value.type === 'coverage'),
    ).toMatchObject({
      confidence: 'possible',
      evidence: { catalogPages: 20, baselineGets: 100, before: 20, after: 10, decline: 0.5 },
    });
  });

  it('withholds coverage conclusions for zero baseline, missing snapshot or changed source/timezone', () => {
    const pages = Array.from({ length: 20 }, (_, index) => ({ path: `/p/${index}`, validGets: 0 }));
    const baseline = coverage(pages);
    for (const value of [
      baseline,
      { ...baseline, previous: null },
      {
        ...baseline,
        previous: { ...baseline.previous, quality: { ...quality, sourceVersion: 'changed' } },
      },
      {
        ...baseline,
        previous: { ...baseline.previous, quality: { ...quality, timezone: 'Asia/Shanghai' } },
      },
    ]) {
      expect(
        evaluateCrawlerRisks(facts({ coverage: value })).find(value => value.type === 'coverage')
          .confidence,
      ).toBe('insufficient');
    }
  });

  it('requires 20 successfully fetched baseline pages even with a larger common catalog', () => {
    const pages = Array.from({ length: 20 }, (_, index) => ({ path: `/p/${index}`, validGets: 0 }));
    const previous = pages.map((page, index) => ({ ...page, validGets: index < 19 ? 6 : 0 }));
    expect(
      evaluateCrawlerRisks(facts({ coverage: coverage(pages, previous) })).find(
        value => value.type === 'coverage',
      ),
    ).toMatchObject({
      confidence: 'insufficient',
      evidence: { catalogPages: 20, before: 19, baselineGets: 114 },
    });
  });

  it('detects low-traffic verified search denial and retains unknown-coverage evidence', () => {
    for (const state of ['complete', 'unknown'] as const) {
      const result = evaluateCrawlerRisks(
        facts({ hour: null, expectedPaths: [expectedPath({ quality: { ...quality, state } })] }),
      );
      expect(result.find(value => value.type === 'expected_access')).toMatchObject({
        grade: 'medium',
        confidence: 'confirmed',
      });
    }
    expect(
      evaluateCrawlerRisks(
        facts({ hour: null, expectedPaths: [expectedPath({ verifiedSearchDenied: 2 })] }),
      ).some(value => value.type === 'expected_access'),
    ).toBe(false);
    expect(
      evaluateCrawlerRisks(
        facts({ botId: 'gptbot', hour: null, expectedPaths: [expectedPath()] }),
      ).find(value => value.type === 'expected_access').grade,
    ).toBe('info');
  });

  it('raises one explicit owned misblock and records intentional blocks as execution', () => {
    const result = evaluateCrawlerRisks(
      facts({
        hour: null,
        expectedPaths: [
          expectedPath({
            verifiedSearchDenied: 0,
            ownedTerminatingBlocks: 1,
            quality: { ...quality, state: 'unknown' },
          }),
        ],
      }),
    );
    expect(result.find(value => value.type === 'expected_access')).toMatchObject({
      grade: 'high',
      confidence: 'confirmed',
    });
    const intentional = evaluateCrawlerRisks(
      facts({
        hour: { ...bounds, counts: counts(), intentionalDenied403429: 20, quality },
        expectedPaths: [expectedPath({ expectedAccess: 'block', ownedTerminatingBlocks: 20 })],
      }),
    );
    expect(intentional.map(value => value.type)).toEqual(['execution']);
  });

  it('keeps UA mismatch and sensitive requests possible without automatic enforcement', () => {
    const result = evaluateCrawlerRisks(
      facts({ hour: null, rangeMismatches: 1, sensitivePathRequests: 1 }),
    );
    for (const type of ['identity', 'sensitive_path'])
      expect(result.find(value => value.type === type)).toMatchObject({
        grade: 'info',
        confidence: 'possible',
      });
    expect(JSON.stringify(result)).not.toMatch(/leak|ban/i);
  });

  it('keeps finding identity stable across repeated windows and bounds aggregates', () => {
    const current = evaluateCrawlerRisks(facts())[0];
    const later = evaluateCrawlerRisks(
      facts({
        now: now + HOUR,
        hour: {
          startAt: bounds.startAt + HOUR,
          endAt: bounds.endAt + HOUR,
          counts: counts(),
          quality,
        },
      }),
    )[0];
    expect(current.key).toBe(later.key);
    expect(current.key.length).toBeLessThanOrEqual(128);
    expect(
      crawlerRiskFactsSchema.safeParse(
        facts({ hour: { ...bounds, counts: { ...counts(), requests: -1 }, quality } }),
      ).success,
    ).toBe(false);
    expect(
      crawlerRiskFactsSchema.safeParse(facts({ sameHourHistory: Array(15).fill(history(1)[0]) }))
        .success,
    ).toBe(false);
  });
});

describe('risk recovery', () => {
  it('requires two new good complete windows and ignores repeat observations', () => {
    const previous = {
      status: 'active' as const,
      goodCompleteWindows: 0,
      lastWindowEnd: null,
      lastQuality: null,
    };
    const observation = {
      outcome: 'good' as const,
      quality,
      windowStart: bounds.startAt,
      windowEnd: bounds.endAt,
    };
    const first = transitionRisk(previous, observation);
    expect(first).toMatchObject({ status: 'pending', goodCompleteWindows: 1 });
    expect(transitionRisk(first, observation)).toEqual(first);
    expect(
      transitionRisk(first, {
        ...observation,
        windowStart: bounds.endAt,
        windowEnd: bounds.endAt + HOUR,
      }),
    ).toMatchObject({ status: 'resolved', goodCompleteWindows: 2 });
  });

  it.each(['unknown', 'no_data'] as const)(
    'keeps %s pending and resets recovery progress',
    outcome => {
      const previous = {
        status: 'pending' as const,
        goodCompleteWindows: 1,
        lastWindowEnd: bounds.endAt,
        lastQuality: quality,
      };
      expect(
        transitionRisk(previous, {
          outcome,
          quality,
          windowStart: bounds.endAt,
          windowEnd: bounds.endAt + HOUR,
        }),
      ).toMatchObject({ status: 'pending', goodCompleteWindows: 0 });
      expect(
        transitionRisk(previous, {
          outcome: 'good',
          quality: { ...quality, state: 'unknown' },
          windowStart: bounds.endAt,
          windowEnd: bounds.endAt + HOUR,
        }),
      ).toMatchObject({ status: 'pending', goodCompleteWindows: 0 });
    },
  );

  it('starts a new recovery sequence after a gap between complete hours', () => {
    const previous = {
      status: 'pending' as const,
      goodCompleteWindows: 1,
      lastWindowEnd: bounds.endAt,
      lastQuality: quality,
    };
    expect(
      transitionRisk(previous, {
        outcome: 'good',
        quality,
        windowStart: bounds.endAt + HOUR,
        windowEnd: bounds.endAt + 2 * HOUR,
      }),
    ).toMatchObject({ status: 'pending', goodCompleteWindows: 1 });
  });

  it.each([
    { classificationVersion: 'rules-v2' },
    { sourceVersion: 'source-v2' },
    { timezone: 'Asia/Shanghai' },
  ])('starts a new recovery sequence when comparison metadata changes: %j', patch => {
    const previous = {
      status: 'pending' as const,
      goodCompleteWindows: 1,
      lastWindowEnd: bounds.endAt,
      lastQuality: quality,
    };
    const changedQuality = { ...quality, ...patch };
    const restarted = transitionRisk(previous, {
      outcome: 'good',
      quality: changedQuality,
      windowStart: bounds.endAt,
      windowEnd: bounds.endAt + HOUR,
    });
    expect(restarted).toMatchObject({
      status: 'pending',
      goodCompleteWindows: 1,
      lastQuality: changedQuality,
    });
    expect(
      transitionRisk(restarted, {
        outcome: 'good',
        quality: changedQuality,
        windowStart: bounds.endAt + HOUR,
        windowEnd: bounds.endAt + 2 * HOUR,
      }),
    ).toMatchObject({ status: 'resolved', goodCompleteWindows: 2 });
  });
});
