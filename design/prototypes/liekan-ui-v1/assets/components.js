import { fixtures } from './catalog.js';
export const clone = x => JSON.parse(JSON.stringify(x));
export const defaultWidgets = () => [
  { type: 'trend', title: '访客趋势', full: true },
  { type: 'channels', title: '访问渠道', full: false },
  { type: 'events', title: '转化事件', full: false },
];
export const initial = () => ({
  sites: clone(fixtures.sites),
  goals: clone(fixtures.goals),
  segments: clone(fixtures.segments),
  cohorts: clone(fixtures.cohorts),
  members: clone(fixtures.members),
  keys: [['研究报告集成', 'demo_key_••••4f2a', '2026-09-23', '2026-09-30']],
  teamMembers: {
    0: clone(fixtures.members),
    1: clone(fixtures.members.slice(1)).map((row, i) => {
      if (i === 0) row[2] = '所有者';
      return row;
    }),
  },
  teams: [
    ['移山增长团队', 'admin', '4', '2', '所有者'],
    ['白鹭研究小组', 'ruozhu', '3', '1', '成员'],
  ],
  adminUsers: [
    ['admin', '管理员', '2', '已启用', '正常'],
    ['ruozhu', '用户', '1', '已启用', '正常'],
    ['yuan', '用户', '1', '未启用', '正常'],
    ['zhiyao', '只读', '1', '已启用', '正常'],
  ],
  shares: [['增长周报', '网站', '总览、事件', '允许', '启用']],
  links: [
    ['秋季 GEO 研究报告', 'https://yishan.example/research', 'geo-report', '1,873'],
    ['预约增长诊断', 'https://yishan.example/demo', 'growth-demo', '846'],
  ],
  pixels: [
    ['研究报告邮件', 'mail-research', '3,684'],
    ['客户通讯', 'client-update', '927'],
  ],
  boards: [
    ['GEO 增长周报', '网站', '移山 GEO 官网', '2026-09-30'],
    ['内容表现对照', '混合', '多个资源', '2026-09-28'],
  ],
  annotations: [
    ['2026-09-12', '新版 GEO 指南上线'],
    ['2026-09-23', '秋季研究报告推广'],
  ],
  steps: [
    { type: 'path', value: '/guide/geo', filters: [] },
    { type: 'path', value: '/pricing', filters: [] },
    {
      type: 'event',
      value: 'demo_submit',
      filters: [{ property: 'plan', operator: '等于', value: 'growth' }],
    },
  ],
  conditions: [
    { field: '来源', op: '包含', value: 'chatgpt.com' },
    { field: '国家 / 地区', op: '等于', value: '中国' },
  ],
  match: 'all',
  onboardStep: 1,
  onboardName: '',
  onboardDomain: '',
  install: 0,
  username: 'admin',
  drafts: {},
  selected: {
    goal: -1,
    segment: -1,
    cohort: -1,
    board: -1,
    link: -1,
    pixel: -1,
    share: 0,
    event: 0,
    session: 0,
    team: 0,
    user: 2,
    path: 0,
    replay: 0,
  },
  funnelWindow: 60,
  twoFactor: false,
  required: false,
  teamRequired: false,
  configMissing: false,
  role: 'owner',
  state: 'normal',
  range: '2026-09-01 至 09-30',
  site: '移山 GEO 官网',
  tab: {},
  savedReplay: false,
  savedReplayRecord: 0,
  savedReplayName: '',
  widgets: defaultWidgets(),
  boardLayouts: {},
  dashboardSites: ['移山 GEO 官网', '猎看产品文档'],
  heatMode: 'click',
  device: 'desktop',
  replayTime: 0,
  replayTotal: 204,
  playing: false,
  speed: 1,
  exportStatus: 'idle',
  exportProgress: 0,
});
export let S = initial();
export const reset = () => {
  S = initial();
};
export const esc = x =>
  String(x ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
export const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',
  shield: '<path d="m12 3 8 3v6c0 4-3.5 7-8 9-4.5-2-8-5-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  funnel: '<path d="M3 4h18l-7 8v7l-4 2v-9z"/>',
  activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  users:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 6"/>',
  bars: '<path d="M4 20V10M10 20V4M16 20v-8M22 20V7"/>',
  box: '<path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 5 9-5M12 12v9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  back: '<path d="m12 5-7 7 7 7M5 12h15"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  pause: '<path d="M8 4v16M16 4v16"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
};
export const icon = (name, cls = '') =>
  `<svg class="nav-icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.grid}</svg>`;
