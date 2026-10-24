// @vitest-environment node
import { expect, it } from 'vitest';
import {
  assertInitialGeoTodaySources,
  geoScenarioValidator,
  requestRangeMatches,
  sameRequestStatistics,
  supplementalCacheMatrix,
} from '../../../../scripts/liekan-cache-matrix';
import type { BrowserPopulation } from '../contracts/browser-population';

const available = (label: string, value: number) => ({ label, state: 'available', value });

it('checks the current overview request card and conversion-page conversion card', () => {
  expect(() =>
    assertInitialGeoTodaySources({
      resource: 'overview',
      cards: [available('今日总请求', 3), available('访客（UV）', 2), available('AI 蜘蛛请求', 1)],
    }),
  ).not.toThrow();
  expect(() =>
    assertInitialGeoTodaySources({ resource: 'conversions', cards: [available('今日转化', 2)] }),
  ).not.toThrow();
  for (const resource of ['overview', 'conversions']) {
    expect(() => assertInitialGeoTodaySources({ resource, cards: [] })).toThrow();
    expect(() =>
      assertInitialGeoTodaySources({
        resource,
        cards: [available(resource === 'overview' ? '今日总请求' : '今日转化', 0)],
      }),
    ).toThrow();
  }
});

const window = {
  startAt: Date.parse('2024-01-01T00:00:00Z'),
  endAt: Date.parse('2024-01-31T00:01:00Z'),
  timezone: 'Asia/Shanghai',
};
const population = (range = window): BrowserPopulation => ({
  resourceId: 'synthetic-site',
  populationVersion: 'browser-population-v4',
  resourceKind: 'website',
  capability: 'supported',
  scope: 'resource-window',
  policyRevision: '7',
  historyActiveGeneration: null,
  historyRevision: '3',
  epoch: '1',
  governanceRevision: '4',
  governanceWatermark: '2024-01-01T00:00:00.000Z',
  governanceProcessing: {
    state: 'observed',
    computedAt: '2024-01-01T00:00:00.000Z',
    nextWindow: null,
    errorCode: null,
  },
  identity: {
    status: 'complete',
    eligibleEvents: 3,
    eligiblePV: 2,
    qualifiedPV: 2,
    qualifiedVisitors: 1,
    coverage: 1,
    versions: ['identity-v1'],
  },
  ruleVersions: ['rule-v1'],
  catalogVersions: ['catalog-v1'],
  versionSetsTruncated: false,
  range,
});
const url = (range = window) =>
  `/api/liekan/websites/synthetic-site/page-report?${new URLSearchParams(
    Object.entries(range).map(([key, value]) => [key, String(value)]),
  )}`;

it.each([1, 60001])(
  'compares page population metadata against its nonce request (%i ms)',
  nonce => {
    const reference = {
      resource: 'human/overview',
      range: window,
      cards: [available('浏览量 PV', 2)],
      meta: { population: population() },
    };
    const range = { ...window, endAt: window.endAt + nonce };
    const body = {
      ...reference,
      range,
      meta: { population: population(range) },
    };
    const validate = geoScenarioValidator(
      {
        label: 'page',
        site: 'synthetic-site',
        target: 'page-report',
        extra: {},
        validate: () => true,
      },
      reference,
      url(),
    );
    expect(validate(body, `${url()}&endAt=${range.endAt}`)).toBe(true);
  },
);

const previousWindow = (range = window) => {
  const offset = Math.trunc((range.endAt - range.startAt) / 60000) * 60000;
  return { ...range, startAt: range.startAt - offset, endAt: range.endAt - offset };
};
const nativeStats = (range = window) => ({
  pageviews: 2,
  visitors: 1,
  visits: 1,
  bounces: 0,
  totaltime: 0,
  population: population(range),
  comparison: {
    pageviews: 2,
    visitors: 1,
    visits: 1,
    bounces: 0,
    totaltime: 0,
    population: population(previousWindow(range)),
  },
});

