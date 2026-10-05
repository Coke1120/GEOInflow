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

import { liekanReportSchema } from './contracts/report';
import { pageReportParts, type ReportResource } from './contracts/page-report';
import { buildReport } from './report';
import { sharedReportParts } from './contracts/shared-report';

const params = { resource: 'overview', startAt: 0, endAt: 86400000, timezone: 'UTC' };
const website = { id: '5b4c0de0-6c47-5b51-8f53-11e5e8c79001', name: 'Test', domain: 'example.com' };

it('builds the share profile without log rows or unrelated statistics and bounds trends to the selected dates', async () => {
  const startAt = 3 * 86400000;
  const report = await buildReport(website, false, { ...params, startAt, endAt: startAt + 86400000 }, 'share');
  expect(Object.keys(report.charts)).toEqual(expect.arrayContaining([...sharedReportParts.charts]));
  expect(Object.keys(report.charts)).toHaveLength(8);
  expect(Object.keys(report.tables).sort()).toEqual(['cityBody', 'envGrid']);
  expect(mocks.logs.mock.calls[0][9]).toEqual(sharedReportParts.logs);
  expect(mocks.human.mock.calls[0][4]).toEqual(sharedReportParts.human);
  expect(mocks.humanDays.mock.calls[0][1]).toEqual(new Date(startAt));
  expect(mocks.months).not.toHaveBeenCalled();
  expect(mocks.conversions).not.toHaveBeenCalled();
  const localRange = await buildReport(website, false, { ...params, startAt: Date.parse('2026-09-05T16:00:00Z'), endAt: Date.parse('2026-10-05T15:59:59Z'), timezone: 'Asia/Shanghai' }, 'share');
  expect(localRange.insights[0]).toMatch(/^2026-09-06 至 2026-10-05/);
});
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
  mocks.conversions.mockResolvedValue(0);
  mocks.humanDays.mockResolvedValue([]);
  mocks.months.mockResolvedValue([]);
});
describe('report evidence states', () => {
  it('keeps the report usable and shows a safe unsupported state for an invalid saved funnel', async () => {
    const human = await mocks.human();
    mocks.human.mockResolvedValue({
      ...human,
      funnel: [],
      funnelState: 'unsupported',
      funnelError: '已保存的漏斗配置无效，请检查目标配置',
    });
    const report = await buildReport(website, false, params);
    expect(report.charts.f1).toMatchObject({ state: 'unsupported', labels: [], series: [] });
    expect(report.insights).toContain('已保存的漏斗配置无效，请检查目标配置');
    expect(liekanReportSchema.safeParse(report).success).toBe(true);
  });
  it('returns page insights only when the loaded facts support them', async () => {
    const human = await mocks.human();
    const logs = await mocks.logs();
    mocks.human.mockResolvedValue({
      ...human,
      funnelError: '已保存的漏斗配置无效，请检查目标配置',
    });
    mocks.logs.mockImplementation(async (...args: any[]) => ({
      ...logs,
      latest: '2026-01-01',
      summary: { requests: 1, ai: 1 },
      pages: !args[9] || args[9].includes('pages')
        ? [{ path: '/a', bot: 'GPTBot', requests: 1, lastCrawled: '2026-01-01' }]
        : [],
    }));
    const full = await buildReport(website, false, params);
    expect(full.insights).toContain('目录 1 个 URL，0 个在所选范围没有 AI 抓取。');
    expect(full.insights).toContain('已保存的漏斗配置无效，请检查目标配置');
    for (const resource of Object.keys(pageReportParts) as ReportResource[]) {
      const page = await buildReport(website, false, { ...params, resource }, true);
      expect(page.insights).toEqual(
        resource === 'overview' || resource === 'ai/preference' ? full.insights : [],
      );
    }
  });
  it('joins encoded logs and catalog to upstream human paths without decoding human paths twice', async () => {
    const human = await mocks.human(),
      logs = await mocks.logs();
    const humanPaths = ['/文档/AI 入门', '/literal%20space', '/reserved%2Fslash'];
    const encodedPaths = [
      '/%E6%96%87%E6%A1%A3/AI%20%E5%85%A5%E9%97%A8',
      '/literal%2520space',
      '/reserved%2Fslash',
    ];
    mocks.human.mockResolvedValue({
      ...human,
      totals: { visits: 3, visitors: 3, pageviews: 3, bounces: 0, totaltime: 0 },
      pages: humanPaths.map(path => ({
        path,
        pv: 1,
        uv: 1,
        entries: 1,
        bounces: 0,
        duration: null,
      })),
    });
    mocks.logs.mockResolvedValue({
      ...logs,
      latest: '2026-01-01',
      summary: { requests: 6, ai: 6 },
      pages: encodedPaths.map((path, i) => ({
        path,
        bot: 'GPTBot',
        requests: i + 1,
        lastCrawled: '2026-01-01',
      })),
      catalog: encodedPaths.map((path, i) => ({ path, type: `类型${i}` })),
    });
    const report = await buildReport(website, false, params);
    expect(report.tables.topBody.map(row => [row.path, row.aiRequests, row.evaluation])).toEqual(
      humanPaths.map((path, i) => [path, i + 1, '已被抓取']),
    );
    expect(report.tables.pgBody.map(row => row.aiRequests)).toEqual([1, 2, 3]);
    expect(report.charts.pf1.series.find(series => series.name === '人类 PV').values).toEqual([
      33.33, 33.33, 33.33,
    ]);
  });
  it('preserves undefined chart percentages as gaps and measured zero percentages as zero', async () => {
    const logs = await mocks.logs();
    mocks.logs.mockResolvedValue({ ...logs, latest: '2026-01-01' });
    mocks.humanDays.mockResolvedValue([
      { day: '1970-01-01', pv: 0, uv: 0, sessions: 0, bounces: 0 },
      { day: '1970-01-02', pv: 3, uv: 3, sessions: 3, bounces: 0 },
    ]);
    mocks.months.mockResolvedValue([
      { month: '2026-01', ai: 0, total: 0 },
      { month: '2026-02', ai: 0, total: 5 },
    ]);
    const empty = await buildReport(website, false, params);
    expect(empty.charts.pf1.series.map(series => series.values)).toEqual([[null], [null]]);
    expect(empty.charts.h1.series[2].values).toEqual([null, 0]);
    expect(empty.charts.a2.series[0].values).toEqual([null, 0]);
    expect(liekanReportSchema.safeParse(empty).success).toBe(true);
    const human = await mocks.human();
    mocks.human.mockResolvedValue({
      ...human,
      totals: { visits: 5, visitors: 5, pageviews: 5, bounces: 0, totaltime: 0 },
      pages: [
        {
          path: '/outside-catalog',
          pv: 5,
          uv: 5,
          entries: 5,
          bounces: 0,
          duration: null,
          samples: 0,
        },
      ],
    });
    mocks.logs.mockResolvedValue({
      ...logs,
      latest: '2026-01-01',
      summary: { requests: 4, ai: 4 },
    });
    const measured = await buildReport(website, false, params);
    expect(measured.charts.pf1.series.map(series => series.values)).toEqual([[0], [0]]);
  });
  it('distinguishes an undefined AI referral rate from a measured zero conversion rate', async () => {
    const human = await mocks.human();
    const input = {
      ...human,
      totals: { visits: 5, visitors: 5, pageviews: 5, bounces: 0, totaltime: 0 },
      goals: [
        {
          id: 'goal',
          name: 'download',
          path: 'download',
          count: 0,
          convertedSessions: 0,
          previous: 0,
        },
      ],
      sources: [
        { source: '直接访问', channel: '直接访问', sessions: 5, conversions: 0, bounces: 0 },
      ],
    };
    mocks.human.mockResolvedValue(input);
    const noAi = await buildReport(website, false, params);
    expect(noAi.cards.find(c => c.label === 'AI 引荐转化率')).toMatchObject({
      value: null,
      state: 'empty',
    });
    mocks.human.mockResolvedValue({
      ...input,
      sources: [
        { source: 'chatgpt.com', channel: 'AI 搜索引荐', sessions: 2, conversions: 0, bounces: 0 },
        { source: '直接访问', channel: '直接访问', sessions: 3, conversions: 0, bounces: 0 },
      ],
    });
    const observedAi = await buildReport(website, false, params);
    expect(observedAi.cards.find(c => c.label === 'AI 引荐转化率')).toMatchObject({
      value: 0,
      state: 'available',
    });
  });
  it('keeps event counts available when a custom-only window has no defined conversion rate', async () => {
    const human = await mocks.human();
    mocks.human.mockResolvedValue({
      ...human,
      goals: [
        {
          id: 'goal',
          name: '白皮书下载',
          path: 'download',
          count: 3,
          convertedSessions: 0,
          previous: 0,
        },
      ],
      dailyConversions: [{ day: '1970-01-02', count: 3 }],
    });
    mocks.conversions.mockResolvedValue(3);
    const report = await buildReport(website, false, params);
    expect(report.tables.goalBody[0]).toMatchObject({ count: 3, rate: null, rateState: 'empty' });
    expect(report.cards.find(c => c.label === '全站转化率')).toMatchObject({
      value: null,
      state: 'empty',
    });
    expect(report.cards.find(c => c.label === '今日转化')).toMatchObject({
      value: 3,
      state: 'available',
    });
    expect(report.cards.find(c => c.label === '白皮书下载').value).toBe(3);
    expect(report.charts.f3.series[0].values).toEqual([3]);
  });
  it('keeps card rates and a page without entry observations undefined at zero denominators', async () => {
    const empty = await buildReport(website, false, params);
    for (const label of ['跳出率', '直接访问', '传统搜索', 'AI 搜索引荐'])
      expect(
        empty.cards.find(c => c.label === label),
        label,
      ).toMatchObject({ value: null, state: 'empty' });
    const human = await mocks.human();
    mocks.human.mockResolvedValue({
      ...human,
      totals: { visits: 2, visitors: 2, pageviews: 3, bounces: 0, totaltime: 0 },
      pages: [
        { path: '/secondary', pv: 1, uv: 1, entries: 0, bounces: 0, duration: null, samples: 0 },
        { path: '/entry', pv: 2, uv: 2, entries: 2, bounces: 0, duration: null, samples: 0 },
      ],
    });
    const observed = await buildReport(website, false, params);
    expect(observed.tables.pgBody.find(row => row.path === '/secondary').bounceRate).toBeNull();
    expect(observed.tables.pgBody.find(row => row.path === '/entry').bounceRate).toBe(0);
    expect(observed.cards.find(c => c.label === '跳出率')).toMatchObject({
      value: 0,
      state: 'available',
    });
  });
  it('uses the entry channel consistently for source rows, daily channels and conversion rates', async () => {
    const human = await mocks.human();
    mocks.human.mockResolvedValue({
      ...human,
      totals: { visits: 4, visitors: 4, pageviews: 4, bounces: 0, totaltime: 0 },
      daily: [{ day: '1970-01-01', sessions: 4, conversions: 1 }],
      goals: [
        {
          id: 'goal',
          name: 'download',
          path: 'download',
          count: 3,
          convertedSessions: 1,
          previous: 0,
        },
      ],
      sources: [
        {
          source: 'google.com',
          channel: '其他引荐',
          utmMedium: 'email',
          referrer: 'google.com',
          sessions: 2,
          conversions: 1,
          bounces: 0,
        },
      ],
      previousSources: [
        { source: 'google.com', channel: '传统搜索', sessions: 20 },
        { source: 'google.com', channel: '其他引荐', sessions: 1 },
      ],
      dailySources: [{ day: '1970-01-01', source: 'google.com', channel: '其他引荐', count: 2 }],
    });
    const report = await buildReport(website, false, params);
    expect(report.tables.srcBody[0]).toMatchObject({
      channel: '其他引荐',
      utmMedium: 'email',
      referrer: 'google.com',
      conversionRate: 50,
      trend: 100,
    });
    expect(report.charts.s1.series.find(s => s.name === '其他引荐').values).toEqual([2]);
    expect(report.charts.s1.series.find(s => s.name === '传统搜索').values).toEqual([0]);
    expect(report.charts.f2).toMatchObject({
      labels: ['其他引荐'],
      series: [{ name: '转化率', values: [50] }],
    });
  });
  it('counts matched events while rates use converted visits and trends follow event dates', async () => {
    const human = await mocks.human();
    mocks.human.mockResolvedValue({
      ...human,
      totals: { visits: 4, visitors: 4, pageviews: 4, bounces: 0, totaltime: 0 },
      daily: [{ day: '1970-01-01', sessions: 4, conversions: 1 }],
      dailyConversions: [{ day: '1970-01-02', count: 3 }],
      goals: [
        {
          id: 'goal',
          name: '白皮书下载',
          path: 'download',
          count: 3,
          convertedSessions: 1,
          previous: 2,
        },
      ],
      converted: 1,
      sources: [
        { source: 'chatgpt.com', channel: 'AI 搜索引荐', sessions: 1, conversions: 1, bounces: 0 },
      ],
    });
    mocks.conversions.mockResolvedValue(3);
    const report = await buildReport(website, false, params);
    expect(report.tables.goalBody[0]).toMatchObject({ count: 3, rate: 25, trend: 50 });
    expect(report.cards.find(c => c.label === '白皮书下载').value).toBe(3);
    expect(report.cards.find(c => c.label === '今日转化').value).toBe(3);
    expect(report.cards.find(c => c.label === '全站转化率').value).toBe(25);
    expect(report.cards.find(c => c.label === 'AI 引荐转化率').value).toBe(100);
    expect(report.charts.f3).toMatchObject({
      labels: ['1970-01-02'],
      series: [{ name: '转化数', values: [3] }],
    });
  });
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