export const btn = (label, action = '', primary = false, extra = '') => {
  const found = extra.match(/class="([^"]*)"/),
    cls = found?.[1] || '';
  extra = extra.replace(/class="[^"]*"/, '');
  return `<button type="button" class="btn ${primary ? 'primary' : ''} ${cls}" ${action ? `data-action="${action}"` : ''} ${extra}>${label}</button>`;
};
export const link = (label, id, primary = false, attrs = '') =>
  `<a class="btn ${primary ? 'primary' : ''}" data-nav="${id}" ${attrs} href="${id === 'index' ? 'index' : id}.html">${label}</a>`;
export const badge = (text, color = 'blue') => `<span class="badge ${color}">${text}</span>`;
export const panel = (title, sub, body, actions = '', cls = '') =>
  `<section class="panel ${cls}"><div class="panel-head"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>${body}</section>`;
export const body = x => `<div class="panel-body">${x}</div>`;
export const metrics = (items, cls = '') =>
  `<div class="metrics ${cls}">${items.map(([label, value, foot, color]) => `<div class="metric"><p class="metric-label">${label}</p><p class="metric-value num ${color ?? 'blue'}">${value}</p><p class="metric-foot">${foot || '示例数据 · 当前期间'}</p></div>`).join('')}</div>`;
export const chart = (kind, title, sub = '', extra = '', cls = '') =>
  panel(
    title,
    sub,
    `<div class="chart ${cls}" data-chart="${kind}" role="img" aria-label="${esc(title)}，示例图表"></div><div class="legend-note">${kind === 'journey' ? '示例数据 · 可悬停查看流量，点击节点查看路径详情' : ['channels', 'utm', 'properties', 'attribution', 'breakdown'].includes(kind) ? '示例数据 · 可悬停查看各类别数值' : '示例数据 · 可悬停查看数值，点击图例切换序列'}</div>`,
    extra,
  );
