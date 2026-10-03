import { journeySample } from './sample-data.js';
import { pages, groups, references, fixtures } from './catalog.js';
import {
  S,
  reset,
  defaultWidgets,
  esc,
  icon,
  btn,
  link,
  badge,
  panel,
  body,
  metrics,
  notice,
  table,
  field,
  select,
  form,
  definition,
} from './components.js';
import { sitesPage, authPage, identityPage, conversionPage } from './pages-core.js';
import { activityPage, audiencePage, advancedPage } from './pages-analysis.js';
import { workspacePage, publicPage } from './pages-workspace.js';
import { extendedPage, clock, exportTask } from './pages-extended.js';
import { drawerContent } from './drawers.js';
import { disposeCharts, hydrateCharts, resizeCharts, updateCharts } from './charts.js';
import { routeMap } from './route-map.js';
let current = location.pathname.split('/').pop().replace('.html', '') || 'index';
let dialogTrigger = null,
  toastTimer,
  playTimer,
  exportTimer,
  renderedPage,
  installRun = 0;
const root = document.querySelector('#app');
const pageById = id => pages.find(p => p.id === id);
const firstGroup = id => pages.find(p => p.group === id)?.id;
const symbols = ['globe', 'shield', 'funnel', 'activity', 'users', 'bars', 'grid', 'box', 'shield'];
const settings = () => ({ ...S.tab });
function gallery() {
  return (
    `<div class="catalog-heading"><div><h2>猎看统计 · 补充页面合集</h2><p>按现有规范补齐 ${pages.length} 个页面与流程，保留 11 个已确认页面作为对照。</p></div><div class="actions">${btn('60 条路由覆盖', 'route-map')}${btn('设计与口径说明', 'review-guide')}</div></div>` +
    notice(
      '本轮交付用于确认 UI、字段和交互。全部使用示例数据，修改保存在当前浏览器内存，刷新即恢复。后台功能融合将在确认后开始。',
      'amber',
    ) +
    panel(
      '建议确认顺序',
      '先走通高优先级配置，再查看分析和管理页面。',
      `<div class="flow-strip">${link('① 添加网站', 'onboarding', true)}${link('② 身份与安全', 'login')}${link('③ 配置漏斗', 'funnel-editor')}${link('④ 查看会话', 'session-detail')}${link('⑤ 编排看板', 'board-design')}</div><div class="review-note">请确认：页面结构、字段口径、配置动作、导航归属和后续能力范围。</div>`,
      `<label class="search"><input type="search" id="catalog-search" placeholder="搜索页面、功能或路由" aria-label="搜索原型页面"></label>`,
    ) +
    `<section class="panel"><div class="catalog-groups">${groups
      .map(
        ([id, title, priority, desc]) =>
          `<div class="catalog-row" data-catalog-group="${id}"><div class="catalog-title"><h2>${title}</h2>${badge(priority + '优先级', priority === '高' ? 'blue' : priority === '后续' ? 'amber' : 'gray')}<p>${desc}</p></div><div class="catalog-links">${pages
            .filter(p => p.group === id)
            .map(
              p =>
                `<a class="catalog-link" data-nav="${p.id}" data-catalog-search="${esc(p.title + ' ' + p.summary + ' ' + p.route)}" href="${p.id}.html"><span>${p.title}<small>${p.kind}</small></span>${icon('chevron')}</a>`,
            )
            .join('')}</div></div>`,
      )
      .join('')}</div></section>` +
    panel(
      '已确认的 11 个页面',
      '参照副本只替换外部资源为本地资源，布局与图表定义沿用原文件。',
      body(
        `<div class="catalog-links">${references.map(([id, t]) => `<a class="catalog-link" href="reference/${id}.html" target="_blank" rel="noopener"><span>${t}<small>原有 UI · 在新标签页查看</small></span>${icon('chevron')}</a>`).join('')}</div>`,
      ),
    ) +
    notice(
      '原有 60 条路由包含别名、重定向和弹层路由。合集为这些入口指定视觉页面，同时补充创建表单、验证流程和异常页面。后续能力页面已设计，接入方式与真实数据条件仍需逐项确认。',
    )
  );
}
function shell(content) {
  const p = pageById(current),
    g = groups.find(x => x[0] === p?.group);
  return `<a class="skip" href="#main-content">跳到主要内容</a><button class="mobile-toggle" data-action="mobile-nav" aria-label="打开导航">${icon('menu')} 页面导航</button><button class="nav-backdrop" data-action="close-nav" aria-label="关闭导航"></button><aside class="sidebar"><a class="brand" data-nav="index" href="index.html"><img src="assets/logo.svg" alt=""><span class="brand-name">猎看统计<span class="brand-caption">LIEKAN GEO STATS</span></span></a><nav class="nav" aria-label="页面导航"><a class="nav-item nav-quick ${current === 'index' ? 'on' : ''}" data-nav="index" href="index.html">${icon('grid')} UI 页面合集</a><div class="nav-label">补充功能</div>${groups.map(([id, title], i) => `<a class="nav-item ${id === p?.group ? 'on' : ''}" data-nav="${firstGroup(id)}" href="${firstGroup(id)}.html">${icon(symbols[i])}${title}</a>`).join('')}<div class="nav-label">已确认 UI 对照</div>${references.map(([id, title]) => `<a class="nav-item" href="reference/${id}.html" target="_blank" rel="noopener">${icon(id.includes('ai') ? 'activity' : 'bars')}${title}</a>`).join('')}</nav><footer class="side-footer"><button class="site-switch" data-action="drawer:site-switch"><span class="avatar">LK</span><span style="min-width:0"><span style="display:block;font-size:12.5px;font-weight:500">${esc(S.site)}</span><small>示例网站</small></span></button></footer></aside><div class="shell-content"><header class="header"><div class="header-inner"><div><h1>${p?.title || 'UI 原型合集'}</h1><div class="subtitle">${p ? g[1] + ' · ' + p.summary : '面向 GEO 增长的 AI 与搜索流量分析系统'}</div></div><div class="header-actions">${current !== 'index' ? btn(icon('back') + '合集', 'back-catalog') : ''}${p && ['activity', 'audience', 'analysis', 'extended'].includes(p.group) ? btn(esc(S.range), 'drawer:date') : ''}${p && p.group === 'extended' ? badge('后续能力 · 待融合', 'amber') : badge('UI v1', 'blue')}</div></div></header><div class="preview-tools"><strong>原型预览</strong><span>示例数据 · 尚未接入后端</span><div class="tool-end"><label>状态 <select aria-label="预览状态" data-control="state"><option value="normal" ${S.state === 'normal' ? 'selected' : ''}>正常</option><option value="empty" ${S.state === 'empty' ? 'selected' : ''}>无数据</option><option value="loading" ${S.state === 'loading' ? 'selected' : ''}>加载中</option><option value="error" ${S.state === 'error' ? 'selected' : ''}>请求失败</option><option value="forbidden" ${S.state === 'forbidden' ? 'selected' : ''}>无权限</option></select></label><label>角色 <select aria-label="预览角色" data-control="role"><option value="owner" ${S.role === 'owner' ? 'selected' : ''}>所有者 / 管理员</option><option value="member" ${S.role === 'member' ? 'selected' : ''}>成员</option><option value="viewer" ${S.role === 'viewer' ? 'selected' : ''}>只读</option></select></label>${btn('重置示例', 'reset-prototype', false, 'aria-label="重置全部原型示例"')}</div></div><main class="content" id="main-content">${
    p
      ? `<nav class="tabs section-tabs" aria-label="${g[1]}页面">${pages
          .filter(x => x.group === p.group)
          .map(
            x =>
              `<a class="tab ${x.id === current ? 'on' : ''}" ${x.id === current ? 'aria-current="page"' : ''} data-nav="${x.id}" href="${x.id}.html">${x.title}</a>`,
          )
          .join('')}</nav>`
      : ''
  }${S.role === 'viewer' ? notice('当前预览为只读角色。修改、创建与删除操作已禁用。', 'blue') : ''}${content}${p ? `<div class="route-summary"><span class="muted">${p.route ? '对应上游入口：' + esc(p.route) : '新增流程或状态设计'} · ${p.kind} · UI 原型</span></div>` : ''}</main></div>`;
}
function stateSurface(state) {
  if (state === 'loading')
    return panel(
      '正在加载',
      '等待统计与配置返回。',
      body(
        '<div class="skeleton" style="width:32%"></div><div class="skeleton wide"></div><div class="skeleton" style="width:70%"></div><p class="muted">演示状态持续展示，可从评审工具栏切换。</p>',
      ),
    );
  const data = {
    empty: ['尚无数据', '当前范围没有可展示记录。接入网站或调整日期后继续查看。', 'globe'],
    error: ['数据加载失败', '当前无法取得统计结果。重试后恢复原型示例。', 'activity'],
    forbidden: ['当前角色无权访问', '请联系资源所有者调整权限，或切换到可访问的空间。', 'shield'],
  }[state];
  return `<div class="state-box"><span class="state-symbol">${icon(data[2])}</span><h2>${data[0]}</h2><p>${data[1]}</p><div class="actions">${btn(state === 'error' ? '重试' : state === 'empty' ? '恢复示例' : '返回可访问页面', 'restore-state', true)}${state === 'empty' ? link('检查接入', 'install-check') : ''}${link('返回合集', 'index')}</div></div>`;
}
function boundary(id) {
  const d = {
    'access-denied': [
      '403',
      '权限不足',
      '当前身份仅能查看授权网站。此操作需要资源管理员权限。',
      '返回工作台',
      'dashboard',
    ],
    'session-expired': [
      '登录已过期',
      '重新登录',
      '完成登录后返回原型工作台。未保存的编辑需要重新确认。',
      '重新登录',
      'login',
    ],
    'not-found': [
      '404',
      '页面不存在',
      '页面可能已经移动，或当前地址无效。可返回合集选择需要的功能。',
      '返回合集',
      'index',
    ],
  }[id];
  return `<div class="state-box"><span class="state-symbol">${d[0]}</span><h2>${d[1]}</h2><p>${d[2]}</p>${link(d[3], d[4], true)}</div>`;
}
function pageContent() {
  if (current === 'index') return gallery();
  if (!pageById(current)) return boundary('not-found');
  const g = pageById(current).group;
  if (g === 'states') return boundary(current);
  return (
    sitesPage(current) ||
    identityPage(current) ||
    conversionPage(current) ||
    activityPage(current) ||
    audiencePage(current) ||
    advancedPage(current) ||
    workspacePage(current) ||
    extendedPage(current) ||
    boundary('not-found')
  );
}
function captureDrafts() {
  document.querySelectorAll('#main-content form[data-form]').forEach(f => {
    const values = {};
    for (const el of f.elements) {
      if (!el.name || el.type === 'password' || el.name === 'token' || el.type === 'hidden')
        continue;
      if (/^(step-|property-|operator-|filtervalue-|condition-)/.test(el.name)) continue;
      values[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    S.drafts[f.dataset.form] = values;
  });
}
function render() {
  if (renderedPage === current) captureDrafts();
  disposeCharts();
  if (['board-design', 'board-view'].includes(current)) {
    const index = S.selected.board >= 0 ? S.selected.board : 0;
    S.widgets = S.boardLayouts[index] ||= defaultWidgets();
  }
  if (['login', 'login-2fa', 'sso'].includes(current))
    root.innerHTML = '<a class="skip" href="#main-content">跳到主要内容</a>' + authPage(current);
  else if (current === 'share-preview') root.innerHTML = publicPage();
  else {
    const admin = current.startsWith('admin-') && S.role !== 'owner';
    root.innerHTML = shell(
      admin
        ? stateSurface('forbidden')
        : S.state === 'normal'
          ? pageContent()
          : stateSurface(S.state),
    );
  }
  renderedPage = current;
  document.querySelectorAll('#main-content form[data-form]').forEach(f => {
    const d = S.drafts[f.dataset.form];
    if (d)
      for (const [name, value] of Object.entries(d)) {
        const el = f.querySelector(`[name="${name}"]`);
        if (el) {
          if (el.type === 'checkbox') el.checked = value;
          else el.value = value;
        }
      }
  });
  document.title = `${pageById(current)?.title || 'UI 页面合集'} · 猎看统计原型`;
  if (S.role === 'viewer') {
    document.querySelectorAll('[data-mutate]').forEach(el => {
      el.disabled = true;
      el.setAttribute('title', '只读角色无法修改');
    });
    document.querySelectorAll('form[data-form]').forEach(f => {
      if (f.dataset.form === 'filter-apply') return;
      f.querySelectorAll('input,select,textarea,button').forEach(el => (el.disabled = true));
    });
  }
  if (S.configMissing && current === 'security')
    document.querySelectorAll('[data-nav="two-factor"]').forEach(el => {
      el.removeAttribute('data-nav');
      el.removeAttribute('href');
      el.setAttribute('aria-disabled', 'true');
      el.classList.add('sub');
    });
  hydrateCharts(settings());
  document.querySelectorAll('[data-chart="journey"]').forEach(el =>
    window.echarts?.getInstanceByDom(el)?.on('click', params => {
      const paths = journeySample();
      const index = paths.findIndex(path =>
        params.data?.source
          ? path.nodes.some(
              (name, i) => name === params.data.source && path.nodes[i + 1] === params.data.target,
            )
          : path.nodes.includes(params.name),
      );
      S.selected.path = index >= 0 ? index : 0;
      navigate('path-detail');
    }),
  );
}
function navigate(id, push = true) {
  if (id !== 'replay-player') {
    S.playing = false;
    clearInterval(playTimer);
  }
  closeDialog(false);
  if (!pageById(id) && id !== 'index') id = 'not-found';
  current = id;
  S.state = 'normal';
  if (push) history.pushState({}, '', `${id}.html`);
  render();
  window.scrollTo(0, 0);
  document.querySelector('h1')?.setAttribute('tabindex', '-1');
  document.querySelector('h1')?.focus({ preventScroll: true });
}
function toast(text) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), 3500);
}
function closeDialog(focus = true) {
  document.querySelector('.dialog-overlay')?.remove();
  document.body.style.overflow = '';
  if (focus && dialogTrigger?.isConnected) dialogTrigger.focus();
}
function openDrawer(type, index = -1, data = {}) {
  closeDialog(false);
  dialogTrigger = document.activeElement;
  const [title, content] = drawerContent(type, index, data);
  openDialogHTML(title, content);
}
function openDialogHTML(title, content) {
  closeDialog(false);
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `<section class="drawer" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="drawer-head"><h2 id="dialog-title">${title}</h2>${btn(icon('close'), 'close-dialog', false, 'aria-label="关闭弹层"')}</div>${content}</section>`;
  document.body.append(overlay);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() =>
    (
      overlay.querySelector('input:not([readonly]):not([type=hidden]),select,textarea') ||
      overlay.querySelector('button')
    )?.focus(),
  );
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制示例内容');
  } catch {
    openDialogHTML(
      '复制示例内容',
      `<textarea aria-label="可复制的示例内容" readonly>${esc(text)}</textarea><p class="muted">请选择并复制。</p>`,
    );
  }
}
function download(name, content, type = 'text/plain') {
  const blob = new Blob([content], { type }),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('示例文件已生成');
}
function keepEditors() {
  document.querySelectorAll('[data-step]').forEach(el => {
    const i = Number(el.dataset.step);
    if (!S.steps[i]) return;
    S.steps[i].type = el.querySelector('[data-step-type]').value;
    S.steps[i].value = el.querySelector('[data-step-value]').value;
    S.steps[i].filters.forEach((f, j) => {
      f.property = el.querySelector(`[name="property-${i}-${j}"]`)?.value || '';
      f.operator = el.querySelector(`[name="operator-${i}-${j}"]`)?.value || '等于';
      f.value = el.querySelector(`[name="filtervalue-${i}-${j}"]`)?.value || '';
    });
  });
  document.querySelectorAll('[data-condition]').forEach(el => {
    const i = Number(el.dataset.condition);
    S.conditions[i] = {
      field: el.querySelector('select').value,
      op: el.querySelectorAll('select')[1].value,
      value: el.querySelector('input').value,
    };
  });
  const match = document.querySelector('[name="match"]');
  if (match) S.match = match.value;
}
function updateReplay() {
  const el = document.querySelector('#replay-clock');
  if (el) el.textContent = `${clock(S.replayTime)} / ${clock(S.replayTotal)}`;
  const slider = document.querySelector('[data-control="replayTime"]');
  if (slider) slider.value = S.replayTime;
  const cursor = document.querySelector('.replay-cursor');
  if (cursor) {
    cursor.style.left = `${24 + ((S.replayTime * 1.7) % 52)}%`;
    cursor.style.top = `${38 + ((S.replayTime * 0.4) % 38)}%`;
  }
}
function startPlayback() {
  clearInterval(playTimer);
  if (!S.playing) return;
  playTimer = setInterval(() => {
    S.replayTime = Math.min(S.replayTotal, S.replayTime + S.speed);
    updateReplay();
    if (S.replayTime >= S.replayTotal) {
      S.playing = false;
      clearInterval(playTimer);
      if (current === 'replay-player') render();
    }
  }, 1000);
}
function reviewGuide() {
  openDialogHTML(
    '确认范围与设计说明',
    `<div class="stack">${notice('确认后才开始后端融合。当前生产系统仍为 Liekan 0.1.2，访问地址 localhost:3002。', 'amber')}<h3>本轮确认</h3><ol style="padding-left:20px"><li>延续原型的颜色、字号、间距和图表规范。</li><li>页面列表、详情、配置与状态是否完整。</li><li>新增管理导航及页面标签的归属。</li><li>示例指标、筛选与图表的统计口径。</li><li>后续能力的字段和配置方案。</li></ol><h3>上游复用</h3><p class="muted">本轮未修改 Umami 逻辑。后续页面消费 Liekan 合同，由独立适配层连接上游查询、鉴权和权限。兼容路由保持入口，视觉由这些新页面承接。</p><h3>仍需融合确认</h3><p class="muted">真实行为采集与遮蔽、收入币种、完整导出、公开分享范围、队列口径和所有角色权限，需要真实接口与数据验证。</p><a href="DESIGN.md" target="_blank">查看完整设计规范</a></div>`,
  );
}
document.addEventListener('click', async e => {
  const nav = e.target.closest('[data-nav]');
  if (nav && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
    e.preventDefault();
    if (nav.dataset.entity) {
      const form = { site: 'website-save', team: 'team-settings', user: 'admin-user-save' }[
        nav.dataset.entity
      ];
      if (form) delete S.drafts[form];
      renderedPage = null;
    }
    if (nav.dataset.entity === 'site') S.site = S.sites[Number(nav.dataset.index)]?.[0] || S.site;
    else if (nav.dataset.entity) {
      S.selected[nav.dataset.entity] = Number(nav.dataset.index);
      if (nav.dataset.entity === 'replay') {
        const duration = fixtures.sessions[S.selected.replay]?.[6] || '03:24';
        const [minutes, seconds] = duration.split(':').map(Number);
        S.replayTotal = minutes * 60 + seconds;
        S.replayTime = 0;
      }
      if (nav.dataset.entity === 'board') {
        const row = S.boards[S.selected.board];
        S.tab.boardType =
          { 网站: 'website', 链接: 'link', 像素: 'pixel', 混合: 'mixed' }[row?.[1]] || 'website';
        S.tab.boardEntity = row?.[2];
      }
    }
    const editor = {
      'goal-editor': 'goal',
      'segment-editor': 'segment',
      'cohort-editor': 'cohort',
      'board-editor': 'board',
      'link-editor': 'link',
      'pixel-editor': 'pixel',
    }[nav.dataset.nav];
    if (editor) {
      if (!nav.dataset.entity) S.selected[editor] = -1;
      delete S.drafts[
        {
          goal: 'goal-save',
          segment: 'segment-save',
          cohort: 'cohort-save',
          board: 'board-save',
          link: 'link-save',
          pixel: 'pixel-save',
        }[editor]
      ];
    }
    navigate(nav.dataset.nav);
    return;
  }
  const sort = e.target.closest('[data-sort]');
  if (sort) {
    const t = sort.closest('table'),
      i = Number(sort.dataset.sort),
      direction = sort.dataset.direction === 'asc' ? 'desc' : 'asc';
    sort.dataset.direction = direction;
    const rows = [...t.tBodies[0].rows];
    rows.sort((a, b) => {
      const aa = a.cells[i].textContent.trim(),
        bb = b.cells[i].textContent.trim();
      const na = Number(aa.replaceAll(',', '').replace('%', '')),
        nb = Number(bb.replaceAll(',', '').replace('%', ''));
      const result =
        Number.isFinite(na) && Number.isFinite(nb) ? na - nb : aa.localeCompare(bb, 'zh-CN');
      return direction === 'asc' ? result : -result;
    });
    rows.forEach(r => t.tBodies[0].append(r));
    return;
  }
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    keepEditors();
    const name = tab.dataset.tabName,
      value = tab.dataset.tab;
    S.tab[name] = value;
    if (name === 'heatMode') S.heatMode = value;
    render();
    return;
  }
  if (e.target.classList.contains('dialog-overlay')) {
    closeDialog();
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const action = el.dataset.action,
    index = Number(el.dataset.index ?? -1);
  if (action.startsWith('drawer:')) {
    openDrawer(action.split(':')[1], index);
    return;
  }
  if (action === 'close-dialog') {
    closeDialog();
    return;
  }
  if (action === 'back-catalog') {
    navigate('index');
    return;
  }
  if (action === 'mobile-nav') {
    document.querySelector('.sidebar')?.classList.toggle('open');
    document.querySelector('.nav-backdrop')?.classList.toggle('open');
    return;
  }
  if (action === 'close-nav') {
    document.querySelector('.sidebar')?.classList.remove('open');
    document.querySelector('.nav-backdrop')?.classList.remove('open');
    return;
  }
  if (action === 'reset-prototype') {
    installRun++;
    renderedPage = null;
    clearInterval(playTimer);
    clearInterval(exportTimer);
    reset();
    render();
    toast('已重置全部示例');
    return;
  }
  if (action === 'restore-state') {
    S.state = 'normal';
    render();
    toast('已恢复示例');
    return;
  }
  if (action === 'review-guide') {
    reviewGuide();
    return;
  }
  if (action === 'route-map') {
    openDialogHTML(
      '原有 60 条路由覆盖',
      `<p class="muted">${routeMap.length} 个入口，包括别名、重定向与弹层。源码路由保持原样。</p>${table(
        ['原入口', '原型视觉'],
        routeMap.map(r => [
          `<code>${esc(r.route)}</code>`,
          r.target.startsWith('reference/')
            ? `<a href="${r.target}" target="_blank">已确认 UI</a>`
            : `<a data-nav="${r.target.replace('.html', '')}" href="${r.target}">${pageById(r.target.replace('.html', ''))?.title || '工作台'}</a>`,
        ]),
        'routes',
      )}`,
    );
    return;
  }
  if (action === 'toggle-password') {
    const input = el.parentElement.querySelector('input');
    input.type = input.type === 'password' ? 'text' : 'password';
    el.setAttribute('aria-label', input.type === 'password' ? '显示密码' : '隐藏密码');
    return;
  }
  if (action === 'onboard-back') {
    S.onboardStep = Math.max(1, S.onboardStep - 1);
    render();
    return;
  }
  if (action === 'onboard-next') {
    S.onboardStep = Math.min(3, S.onboardStep + 1);
    render();
    return;
  }
  if (action === 'simulate-install') {
    const run = ++installRun,
      domain = S.onboardDomain,
      name = S.site;
    S.install = 0;
    render();
    for (let i = 1; i <= 3; i++) {
      await new Promise(r => setTimeout(r, 450));
      if (run !== installRun) return;
      S.install = i;
      if (i === 3) {
        const row =
          current === 'onboarding'
            ? S.sites.find(r => r[1] === domain)
            : S.sites.find(r => r[0] === name);
        if (row) {
          row[3] = '已接入';
          row[4] = row[4] === '0' ? '1' : row[4];
          row[5] = '09:43';
        }
      }
      if (['onboarding', 'install-check'].includes(current)) render();
    }
    toast('示例接入验证完成');
    return;
  }
  if (action.startsWith('copy:')) {
    const texts = {
      tracker: document.querySelector('.code-block')?.textContent || '',
      pixel: document.querySelector('.code-block')?.textContent || '',
      team: S.tab.teamCode || 'DEMO-GEO-TEAM',
      '2fa': 'DEMO KEY · 不可绑定',
      key: el.dataset.value || '',
    };
    await copy(texts[action.split(':')[1]]);
    return;
  }
  if (action === 'sso-success') {
    navigate('dashboard');
    toast('已模拟 SSO 验证成功');
    return;
  }
  if (action === 'sso-fail') {
    openDialogHTML(
      '单点登录失败',
      `${notice('无法验证登录回调，可能已过期。请返回登录页重新发起。', 'red')}${link('返回登录', 'login')}`,
    );
    return;
  }
  if (action === 'finish-2fa') {
    navigate('security');
    toast('示例双重验证设置已完成');
    return;
  }
  if (action === 'condition-add' || action === 'condition-remove' || action === 'condition-reset') {
    keepEditors();
    if (action === 'condition-add') S.conditions.push({ field: '设备', op: '等于', value: '桌面' });
    if (action === 'condition-remove') S.conditions.splice(index, 1);
    if (action === 'condition-reset') S.conditions = [];
    render();
    return;
  }
  if (action === 'preview-match') {
    keepEditors();
    document.querySelector('#match-preview').textContent =
      `示例预览：${S.match === 'all' ? '1,286' : '3,147'} 位访客 · ${S.conditions.length} 个条件`;
    return;
  }
  if (action.startsWith('step-')) {
    if (S.role === 'viewer') {
      toast('只读角色无法修改漏斗');
      return;
    }
    keepEditors();
    if (action === 'step-add' && S.steps.length < 8)
      S.steps.push({ type: 'path', value: '', filters: [] });
    if (action === 'step-remove' && S.steps.length > 2) S.steps.splice(index, 1);
    if (action === 'step-up' && index > 0)
      [S.steps[index - 1], S.steps[index]] = [S.steps[index], S.steps[index - 1]];
    if (action === 'step-down' && index < S.steps.length - 1)
      [S.steps[index + 1], S.steps[index]] = [S.steps[index], S.steps[index + 1]];
    if (action === 'step-filter-add')
      S.steps[index].filters.push({ property: '', operator: '等于', value: '' });
    if (action === 'step-filter-remove')
      S.steps[index].filters.splice(Number(el.dataset.filter), 1);
    render();
    return;
  }
  if (action === 'retention-cell') {
    openDrawer('retention-cell', -1, el.dataset);
    return;
  }
  if (action === 'journey-apply') {
    S.tab.journeyType = document.querySelector('[name="journeyType"]').value;
    S.tab.journeySteps = document.querySelector('[name="journeySteps"]').value;
    S.tab.journeyStart = document.querySelector('[name="journeyStart"]').value.trim();
    S.tab.journeyEnd = document.querySelector('[name="journeyEnd"]').value.trim();
    render();
    toast('已应用示例路径条件');
    return;
  }
  if (action === 'attribution-apply') {
    S.tab.model = document.querySelector('[name="model"]').value;
    render();
    toast('已切换示例归因模型');
    return;
  }
  if (action === 'refresh-sample') {
    toast('示例数据已刷新，真实自动更新将在融合后接入');
    return;
  }
  if (action === 'regenerate-team-code') {
    S.tab.teamCode = 'DEMO-GEO-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    render();
    toast('已重新生成示例访问码');
    return;
  }
  if (action === 'save-team-policy' || action === 'save-system-policy') {
    toast('示例安全策略已保存');
    return;
  }
  if (action === 'share-toggle') {
    S.shares[index][4] = S.shares[index][4] === '启用' ? '停用' : '启用';
    render();
    toast('已更新示例分享状态');
    return;
  }
  if (action.startsWith('widget-')) {
    if (action === 'widget-up' && index > 0)
      [S.widgets[index - 1], S.widgets[index]] = [S.widgets[index], S.widgets[index - 1]];
    if (action === 'widget-width') S.widgets[index].full = !S.widgets[index].full;
    if (action === 'widget-remove') S.widgets.splice(index, 1);
    render();
    return;
  }
  if (action === 'save-board-design') {
    navigate('board-view');
    toast('看板编排已保存到原型');
    return;
  }
  if (action === 'dashboard-up' && index > 0) {
    [S.dashboardSites[index - 1], S.dashboardSites[index]] = [
      S.dashboardSites[index],
      S.dashboardSites[index - 1],
    ];
    render();
    return;
  }
  if (action === 'replay-toggle') {
    if (S.replayTime >= S.replayTotal) S.replayTime = 0;
    S.playing = !S.playing;
    render();
    startPlayback();
    return;
  }
  if (action === 'replay-seek') {
    S.replayTime = Number(el.dataset.time);
    updateReplay();
    return;
  }
  if (action === 'generate-slug') {
    const slug = 'geo-' + Math.random().toString(36).slice(2, 8);
    document.querySelector('[name="slug"]').value = slug;
    document.querySelector('[name="preview"]').value = 'https://go.liekan.example/' + slug;
    return;
  }
  if (action === 'select-site') {
    delete S.drafts['website-save'];
    renderedPage = null;
    S.site = el.dataset.site;
    closeDialog(false);
    render();
    toast('已切换示例网站');
    return;
  }
  if (action === 'export-cancel') {
    clearInterval(exportTimer);
    S.exportStatus = 'idle';
    render();
    toast('示例任务已取消');
    return;
  }
  if (action === 'download:backup') {
    download(
      'liekan-backup-codes-demo.txt',
      'Liekan UI prototype: invalid demo recovery codes\n' +
        Array.from({ length: 8 }, (_, i) => `DEMO-${String(i + 1).padStart(2, '0')}-SAMPLE`).join(
          '\n',
        ),
    );
    return;
  }
  if (action === 'download:export') {
    downloadExport();
    return;
  }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.matches('[data-step-type]')) {
    keepEditors();
    render();
    return;
  }
  if (el.dataset.control) {
    const c = el.dataset.control;
    if (c === 'backupSaved') {
      document.querySelector('#finish-2fa').disabled = !el.checked;
      return;
    }
    if (c === 'replayTime') {
      S.replayTime = Number(el.value);
      updateReplay();
      return;
    }
    if (c === 'speed') {
      S.speed = Number(el.value);
      return;
    }
    S[c] = el.type === 'checkbox' ? el.checked : el.value;
    render();
    return;
  }
  if (el.name === 'match') {
    S.match = el.value;
    return;
  }
  if (el.name === 'boardType') {
    S.tab.boardType = el.value;
    const entity = document.querySelector('[name="entity"]');
    if (!entity) {
      render();
      return;
    }
    if (el.value === 'mixed') {
      entity.disabled = true;
      entity.closest('.field').hidden = true;
    } else {
      entity.disabled = false;
      entity.closest('.field').hidden = false;
      const list =
        el.value === 'link'
          ? S.links.map(r => r[0])
          : el.value === 'pixel'
            ? S.pixels.map(r => r[0])
            : S.sites.map(r => r[0]);
      entity.innerHTML = list.map(v => `<option>${esc(v)}</option>`).join('');
    }
    return;
  }
  if (el.dataset.chartControl !== undefined) {
    S.tab[el.name] = el.value;
    render();
  }
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'catalog-search') {
    const value = el.value.toLowerCase();
    document
      .querySelectorAll('[data-catalog-search]')
      .forEach(a => (a.hidden = !a.dataset.catalogSearch.toLowerCase().includes(value)));
    document
      .querySelectorAll('[data-catalog-group]')
      .forEach(
        g => (g.hidden = ![...g.querySelectorAll('[data-catalog-search]')].some(a => !a.hidden)),
      );
    return;
  }
  if (el.matches('[data-search]')) {
    const panel = el.closest('.panel'),
      q = el.value.toLowerCase();
    let count = 0;
    panel.querySelectorAll('tbody tr').forEach(row => {
      row.hidden = !row.textContent.toLowerCase().includes(q);
      if (!row.hidden) count++;
    });
    panel.querySelector('[data-count]').textContent = `${count} 条匹配的示例记录`;
    return;
  }
  if (el.dataset.control === 'replayTime') {
    S.replayTime = Number(el.value);
    updateReplay();
  }
  if (el.name === 'slug') {
    const prev = document.querySelector('[name="preview"]');
    if (prev) prev.value = 'https://go.liekan.example/' + el.value;
  }
  if (el.closest('.field')) {
    el.closest('.field').classList.remove('invalid');
    const error = el.closest('.field').querySelector('.field-error');
    if (error) error.textContent = '';
  }
});
function showError(f, name, message) {
  const el = f.querySelector(`[name="${name}"]`);
  el?.closest('.field')?.classList.add('invalid');
  const error = f.querySelector(`[data-error-for="${name}"]`);
  if (error) error.textContent = message;
  else f.querySelector('[data-form-error]').textContent = message;
  el?.focus();
  return false;
}
document.addEventListener('submit', e => {
  const f = e.target;
  if (!f.dataset.form) return;
  e.preventDefault();
  if (
    S.role === 'viewer' &&
    !['login', 'verify-login', 'enable-2fa', 'filter-apply'].includes(f.dataset.form)
  ) {
    toast('只读角色无法修改');
    return;
  }
  f.querySelectorAll('.field-error').forEach(el => (el.textContent = ''));
  f.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));
  const d = Object.fromEntries(new FormData(f)),
    a = f.dataset.form;
  for (const el of f.querySelectorAll('[required]')) {
    if (!el.value.trim()) return showError(f, el.name, '请填写此字段');
    if (
      el.type === 'number' &&
      (Number(el.value) < Number(el.min || 0) || Number(el.value) > Number(el.max || Infinity))
    )
      return showError(f, el.name, '请输入允许范围内的数值');
  }
  if (d.domain && !/^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/i.test(d.domain))
    return showError(f, 'domain', '请输入有效域名，例如 yishan.example');
  if (d.url && !/^https?:\/\//i.test(d.url))
    return showError(f, 'url', '请输入完整的 http:// 或 https:// 地址');
  if (d.start && d.end && d.start > d.end) return showError(f, 'end', '结束日期不能早于开始日期');
  if (d.confirmation && d.confirmation !== d.expected)
    return showError(f, 'confirmation', '确认内容与要求不一致');
  if (a === 'login') {
    if (d.username !== 'admin' || d.password !== 'liekan')
      return showError(f, 'password', '示例用户名或密码不匹配，请使用 admin / liekan');
    S.twoFactor = d.login2fa === 'on';
    navigate(S.twoFactor ? 'login-2fa' : 'dashboard');
    return;
  }
  if (a === 'verify-login') {
    if (!['123456', 'DEMO-01'].includes(d.token))
      return showError(f, 'token', '示例验证码不匹配，请检查输入');
    navigate('dashboard');
    toast('已通过示例登录验证');
    return;
  }
  if (a === 'onboard-info') {
    S.onboardName = d.name;
    S.onboardDomain = d.domain;
    if (!S.sites.some(r => r[1] === d.domain))
      S.sites.push([d.name, d.domain, d.space, '待验证', '0', '尚未接收']);
    S.onboardStep = 2;
    render();
    return;
  }
  if (a === 'website-save') {
    const row = S.sites.find(r => r[0] === S.site) || S.sites[0];
    if (row) {
      row[0] = d.name;
      row[1] = d.domain;
    }
    S.site = d.name;
    render();
    toast('网站信息已保存到原型');
    return;
  }
  if (a === 'enable-2fa') {
    if (d.token !== '123456') return showError(f, 'token', '请输入演示验证码 123456');
    S.twoFactor = true;
    navigate('backup-codes');
    return;
  }
  if (a === 'password-save') {
    if (d.currentPassword !== 'liekan')
      return showError(f, 'currentPassword', '演示当前密码为 liekan');
    if (d.newPassword.length < 6) return showError(f, 'newPassword', '新密码至少 6 位');
    if (d.newPassword !== d.confirmPassword)
      return showError(f, 'confirmPassword', '两次输入的新密码不一致');
    closeDialog();
    toast('示例密码修改流程已完成，生产密码保持原样');
    return;
  }
  if (a === 'disable-2fa') {
    if (S.required || S.teamRequired)
      return showError(f, 'currentPassword', '系统或团队要求启用双重验证');
    if (d.currentPassword !== 'liekan')
      return showError(f, 'currentPassword', '演示当前密码为 liekan');
    S.twoFactor = false;
    closeDialog(false);
    render();
    toast('已关闭示例双重验证');
    return;
  }
  if (a === 'username-save') {
    S.username = d.username;
    closeDialog(false);
    render();
    toast('用户名已保存到原型');
    return;
  }
  if (a === 'key-create') {
    const key = 'demo_key_not_valid_' + Math.random().toString(36).slice(2, 10);
    S.keys.push([d.name, 'demo_key_••••' + key.slice(-4), '2026-09-30', '尚未使用']);
    closeDialog(false);
    render();
    openDialogHTML(
      '示例密钥已创建',
      `${notice('完整值仅展示这一次。此示例密钥无法调用生产接口。', 'amber')}<pre class="code-block">${esc(key)}</pre>${btn('复制示例密钥', 'copy:key', true, `data-value="${key}"`)}<div class="form-actions">${btn('我已保存，关闭', 'close-dialog')}</div>`,
    );
    return;
  }
  if (a === 'key-revoke') {
    S.keys.splice(Number(d.index), 1);
    closeDialog(false);
    render();
    toast('示例密钥已撤销');
    return;
  }
  if (a === 'goal-save') {
    const row = [
      d.name,
      (d.goalType === 'path' ? '页面' : '事件') + ' · ' + d.value,
      '0',
      '暂无转化',
      d.description || '',
    ];
    if (S.selected.goal >= 0) S.goals[S.selected.goal] = row;
    else S.goals.push(row);
    delete S.drafts['goal-save'];
    navigate('goals');
    toast('目标已保存到原型');
    return;
  }
  if (a === 'funnel-save') {
    keepEditors();
    if (S.steps.length < 2) return showError(f, 'name', '至少需要两个步骤');
    if (S.steps.some(s => !s.value.trim())) return showError(f, 'name', '请填写每一步的路径或事件');
    S.tab.funnelName = d.name;
    S.funnelWindow = Number(d.window);
    delete S.drafts['funnel-save'];
    navigate('funnels');
    toast('漏斗配置已保存到原型');
    return;
  }
  if (a === 'filter-apply') {
    keepEditors();
    navigate('sessions');
    toast('已应用示例筛选条件');
    return;
  }
  if (a === 'segment-save') {
    keepEditors();
    const row = [
      d.name,
      S.conditions.map(c => c.field + c.op + c.value).join(S.match === 'all' ? ' 且 ' : ' 或 '),
      '1,286',
      '10.60%',
    ];
    if (S.selected.segment >= 0) S.segments[S.selected.segment] = row;
    else S.segments.push(row);
    delete S.drafts['segment-save'];
    navigate('segments');
    toast('分群已保存到原型');
    return;
  }
  if (a === 'cohort-save') {
    keepEditors();
    const row = [d.name, d.actionValue + ' · ' + d.dateRange, '438', '2026-09-30'];
    if (S.selected.cohort >= 0) S.cohorts[S.selected.cohort] = row;
    else S.cohorts.push(row);
    delete S.drafts['cohort-save'];
    navigate('cohorts');
    toast('队列已保存到原型');
    return;
  }
  if (a === 'admin-user-save') {
    const row = S.adminUsers[S.selected.user];
    if (d.password && d.password.length < 6) return showError(f, 'password', '密码至少 6 位');
    const own = row[0] === S.username;
    row[0] = d.username;
    if (!own) row[1] = d.role;
    if (own) S.username = d.username;
    delete S.drafts[a];
    navigate('admin-users');
    toast('已保存示例用户资料');
    return;
  }
  if (a === 'team-settings') {
    const team = S.teams[S.selected.team];
    const oldName = team[0];
    team[0] = d.name;
    S.sites.forEach(site => {
      if (site[2] === oldName) site[2] = d.name;
    });
    delete S.drafts[a];
    navigate('teams');
    toast('已保存示例团队设置');
    return;
  }
  if (a === 'join-team') {
    if (d.accessCode !== (S.tab.teamCode || 'DEMO-GEO-TEAM'))
      return showError(f, 'accessCode', '访问码不匹配，演示使用 DEMO-GEO-TEAM');
    navigate('team-detail');
    toast('已模拟加入团队，角色为成员');
    return;
  }
  if (a === 'member-add') {
    S.members.push([d.username, d.username, d.role, '未启用', '2026-09-30']);
    closeDialog(false);
    render();
    toast('已添加示例成员');
    return;
  }
  if (a === 'member-save') {
    S.members[Number(d.index)][2] = d.role;
    closeDialog(false);
    render();
    toast('已保存示例角色');
    return;
  }
  if (a === 'member-remove') {
    S.members.splice(Number(d.index), 1);
    closeDialog(false);
    render();
    toast('已移除示例成员');
    return;
  }
  if (a === 'site-transfer') {
    const row = S.sites.find(r => r[0] === S.site);
    if (row) row[2] = d.team;
    closeDialog(false);
    render();
    toast('已转移示例网站');
    return;
  }
  if (a === 'site-delete') {
    S.sites = S.sites.filter(r => r[0] !== S.site);
    S.site = S.sites[0]?.[0] || '没有网站';
    navigate('websites');
    toast('已删除示例网站');
    return;
  }
  if (a === 'site-reset') {
    const row = S.sites.find(r => r[0] === S.site);
    if (row) row[4] = '0';
    closeDialog(false);
    render();
    toast('示例网站访问计数已重置');
    return;
  }
  if (a === 'date-range') {
    S.range = d.start + ' 至 ' + d.end;
    closeDialog(false);
    render();
    toast('已更新示例日期范围');
    return;
  }
  if (a === 'compare-range') {
    S.tab.compareRange = d.start + ' 至 ' + d.end;
    closeDialog(false);
    render();
    return;
  }
  if (a === 'dimensions-save') {
    S.tab.breakdownExtra = d.browser ? '浏览器' : d.device ? '设备' : d.referrer ? '来源' : '';
    closeDialog(false);
    render();
    return;
  }
  if (a === 'annotation-save') {
    if (!d.note?.trim()) return showError(f, 'date', '请填写注释内容');
    if (d.note.length > 1000) return showError(f, 'date', '注释不能超过 1000 字');
    if (Number(d.index) >= 0) S.annotations[Number(d.index)] = [d.date, d.note];
    else S.annotations.push([d.date, d.note]);
    closeDialog(false);
    render();
    toast('已保存示例注释');
    return;
  }
  if (a === 'widget-add') {
    S.widgets.push({ type: d.type, title: d.title, full: d.full === 'on' });
    closeDialog(false);
    render();
    toast('组件已加入示例看板');
    return;
  }
  if (a === 'board-save') {
    const resources =
      d.boardType === 'link' ? S.links : d.boardType === 'pixel' ? S.pixels : S.sites;
    if (d.boardType !== 'mixed' && !resources.some(r => r[0] === d.entity))
      return showError(f, 'entity', '请选择与看板类型一致的资源');
    S.tab.boardType = d.boardType;
    S.tab.boardEntity = d.entity;
    const row = [
      d.name,
      { website: '网站', pixel: '像素', link: '链接', mixed: '混合' }[d.boardType],
      d.entity || '多个资源',
      '2026-09-30',
    ];
    if (S.selected.board >= 0) S.boards[S.selected.board] = row;
    else {
      S.boards.push(row);
      S.selected.board = S.boards.length - 1;
    }
    navigate('board-design');
    toast('已保存示例看板信息');
    return;
  }
  if (a === 'dashboard-save') {
    const checked = S.sites.filter((r, i) => d['dashboard-' + i] === 'on').map(r => r[0]);
    S.dashboardSites = [
      ...S.dashboardSites.filter(name => checked.includes(name)),
      ...checked.filter(name => !S.dashboardSites.includes(name)),
    ];
    navigate('dashboard');
    toast('已保存示例工作台');
    return;
  }
  if (a === 'share-save') {
    const range =
      ['overview', 'events', 'utm', 'goals']
        .filter(k => d[k] === 'on')
        .map(k => ({ overview: '总览', events: '事件', utm: 'UTM', goals: '目标与漏斗' })[k])
        .join('、') || '资源统计';
    const row = [
      d.name,
      d.resource,
      range,
      d.allowFilter === 'on' ? '允许' : '禁止',
      Number(d.index) >= 0 ? S.shares[Number(d.index)][4] : '启用',
    ];
    if (Number(d.index) >= 0) S.shares[Number(d.index)] = row;
    else S.shares.push(row);
    closeDialog(false);
    render();
    toast('已保存示例分享');
    return;
  }
  if (a === 'replay-save') {
    S.savedReplay = true;
    S.savedReplayRecord = S.selected.replay;
    S.savedReplayName = d.name;
    closeDialog(false);
    render();
    toast('录制已保存到示例列表');
    return;
  }
  if (a === 'link-save') {
    try {
      new URL(d.url);
    } catch {
      return showError(f, 'url', '请输入有效 URL');
    }
    if (!/^[a-z0-9_-]+$/i.test(d.slug))
      return showError(f, 'slug', '使用字母、数字、短横线或下划线');
    const row = [d.name, d.url, d.slug, S.selected.link >= 0 ? S.links[S.selected.link][3] : '0'];
    if (S.selected.link >= 0) S.links[S.selected.link] = row;
    else S.links.push(row);
    navigate('links');
    toast('示例链接已保存');
    return;
  }
  if (a === 'pixel-save') {
    if (S.selected.pixel >= 0) S.pixels[S.selected.pixel][0] = d.name;
    else S.pixels.push([d.name, 'demo-pixel-' + S.pixels.length, '0']);
    navigate('pixels');
    toast('示例像素已保存');
    return;
  }
  if (a === 'user-create') {
    if (d.password.length < 6) return showError(f, 'password', '密码至少 6 位');
    closeDialog();
    toast('创建用户表单已验证，未创建生产账户');
    return;
  }
  if (a === 'export-create') {
    if (!['summary', 'dimensions', 'events', 'sessions', 'config'].some(k => d[k] === 'on'))
      return showError(f, 'website', '请至少选择一种数据');
    clearInterval(exportTimer);
    S.exportConfig = d;
    S.exportStatus = 'working';
    S.exportProgress = 0;
    render();
    exportTimer = setInterval(() => {
      S.exportProgress = Math.min(100, S.exportProgress + 25);
      if (S.exportProgress === 100) {
        clearInterval(exportTimer);
        S.exportStatus = 'done';
      }
      if (current === 'exports') {
        const task = document.querySelector('#export-task');
        if (task) task.innerHTML = exportTask();
      }
    }, 400);
    return;
  }
  closeDialog(false);
  render();
  toast('已完成示例操作，生产配置保持原样');
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeDialog();
    document.querySelector('.sidebar')?.classList.remove('open');
    document.querySelector('.nav-backdrop')?.classList.remove('open');
  }
  const dialog = document.querySelector('[role="dialog"]');
  if (dialog && e.key === 'Tab') {
    const els = [
      ...dialog.querySelectorAll(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea',
      ),
    ].filter(el => el.getClientRects().length);
    if (!els.length) return;
    const first = els[0],
      last = els.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});
