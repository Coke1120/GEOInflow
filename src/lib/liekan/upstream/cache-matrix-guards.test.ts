// @vitest-environment node
import { expect, it } from 'vitest';
import { assertInitialGeoTodaySources } from '../../../../scripts/liekan-cache-matrix';

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
