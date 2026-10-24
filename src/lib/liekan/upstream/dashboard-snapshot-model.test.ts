// @vitest-environment node
import { expect, it } from 'vitest';
import {
  dashboardCutoff,
  dashboardWindow,
  defaultDashboardRange,
} from './dashboard-snapshot-model';
const now = +new Date('2026-10-24T10:07:30+08:00');
it('publishes closed five-minute buckets with an ingestion buffer', () => {
  expect(dashboardCutoff(now)).toBe(+new Date('2026-10-24T10:05:00+08:00'));
  expect(dashboardCutoff(+new Date('2026-10-24T10:05:59+08:00'))).toBe(
    +new Date('2026-10-24T10:00:00+08:00'),
  );
});
it('defers a new day until its first complete inclusive bucket is available', () => {
  const at = +new Date('2026-10-25T00:03:00+08:00');
  const w = dashboardWindow(
    'native:stats',
    {
      timezone: 'Asia/Shanghai',
      startAt: +new Date('2026-10-25T00:00:00+08:00'),
      endAt: +new Date('2026-10-25T23:59:59.999+08:00'),
    },
    at,
  );
  expect(w.computable).toBe(false);
  expect(w.parameters.endAt).toBe(+new Date('2026-10-25T00:04:59.999+08:00'));
  expect(w.availableAt).toBe(+new Date('2026-10-25T00:06:00+08:00'));
});
it('keeps historical boundaries exact and clips current inclusive and half-open reads', () => {
  const parameters = {
    ...defaultDashboardRange('Asia/Shanghai', now),
    timezone: 'Asia/Shanghai',
    resource: 'ai/overview',
    crawlerMetricsVersion: 1,
  };
  const hot = dashboardWindow('feature:page-report', parameters, now);
  expect(hot.hot).toBe(true);
  expect(hot.parameters.endAt).toBe(parameters.endAt);
  expect(dashboardWindow('native:stats', parameters, now).parameters.endAt).toBe(
    dashboardCutoff(now) - 1,
  );
  const history = { ...parameters, endAt: +new Date('2026-10-24T00:00:00+08:00') };
  expect(dashboardWindow('feature:page-report', history, now)).toMatchObject({
    hot: false,
    parameters: history,
  });
});
it('rotates dedicated today counters by local calendar day and preserves natural-day DST boundaries', () => {
  const p = { startAt: 0, endAt: 1, resource: 'overview', timezone: 'Asia/Shanghai' };
  expect(dashboardWindow('feature:page-report', p, now).day).toBe('2026-10-24');
  expect(
    dashboardWindow('feature:page-report', p, +new Date('2026-10-25T00:00:00+08:00')).day,
  ).toBe('2026-10-25');
  const range = defaultDashboardRange('America/New_York', +new Date('2026-03-20T16:00:00Z'));
  expect(new Date(range.startAt).toISOString()).toBe('2026-02-19T05:00:00.000Z');
  expect(new Date(range.endAt).toISOString()).toBe('2026-03-21T03:59:59.999Z');
});

it('preserves distinct selected report boundaries in the background task identity', () => {
  const parameters = {
    ...defaultDashboardRange('Asia/Shanghai', now),
    timezone: 'Asia/Shanghai',
    resource: 'overview',
  };
  const noon = { ...parameters, endAt: +new Date('2026-10-24T12:00:00+08:00') };
  const first = dashboardWindow('feature:page-report', parameters, now);
  const second = dashboardWindow('feature:page-report', noon, now);
  expect(first.parameters.endAt).toBe(parameters.endAt);
  expect(second.parameters.endAt).toBe(noon.endAt);
  expect(first.parameters.endAt).not.toBe(second.parameters.endAt);
  expect(first.through).toBe(second.through);
});