window.addEventListener('popstate', () => {
  S.playing = false;
  clearInterval(playTimer);
  closeDialog(false);
  current = location.pathname.split('/').pop().replace('.html', '') || 'index';
  render();
});
window.addEventListener('resize', resizeCharts);
function downloadExport() {
  const f = S.exportConfig || {},
    summary = 'demo,website,visitors,views,events\ntrue,Liekan sample,12131,28416,3595\n',
    data = {
      demo: true,
      product: 'Liekan',
      range: [f.start, f.end],
      containsProductionData: false,
      selected: Object.keys(f).filter(k => f[k] === 'on'),
      summary: { visitors: 12131, views: 28416, events: 3595 },
    };
  if (f.format === 'csv') download('liekan-export-demo.csv', '\ufeff' + summary, 'text/csv');
  else if (f.format === 'json')
    download('liekan-export-demo.json', JSON.stringify(data, null, 2), 'application/json');
  else {
    const files = { 'manifest-demo.json': JSON.stringify(data, null, 2) };
    if (f.summary) files['summary-demo.csv'] = summary;
    if (f.dimensions) files['dimensions-demo.csv'] = 'demo,path,views\ntrue,/guide/geo,4168\n';
    if (f.events) files['events-demo.csv'] = 'demo,event,count\ntrue,demo_submit,386\n';
    if (f.sessions)
      files['sessions-demo.csv'] = 'demo,masked_visitor,device\ntrue,visitor-8f3c,desktop\n';
    if (f.config)
      files['config-demo.json'] = JSON.stringify({ demo: true, goals: S.goals.map(r => r[0]) });
    download('liekan-export-demo.zip', zip(files), 'application/zip');
  }
}
function zip(files) {
  const enc = new TextEncoder(),
    chunks = [],
    central = [];
  let offset = 0;
  const u16 = (v, n) => v.setUint16(n, 0, true),
    crc32 = bytes => {
      let crc = -1;
      for (const b of bytes) {
        crc ^= b;
        for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
      return (crc ^ -1) >>> 0;
    };
  for (const [name, content] of Object.entries(files)) {
    const n = enc.encode(name),
      d = enc.encode(content),
      crc = crc32(d),
      h = new Uint8Array(30 + n.length),
      v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, d.length, true);
    v.setUint32(22, d.length, true);
    v.setUint16(26, n.length, true);
    h.set(n, 30);
    chunks.push(h, d);
    const c = new Uint8Array(46 + n.length),
      cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, d.length, true);
    cv.setUint32(24, d.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, offset, true);
    c.set(n, 46);
    central.push(c);
    offset += h.length + d.length;
  }
  const centralLength = central.reduce((a, b) => a + b.length, 0),
    end = new Uint8Array(22),
    v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, central.length, true);
  v.setUint16(10, central.length, true);
  v.setUint32(12, centralLength, true);
  v.setUint32(16, offset, true);
  const total = offset + centralLength + 22,
    out = new Uint8Array(total);
  let pos = 0;
  for (const ch of [...chunks, ...central, end]) {
    out.set(ch, pos);
    pos += ch.length;
  }
  return out;
}
render();
