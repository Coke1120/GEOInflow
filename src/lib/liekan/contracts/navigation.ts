import type { FeatureRoute } from './features';

export type PageScope = 'global' | 'website' | 'account' | 'admin' | 'auth' | 'public' | 'state';
export interface NavigationItem {
  page: string;
  label: string;
}
export interface NavigationGroup extends NavigationItem {
  id: string;
  icon: string;
  children?: NavigationItem[];
}
export interface PageNavigation {
  scope: PageScope;
  section: string;
  parent?: string;
  title?: string;
}

export const globalNavigation: NavigationGroup[] = [
  { id: 'dashboard', page: 'dashboard', label: '工作台', icon: 'grid' },
  { id: 'websites', page: 'websites', label: '网站管理', icon: 'globe' },
  { id: 'boards', page: 'boards', label: '看板', icon: 'bars' },
  { id: 'sharing', page: 'sharing', label: '分享链接', icon: 'copy' },
  { id: 'teams', page: 'teams', label: '团队协作', icon: 'users' },
  { id: 'links', page: 'links', label: '链接', icon: 'box' },
  { id: 'pixels', page: 'pixels', label: '像素', icon: 'eye' },
];
export const websiteNavigation: NavigationGroup[] = [
  { id: 'overview', page: 'overview', label: '流量总览', icon: 'grid' },
  {
    id: 'ai',
    page: 'geo-ai',
    label: 'AI 抓取分析',
    icon: 'box',
    children: [
      { page: 'geo-ai', label: '抓取总览' },
      { page: 'geo-bots', label: 'AI 爬虫' },
      { page: 'geo-ai-pages', label: '抓取页面' },
      { page: 'geo-preference', label: '内容偏好' },
    ],
  },
  {
    id: 'visitors',
    page: 'geo-human',
    label: '访客与来源',
    icon: 'users',
    children: [
      { page: 'geo-human', label: '访客总览' },
      { page: 'geo-geography', label: '地域分布' },
      { page: 'geo-sources', label: '来源渠道' },
      { page: 'utm', label: 'UTM 活动' },
    ],
  },
  {
    id: 'behavior',
    page: 'geo-content',
    label: '内容与行为',
    icon: 'activity',
    children: [
      { page: 'geo-content', label: '页面与内容' },
      { page: 'events', label: '事件分析' },
      { page: 'sessions', label: '访问记录' },
      { page: 'heatmaps', label: '热力图' },
      { page: 'replays', label: '会话回放' },
      { page: 'performance', label: '页面性能' },
    ],
  },
  {
    id: 'conversion',
    page: 'geo-conversions',
    label: '转化分析',
    icon: 'funnel',
    children: [
      { page: 'geo-conversions', label: '转化概览' },
      { page: 'goals', label: '目标' },
      { page: 'funnels', label: '漏斗' },
      { page: 'attribution', label: '转化归因' },
      { page: 'revenue', label: '收入' },
    ],
  },
  {
    id: 'explore',
    page: 'segments',
    label: '深度分析',
    icon: 'bars',
    children: [
      { page: 'segments', label: '已保存分群' },
      { page: 'cohorts', label: '行为人群' },
      { page: 'retention', label: '留存分析' },
      { page: 'journeys', label: '访问旅程' },
      { page: 'breakdown', label: '维度拆分' },
      { page: 'compare', label: '对比分析' },
    ],
  },
  {
    id: 'monitor',
    page: 'realtime',
    label: '实时监测',
    icon: 'activity',
    children: [
      { page: 'realtime', label: '实时访客' },
      { page: 'geo-logs', label: '日志访问流' },
    ],
  },
];
export const accountNavigation: NavigationItem[] = [
  { page: 'account', label: '账户资料' },
  { page: 'security', label: '账户安全' },
  { page: 'api-keys', label: 'API 密钥' },
  { page: 'preferences', label: '偏好设置' },
];
export const adminNavigation: NavigationGroup[] = [
  { id: 'admin-users', page: 'admin-users', label: '用户管理', icon: 'users' },
  { id: 'admin-websites', page: 'admin-websites', label: '所有网站', icon: 'globe' },
  { id: 'admin-teams', page: 'admin-teams', label: '所有团队', icon: 'box' },
  { id: 'admin-security', page: 'admin-security', label: '系统安全', icon: 'shield' },
];
export const geoPaths: Record<string, string> = {
  overview: '',
  'geo-ai': '/ai',
  'geo-bots': '/ai/bots',
  'geo-ai-pages': '/ai/pages',
  'geo-preference': '/ai/preference',
  'geo-human': '/human',
  'geo-geography': '/human/geo',
  'geo-sources': '/human/sources',
  'geo-content': '/content',
  'geo-conversions': '/conversions',
  'geo-logs': '/logs',
};

