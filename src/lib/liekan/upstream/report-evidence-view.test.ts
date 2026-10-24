import { expect, it, vi } from 'vitest';
import { reportQuery } from '../contracts/query';
import type { LiekanReport } from '../contracts/report';
import { attachReportEvidenceView } from './report-evidence-view';

vi.mock('./server', () => ({ query: vi.fn(async () => []) }));

it('binds export proof to the actual read range of a current-day cached report', async () => {
  const startAt = Date.parse('2026-10-01T00:00:00Z');
  const endAt = Date.parse('2026-10-23T06:00:00Z');
  const selectedEnd = Date.parse('2026-10-24T00:00:00Z');
  const report: LiekanReport = {
    contractVersion: 2, website: { id: 'site', name: 'Fixture', domain: 'example.test' },
    range: { startAt, endAt, timezone: 'UTC' },
    states: { human: 'empty', logs: 'empty', catalog: 'empty', goals: 'empty' },
    cards: [], charts: {}, tables: {}, insights: [],
    meta: { demo: false, canManage: true, latestImportAt: null, ruleCount: 0 },
  };
  const input = reportQuery.parse({ resource: 'ai/pages', startAt, endAt: selectedEnd,
    timezone: 'UTC', crawlerMetricsVersion: 1, botProductForm: 'workbench' });
  const result = await attachReportEvidenceView(report, input);
  expect(result.meta.crawlerEvidenceView.query).toMatchObject({
    startAt, endAt, timezone: 'UTC', resource: 'ai/pages', botProductForm: 'workbench',
  });
  expect(input.endAt).toBe(selectedEnd);
  expect(result.meta.crawlerEvidenceView.snapshot).toMatch(/^[a-f0-9]{64}$/);
});
