import { beforeEach, describe, expect, test, vi } from 'vitest';
import { analyticsInfrastructureKey } from '../lib/liekan/upstream/query-cache';
import { processAnalyticsRefresh, readAnalyticsHotStrongVersion } from './analytics-refresh';
import { AnalyticsGate } from '../lib/liekan/upstream/analytics-budget';
import { getPublishedCatalog } from '../lib/liekan/crawlers/published';
import { getBundledPublishedCatalog } from '../lib/liekan/crawlers/catalog-seed';

const state = vi.hoisted(() => ({
  job: undefined as any,
  website: undefined as any,
  context: undefined as any,
  catalog: undefined as any,
  user: vi.fn(),
  membership: vi.fn(),
  strong: vi.fn(),
  eligible: vi.fn(),
  schedule: vi.fn(),
  renew: vi.fn(),
  forget: vi.fn(),
  worker: vi.fn(),
  breakdown: vi.fn(),
  filter: vi.fn(),
  share: vi.fn(),
  shareScope: vi.fn(),
  canShare: vi.fn(),
  pageReport: vi.fn(),
  note: vi.fn(),
  stats: vi.fn(),
  pageviews: vi.fn(),
  sessions: vi.fn(),
}));
vi.mock('../lib/liekan/upstream/crawler-registry', () => ({
  readCrawlerRegistryPointer: async () => ({ version: state.catalog.version, revision: '1' }),
  readPublishedRegistry: async (version: string) => ({ ...state.catalog, version }),
}));
vi.mock('../lib/prisma', () => ({
  getRawQueryClient: () => ({
    user: { findFirst: state.user },
    teamUser: { findFirst: state.membership },
    $transaction: async work => work({ $executeRawUnsafe: vi.fn(async () => {}) }),
  }),
  default: { client: {} },
}));
vi.mock('../lib/liekan/upstream/analytics-revision', () => ({
  readAnalyticsVersions: state.strong,
}));
vi.mock('../lib/liekan/upstream/analytics-hot', () => ({
  readAnalyticsHot: async () => ({ job: state.job, priority: 3 }),
  hotJobEligible: state.eligible,
  scheduleNextAnalyticsHot: state.schedule,
  renewAnalyticsHotVersion: state.renew,
  forgetAnalyticsHot: state.forget,
}));
vi.mock('../lib/liekan/upstream/cache-context', () => ({
  currentCacheContext: () => state.context,
  analyticsWorkerContext: state.worker,
  runCacheAuthorization: async work => work(),
  noteCacheResult: state.note,
}));
vi.mock('../lib/liekan/upstream/live-share', () => ({
  loadShareEntity: async () => state.website,
  currentShareScope: state.shareScope,
}));
vi.mock('../queries/prisma/share', () => ({ getShare: state.share }));
vi.mock('../permissions/share', () => ({ canViewWebsiteSection: state.canShare }));
vi.mock('../lib/liekan/upstream/page-report', () => ({ readPageReport: state.pageReport }));
vi.mock('../lib/liekan/upstream/feature-analytics', () => ({
  featureAnalytics: vi.fn(),
  featureJourney: vi.fn(),
}));
vi.mock('../lib/request', () => ({ getQueryFilters: state.filter }));
vi.mock('../queries/sql', () => ({
  getWebsiteStats: state.stats,
  getPageviewStats: state.pageviews,
  getSessionStats: state.sessions,
}));
vi.mock('../queries/sql/performance/getPerformanceChart', () => ({ getPerformanceChart: vi.fn() }));
vi.mock('../queries/sql/performance/getPerformanceStats', () => ({ getPerformanceStats: vi.fn() }));
vi.mock('../queries/sql/performance/getPerformanceMetrics', () => ({
  getPerformanceMetrics: vi.fn(),
}));
vi.mock('../queries/sql/revenue/getRevenueStats', () => ({ getRevenueStats: vi.fn() }));
vi.mock('../queries/sql/revenue/getRevenueChart', () => ({ getRevenueChart: vi.fn() }));
vi.mock('../queries/sql/revenue/getRevenueMetrics', () => ({ getRevenueMetrics: vi.fn() }));
vi.mock('../queries/sql/events/getWebsiteEventStats', () => ({ getWebsiteEventStats: vi.fn() }));
vi.mock('../queries/sql/goals/getGoal', () => ({ getGoal: vi.fn() }));
vi.mock('../queries/sql/funnels/getFunnel', () => ({ getFunnel: vi.fn() }));
vi.mock('../queries/sql/journeys/getJourney', () => ({ getJourney: vi.fn() }));
vi.mock('../queries/sql/retention/getRetention', () => ({ getRetention: vi.fn() }));
vi.mock('../queries/sql/breakdown/getBreakdown', () => ({ getBreakdown: state.breakdown }));
vi.mock('../queries/sql/heatmap/getHeatmap', () => ({ getHeatmap: vi.fn() }));
vi.mock('../queries/sql/utm/getUTM', () => ({ getUTM: vi.fn() }));