const pageDefinitions: Array<[PageScope, string, string | undefined, string[]]> = [
  ['global', 'dashboard', undefined, ['dashboard']],
  ['global', 'dashboard', 'dashboard', ['dashboard-edit']],
  ['global', 'websites', undefined, ['websites']],
  ['global', 'websites', 'websites', ['onboarding']],
  ['website', 'website-settings', undefined, ['website-settings']],
  [
    'website',
    'website-settings',
    'website-settings',
    ['tracking', 'install-check', 'recorder-settings'],
  ],
  ['account', 'account', undefined, ['account', 'security', 'api-keys', 'preferences']],
  ['auth', 'account', 'security', ['two-factor', 'backup-codes']],
  ['auth', 'account', undefined, ['login', 'login-2fa', 'sso']],
  ['website', 'conversion', undefined, ['goals', 'funnels', 'attribution', 'revenue']],
  ['website', 'conversion', 'goals', ['goal-editor']],
  ['website', 'conversion', 'funnels', ['funnel-editor']],
  ['website', 'monitor', undefined, ['realtime']],
  ['website', 'behavior', undefined, ['events', 'sessions', 'performance', 'heatmaps', 'replays']],
  ['website', 'behavior', 'events', ['event-detail']],
  ['website', 'behavior', 'sessions', ['session-detail']],
  ['website', 'behavior', 'replays', ['replay-player']],
  ['website', 'overview', 'overview', ['filters', 'annotations', 'exports']],
  [
    'website',
    'explore',
    undefined,
    ['segments', 'cohorts', 'retention', 'journeys', 'breakdown', 'compare'],
  ],
  ['website', 'explore', 'segments', ['segment-editor']],
  ['website', 'explore', 'cohorts', ['cohort-editor']],
  ['website', 'explore', 'journeys', ['path-detail']],
  ['website', 'visitors', undefined, ['utm']],
  ['global', 'teams', undefined, ['teams']],
  ['global', 'teams', 'teams', ['team-detail', 'team-join']],
  ['admin', 'admin-users', undefined, ['admin-users']],
  ['admin', 'admin-users', 'admin-users', ['admin-user']],
  ['admin', 'admin-websites', undefined, ['admin-websites']],
  ['admin', 'admin-teams', undefined, ['admin-teams']],
  ['admin', 'admin-security', undefined, ['admin-security']],
  ['global', 'boards', undefined, ['boards']],
  ['global', 'sharing', undefined, ['sharing']],
  ['global', 'boards', 'boards', ['board-editor', 'board-view']],
  ['global', 'boards', 'board-view', ['board-design']],
  ['public', 'boards', undefined, ['share-preview']],
  ['global', 'links', undefined, ['links']],
  ['global', 'pixels', undefined, ['pixels']],
  ['global', 'links', 'links', ['link-editor', 'link-detail']],
  ['global', 'pixels', 'pixels', ['pixel-editor', 'pixel-detail']],
  ['state', 'dashboard', undefined, ['access-denied', 'session-expired', 'not-found']],
];
export const pageNavigation: Record<string, PageNavigation> = Object.fromEntries(
  pageDefinitions.flatMap(([scope, section, parent, pages]) =>
    pages.map(page => [page, { scope, section, parent }]),
  ),
);
for (const group of websiteNavigation) {
  for (const item of group.children || [group]) {
    if (item.page in geoPaths)
      pageNavigation[item.page] = { scope: 'website', section: group.id, title: item.label };
  }
}
const titles: Record<string, string> = {
  'two-factor': '设置双重验证',
  'funnel-editor': '创建漏斗',
  'link-editor': '创建链接',
  'pixel-editor': '创建像素',
  revenue: '收入',
  account: '账户资料',
  'api-keys': 'API 密钥',
  goals: '目标',
  funnels: '漏斗',
  sessions: '访问记录',
  'session-detail': '访问详情',
  segments: '已保存分群',
  cohorts: '行为人群',
  'cohort-editor': '创建行为人群',
  utm: 'UTM 活动',
  teams: '团队协作',
  boards: '看板',
  'board-editor': '看板信息',
  'board-design': '编辑看板布局',
  sharing: '分享链接',
  'share-preview': '分享页面',
  'admin-websites': '所有网站',
  'admin-teams': '所有团队',
  links: '链接',
  pixels: '像素',
  exports: '数据导出',
  'access-denied': '没有访问权限',
  'session-expired': '需要重新登录',
};
for (const [page, title] of Object.entries(titles)) pageNavigation[page].title = title;

