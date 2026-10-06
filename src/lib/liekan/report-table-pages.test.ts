import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  human: vi.fn(),
  logs: vi.fn(),
  settings: vi.fn(),
  plotLogs: vi.fn(),
  conversions: vi.fn(),
  humanDays: vi.fn(),
  months: vi.fn(),
}));
vi.mock('./upstream/analytics', async importOriginal => ({
  ...(await importOriginal<typeof import('./upstream/analytics')>()),
  getHumanFacts: mocks.human,
  getHumanConversions: mocks.conversions,
  getHumanDays: mocks.humanDays,
}));
vi.mock('./upstream/logs', () => ({
  getLogFacts: mocks.logs,
  getLogToday: async () => ({ requests: 0, accepted: 0, abnormal: 0 }),
  getContentImpact: async () => [],
  getMonthlyAiShare: mocks.months,
  getPlotLogs: mocks.plotLogs,
}));
vi.mock('./store', () => ({ getSettings: mocks.settings }));
vi.mock('./upstream/server', () => ({ LiekanError: class extends Error {} }));
vi.mock('@/queries/sql', () => ({ getFunnel: vi.fn() }));

import { parseReportQuery } from './contracts/query';
import { buildReport } from './report';

const params = { resource: 'overview', startAt: 0, endAt: 86400000, timezone: 'UTC' };
const website = { id: '5b4c0de0-6c47-5b51-8f53-11e5e8c79001', name: 'Test', domain: 'example.com' };

describe('parseReportQuery flat table pages', () => {
  it('normalizes tp_* keys into sorted tablePages', () => {
    const parsed = parseReportQuery({ ...params, tp_topBody: '3', tp_apBody: '2' });
    expect(parsed.success).toBe(true);
    if (parsed.success)
      expect(parsed.data.tablePages).toEqual({ apBody: 2, topBody: 3 });
  });

  it('rejects non-whitelisted table names and invalid pages', () => {
    expect(parseReportQuery({ ...params, tp_goalBody: '2' }).success).toBe(false);
    expect(parseReportQuery({ ...params, tp_topBody: '0' }).success).toBe(false);
    expect(parseReportQuery({ ...params, tp_topBody: 'x' }).success).toBe(false);
  });

  it('accepts an already parsed object with tablePages intact', () => {
    const parsed = parseReportQuery({ ...params, tablePages: { topBody: 2 } });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.tablePages).toEqual({ topBody: 2 });
  });
});

describe('buildReport serialization slicing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.human.mockResolvedValue({
      totals: { visits: 0, visitors: 0, pageviews: 0, bounces: 0, totaltime: 0 },
      daily: [],
      geo: [{ country: '中国', region: '广东', city: '深圳', sessions: 5 }],
      sources: [],
      environment: [],
      pages: Array.from({ length: 25 }, (_, i) => ({ path: `/page-${i + 1}`, pv: 25 - i, uv: i })),
      heatmap: [],
      goals: [],
      converted: 0,
      funnel: [],
      journeys: [],
      exits: [],
      dailySources: [],
      newVisitors: 0,
      previousSources: [],
      previousGoals: [],
    });
    mocks.logs.mockResolvedValue({
      summary: { requests: 0, ai: 0 },
      daily: [],
      bots: [],
      pages: [],
      statuses: [],
      hours: [],
      catalog: [],
      latest: null,
      recent: [],
      totalLogs: 0,
      previousBots: [],
    });
    mocks.settings.mockResolvedValue({ isDemo: false, rules: [], robots: '' });
    mocks.plotLogs.mockResolvedValue([]);
    mocks.humanDays.mockResolvedValue([]);
    mocks.months.mockResolvedValue([]);
    mocks.conversions.mockResolvedValue({ goals: [] });
  });

  it('caps the requested table to its page and records tablePages meta', async () => {
    const report = await buildReport(
      website,
      false,
      { ...params, tablePages: { topBody: 2 } },
      true,
    );
    expect(report.tables.topBody).toHaveLength(5);
    expect(report.tables.topBody[0].path).toBe('/page-21');
    expect(report.meta.tablePages).toEqual({ topBody: { page: 2, pageSize: 20, total: 25 } });
    expect(Object.keys(report.tables)).toEqual(['topBody']);
  });

  it('keeps every table full and omits tablePages when no page is requested', async () => {
    const report = await buildReport(website, false, params, true);
    expect(report.tables.topBody).toHaveLength(25);
    expect(report.meta.tablePages).toBeUndefined();
  });
});