it.each([0, 1, 60001, 200001])(
  'validates both native population windows across a %i ms nonce',
  nonce => {
    const range = { ...window, endAt: window.endAt + nonce };
    const body = nativeStats(range);
    expect(requestRangeMatches(body, `${url()}&endAt=${range.endAt}`)).toBe(true);
    expect(sameRequestStatistics(body, nativeStats(), `${url()}&endAt=${range.endAt}`, url())).toBe(
      true,
    );
    if (nonce >= 60000) {
      expect(body.comparison.population.range.startAt).not.toBe(
        nativeStats().comparison.population.range.startAt,
      );
    }
  },
);

it('validates a nonce reference and a measured request on different minute boundaries', () => {
  const referenceRange = { ...window, endAt: window.endAt + 100000 };
  const measuredRange = { ...window, endAt: window.endAt + 200001 };
  expect(
    sameRequestStatistics(
      nativeStats(measuredRange),
      nativeStats(referenceRange),
      `${url()}&endAt=${measuredRange.endAt}`,
      `${url()}&endAt=${referenceRange.endAt}`,
    ),
  ).toBe(true);
});

it('uses the native year-over-year calendar window including leap-day clamping', () => {
  const range = {
    ...window,
    startAt: Date.parse('2024-02-29T00:00:00Z'),
    endAt: Date.parse('2024-03-01T00:00:00Z'),
  };
  const reference = nativeStats(range);
  reference.comparison.population.range = {
    ...range,
    startAt: Date.parse('2023-02-28T00:00:00Z'),
    endAt: Date.parse('2023-03-01T00:00:00Z'),
  };
  const body = structuredClone(reference);
  body.population.range.endAt += 60001;
  body.comparison.population.range.endAt += 60001;
  expect(
    sameRequestStatistics(
      body,
      reference,
      `${url(range)}&compare=yoy&endAt=${range.endAt + 60001}`,
      `${url(range)}&compare=yoy`,
    ),
  ).toBe(true);
});

it('supports feature population envelopes and preserves inclusive/half-open semantics', () => {
  const range = { ...window, endAt: window.endAt + 60001 };
  const reference = { rows: [{ x: 'Synthetic Firefox', y: 2 }], population: population() };
  const body = { ...reference, population: population(range) };
  expect(sameRequestStatistics(body, reference, url(range), url())).toBe(true);
  body.population.range = { ...range, endExclusive: true };
  expect(sameRequestStatistics(body, reference, url(range), url())).toBe(false);
  reference.population.range = { ...window, endExclusive: true };
  expect(sameRequestStatistics(body, reference, url(range), url())).toBe(true);
});

it.each([
  ['current start', (body: ReturnType<typeof nativeStats>) => body.population.range.startAt++],
  ['current end', (body: ReturnType<typeof nativeStats>) => body.population.range.endAt--],
  ['timezone', (body: ReturnType<typeof nativeStats>) => (body.population.range.timezone = 'UTC')],
  [
    'comparison start',
    (body: ReturnType<typeof nativeStats>) => body.comparison.population.range.startAt++,
  ],
  [
    'comparison end',
    (body: ReturnType<typeof nativeStats>) => body.comparison.population.range.endAt--,
  ],
] as const)('rejects the wrong %s metadata', (_name, change) => {
  const range = { ...window, endAt: window.endAt + 60001 };
  const body = nativeStats(range);
  change(body);
  expect(requestRangeMatches(body, url(range))).toBe(false);
  expect(sameRequestStatistics(body, nativeStats(), url(range), url())).toBe(false);
});