const actor = '11111111-1111-4111-8111-111111111111',
  site = '22222222-2222-4222-8222-222222222222';

describe('analytics worker current authorization and completion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost/isolated_worker');
    state.catalog = getBundledPublishedCatalog();
    state.job = {
      websiteId: site,
      target: 'native:breakdown',
      actorId: actor,
      scopeHash: analyticsInfrastructureKey('scope-v1', { private: true }),
      fingerprint: 'a'.repeat(64),
      scheduledAt: Date.now() - 5000,
      expectedStrongVersion: 'v1',
      parameters: {
        startAt: 1727740800000,
        endAt: 1727827199999,
        timezone: 'UTC',
        fields: ['country', 'browser'],
      },
    };
    state.website = { id: site, userId: actor, teamId: null };
    state.context = {
      results: [{ generatedAt: Date.now(), expiresAt: Date.now() + 300000, status: 'miss' }],
    };
    state.user.mockResolvedValue({ id: actor, role: 'user' });
    state.membership.mockResolvedValue({ id: 'membership' });
    state.strong.mockResolvedValue({ strong: 'v1', data: 'd1' });
    state.eligible.mockResolvedValue(true);
    state.worker.mockImplementation(async (_actor, _scope, work) => work());
    state.note.mockImplementation(result => state.context.results.push(result));
    state.breakdown.mockResolvedValue([{ country: 'CN', visitors: 1 }]);
    state.filter.mockResolvedValue({
      startDate: new Date(1727740800000),
      endDate: new Date(1727827199999),
    });
    state.canShare.mockResolvedValue(true);
  });

  test('pins authorization, strong checks and native warming to the accepted catalog', async () => {
    const accepted = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const strong = JSON.stringify(['policy-v1', accepted, [site], [], []]);
    const observed: Array<string | undefined> = [];
    state.job.target = 'native:stats';
    state.job.expectedStrongVersion = strong;
    state.user.mockImplementation(async () => {
      expect(getPublishedCatalog()?.version).toBe(accepted);
      return { id: actor, role: 'user' };
    });
    state.strong.mockImplementation(async () => {
      observed.push(getPublishedCatalog()?.version);
      return { strong, data: 'd1' };
    });
    state.stats.mockImplementation(async () => {
      observed.push(getPublishedCatalog()?.version);
      return [];
    });
    expect(getPublishedCatalog()).toBeUndefined();
    expect(await readAnalyticsHotStrongVersion(site, strong)).toBe(strong);
    await processAnalyticsRefresh(state.job);
    expect(observed).toHaveLength(5);
    expect(new Set(observed)).toEqual(new Set([accepted]));
    expect(state.schedule).toHaveBeenCalled();
    expect(getPublishedCatalog()).toBeUndefined();
  });

  test('warms normalized breakdown and renews from recorded result using original planned deadline', async () => {
    await processAnalyticsRefresh(state.job);
    expect(state.context.parameters).toEqual(
      expect.objectContaining({
        timezone: 'UTC',
        startAt: state.job.parameters.startAt,
        endAt: state.job.parameters.endAt,
      }),
    );
    expect(state.breakdown).toHaveBeenCalledWith(
      site,
      expect.objectContaining({ fields: ['country', 'browser'] }),
      expect.any(Object),
    );
    expect(state.user).toHaveBeenCalledWith({
      where: { id: actor, deletedAt: null },
      select: { id: true, role: true },
    });
    expect(state.canShare).not.toHaveBeenCalled();
    expect(state.worker.mock.calls[0][3]).toEqual({ deadline: state.job.scheduledAt + 30000 });
    expect(state.worker.mock.calls[1][3]).toMatchObject({
      deadline: state.job.scheduledAt + 30000,
      reauthorize: expect.any(Function),
    });
    expect(state.schedule).toHaveBeenCalledWith(
      state.job,
      state.context.results[0].expiresAt,
      state.context.results[0].generatedAt,
      'v1',
    );
  });

  test('preheats the same default comparison identity as the native HTTP route', async () => {
    state.job.target = 'native:stats';
    await processAnalyticsRefresh(state.job);
    expect(state.stats).toHaveBeenCalledTimes(2);
    expect(state.stats.mock.calls[0][1]).toEqual(await state.filter.mock.results[0].value);
    expect(state.stats.mock.calls[1][1].compare).toBeUndefined();
    expect(+state.stats.mock.calls[1][1].startDate).toBeLessThan(
      +state.stats.mock.calls[0][1].startDate,
    );
  });

  test('preheats both pageview and session comparison series when requested', async () => {
    state.job.target = 'native:pageviews';
    state.job.parameters.compare = 'prev';
    state.filter.mockResolvedValue({
      startDate: new Date(1727740800000),
      endDate: new Date(1727827199999),
      compare: 'prev',
    });
    await processAnalyticsRefresh(state.job);
    for (const query of [state.pageviews, state.sessions]) {
      expect(query).toHaveBeenCalledTimes(2);
      expect(+query.mock.calls[1][1].startDate).toBeLessThan(+query.mock.calls[0][1].startDate);
    }
  });

  test('finishes a twelve second stats preheat without competing against its own five second queue limit', async () => {
    vi.useFakeTimers();
    try {
      state.job.target = 'native:stats';
      const gate = new AnalyticsGate(1);
      state.stats.mockImplementation(() =>
        gate.run(() => new Promise(resolve => setTimeout(() => resolve({ pageviews: 1 }), 6000))),
      );
      const result = processAnalyticsRefresh(state.job).then(
        value => ({ value }),
        error => ({ error }),
      );
      await vi.advanceTimersByTimeAsync(12001);
      expect(await result).toEqual({ value: undefined });
      expect(state.stats).toHaveBeenCalledTimes(2);
      expect(gate.state).toEqual({ active: 0, queued: 0 });
      expect(state.schedule).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
      state.stats.mockReset();
    }
  });

  test('records page report computation so successful preheat schedules its next expiry', async () => {
    state.job.target = 'feature:page-report';
    state.job.parameters = { ...state.job.parameters, resource: 'human/overview' };
    state.context.results = [];
    const result = {
      value: {},
      generatedAt: Date.now(),
      expiresAt: Date.now() + 300000,
      status: 'miss',
    };
    state.pageReport.mockResolvedValue(result);
    await processAnalyticsRefresh(state.job);
    expect(state.note).toHaveBeenCalledWith(result);
    expect(state.schedule).toHaveBeenCalledWith(
      state.job,
      result.expiresAt,
      result.generatedAt,
      'v1',
    );
    expect(state.forget).not.toHaveBeenCalled();
  });

  test('merges changed strong version without spending a worker round or aggregating old data', async () => {
    state.strong.mockResolvedValue({ strong: 'v2', data: 'd2' });
    await processAnalyticsRefresh(state.job);
    expect(state.renew).toHaveBeenCalledWith(state.job, 'v2');
    expect(state.eligible).not.toHaveBeenCalled();
    expect(state.breakdown).not.toHaveBeenCalled();
  });

  test('revoked primary team membership ends private preheating', async () => {
    state.website = { id: site, userId: null, teamId: 'team-id' };
    state.membership.mockResolvedValue(null);
    await processAnalyticsRefresh(state.job);
    expect(state.membership).toHaveBeenCalledWith({
      where: { teamId: 'team-id', userId: actor, team: { deletedAt: null } },
      select: { id: true },
    });
    expect(state.forget).toHaveBeenCalledWith(state.job);
    expect(state.breakdown).not.toHaveBeenCalled();
  });

  test('rechecks scope and removes a share whose board layout changed', async () => {
    const scope = {
      shareId: actor,
      parameters: {},
      websiteIds: [site],
      boardLayoutHash: 'old-layout',
    };
    state.job = {
      ...state.job,
      actorId: undefined,
      shareId: actor,
      scopeHash: analyticsInfrastructureKey('scope-v1', scope),
    };
    state.share.mockResolvedValue({ id: actor });
    state.shareScope.mockResolvedValue({ ...scope, boardLayoutHash: 'new-layout' });
    await processAnalyticsRefresh(state.job);
    expect(state.forget).toHaveBeenCalledWith(state.job);
    expect(state.breakdown).not.toHaveBeenCalled();
  });

  test('keeps failed aggregation retryable and defers competing site round demand', async () => {
    state.breakdown.mockRejectedValueOnce(new Error('temporary query failure'));
    await expect(processAnalyticsRefresh(state.job)).rejects.toThrow('temporary query failure');
    expect(state.schedule).not.toHaveBeenCalled();
    expect(state.forget).not.toHaveBeenCalled();
    state.eligible.mockResolvedValue(false);
    await processAnalyticsRefresh(state.job);
    expect(state.renew).toHaveBeenCalledWith(state.job, 'v1');
  });
});