export const table = (headers, rows, id = '', numeric = []) =>
  `<div class="table-wrap"><table style="--table-min:${headers.length <= 4 ? 40 + headers.length * 100 : headers.length * 110}px" ${id ? `data-table="${id}"` : ''}><thead><tr>${headers.map((h, i) => `<th class="${numeric.includes(i) ? 'numeric' : ''}" scope="col"><button class="table-sort" data-sort="${i}">${h} <span aria-hidden="true">↕</span></button></th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${numeric.includes(i) ? 'numeric' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="table-footer"><span data-count>${rows.length} 条示例记录 · 表头可排序</span><span>本页展示全部示例</span></div>`;
export const search = placeholder =>
  `<label class="search"><span class="sr-only" hidden>${placeholder}</span><input type="search" data-search placeholder="${placeholder}" aria-label="${placeholder}"></label>`;
export const notice = (text, color = '') => `<div class="notice ${color}">${text}</div>`;
export const field = (
  label,
  name,
  value = '',
  type = 'text',
  help = '',
  required = false,
  attrs = '',
) =>
  `<label class="field"> <span>${label}${required ? ' <span class="required">*</span>' : ''}</span><input type="${type}" name="${name}" value="${esc(value)}" ${required ? 'required' : ''} ${attrs}>${help ? `<span class="field-help">${help}</span>` : ''}<span class="field-error" data-error-for="${name}" aria-live="polite"></span></label>`;
export const select = (label, name, options, value = '', attrs = '') =>
  `<label class="field"><span>${label}</span><select name="${name}" ${attrs}>${options
    .map(o => {
      const [val, title] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(val)}" ${String(val) === String(value) ? 'selected' : ''}>${title}</option>`;
    })
    .join('')}</select></label>`;
export const textarea = (label, name, value = '', help = '') =>
  `<label class="field"><span>${label}</span><textarea name="${name}">${esc(value)}</textarea>${help ? `<span class="field-help">${help}</span>` : ''}</label>`;
export const check = (text, name, checked = false, attrs = '') =>
  `<label class="check"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''} ${attrs}><span>${text}</span></label>`;
export const switchRow = (title, desc, name, on = false, attrs = '') =>
  `<label class="switch-row"><span><strong>${title}</strong><small style="display:block;margin-top:4px">${desc}</small></span><input type="checkbox" class="switch" name="${name}" aria-label="${title}" ${on ? 'checked' : ''} ${attrs}></label>`;
export const definition = values =>
  `<dl class="definition">${values.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
export const tabs = (items, current = '', name = 'tab') =>
  `<div class="tabs" role="tablist" aria-label="视图切换">${items
    .map(o => {
      const [id, text] = Array.isArray(o) ? o : [o, o];
      return `<button type="button" role="tab" aria-selected="${id === current}" class="tab ${id === current ? 'on' : ''}" data-tab="${esc(id)}" data-tab-name="${name}">${text}</button>`;
    })
    .join('')}</div>`;
export const searchPanel = (title, sub, headers, rows, action = '', id = '', numeric = []) =>
  panel(title, sub, table(headers, rows, id, numeric), search('搜索本页记录') + action);
export const form = (action, fields, submit = '保存', cancel = '') =>
  `<form class="form" data-form="${action}" novalidate>${fields}<div class="form-actions">${cancel ? link('取消', cancel) : ''}<button type="submit" class="btn primary" ${action === 'filter-apply' ? '' : 'data-mutate'}>${submit}</button></div><p class="field-error" data-form-error aria-live="polite"></p></form>`;
export const code = text => `<pre class="code-block">${esc(text)}</pre>`;
export const actionCell = (label, id, entity = '', index = -1) =>
  `<a data-nav="${id}" ${entity ? `data-entity="${entity}" data-index="${index}"` : ''} href="${id}.html">${label} →</a>`;
export const filterRows = () =>
  S.conditions
    .map(
      (c, i) =>
        `<div class="condition" data-condition="${i}">${select('字段', `condition-field-${i}`, ['来源', '国家 / 地区', '页面路径', '设备', '浏览器', '渠道', '会话属性 · plan'], c.field)}${select('运算符', `condition-op-${i}`, ['等于', '不等于', '包含', '不包含', '正则匹配'], c.op)}${field('值', `condition-value-${i}`, c.value, 'text', '', true)}${btn(icon('close'), 'condition-remove', false, `aria-label="移除条件 ${i + 1}" data-index="${i}" class="icon-btn"`)}</div>`,
    )
    .join('');
export const conditionBuilder = () =>
  `<div class="condition-group"><div class="row between" style="margin-bottom:16px"><h3>访问条件</h3>${select(
    '匹配规则',
    'match',
    [
      ['all', '满足全部条件 (AND)'],
      ['any', '满足任一条件 (OR)'],
    ],
    S.match,
  )}</div><div>${filterRows()}</div>${btn(icon('plus') + '添加条件', 'condition-add')}</div>`;
export const sampleWeb = (overlay = '', phone = false) =>
  `<div class="browser-stage"><div class="browser-bar"><span class="browser-dot"></span><span class="browser-dot"></span><span class="browser-dot"></span><span>yishan.example/guide/geo · 示例页面</span></div><div class="web-sample ${phone ? 'phone' : ''}"><header><strong>移山 GEO</strong><span>研究 · 案例 · 联系</span></header><h3>让优质内容获得<br>更多 AI 与搜索流量</h3><p>从内容发现到转化，理解每一次访问的路径。</p><span class="sample-cta">预约增长诊断</span><div class="sample-cols"><div>AI 内容发现<br><small>引荐与抓取</small></div><div>搜索增长<br><small>来源与访问</small></div><div>转化洞察<br><small>目标与路径</small></div></div>${overlay}</div></div>`;
