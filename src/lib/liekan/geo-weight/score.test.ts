import { describe, expect, it } from 'vitest';
import { emptyGeoFactors, geoScore } from './score';
import { GEO_SCOPE } from './policy';
import { geoAsOf, geoWindow } from './window';
import { geoComparable, geoPoint } from './evidence';
import type { CrawlerObservationQuality } from '../contracts/crawlers';

const zero = () => ({
  search: emptyGeoFactors(),
  user: emptyGeoFactors(),
  training: emptyGeoFactors(),
});
const full = (operators: number) => ({ paths: 1000, units: 10000, days: 30, operators });
const window = geoWindow('2026-10-20', 'Asia/Shanghai');
const quality = (
  state: CrawlerObservationQuality['state'] = 'complete',
): CrawlerObservationQuality => ({
  state,
  basis: 'event_time',
  classificationVersion: 'class-1',
  sourceVersion: 'source-1',
  timezone: 'Asia/Shanghai',
});
const row = () => ({
  stats: {
    requests: 100,
    accepted: 100,
    firstEvidenceDay: '2026-09-21',
    classificationVersions: ['class-1'],
    catalogVersions: ['catalog-1'],
    sources: ['source-1'],
    mimeConfirmed: 100,
  },
  factors: [{ purpose: 'search', paths: 10, units: 100, days: 10, operators: 1 }],
});
describe('frozen GEO weight calculation', () => {
  it('reproduces the approved worked example without rounding category contributions first', () => {
    const actual = geoScore({
      search: { paths: 300, units: 3000, days: 24, operators: 3 },
      user: { paths: 80, units: 400, days: 16, operators: 2 },
      training: { paths: 800, units: 8000, days: 12, operators: 3 },
    });
    expect(actual).toMatchObject({ rawScore: 63.75526112, score: 63.8, level: 7 });
  });
  it('keeps absent purpose weights and caps all factors', () => {
    expect(geoScore(zero())).toMatchObject({ score: 0, level: 0 });
    expect(geoScore({ ...zero(), training: full(3) })).toMatchObject({ score: 15, level: 2 });
    expect(geoScore({ ...zero(), search: full(5), user: full(5) })).toMatchObject({
      score: 85,
      level: 9,
    });
    expect(geoScore({ search: full(5), user: full(5), training: full(3) })).toMatchObject({
      score: 100,
      level: 10,
    });
    expect(
      geoScore({ ...zero(), search: { ...full(0), days: 1 } }).categories[0].score,
    ).toBeCloseTo(46.5);
  });
  it('is monotonic across page and daily-unit increases and rejects invalid factors', () => {
    let previous = 0;
    for (let n = 1; n < 10000; n += 113) {
      const next = geoScore({
        ...zero(),
        search: { paths: n, units: n, days: 30, operators: 1 },
      }).score;
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
    expect(() => geoScore({ ...zero(), search: { ...full(5), days: 31 } })).toThrow();
    expect(() => geoScore({ ...zero(), search: { ...full(5), units: NaN } })).toThrow();
  });
  it('freezes 18 identities and eight operators independently of future catalog entries', () => {
    expect(GEO_SCOPE).toHaveLength(18);
    expect(new Set(GEO_SCOPE.map(i => i.platformId)).size).toBe(8);
    expect(
      ['search', 'user', 'training'].map(p => GEO_SCOPE.filter(i => i.purpose === p).length),
    ).toEqual([7, 6, 5]);
    expect(GEO_SCOPE.map(i => i.id)).not.toContain('chatgpt-agent');
  });
  it('uses local calendar dates through daylight saving and never includes today', () => {
    const dst = geoWindow('2026-03-20', 'America/New_York');
    expect(dst.endAt - dst.startAt).toBe((30 * 24 - 1) * 3600000);
    expect(
      geoAsOf(
        Date.parse('2026-10-21T15:59:59Z'),
        'Asia/Shanghai',
        Date.parse('2026-10-21T08:00:00Z'),
      ),
    ).toBe('2026-10-20');
    expect(geoAsOf(Date.parse('2026-10-20T16:00:00Z'), 'Asia/Shanghai')).toBe('2026-10-20');
  });
});
describe('GEO evidence states and comparisons', () => {
  it('distinguishes no input, unverified input and proved observed zero', () => {
    expect(geoPoint(window, {}, quality('missing'), false, false)).toMatchObject({
      state: 'missing',
      score: null,
      level: null,
    });
    expect(
      geoPoint(window, { stats: { requests: 1, identityMissing: 1 } }, quality(), false, true),
    ).toMatchObject({ state: 'unavailable', score: null });
    expect(geoPoint(window, {}, quality(), false, true)).toMatchObject({
      state: 'observed_zero',
      score: 0,
      level: 0,
    });
    expect(
      geoPoint(window, { stats: { requests: 1, historyMissing: 1 } }, quality(), false, true).score,
    ).toBeNull();
  });
  it('does not extrapolate short spans or claim full coverage from distant endpoints', () => {
    const input = row();
    input.stats.firstEvidenceDay = '2026-10-20';
    expect(geoPoint(window, input, quality('unknown'), false, false)).toMatchObject({
      state: 'warming_up',
      observedDays: 1,
      level: null,
    });
    expect(geoPoint(window, row(), quality('unknown'), false, false).state).toBe('reference');
  });
  it('requires stable complete evidence for comparisons and stops for every limitation', () => {
    const aligned = geoPoint(window, row(), quality(), false, true);
    expect(aligned.state).toBe('aligned');
    expect(geoComparable(aligned, aligned)).toBe(true);
    for (const flag of [
      'samplingUnknown',
      'inferredHost',
      'historyMissing',
      'identityMissing',
      'pathInferred',
    ]) {
      const limited = geoPoint(
        window,
        { ...row(), stats: { ...row().stats, [flag]: 1 } },
        quality(),
        false,
        true,
      );
      expect(limited.state).toBe('reference');
      expect(geoComparable(aligned, limited)).toBe(false);
    }
    expect(geoComparable(aligned, geoPoint(window, row(), quality(), true, true))).toBe(false);
    expect(
      geoComparable(
        aligned,
        geoPoint(window, row(), { ...quality(), sourceVersion: 'changed' }, false, true),
      ),
    ).toBe(false);
  });
});
