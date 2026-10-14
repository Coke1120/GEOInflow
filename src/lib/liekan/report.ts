import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { pageReportParts, visitorOverviewCards } from './contracts/page-report';
import { parseReportQuery, pagableTables, tablePageSize } from './contracts/query';
import {
  type DataState,
  type LiekanReport,
  liekanReportSchema,
  type Row,
} from './contracts/report';
import { summarizeSearchEngines, searchChannels } from './contracts/search-engines';
import { sharedReportParts } from './contracts/shared-report';
import { getSettings } from './store';
import {
  classifyEntrySource,
  getHumanConversions,
  getHumanDays,
  getHumanFacts,
  type HumanFact,
} from './upstream/analytics';
import {
  countryName,
  regionName,
  mergeGeography,
  geographyTableDisplay,
  geographyDisplay,
  geographyLabel,
  geographyCoverage,
  knownChinaProvince,
  isCountryCode,
} from './contracts/geography';
import {
  getContentImpact,
  getLogFacts,
  getLogToday,
  getMonthlyAiShare,
  getPlotLogs,
} from './upstream/logs';
import { humanPathFromEncoded } from './upstream/paths';
import { LiekanError } from './upstream/server';

const pct = (a: number, b: number): number | null => (b ? Math.round((a / b) * 10000) / 100 : null);
const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 100) / 100 : null);
const aiType = (type: string) => ['训练', '搜索', '用户触发'].includes(type);
function channel(row: { source: string; channel?: string }) {
  return row.channel ?? classifyEntrySource({ referrer: row.source }).channel;
}
function stringifySafe(value: unknown): any {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? Number(item) : item)),
  );
}
// 序列化层切片（修正后 B1）：事实仍全量参与派生——AI 富化、pf1 回查、卡片与图表都依赖全量
// 页路径且含 SQL 不可表达的解码路径连接——因此只在响应组装时按 tp_* 页码切片白名单明细表，
// 并回写 total 供客户端服务端分页模式渲染。
// page-report 路径始终下发（缺省第 1 页）：客户端据 meta.tablePages 判定服务端模式并经
// onTablePage 翻页，不下发则客户端只会本地分页，服务端切片永远无法生效；
// legacy /report 与 share 路径保持显式请求才切，避免破坏既有全量消费方。
function capTablePages(report: LiekanReport, tablePages: Record<string, number>, always: boolean) {
  for (const table of pagableTables) {
    const requested = tablePages[table];
    if (!always && !requested) continue;
    const rows = report.tables[table];
    if (!rows) continue;
    const page =
      table === 'cityBody'
        ? Math.min(requested ?? 1, Math.max(1, Math.ceil(rows.length / tablePageSize)))
        : (requested ?? 1);
    const start = (page - 1) * tablePageSize;
    report.tables[table] = rows.slice(start, start + tablePageSize);
    const locations = report.meta.geography?.tables?.[table];
    if (locations)
      report.meta.geography.tables[table] = locations.slice(start, start + tablePageSize);
    report.meta.tablePages = {
      ...report.meta.tablePages,
      [table]: { page, pageSize: tablePageSize, total: rows.length },
    };
  }
}