export function analysisSourcePage(page: string) {
  if (pageNavigation[page]?.scope !== 'website') return 'overview';
  let source = page;
  while (pageNavigation[source]?.parent) source = pageNavigation[source].parent;
  return source;
}

export function navigationFor(route: FeatureRoute): PageNavigation {
  const meta = pageNavigation[route.page] || { scope: 'state', section: 'dashboard' };
  if (
    ['filters', 'annotations', 'exports'].includes(route.page) &&
    route.from &&
    pageNavigation[route.from]?.scope === 'website' &&
    !['filters', 'annotations', 'exports'].includes(route.from)
  )
    return {
      ...meta,
      section: pageNavigation[route.from].section,
      parent: analysisSourcePage(route.from),
    };
  if (route.context === 'admin' && ['website-settings', 'team-detail'].includes(route.page))
    return {
      ...meta,
      scope: 'admin',
      section: route.page === 'website-settings' ? 'admin-websites' : 'admin-teams',
      parent: route.page === 'website-settings' ? 'admin-websites' : 'admin-teams',
    };
  if (route.context === 'website' && route.page === 'sharing')
    return { ...meta, scope: 'website', section: 'website-settings', parent: 'website-settings' };
  return meta;
}
export const needsWebsite = (route: FeatureRoute) =>
  pageNavigation[route.page]?.scope === 'website' ||
  (route.page === 'sharing' && route.context === 'website');
export function activeNavigationPage(route: FeatureRoute) {
  let page = route.page;
  let parent = navigationFor(route).parent;
  while (parent) {
    page = parent;
    parent = pageNavigation[page]?.parent;
  }
  return page;
}
export const resourceListPages = new Set(['websites', 'boards', 'sharing', 'links', 'pixels']);
export const datedPages = new Set([
  'websites',
  'dashboard',
  'board-view',
  'links',
  'pixels',
  'link-detail',
  'pixel-detail',
]);
export function hasDateControl(route: FeatureRoute) {
  return (
    datedPages.has(route.page) ||
    (navigationFor(route).scope === 'website' &&
      !['website-settings', 'tracking', 'install-check', 'recorder-settings', 'sharing'].includes(
        route.page,
      ))
  );
}
export function geoPageFromPath(pathname: string) {
  const suffix = pathname.match(/\/websites\/[^/]+\/geo(\/.*)?$/)?.[1] || '';
  return (
    Object.keys(geoPaths).find(page => geoPaths[page] === suffix.replace(/\/$/, '')) || 'overview'
  );
}
