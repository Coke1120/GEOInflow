import { describe, expect, it } from 'vitest';
import {
  applyFeaturePopulation,
  applyHumanFactsPopulation,
  applyReportPopulation,
} from './population-results';
import { populationFromRow } from '../upstream/browser-population';
const population = populationFromRow(
  {
    resourceKind: 'website',
    eligibleEvents: 5,
    qualifiedEvents: 3,
    eligiblePV: 5,
    qualifiedPV: 3,
    qualifiedVisitors: 2,
  },
  { startAt: 0, endAt: 1000, timezone: 'UTC' },
);
describe('identity availability output contracts', () => {
  it.each([0, 1, 2])('gates keyword visit counts with %s qualified events', qualified => {
    const window = populationFromRow(
      {
        resourceKind: 'website',
        eligibleEvents: 2,
        qualifiedEvents: qualified,
        eligiblePV: 2,
        qualifiedPV: qualified,
        qualifiedVisitors: qualified ? 1 : 0,
      },
      { startAt: 0, endAt: 1000, timezone: 'UTC' },
    );
    const complete = qualified === 2;
    const result = applyReportPopulation(
      {
        meta: {},
        cards: [],
        charts: {},
        tables: {
          keywordBody: [
            {
              sessions: 1,
              bounces: 1,
              conversions: 1,
              share: 100,
              bounceRate: 100,
              conversionRate: 100,
            },
          ],
          goalBody: [{ count: 1, convertedSessions: 1 }],
          pgBody: [{ path: '/', pv: 2, uv: 1 }],
        },
      } as any,
      window,
    );
    expect(result.tables.keywordBody[0]).toEqual({
      sessions: complete ? 1 : null,
      bounces: complete ? 1 : null,
      conversions: complete ? 1 : null,
      share: complete ? 100 : null,
      bounceRate: complete ? 100 : null,
      conversionRate: complete ? 100 : null,
    });
    expect(result.tables.goalBody[0].count).toBe(1);
    expect(result.tables.pgBody[0].pv).toBe(2);
  });
  it.each([0, 1, 2])('gates entry-attributed PV with %s qualified events', qualified => {
    const window = populationFromRow(
      {
        resourceKind: 'website',
        eligibleEvents: 2,
        qualifiedEvents: qualified,
        eligiblePV: 2,
        qualifiedPV: qualified,
        qualifiedVisitors: qualified ? 1 : 0,
      },
      { startAt: 0, endAt: 1000, timezone: 'UTC' },
    );
    const complete = qualified === 2;
    const source = {
      channel: 'AI 搜索引荐',
      source: 'ChatGPT',
      pv: 2,
      sessions: 1,
      bounces: 1,
      conversions: 1,
      count: 1,
      duration: 10,
    };
    const facts = applyHumanFactsPopulation(
      {
        sources: [source],
        sourceEvidence: [source],
        dailySources: [{ channel: 'AI 搜索引荐', count: 1 }],
        daily: [{ pv: 2, uv: 1 }],
        pages: [{ path: '/', pv: 2, uv: 1 }],
        goals: [{ count: 1, convertedSessions: 1 }],
      },
      window,
    );
    for (const key of ['sources', 'sourceEvidence'] as const)
      expect(facts[key][0]).toMatchObject({
        pv: complete ? 2 : null,
        sessions: complete ? 1 : null,
        conversions: complete ? 1 : null,
      });
    expect(facts.daily[0].pv).toBe(2);
    expect(facts.pages[0].pv).toBe(2);
    expect(facts.goals[0].count).toBe(1);
    expect(facts.dailySources[0].count).toBe(complete ? 1 : null);
  });
  it('preserves PV and goal event counts while clearing post-aggregation identity metrics', () => {
    const report: any = {
      meta: {},
      cards: [
        { key: '浏览量 PV', value: 5, state: 'available' },
        { key: '访客数 UV', value: 0, state: 'empty' },
        { key: 'keyword-total', label: '搜索渠道会话', value: 5, state: 'available' },
      ],
      charts: {
        h1: {
          labels: ['day'],
          series: [
            { name: 'PV', values: [5] },
            { name: 'UV', values: [0] },
          ],
        },
      },
      tables: {
        visitorTopBody: [{ path: '/', pv: 5, uv: 2 }],
        goalBody: [{ count: 3, convertedSessions: 2, conversionRate: 50 }],
      },
    };
    const result = applyReportPopulation(report, population);
    expect(result.cards).toMatchObject([
      { value: 5 },
      { value: null, state: 'unavailable' },
      { value: null, state: 'unavailable' },
    ]);
    expect(result.charts.h1.series.map(s => s.values)).toEqual([[5], [null]]);
    expect(result.tables.visitorTopBody).toEqual([{ path: '/', pv: 5, uv: null }]);
    expect(result.tables.goalBody).toEqual([
      { count: 3, convertedSessions: null, conversionRate: null },
    ]);
    expect(result.meta.population).toBe(population);
  });
  it('carries the unavailable reason for empty feature source lists', () => {
    expect(applyFeaturePopulation([], 'sources', population)).toEqual({ rows: [], population });
  });
  it('withholds fallback association records and preserves event/revenue measures', () => {
    expect(
      applyFeaturePopulation(
        { rows: [{ id: 'fallback', views: 5, seconds: 0 }], count: 1 },
        'sessions',
        population,
      ),
    ).toMatchObject({ rows: [], count: null, population });
    expect(
      applyFeaturePopulation(
        { rows: [{ sessionId: 'fallback', duration: 10 }], count: 1 },
        'replays',
        population,
      ),
    ).toMatchObject({ rows: [], count: null, population });
    expect(
      applyFeaturePopulation(
        { totals: { total: 5, visitors: 2 }, rows: [{ triggers: 5, visitors: 2 }] },
        'events',
        population,
      ),
    ).toMatchObject({
      totals: { total: 5, visitors: null },
      rows: [{ triggers: 5, visitors: null }],
    });
    expect(
      applyFeaturePopulation({ rows: [{ amount: 100 }], count: 1 }, 'revenue', population),
    ).toMatchObject({ rows: [{ amount: 100 }], count: 1 });
  });
});