it.each([
  ['pageviews', (body: ReturnType<typeof nativeStats>) => body.pageviews++],
  ['comparison count', (body: ReturnType<typeof nativeStats>) => body.comparison.visitors++],
  [
    'identity status',
    (body: ReturnType<typeof nativeStats>) => (body.population.identity.status = 'partial'),
  ],
  ['coverage', (body: ReturnType<typeof nativeStats>) => (body.population.identity.coverage = 0.5)],
  [
    'identity version',
    (body: ReturnType<typeof nativeStats>) => body.population.identity.versions.push('identity-v2'),
  ],
  [
    'rule version',
    (body: ReturnType<typeof nativeStats>) => body.population.ruleVersions.push('rule-v2'),
  ],
  [
    'catalog version',
    (body: ReturnType<typeof nativeStats>) => body.population.catalogVersions.push('catalog-v2'),
  ],
  [
    'governance revision',
    (body: ReturnType<typeof nativeStats>) => (body.population.governanceRevision = '5'),
  ],
  [
    'governance processing',
    (body: ReturnType<typeof nativeStats>) =>
      (body.population.governanceProcessing.computedAt = '2024-01-02T00:00:00.000Z'),
  ],
  [
    'resource identity',
    (body: ReturnType<typeof nativeStats>) => (body.population.resourceId = 'other'),
  ],
  ['epoch', (body: ReturnType<typeof nativeStats>) => (body.population.epoch = '2')],
  [
    'comparison policy',
    (body: ReturnType<typeof nativeStats>) => (body.comparison.population.policyRevision = '8'),
  ],
] as const)('preserves exact %s comparison', (_name, change) => {
  const range = { ...window, endAt: window.endAt + 60001 };
  const body = nativeStats(range);
  change(body);
  expect(requestRangeMatches(body, url(range))).toBe(true);
  expect(sameRequestStatistics(body, nativeStats(), url(range), url())).toBe(false);
});

it('validates the reference window and retains all unrelated range-shaped data', () => {
  const range = { ...window, endAt: window.endAt + 1 };
  expect(sameRequestStatistics(nativeStats(range), nativeStats(), url(range), url(range))).toBe(
    false,
  );
  const body = { ...nativeStats(range), rows: [{ range }] };
  const reference = { ...nativeStats(), rows: [{ range: window }] };
  expect(sameRequestStatistics(body, reference, url(range), url())).toBe(false);
  expect(sameRequestStatistics(nativeStats(), nativeStats(), url(), url())).toBe(true);
});

it('rejects missing or stale declared windows and leaves both DTOs unchanged', () => {
  const range = { ...window, endAt: window.endAt + 60001 };
  const body = nativeStats(range);
  const reference = nativeStats();
  const before = JSON.stringify({ body, reference });
  expect(sameRequestStatistics(body, reference, url(range), url())).toBe(true);
  expect(JSON.stringify({ body, reference })).toBe(before);
  const missing = structuredClone(body);
  delete missing.population.range;
  expect(requestRangeMatches(missing, url(range))).toBe(false);
  const staleComparison = structuredClone(body);
  staleComparison.comparison.population.range = reference.comparison.population.range;
  expect(sameRequestStatistics(staleComparison, reference, url(range), url())).toBe(false);
  const page = {
    range: { ...range, startAt: range.startAt + 1 },
    meta: { population: population(range) },
  };
  expect(requestRangeMatches(page, url(range))).toBe(false);
});

const summaryUrl = (range = window) =>
  url(range).replace('/synthetic-site/page-report', '/summary');
const summaryRows = (range = window) =>
  ['first', 'second'].map(id => ({
    id,
    ...nativeStats(range),
    population: { ...population(range), resourceId: id },
    views: 2,
    received: true,
    lastAt: '2024-01-30T00:00:00.000Z',
  }));

it('compares each registered website-summary row using its fixed previous window', () => {
  const range = { ...window, endAt: window.endAt + 60001 };
  expect(
    sameRequestStatistics(
      summaryRows(range),
      summaryRows(),
      `${summaryUrl(range)}&compare=yoy`,
      `${summaryUrl()}&compare=yoy`,
    ),
  ).toBe(true);
});

it('compares the registered native event stats data envelope', () => {
  const range = { ...window, endAt: window.endAt + 60001 };
  const eventUrl = (range = window) =>
    url(range)
      .replace('/api/liekan/websites/', '/api/websites/')
      .replace('/page-report?', '/events/stats?');
  const eventStats = (range = window) => ({
    data: { ...nativeStats(range), events: 3, uniqueEvents: 1 },
  });
  expect(sameRequestStatistics(eventStats(range), eventStats(), eventUrl(range), eventUrl())).toBe(
    true,
  );
});

