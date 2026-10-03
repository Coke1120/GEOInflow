import type { FeatureEntity, FeatureUser } from './features';

export const workspaceRoleLabels: Record<string, string> = {
  admin: '管理员',
  user: '用户',
  'view-only': '只读',
  'team-owner': '所有者',
  'team-manager': '管理员',
  'team-member': '成员',
  'team-view-only': '只读',
};
export const teamRoleOptions: [string, string][] = [
  ['team-manager', '管理员'],
  ['team-member', '成员'],
  ['team-view-only', '只读'],
];
export const userRoleOptions: [string, string][] = [
  ['user', '用户'],
  ['view-only', '只读'],
  ['admin', '管理员'],
];
const rank: Record<string, number> = {
  'team-owner': 3,
  'team-manager': 2,
  'team-member': 1,
  'team-view-only': 0,
};
export function workspaceTeamRole(user: FeatureUser, team?: FeatureEntity) {
  return team?.members?.find((member: any) => member.userId === user.id)?.role || team?.role || '';
}
export function canManageTeam(user: FeatureUser, team?: FeatureEntity) {
  if (user?.role === 'view-only') return false;
  return !!user?.isAdmin || ['team-owner', 'team-manager'].includes(workspaceTeamRole(user, team));
}
export function canManageMember(user: FeatureUser, team: FeatureEntity, member: any) {
  if (user?.role === 'view-only') return false;
  return (
    !!user?.isAdmin || (rank[workspaceTeamRole(user, team)] ?? -1) > (rank[member?.role] ?? -1)
  );
}
export function canCreateResource(user: FeatureUser, team?: FeatureEntity) {
  if (user?.isAdmin) return true;
  if (user?.role !== 'user') return false;
  return (
    !team || ['team-owner', 'team-manager', 'team-member'].includes(workspaceTeamRole(user, team))
  );
}
export function canManageResource(
  user: FeatureUser,
  entity?: FeatureEntity,
  teams: FeatureEntity[] = [],
) {
  if (!entity) return false;
  if (user?.role === 'view-only') return false;
  if (user?.isAdmin) return true;
  if (entity.userId) return entity.userId === user.id;
  return ['team-owner', 'team-manager', 'team-member'].includes(
    workspaceTeamRole(
      user,
      teams.find(team => team.id === entity.teamId),
    ),
  );
}
export function nativeMetric(value: any): number | null {
  if (value == null) return null;
  const number = Number(value?.value ?? value?.y ?? value?.count ?? value);
  return Number.isFinite(number) ? number : null;
}
export function resourceUrl(
  origin: string,
  basePath: string,
  kind: 'link' | 'pixel',
  slug: string,
  configured?: string,
) {
  if (!slug || !(configured || origin)) return '';
  return `${(configured || `${origin}${basePath}/${kind === 'link' ? 'q' : 'p'}`).replace(/\/$/, '')}/${encodeURIComponent(slug)}`;
}
export function linkPayload(value: Record<string, any>, kind: 'link' | 'pixel', teamId?: string) {
  const name = String(value.name || '').trim(),
    slug = String(value.slug || '').trim();
  if (!name || name.length > 100) throw new Error('名称需要 1 至 100 个字符');
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(slug))
    throw new Error('标识需要 8 至 100 位字母、数字、短横线或下划线');
  const body: Record<string, any> = { name, slug };
  if (kind === 'link') {
    const url = String(value.url || '').trim();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('请输入完整的 http:// 或 https:// 地址');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || url.length > 500)
      throw new Error('目标地址需要 http:// 或 https:// 开头，最多 500 个字符');
    body.url = url;
  }
  if (teamId) body.teamId = teamId;
  return body;
}
export interface WorkspaceComponent {
  type: string;
  title?: string;
  entityType?: 'website' | 'link' | 'pixel';
  entityId?: string;
  websiteId?: string;
  props?: Record<string, any>;
  [key: string]: any;
}
export interface WorkspaceColumn {
  id: string;
  size?: number;
  component?: WorkspaceComponent;
  [key: string]: any;
}
export interface WorkspaceRow {
  id: string;
  size?: number;
  columns: WorkspaceColumn[];
  [key: string]: any;
}
export interface WorkspaceParameters {
  rows?: WorkspaceRow[];
  websiteId?: string;
  linkId?: string;
  pixelId?: string;
  [key: string]: any;
}
export function boardEntity(
  parameters: WorkspaceParameters = {},
  type = 'mixed',
): { entityType: WorkspaceComponent['entityType'] | ''; entityId: string } {
  const entityType = type === 'website' || type === 'link' || type === 'pixel' ? type : '';
  return { entityType, entityId: parameters[`${entityType}Id`] || '' };
}
export function bindBoardComponent(
  component: WorkspaceComponent,
  entityType?: WorkspaceComponent['entityType'],
  entityId?: string,
): WorkspaceComponent {
  const { entityType: _type, entityId: _id, websiteId: _websiteId, ...rest } = component;
  return { ...rest, ...(entityType && entityId ? { entityType, entityId } : {}) };
}
export function boardParameters(
  parameters: WorkspaceParameters = {},
  type: string,
  entityId?: string,
  previousType?: string,
): WorkspaceParameters {
  const { websiteId, linkId, pixelId, ...rest } = parameters;
  const fixed = ['website', 'link', 'pixel'].includes(type);
  const previous = boardEntity(
    parameters,
    previousType || (websiteId ? 'website' : linkId ? 'link' : pixelId ? 'pixel' : 'mixed'),
  );
  return {
    ...rest,
    ...(fixed && entityId ? { [`${type}Id`]: entityId } : {}),
    ...(rest.rows && {
      rows: rest.rows.map(row => ({
        ...row,
        columns: row.columns.map(column => {
          const component = column.component;
          if (!component) return column;
          // Fixed widgets inherit the board source. Opening a fixed board keeps each visible source.
          return fixed || component.type === 'TextBlock'
            ? { ...column, component: bindBoardComponent(component) }
            : previous.entityType && previous.entityId
              ? {
                  ...column,
                  component: bindBoardComponent(component, previous.entityType, previous.entityId),
                }
              : column;
        }),
      })),
    }),
  };
}
export function boardColumns(parameters: WorkspaceParameters = {}) {
  return (parameters.rows || []).flatMap(row => row.columns.map(column => ({ row, column })));
}
// Rows and columns stay in the native board format so both editors can reopen a saved layout.
export function updateBoardColumn(
  parameters: WorkspaceParameters,
  id: string,
  patch: Partial<WorkspaceColumn>,
): WorkspaceParameters {
  return {
    ...parameters,
    rows: (parameters.rows || []).map(row => ({
      ...row,
      columns: row.columns.map(column => (column.id === id ? { ...column, ...patch } : column)),
    })),
  };
}
export function removeBoardColumn(
  parameters: WorkspaceParameters,
  id: string,
): WorkspaceParameters {
  return {
    ...parameters,
    rows: (parameters.rows || [])
      .map(row => ({ ...row, columns: row.columns.filter(column => column.id !== id) }))
      .filter(row => row.columns.length),
  };
}
export function moveBoardColumn(
  parameters: WorkspaceParameters,
  id: string,
  targetId: string,
): WorkspaceParameters {
  if (id === targetId) return parameters;
  const entries = boardColumns(parameters),
    from = entries.findIndex(entry => entry.column.id === id),
    to = entries.findIndex(entry => entry.column.id === targetId);
  if (from < 0 || to < 0) return parameters;
  const columns = entries.map(entry => entry.column),
    [moved] = columns.splice(from, 1);
  columns.splice(to, 0, moved);
  let offset = 0;
  return {
    ...parameters,
    rows: (parameters.rows || []).map(row => {
      const next = { ...row, columns: columns.slice(offset, offset + row.columns.length) };
      offset += row.columns.length;
      return next;
    }),
  };
}
export function setBoardColumnWidth(
  parameters: WorkspaceParameters,
  id: string,
  full: boolean,
  newId: () => string,
): WorkspaceParameters {
  const entry = boardColumns(parameters).find(entry => entry.column.id === id);
  if (!entry) return parameters;
  const column = { ...entry.column, size: full ? 100 : 50 };
  if (!full || entry.row.columns.length === 1)
    return updateBoardColumn(parameters, id, { size: column.size });
  const index = entry.row.columns.findIndex(item => item.id === id);
  const before = entry.row.columns.slice(0, index),
    after = entry.row.columns.slice(index + 1);
  const replacements: WorkspaceRow[] = [];
  if (before.length) replacements.push({ ...entry.row, columns: before });
  replacements.push({
    ...entry.row,
    id: before.length ? newId() : entry.row.id,
    columns: [column],
  });
  if (after.length) replacements.push({ ...entry.row, id: newId(), columns: after });
  return {
    ...parameters,
    rows: (parameters.rows || []).flatMap(row => (row.id === entry.row.id ? replacements : [row])),
  };
}
export function eventChartData(rows: any[] = []) {
  const dates = [...new Set(rows.map(row => String(row.t)))].sort();
  const names = [...new Set(rows.map(row => String(row.x)))];
  return {
    labels: dates,
    series: names.map(name => ({
      name,
      values: dates.map(time => {
        const row = rows.find(item => String(item.x) === name && String(item.t) === time);
        return row ? nativeMetric(row.y) : 0;
      }),
    })),
  };
}
export const shareTypes: Record<string, number> = { website: 1, link: 2, pixel: 3, board: 4 };
export const shareSections: [string, string][] = [
  ['overview', '总览'],
  ['events', '事件'],
  ['utm', 'UTM'],
  ['goals', '目标与漏斗'],
];
export function hasShareSection(parameters: Record<string, any> = {}, section: string) {
  const known = [
    'overview',
    'events',
    'sessions',
    'realtime',
    'performance',
    'compare',
    'breakdown',
    'goals',
    'funnels',
    'journeys',
    'retention',
    'utm',
    'revenue',
    'attribution',
  ];
  const restricted = known.some(key => typeof parameters[key] === 'boolean');
  return !restricted || parameters[section] === true;
}
export function allowedShareSections(parameters: Record<string, any> = {}) {
  return shareSections.filter(
    ([key]) =>
      hasShareSection(parameters, key) ||
      (key === 'goals' && hasShareSection(parameters, 'funnels')),
  );
}
export function shareParameters(values: Record<string, any>, previous: Record<string, any> = {}) {
  const parameters: Record<string, any> = {
    ...previous,
    enabled: previous.enabled !== false,
    allowFilter: values.allowFilter === 'on',
    theme: values.theme || 'light',
  };
  for (const key of ['overview', 'events', 'utm', 'goals']) parameters[key] = values[key] === 'on';
  parameters.funnels = parameters.goals;
  // Password material is sent only on explicit submission and is never copied from API data.
  delete parameters.password;
  delete parameters.passwordHash;
  if (values.removePassword === 'on') parameters.password = null;
  else if (values.password) parameters.password = String(values.password);
  return parameters;
}
