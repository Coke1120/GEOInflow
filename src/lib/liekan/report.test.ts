import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  human: vi.fn(),
  logs: vi.fn(),
  settings: vi.fn(),
  plotLogs: vi.fn(),
}));
vi.mock('./upstream/analytics', () => ({
  getHumanFacts: mocks.human,
  getHumanConversions: async () => 0,
  getHumanDays: async () => [],
}));
vi.mock('./upstream/logs', () => ({
  getLogFacts: mocks.logs,
  getLogToday: async () => ({ requests: 0, accepted: 0, abnormal: 0 }),
  getContentImpact: async () => [],
  getMonthlyAiShare: async () => [],
  getPlotLogs: mocks.plotLogs,
}));
vi.mock('./store', () => ({ getSettings: mocks.settings }));
vi.mock('./upstream/server', () => ({ LiekanError: class extends Error {} }));

import { liekanReportSchema } from './contracts/report';
import { buildReport } from './report';

const params = { resource: 'overview', startAt: 0, endAt: 86400000, timezone: 'UTC' };
const website = { id: '5b4c0de0-6c47-5b51-8f53-11e5e8c79001', name: 'Test', domain: 'example.com' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.human.mockResolvedValue({
    totals: { visits: 0, visitors: 0, pageviews: 0, bounces: 0, totaltime: 0 },
    daily: [],
    geo: [],
    sources: [],
    environment: [],
    pages: [],
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
    catalog: [{ path: '/a', type: '文档', wordCount: 300, structureScore: 70 }],
    latest: null,
    recent: [],
    totalLogs: 0,
    previousBots: [],
  });
  mocks.settings.mockResolvedValue({ isDemo: false, rules: [], robots: '' });
  mocks.plotLogs.mockResolvedValue([]);
});
describe('report evidence states', () => {
  it('keeps missing AI evidence separate from a measured zero', async () => {
    const report = await buildReport(website, false, params);
    for (const name of ['AI 抓取页面覆盖率', '从未被抓页面', '识别 AI 蜘蛛']) {
      expect(report.cards.find(card => card.label === name)).toMatchObject({
        value: null,
        state: 'not_connected',
      });
    }
    expect(report.tables.blindList).toEqual([]);
    expect(report.charts.a3.series).toEqual([]);
    expect(report.charts.pf2.state).toBe('not_connected');
    expect(report.charts.f2.series).toEqual([]);
  });
  it('validates date range and timezone before accessing storage', async () => {
    await expect(buildReport(website, false, { ...params, endAt: -1 })).rejects.toThrow();
    await expect(
      buildReport(website, false, { ...params, timezone: 'invalid/timezone' }),
    ).rejects.toThrow();
    expect(mocks.human).not.toHaveBeenCalled();
  });
  it('rejects an upstream response with a missing chart contract', async () => {
    const report = await buildReport(website, false, params);
    expect(liekanReportSchema.safeParse(report).success).toBe(true);
    const damaged = structuredClone(report);
    delete damaged.charts.h1;
    expect(liekanReportSchema.safeParse(damaged).success).toBe(false);
  });
  it('keeps historical classifications stable and counts each named bot once', async () => {
    const logs = await mocks.logs();
    mocks.logs.mockResolvedValue({
      ...logs,
      latest: '2026-01-01',
      summary: { requests: 5, ai: 5 },
      daily: [{ day: '1970-01-01', bot: 'GPTBot', count: 5 }],
      bots: [
        {
          name: 'GPTBot',
          vendor: 'OpenAI',
          type: '训练',
          requests: 3,
          pages: 1,
          lastVisit: '2026-01-01',
        },
        {
          name: 'GPTBot',
          vendor: 'Changed vendor',
          type: '搜索',
          requests: 2,
          pages: 1,
          lastVisit: '2026-01-01',
        },
      ],
    });
    mocks.plotLogs.mockResolvedValue([
      { day: '1970-01-01', bot: 'GPTBot', type: '训练', count: 3 },
      { day: '1970-01-01', bot: 'GPTBot', type: '搜索', count: 2 },
    ]);
    const report = await buildReport(website, false, params);
    expect(report.cards.find(c => c.label === '识别 AI 蜘蛛').value).toBe(1);
    expect(report.charts.a1.series).toEqual([{ name: 'GPTBot', values: [5] }]);
    expect(report.charts.d2.labels).toEqual(['GPTBot']);
    expect(report.charts.d2.series[0].values).toEqual([5]);
    expect(report.charts.d1.series[1].values).toEqual([5]);
    expect(report.tables.botBody).toHaveLength(2);
  });
});