it('validates feature-sources rows in the population envelope', () => {
  const entry = supplementalCacheMatrix(Array(10).fill('synthetic-site'), {}).find(
    entry => entry.label === 'feature-sources',
  );
  expect(
    entry.validate({
      rows: [{ referrer: 'chatgpt.com', visitors: 1, views: 2 }],
      population: population(),
    }),
  ).toBe(true);
  for (const body of [[], [{ visitors: 1 }], { rows: [] }, { rows: [{ visitors: 0 }] }])
    expect(entry.validate(body)).toBe(false);
});

it('retains summary row identity, order, counts and child population evidence', () => {
  const range = { ...window, endAt: window.endAt + 60001 };
  const reference = summaryRows();
  const compare = (body: typeof reference) =>
    sameRequestStatistics(body, reference, summaryUrl(range), summaryUrl());
  const wrongWindow = summaryRows(range);
  wrongWindow[1].comparison.population.range.endAt--;
  expect(requestRangeMatches(wrongWindow, summaryUrl(range))).toBe(false);
  expect(compare(wrongWindow)).toBe(false);
  const wrongIdentity = summaryRows(range);
  wrongIdentity[1].population.identity.versions.push('changed');
  expect(compare(wrongIdentity)).toBe(false);
  const wrongId = summaryRows(range);
  wrongId[0].id = 'another';
  expect(compare(wrongId)).toBe(false);
  const wrongCount = summaryRows(range);
  wrongCount[1].comparison.pageviews++;
  expect(compare(wrongCount)).toBe(false);
  expect(compare(summaryRows(range).reverse())).toBe(false);
  expect(compare(summaryRows(range).slice(0, 1))).toBe(false);
});

it('validates nested event windows only for the registered event-stats route', () => {
  const range = { ...window, endAt: window.endAt + 60001 };
  const path = url()
    .replace('/api/liekan/websites/', '/api/websites/')
    .replace('/page-report?', '/events/stats?');
  const noncePath = `${path}&endAt=${range.endAt}`;
  const body = { data: nativeStats(range) },
    reference = { data: nativeStats() };
  const wrongWindow = structuredClone(body);
  wrongWindow.data.comparison.population.range.startAt++;
  expect(requestRangeMatches(wrongWindow, noncePath)).toBe(false);
  expect(sameRequestStatistics(wrongWindow, reference, noncePath, path)).toBe(false);
  const wrongCount = structuredClone(body);
  wrongCount.data.visitors++;
  expect(sameRequestStatistics(wrongCount, reference, noncePath, path)).toBe(false);
  expect(sameRequestStatistics(body, reference, url(range), url())).toBe(false);
  expect(sameRequestStatistics(summaryRows(range), summaryRows(), url(range), url())).toBe(false);
});

it.each(['websites', 'links', 'pixels'])(
  'validates every registered %s chart resource window',
  kind => {
    const range = { ...window, endAt: window.endAt + 60001 };
    const path = (range = window) =>
      url(range).replace('/api/liekan/websites/synthetic-site/page-report', `/api/${kind}/charts`);
    const chart = (range = window) => ({
      data: {
        first: {
          total: 1,
          values: [1, 0],
          population: { ...population(range), resourceId: 'first' },
        },
        second: {
          total: 2,
          values: [1, 1],
          population: { ...population(range), resourceId: 'second' },
        },
      },
    });
    expect(sameRequestStatistics(chart(range), chart(), path(range), path())).toBe(true);
    const stale = chart(range);
    stale.data.second.population.range = { ...window };
    expect(requestRangeMatches(stale, path(range))).toBe(false);
    expect(sameRequestStatistics(stale, chart(), path(range), path())).toBe(false);
    const changed = chart(range);
    changed.data.second.population.identity.coverage = 0.5;
    expect(sameRequestStatistics(changed, chart(), path(range), path())).toBe(false);
    const wrongId = chart(range);
    wrongId.data.second.population.resourceId = 'another';
    expect(sameRequestStatistics(wrongId, chart(), path(range), path())).toBe(false);
    const wrongCount = chart(range);
    wrongCount.data.second.total++;
    expect(sameRequestStatistics(wrongCount, chart(), path(range), path())).toBe(false);
    expect(sameRequestStatistics(chart(range), chart(), url(range), url())).toBe(false);
  },
);
