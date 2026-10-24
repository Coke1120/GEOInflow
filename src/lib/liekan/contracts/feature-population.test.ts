import { describe, expect, it } from 'vitest';
import { featureAnalyticsResponse } from './feature-responses';
import { applyFeaturePopulation } from './population-results';
import { populationFromRow } from '../upstream/browser-population';

const range = { startAt: 1, endAt: 2, timezone: 'UTC' };
const session = featureAnalyticsResponse.options.find(
  (branch: any) => branch.shape.totals?.shape?.entryPath,
)!;
const replays = featureAnalyticsResponse.options.find(
  (branch: any) => branch.shape.rows?.element?.shape?.chunkCount,
)!;
const sessionValue = {
  rows: [],
  totals: {
    views: 2,
    events: 1,
    seconds: 30,
    count: 3,
    firstAt: '2026-10-01',
    lastAt: '2026-10-02',
    entryPath: '/',
    exitPath: '/done',
    referrerDomain: 'example.com',
  },
  page: 1,
  pageSize: 1000,
  more: false,
};
const replayValue = { rows: [], count: 2, page: 1, pageSize: 25 };
describe('exact feature identity response branches', () => {
  it.each(['session', 'replays'].flatMap(kind => [0, 1, 2].map(reliable => ({ kind, reliable }))))(
    'matches $kind runtime outputs with $reliable reliable events',
    ({ kind, reliable }) => {
      const population = populationFromRow(
        {
          eligibleEvents: 2,
          qualifiedEvents: reliable,
          eligiblePV: 2,
          qualifiedPV: reliable,
          qualifiedVisitors: reliable ? 1 : 0,
        },
        range,
      );
      const schema = kind === 'session' ? session : replays;
      const output = applyFeaturePopulation(
        kind === 'session' ? sessionValue : replayValue,
        kind,
        population,
      );
      expect(schema.safeParse(output).success).toBe(true);
      expect(schema.parse(output)).toEqual(output);
      expect(kind === 'session' ? output.totals.count : output.count).toBe(
        reliable === 2 ? (kind === 'session' ? 3 : 2) : null,
      );
    },
  );
  it('keeps measured empty identity counts as zero', () => {
    const population = populationFromRow(
      {
        eligibleEvents: 0,
        qualifiedEvents: 0,
        eligiblePV: 0,
        qualifiedPV: 0,
        qualifiedVisitors: 0,
      },
      range,
    );
    const output = applyFeaturePopulation({ ...replayValue, count: 0 }, 'replays', population);
    expect(replays.parse(output)).toEqual(output);
    expect(output.count).toBe(0);
  });
});