export async function buildReport(
  website: { id: string; name: string; domain: string; siteNumber?: number | null },
  canManage: boolean,
  input: unknown,
  pageOnly: boolean | 'share' = false,
): Promise<LiekanReport> {
  const parsed = parseReportQuery(input);
  if (!parsed.success) throw new LiekanError('统计参数无效');
  const p = parsed.data;
  if (p.resource === 'human/keywords') {
    throw new LiekanError('来源关键词请使用分页统计接口');
  }
  const parts =
    pageOnly === 'share' ? sharedReportParts : pageOnly ? pageReportParts[p.resource] : undefined;
  const needed = (...resources: string[]) =>
    pageOnly === 'share'
      ? resources.includes('human/overview')
      : !pageOnly || resources.includes(p.resource);
  if (
    p.endAt < p.startAt ||
    p.endAt - p.startAt > 1096 * 86400000 ||
    p.endAt > Date.now() + 86400000
  )
    throw new LiekanError('日期范围无效，上限 3 年');
  try {
    new Intl.DateTimeFormat('en', { timeZone: p.timezone }).format();
  } catch {
    throw new LiekanError('时区无效');
  }
  const start = new Date(p.startAt),
    end = new Date(p.endAt);
  const todayStart = fromZonedTime(
    `${formatInTimeZone(new Date(), p.timezone, 'yyyy-MM-dd')}T00:00:00`,
    p.timezone,
  );
  const plotStart = new Date(
    Math.max(
      pageOnly === 'share' ? p.startAt : 0,
      p.endAt - { '30d': 30, '7d': 7, '24h': 1 }[p.chartPeriod] * 86400000,
    ),
  );
  const [
    rawHuman,
    rawLogs,
    settings,
    todayLogs,
    todayConversions,
    impact,
    months,
    plotHuman,
    plotLogs,
  ] = await Promise.all([
    getHumanFacts(website.id, start, end, p.timezone, parts?.human as readonly HumanFact[]),
    getLogFacts(
      website.id,
      start,
      end,
      p.timezone,
      p.page,
      p.filter,
      p.search,
      p.cursor,
      p.seek,
      parts?.logs,
    ),
    getSettings(website.id),
    needed('overview', 'logs')
      ? getLogToday(website.id, todayStart, new Date())
      : Promise.resolve({ requests: 0, accepted: 0, abnormal: 0 }),
    needed('overview', 'conversions')
      ? getHumanConversions(website.id, todayStart, new Date(), p.timezone)
      : Promise.resolve(0),
    needed('content') ? getContentImpact(website.id, start, end) : Promise.resolve([]),
    needed('ai/overview') ? getMonthlyAiShare(website.id, end, p.timezone) : Promise.resolve([]),
    needed('overview', 'human/overview')
      ? getHumanDays(website.id, plotStart, end, p.timezone, p.chartPeriod === '24h')
      : Promise.resolve([]),
    needed('overview', 'human/overview')
      ? getPlotLogs(website.id, plotStart, end, p.timezone, p.chartPeriod === '24h')
      : Promise.resolve([]),
  ]);
  const h = stringifySafe(rawHuman),
    l = stringifySafe(rawLogs),
    days = Math.max(1, Math.ceil((p.endAt - p.startAt + 1) / 86400000));
  h.geo = mergeGeography(h.geo);
  const t = h.totals;
  const humanState: DataState = t.visits ? 'available' : 'empty',
    logState: DataState =
      (l.connected ?? Boolean(l.latest))
        ? l.summary.requests
          ? 'available'
          : 'empty'
        : 'not_connected',
    catalogState: DataState = l.catalog.length ? 'available' : 'not_connected',
    goalState: DataState = h.goals.length ? 'available' : 'not_connected';
  const r: LiekanReport = {
    contractVersion: 2,
    website,
    range: { startAt: p.startAt, endAt: p.endAt, timezone: p.timezone },
    states: { human: humanState, logs: logState, catalog: catalogState, goals: goalState },
    cards: [],
    charts: {},
    tables: {},
    insights: [],
    meta: {
      ...(!parts || parts.human?.includes('geo' as never)
        ? { geographyCoverage: geographyCoverage(h.geo, t.visits) }
        : {}),
      demo: settings.isDemo,
      aiCrawlerEnabled: settings.aiCrawlerEnabled ?? true,
      logsConfigured: settings.logsConfigured ?? (!settings.isDemo && !!l.latest),
      canManage,
      latestImportAt: l.latest,
      ruleCount: settings.rules.length,
      totalLogs: l.totalLogs,
      page: p.page,
      pageSize: 100,
      nextCursor: l.nextCursor,
      previousCursor: l.previousCursor,
    },
  };
  const card = (
    label: string,
    value: number | string | null,
    state: DataState = humanState,
    unit = '',
    detail = '所选统计范围',
  ) => r.cards.push({ key: label, label, value, state, unit, detail });
  const chart = (
    id: string,
    labels: string[],
    series: Array<{ name: string; values: Array<number | null> }>,
    state?: DataState,
    rows?: Record<string, unknown>[],
  ) => {
    r.charts[id] = { labels, series, state, rows };
  };
  const catalog = new Map<string, any>(l.catalog.map(c => [c.path, c]));
  const catalogLogState: DataState = logState === 'not_connected' ? logState : catalogState;
  const preference = (bot: string) => {
    if (!catalog.size) return null;
    const totals = new Map<string, number>();
    for (const row of l.pages.filter(page => page.bot === bot)) {
      const type = catalog.get(row.path)?.type;
      if (type) totals.set(type, (totals.get(type) ?? 0) + row.requests);
    }
    const top = [...totals].sort((a, b) => b[1] - a[1])[0];
    const total = l.bots
      .filter(b => b.name === bot)
      .reduce((sum, b) => sum + Number(b.requests), 0);
    return top && total ? `${top[0]}（${pct(top[1], total)}% 抓取集中）` : null;
  };
  const paths = new Map<string, any>();
  for (const row of l.pages) {
    const old = paths.get(row.path) ?? {
      path: row.path,
      requests: 0,
      bots: 0,
      bot: row.bot,
      lastCrawled: row.lastCrawled,
      main: 0,
    };
    old.requests += row.requests;
    old.bots++;
    if (row.requests > old.main) {
      old.bot = row.bot;
      old.main = row.requests;
    }
    if (row.lastCrawled > old.lastCrawled) old.lastCrawled = row.lastCrawled;
    paths.set(row.path, old);
  }
  const aiPages = Array.from(paths.values()).sort((a, b) => b.requests - a.requests);
  const humanAiPages = new Map<string, { requests: number; bot: string; main: number }>();
  for (const page of aiPages) {
    const key = humanPathFromEncoded(page.path);
    const previous = humanAiPages.get(key) ?? { requests: 0, bot: page.bot, main: 0 };
    previous.requests += page.requests;
    if (page.requests > previous.main) {
      previous.bot = page.bot;
      previous.main = page.requests;
    }
    humanAiPages.set(key, previous);
  }
  const knownCovered = l.catalog.filter(c => paths.has(c.path)).length,
    blind = l.catalog.filter(c => !paths.has(c.path));
  const src: Row[] = h.sources.map(s => {
    const previous = h.previousSources.find(
      prev =>
        prev.source === s.source &&
        channel(prev) === channel(s) &&
        prev.sourceLabel === s.sourceLabel,
    );
    return {
      source: s.source,
      ...(s.sourceLabel === 'direct' ? { sourceLabel: 'direct' } : {}),
      channel: channel(s),
      utmSource: s.utmSource ?? null,
      utmMedium: s.utmMedium ?? null,
      utmCampaign: s.utmCampaign ?? null,
      referrer: s.referrer ?? null,
      sessions: s.sessions,
      share: pct(s.sessions, t.visits),
      bounceRate: pct(s.bounces, s.sessions),
      conversionRate: h.goals.length ? pct(s.conversions, s.sessions) : null,
      trend: previous?.sessions
        ? Math.round(((s.sessions - previous.sessions) / previous.sessions) * 10000) / 100
        : null,
    };
  });
  const aggregate = (rows: any[], key: string, value: string) => {
    const map = new Map<string, number>();
    for (const row of rows) {
      const name = String(row[key] ?? '未知');
      map.set(name, (map.get(name) ?? 0) + Number(row[value] ?? 0));
    }
    return Array.from(map, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  };
  const ch = aggregate(src, 'channel', 'sessions');
  const uniqueBots = aggregate(l.bots, 'name', 'requests');
  const uniqueAiBots = aggregate(
    l.bots.filter(b => aiType(b.type)),
    'name',
    'requests',
  );
  const aiSources = h.sources.filter(s => channel(s) === 'AI 搜索引荐');
  const aiSessions = aiSources.reduce((sum, s) => sum + s.sessions, 0);
  const humanPages = new Map<string, any>(h.pages.map(page => [page.path, page]));
  r.tables.topBody = h.pages.map(page => ({
    path: page.path,
    humanPv: page.pv,
    aiRequests: l.latest ? (humanAiPages.get(page.path)?.requests ?? 0) : null,
    ratio: l.latest ? ratio(humanAiPages.get(page.path)?.requests ?? 0, page.pv) : null,
    bot: humanAiPages.get(page.path)?.bot ?? null,
    evaluation: !l.latest
      ? '待接入日志'
      : humanAiPages.has(page.path)
        ? '已被抓取'
        : '所选范围未被抓取',
  }));
  r.tables.botBody = l.bots.map(b => ({
    name: b.name,
    vendor: b.vendor,
    type: b.type,
    requests: b.requests,
    dailyAverage: Math.round((b.requests / days) * 100) / 100,
    pages: b.pages,
    preference: preference(b.name),
    lastVisit: b.lastVisit,
    trend: l.previousBots?.find(
      prev => prev.name === b.name && prev.vendor === b.vendor && prev.type === b.type,
    )?.requests
      ? Math.round(
          (b.requests /
            l.previousBots.find(
              prev => prev.name === b.name && prev.vendor === b.vendor && prev.type === b.type,
            ).requests -
            1) *
            10000,
        ) / 100
      : null,
  }));
  r.tables.apBody = aiPages.map(page => ({
    path: page.path,
    requests: page.requests,
    bots: page.bots,
    heat: pct(page.requests, aiPages[0]?.requests ?? 0),
    repeatRate: null,
    bot: page.bot,
    lastCrawled: page.lastCrawled,
    freshness: catalog.get(page.path)?.updatedAt
      ? `${Math.max(0, Math.floor((p.endAt - new Date(catalog.get(page.path).updatedAt).getTime()) / 86400000))} 天`
      : null,
  }));
  const cityTable = geographyTableDisplay(
    h.geo,
    t.visits,
    !!h.goals.length,
    p.resource === 'human/geo' ? p : {},
  );
  r.tables.cityBody = cityTable.rows;
  r.tables.srcBody = src;
  const searchEngines = summarizeSearchEngines(
    h.sources.map(source => ({ ...source, channel: channel(source) })),
    h.goals.length > 0,
  );
  r.tables.searchEngineBody = searchEngines.rows;
  const searchState = searchEngines.sessions ? 'available' : 'empty';
  card('搜索总会话', searchEngines.sessions, searchState, '', '传统搜索与 AI 搜索引荐');
  card('传统搜索会话', searchEngines.totals['传统搜索'], searchState);
  card('AI 搜索引荐会话', searchEngines.totals['AI 搜索引荐'], searchState);
  card('AI 搜索占比', searchEngines.aiShare, searchState, '%', '占搜索总会话');
  searchChannels.forEach((type, index) => {
    const rows = searchEngines.rows.filter(row => row.type === type);
    chart(
      `se${index + 1}`,
      rows.map(row => String(row.engine)),
      [{ name: '会话', values: rows.map(row => Number(row.sessions)) }],
      rows.length ? 'available' : 'empty',
    );
  });
  r.tables.sourceEvidence = h.sourceEvidence ?? [];
  r.tables.pgBody = h.pages.map(page => ({
    path: page.path,
    pv: page.pv,
    uv: page.uv,
    entries: page.entries,
    duration: page.duration,
    bounceRate: page.entries ? pct(page.bounces, page.entries) : null,
    aiRequests: l.latest ? (humanAiPages.get(page.path)?.requests ?? 0) : null,
  }));
  r.tables.goalBody = h.goals.map(g => ({
    name: g.name,
    count: g.count,
    rate: t.visits ? pct(g.convertedSessions, t.visits) : null,
    rateState: t.visits ? 'available' : 'empty',
    trend: g.previous ? Math.round((g.count / g.previous - 1) * 10000) / 100 : null,
    path: g.path,
  }));
  r.tables.logBody = l.recent.map(row => ({
    ...row,
    time: row.time,
    classification:
      row.bot === '其他'
        ? '未知/其他'
        : `${row.bot} · ${row.verification === 'verified_range' ? '官方 IP 范围匹配' : row.verification === 'range_mismatch' ? '官方范围未匹配' : '身份未核验'}`,
  }));
  r.tables.blindList = (l.latest ? blind : []).map(page => ({
    path: page.path,
    reason: '已收录目录，所选范围无 AI 抓取',
  }));
  const pathBot =
    l.recent.find(row => row.bot === 'GPTBot')?.bot ??
    l.recent.find(row => row.bot !== '其他')?.bot;
  r.tables.pathList = l.recent
    .filter(row => row.bot === pathBot)
    .slice(0, 7)
    .reverse()
    .map(row => ({ bot: row.bot, time: row.time, path: row.path, status: row.status }));
  r.tables.robotsList = [...settings.rules, { name: 'Applebot-Extended' }].map(rule => ({
    bot: rule.name,
    policy: settings.robots ? '已保存本地策略' : '未设置',
    state: '策略需同步到站点服务器',
  }));
  r.tables.prefList = uniqueAiBots.map(b => ({
    bot: b.name,
    preference: preference(b.name),
  }));
  r.tables.pipeList = [
    {
      name: '日志导入',
      detail: l.latest ? '导入完成，主动刷新读取' : '支持 combined / JSON 单批导入',
      state: l.latest ? '已接入' : '待接入',
    },
    { name: '身份验证', detail: '6 类官方 IP 范围核验；历史或过期依据保留未核验', state: '已接入' },
    {
      name: '内容目录',
      detail: `${l.catalog.length} 条目录记录`,
      state: catalog.size ? '已接入' : '待接入',
    },
  ];
  r.tables.envGrid = ['device', 'browser', 'os'].flatMap(category =>
    aggregate(h.environment, category, 'sessions').map(row => ({
      category,
      name: row.name,
      share: pct(row.count, t.visits),
    })),
  );
  r.tables.journeyList = h.journeys;
  const dateLabels = Array.from(
    new Set([...h.daily.map(d => d.day), ...l.daily.map(d => d.day)]),
  ).sort();
  const plotLabels = Array.from(
    new Set([
      ...plotHuman.map(d => d.day),
      ...(settings.aiCrawlerEnabled === false ? [] : plotLogs.map(d => d.day)),
    ]),
  ).sort();
  chart('d1', plotLabels, [
    {
      name: '人类 PV',
      values: plotLabels.map(day => Number(plotHuman.find(d => d.day === day)?.pv ?? 0)),
    },
    {
      name: 'AI 蜘蛛请求',
      values: plotLabels.map(day =>
        plotLogs
          .filter(d => d.day === day && aiType(d.type))
          .reduce((sum, d) => sum + Number(d.count), 0),
      ),
    },
  ]);
  chart(
    'h1',
    plotLabels,
    [
      {
        name: 'PV',
        values: plotLabels.map(day => Number(plotHuman.find(d => d.day === day)?.pv ?? 0)),
      },
      {
        name: 'UV',
        values: plotLabels.map(day => Number(plotHuman.find(d => d.day === day)?.uv ?? 0)),
      },
      {
        name: '跳出率',
        values: plotLabels.map(day => {
          const row = plotHuman.find(d => d.day === day);
          return pct(Number(row?.bounces ?? 0), Number(row?.sessions ?? 0));
        }),
      },
    ],
    humanState,
  );
  chart(
    'h2',
    Array.from({ length: 24 }, (_, i) => String(i)),
    [
      {
        name: '会话',
        values: Array.from({ length: 24 }, (_, hour) =>
          h.heatmap.filter(row => row.hour === hour).reduce((sum, row) => sum + row.count, 0),
        ),
      },
    ],
    humanState,
  );
  const devices = aggregate(h.environment, 'device', 'sessions');
  chart(
    'h3',
    devices.map(d => d.name),
    [{ name: '会话', values: devices.map(d => d.count) }],
    humanState,
  );
  chart(
    'd3',
    ch.map(c => c.name),
    [{ name: '会话', values: ch.map(c => c.count) }],
    humanState,
  );
  chart(
    's1',
    dateLabels,
    ['直接访问', '传统搜索', '其他引荐', 'AI 搜索引荐'].map(name => ({
      name,
      values: dateLabels.map(day =>
        h.dailySources
          .filter(s => s.day === day && channel(s) === name)
          .reduce((sum, s) => sum + s.count, 0),
      ),
    })),
    humanState,
  );
  chart(
    's2',
    src.filter(row => row.channel === 'AI 搜索引荐').map(row => String(row.source)),
    [
      {
        name: 'AI 引荐会话',
        values: src.filter(row => row.channel === 'AI 搜索引荐').map(row => Number(row.sessions)),
      },
    ],
    humanState,
  );
  chart(
    'd2',
    uniqueAiBots.slice(0, 8).map(b => b.name),
    [
      {
        name: '抓取次数',
        values: uniqueAiBots.slice(0, 8).map(b => b.count),
      },
    ],
    logState,
  );
  chart(
    'a2',
    months.map(m => m.month),
    [{ name: 'AI 占比', values: months.map(m => pct(m.ai, m.total)) }],
    logState,
  );
  chart(
    'a1',
    dateLabels,
    uniqueBots.slice(0, 5).map(b => ({
      name: b.name,
      values: dateLabels.map(
        day => l.daily.find(d => d.day === day && d.bot === b.name)?.count ?? 0,
      ),
    })),
    logState,
  );
  chart(
    'a3',
    Array.from({ length: 24 }, (_, i) => `${i}:00`),
    [
      {
        name: '抓取次数',
        values: Array.from({ length: 24 }, (_, i) => l.hours.find(h => h.hour === i)?.count ?? 0),
      },
    ],
    logState,
  );
  chart(
    'a4',
    l.statuses.map(s => String(s.status)),
    [{ name: '状态分布', values: l.statuses.map(s => s.count) }],
    logState,
  );
  const types = aggregate(l.bots, 'type', 'requests');
  chart(
    'b1',
    types.map(t => t.name),
    [{ name: '抓取次数', values: types.map(t => t.count) }],
    logState,
  );
  const directories = aggregate(
    aiPages.map(page => ({
      ...page,
      directory: `/${page.path.split('/').filter(Boolean)[0] ?? ''}/`,
    })),
    'directory',
    'requests',
  );
  chart(
    'ap1',
    directories.slice(0, 10).map(d => d.name),
    [{ name: '抓取次数', values: directories.slice(0, 10).map(d => d.count) }],
    logState,
  );
  const contentTypes = aggregate(
    l.catalog.map(c => ({ ...c, requests: paths.get(c.path)?.requests ?? 0 })),
    'type',
    'requests',
  );
  chart(
    'pf1',
    contentTypes.map(c => c.name),
    [
      { name: 'AI 蜘蛛', values: contentTypes.map(c => pct(c.count, l.summary.ai)) },
      {
        name: '人类 PV',
        values: contentTypes.map(c =>
          pct(
            l.catalog
              .filter(page => page.type === c.name)
              .reduce(
                (sum, page) => sum + (humanPages.get(humanPathFromEncoded(page.path))?.pv ?? 0),
                0,
              ),
            t.pageviews,
          ),
        ),
      },
    ],
    catalogLogState,
  );
  const scatter = l.catalog
    .filter(c => c.wordCount != null && c.structureScore != null)
    .map(c => ({
      words: c.wordCount,
      structureScore: c.structureScore,
      requests: paths.get(c.path)?.requests ?? 0,
      path: c.path,
    }));
  chart(
    'pf2',
    [],
    [],
    l.latest && scatter.length ? 'available' : 'not_connected',
    l.latest ? scatter : [],
  );
  const regions = aggregate(
      h.geo.filter(g => g.country === 'CN' && knownChinaProvince(g.region)),
      'region',
      'sessions',
    ),
    countries = aggregate(
      h.geo.filter(g => isCountryCode(g.country) && g.country !== 'CN'),
      'country',
      'sessions',
    );
  chart(
    'g1',
    regions.slice(0, 10).map(g => regionName(g.name)),
    [{ name: '会话', values: regions.slice(0, 10).map(g => g.count) }],
    humanState,
    regions.slice(0, 10).map(g => ({
      conversionRate: h.goals.length
        ? pct(
            h.geo
              .filter(row => row.country === 'CN' && String(row.region ?? '未知') === g.name)
              .reduce((sum, row) => sum + row.conversions, 0),
            g.count,
          )
        : null,
    })),
  );
  chart(
    'g2',
    countries.slice(0, 8).map(g => countryName(g.name)),
    [{ name: '会话', values: countries.slice(0, 8).map(g => g.count) }],
    humanState,
  );
  chart(
    'c1',
    impact.map(row => row.path),
    [
      { name: '发布内容 PV（7天）', values: impact.map(row => row.pv) },
      { name: 'AI 抓取增量', values: impact.map(row => row.increment) },
    ],
    impact.length ? 'available' : catalogState === 'available' ? 'empty' : catalogState,
  );
  chart(
    'f1',
    h.funnel.map(step => step.value),
    [{ name: '访客数', values: h.funnel.map(step => step.visitors) }],
    h.funnelState ?? (h.funnel.length ? 'available' : 'not_connected'),
  );
  chart(
    'f2',
    ch.map(c => c.name),
    [
      {
        name: '转化率',
        values: ch.map(c =>
          pct(
            h.sources.filter(s => channel(s) === c.name).reduce((sum, s) => sum + s.conversions, 0),
            c.count,
          ),
        ),
      },
    ],
    goalState,
  );
  chart(
    'f3',
    (h.dailyConversions ?? []).map(day => day.day),
    [
      {
        name: '转化数',
        values: (h.dailyConversions ?? []).map(day => day.count),
      },
    ],
    goalState,
  );
  card('人类访客（UV）', t.visitors);
  card('AI 蜘蛛请求', l.latest ? l.summary.ai : null, logState);
  card(
    '今日总请求',
    l.latest ? todayLogs.requests : null,
    logState,
    '',
    '今日已接入日志的内容请求，排除静态资源扩展名',
  );
  card(
    '今日转化',
    h.goals.length ? todayConversions : null,
    goalState,
    '',
    '今日匹配目标的去重事件次数',
  );
  card('AI 蜘蛛请求（30天）', l.latest ? l.summary.ai : null, logState, '', '所选范围请求量');
  card('识别 AI 蜘蛛', l.latest ? uniqueAiBots.length : null, logState);
  card(
    'AI 抓取页面覆盖率',
    l.latest && catalog.size ? pct(knownCovered, catalog.size) : null,
    catalogLogState,
    '%',
    '分母：已导入目录 URL',
  );
  card(
    '单页日均最高抓取',
    aiPages.length ? Math.round((aiPages[0].requests / days) * 100) / 100 : null,
    logState,
  );
  card('被 AI 抓取页面', l.latest ? aiPages.length : null, logState);
  card(
    '反复抓取页面',
    l.latest ? aiPages.filter(p => p.requests >= 50).length : null,
    logState,
    '',
    '阈值：所选范围 ≥50 次',
  );
  card(
    '从未被抓页面',
    l.latest && catalog.size ? blind.length : null,
    catalogLogState,
    '',
    '目录内 URL，所选范围零抓取',
  );
  card(
    '平均抓取深度',
    aiPages.some(page => catalog.get(page.path)?.linkDepth != null)
      ? Math.round(
          (aiPages
            .filter(page => catalog.get(page.path)?.linkDepth != null)
            .reduce((sum, page) => sum + catalog.get(page.path).linkDepth, 0) /
            aiPages.filter(page => catalog.get(page.path)?.linkDepth != null).length) *
            100,
        ) / 100
      : null,
    aiPages.some(page => catalog.get(page.path)?.linkDepth != null) ? logState : 'not_connected',
    '',
    '目录提供的链接深度平均值',
  );
  const typeTotals = (pattern: RegExp) =>
    l.catalog
      .filter(c => pattern.test(c.type))
      .reduce(
        (sum, c) => ({
          ai: sum.ai + (paths.get(c.path)?.requests ?? 0),
          human: sum.human + (humanPages.get(c.path)?.pv ?? 0),
        }),
        { ai: 0, human: 0 },
      );
  const cases = typeTotals(/案例|case/i),
    articles = typeTotals(/图文|article/i),
    interactive = typeTotals(/交互|interactive/i);
  card(
    'AI 最爱内容类型',
    l.latest && contentTypes[0]?.count ? contentTypes[0].name : null,
    catalogLogState,
  );
  card(
    '案例页 AI/人 比值',
    l.latest && catalog.size ? ratio(cases.ai, cases.human) : null,
    catalogLogState,
  );
  card(
    '图文页 vs 交互页',
    l.latest && catalog.size ? ratio(articles.ai, interactive.ai) : null,
    catalogLogState,
    '倍',
    '依据已导入内容分类的 AI 请求量',
  );
  card('长文平均抓取完成率', null, 'unsupported', '%', '请求日志未提供正文完成证据');
  card('访客数 UV', t.visitors);
  card('浏览量 PV', t.pageviews);
  card('跳出率', t.visits ? pct(t.bounces, t.visits) : null, humanState, '%');
  card(
    '平均访问时长',
    ratio(t.totaltime, t.visits),
    humanState,
    '秒',
    '按同次访问首末浏览时间估算',
  );
  card(
    '新访客占比',
    t.visitors ? pct(h.newVisitors, t.visitors) : null,
    'estimated',
    '%',
    '窗口内首次创建的匿名标识；无法证明真实首次访问',
  );
  card('覆盖省份', regions.filter(g => g.name !== '未知').length);
  card('海外国家/地区', countries.length);
  card('TOP1 城市', h.geo.find(g => g.city) ? geographyLabel(h.geo.find(g => g.city)) : null);
  card('海外 TOP1', countries[0] ? countryName(countries[0].name) : null);
  for (const label of ['直接访问', '传统搜索', 'AI 搜索引荐'])
    card(
      label,
      t.visits ? pct(ch.find(c => c.name === label)?.count ?? 0, t.visits) : null,
      humanState,
      '%',
    );
  card(
    'AI 引荐转化率',
    h.goals.length && aiSessions
      ? pct(
          aiSources.reduce((sum, s) => sum + s.conversions, 0),
          aiSessions,
        )
      : null,
    h.goals.length && !aiSessions ? 'empty' : goalState,
    '%',
  );
  const measured = h.pages.filter(page => page.duration != null);
  card('有流量页面', h.pages.length);
  card('入口页 TOP1', [...h.pages].sort((a, b) => b.entries - a.entries)[0]?.path ?? null);
  card('退出页 TOP1', h.exits[0]?.path ?? null, humanState, '', '最后一个已观测浏览页');
  card(
    '内容页平均停留',
    measured.length
      ? measured.reduce((sum, page) => sum + page.duration * page.samples, 0) /
          measured.reduce((sum, page) => sum + page.samples, 0)
      : null,
    'estimated',
    '秒',
    '有后续浏览的页面间隔均值；末次停留未观测',
  );
  card(
    '全站转化率',
    h.goals.length && t.visits ? pct(h.converted, t.visits) : null,
    h.goals.length && !t.visits ? 'empty' : goalState,
    '%',
    t.visits ? '去重转化会话 ÷ 浏览会话' : '浏览会话为零，转化率无定义',
  );
  card('转化页 TOP1', [...h.goals].sort((a, b) => b.count - a.count)[0]?.path ?? null, goalState);
  card('白皮书下载', h.goals.find(g => /白皮书|download/i.test(g.name))?.count ?? null, goalState);
  card('日志处理能力', null, 'unsupported', '', '单批 10 MiB / 10000 行；吞吐量待压测');
  card('今日已解析', l.latest ? todayLogs.accepted : null, logState, '', '今日导入的有效日志行数');
  card('蜘蛛识别规则', settings.rules.length, 'available');
  card(
    '异常请求（今日）',
    l.latest ? todayLogs.abnormal : null,
    logState,
    '',
    '已接入日志中状态码 ≥400 的请求',
  );
  if (!parts || parts.insights) {
    const insightDate = (time: number) =>
      pageOnly === 'share'
        ? formatInTimeZone(time, p.timezone, 'yyyy-MM-dd')
        : new Date(time).toISOString().slice(0, 10);
    r.insights = [
      `${insightDate(p.startAt)} 至 ${insightDate(p.endAt)}：${t.pageviews} 次人类浏览、${t.visits} 次访问。`,
      l.latest
        ? `已导入日志识别 ${l.summary.ai} 次 AI 请求；按 UA 分类，官方 IP 范围匹配结果见访问流。`
        : '接入服务器日志后可计算 AI 抓取统计。',
      catalog.size && l.latest
        ? `目录 ${catalog.size} 个 URL，${blind.length} 个在所选范围没有 AI 抓取。`
        : '接入日志与 sitemap、CSV 或 JSON 目录后可计算完整覆盖率。',
      '结构化评分来自导入元数据；抓取完成率仍需正文传输证据。',
    ];
    if (pageOnly !== 'share' && h.funnelError) r.insights.push(h.funnelError);
    r.tables.recoList = r.insights.map((detail, i) => ({
      name: `观察 ${i + 1}`,
      detail,
      state: '规则生成',
    }));
  }
  for (const [id, data] of Object.entries(r.charts)) {
    if (['not_connected', 'unsupported'].includes(data.state ?? '')) {
      data.series = [];
      data.rows = [];
    }
    if (id === 'd1' && !l.latest && data.series[1]) data.series[1].values = [];
    if (id === 'c1' && !l.latest && data.series[1]) data.series[1].values = [];
  }
  const visitorOverview =
    settings.aiCrawlerEnabled === false && (p.resource === 'overview' || pageOnly === 'share');
  if (visitorOverview) {
    r.charts.d1 = {
      labels: plotHuman.map(day => day.day),
      series: [{ name: '浏览量 PV', values: plotHuman.map(day => Number(day.pv ?? 0)) }],
      state: humanState,
    };
    r.charts.d2 = { labels: [], series: [], state: 'unsupported' };
    r.tables.visitorTopBody = h.pages.map(page => ({ path: page.path, pv: page.pv, uv: page.uv }));
    r.insights = [
      `所选统计范围：${t.pageviews} 次浏览、${t.visitors} 位访客、${t.visits} 次访问。`,
    ];
  }
  const displayParts =
    visitorOverview && parts && pageOnly !== 'share'
      ? { ...parts, cards: visitorOverviewCards, charts: ['d1', 'd3'], tables: ['visitorTopBody'] }
      : parts;
  if (settings.aiCrawlerEnabled === false && p.resource === 'content') {
    r.tables.visitorPgBody = r.tables.pgBody.map(({ aiRequests, ...page }) => page);
    r.charts.c1.series = r.charts.c1.series.slice(0, 1);
  }
  if (displayParts) {
    const parts = displayParts;
    r.cards = r.cards.filter(card => (parts.cards as readonly string[]).includes(card.label));
    r.charts = Object.fromEntries(
      Object.entries(r.charts).filter(([id]) => (parts.charts as readonly string[]).includes(id)),
    );
    r.tables = Object.fromEntries(
      Object.entries(r.tables).filter(
        ([id]) =>
          (parts.tables as readonly string[]).includes(id) ||
          (settings.aiCrawlerEnabled === false &&
            p.resource === 'content' &&
            id === 'visitorPgBody'),
      ),
    );
    if (p.resource !== 'logs') {
      delete r.meta.totalLogs;
      delete r.meta.page;
      delete r.meta.pageSize;
      delete r.meta.nextCursor;
      delete r.meta.previousCursor;
    }
  } else liekanReportSchema.parse(r);
  const topCity = h.geo.find(g => g.city);
  const geography: NonNullable<LiekanReport['meta']['geography']> = {
    charts: {
      ...(r.charts.g1
        ? {
            g1: regions
              .slice(0, 10)
              .map(g =>
                geographyDisplay({ country: 'CN', region: g.name === '未知' ? null : g.name }),
              ),
          }
        : {}),
      ...(r.charts.g2
        ? { g2: countries.slice(0, 8).map(g => geographyDisplay({ country: g.name })) }
        : {}),
    },
    tables: r.tables.cityBody ? { cityBody: cityTable.locations } : {},
    cards: {
      ...(topCity && r.cards.some(card => card.key === 'TOP1 城市')
        ? { 'TOP1 城市': geographyDisplay(topCity) }
        : {}),
      ...(countries[0] && r.cards.some(card => card.key === '海外 TOP1')
        ? { '海外 TOP1': geographyDisplay({ country: countries[0].name }) }
        : {}),
    },
  };
  if (Object.values(geography).some(entries => Object.keys(entries).length))
    r.meta.geography = geography;
  capTablePages(r, p.tablePages, pageOnly === true);
  return r;
}
