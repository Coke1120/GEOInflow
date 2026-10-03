import { fixtures } from './catalog.js';
import {
  S,
  esc,
  icon,
  btn,
  link,
  badge,
  panel,
  body,
  metrics,
  chart,
  table,
  notice,
  field,
  select,
  textarea,
  check,
  switchRow,
  definition,
  tabs,
  searchPanel,
  form,
  actionCell,
} from './components.js';
export function workspacePage(id) {
  const teamIndex = S.selected.team >= 0 ? S.selected.team : 0;
  const team = S.teams[teamIndex] || S.teams[0];
  const user = S.adminUsers[S.selected.user] || S.adminUsers[2];
  if (id === 'team-detail') S.members = S.teamMembers[teamIndex];
  if (id === 'teams')
    return (
      metrics([
        ['参与团队', '2', '当前账户'],
        [
          '团队网站',
          String(S.sites.filter(site => S.teams.some(team => team[0] === site[2])).length),
          '管理和只读权限分开',
        ],
        ['团队成员', '7', '示例成员'],
        ['安全策略', '按团队设置', '沿用双重验证要求'],
      ]) +
      searchPanel(
        '我的团队',
        '所有者管理团队，管理员管理资源与成员。',
        ['团队', '我的角色', '成员', '网站', '操作'],
        S.teams.map((r, i) => [
          esc(r[0]),
          badge(r[4], r[4] === '所有者' ? 'blue' : 'gray'),
          String(S.teamMembers[i]?.length || 0),
          String(S.sites.filter(site => site[2] === r[0]).length),
          actionCell(r[4] === '所有者' ? '管理' : '查看', 'team-detail', 'team', i),
        ]),
        link('通过访问码加入', 'team-join') +
          btn(icon('plus') + '创建团队', 'drawer:create-team', true, 'data-mutate'),
        'teams',
        [2, 3],
      )
    );
  if (id === 'team-detail') {
    const tab = S.tab.team || 'members';
    const b =
      tab === 'members'
        ? searchPanel(
            '团队成员',
            '所有者、管理员、成员与只读角色分别保留。',
            ['成员', '用户名', '角色', '双重验证', '加入时间', '操作'],
            S.members.map((r, i) => [
              esc(r[0]),
              esc(r[1]),
              badge(r[2], r[2] === '所有者' ? 'blue' : 'gray'),
              badge(r[3], r[3] === '已启用' ? 'green' : 'amber'),
              r[4],
              i === 0
                ? '<span class="muted">所有者</span>'
                : btn('编辑角色', 'drawer:member', false, `data-index="${i}" data-mutate`),
            ]),
            btn('添加已有用户', 'drawer:add-member', true, 'data-mutate'),
            'members',
          )
        : tab === 'resources'
          ? searchPanel(
              '团队资源',
              '网站转移保留历史访问数据。',
              ['网站', '域名', '状态', '操作'],
              S.sites
                .filter(r => r[2] === team[0])
                .map(r => [
                  esc(r[0]),
                  esc(r[1]),
                  badge(r[3], r[3] === '已接入' ? 'green' : 'amber'),
                  actionCell('设置', 'website-settings', 'site', S.sites.indexOf(r)),
                ]),
              link('添加网站', 'onboarding', true),
              'teamSites',
            )
          : tab === 'security'
            ? panel(
                '团队双重验证',
                '要求所有团队成员开启验证，覆盖个人自主设置。',
                body(
                  `${switchRow('要求团队成员启用双重验证', '开启后未配置的成员需要完成绑定。', 'teamRequired', S.teamRequired, 'data-control="teamRequired" data-mutate')}${notice(S.teamRequired ? '团队已要求双重验证，成员无法自行关闭。' : '成员当前可自主启用双重验证。', S.teamRequired ? 'amber' : '')}<div class="form-actions">${btn('保存团队策略', 'save-team-policy', true, 'data-mutate')}</div>`,
                ),
              )
            : panel(
                '团队设置',
                '访问码用于已登录用户加入团队。',
                body(
                  form(
                    'team-settings',
                    `${field('团队名称', 'name', team[0], 'text', '', true)}${field('团队 ID', 'teamId', 'demo-team-' + teamIndex, 'text', '', false, 'readonly')}<div class="row">${field('团队访问码', 'accessCode', S.tab.teamCode || 'DEMO-GEO-TEAM', 'text', '原型访问码无法加入实际团队。', false, 'readonly')}${btn('复制访问码', 'copy:team')}${btn('重新生成', 'regenerate-team-code', false, 'data-mutate')}</div>${notice('新访问码生成后旧码失效。添加成员还支持选择本系统的已有用户。', 'amber')}<hr class="divider"><div class="row">${btn('退出团队', 'drawer:leave-team', false, 'disabled title="所有者需先转移所有权"')}${btn('删除团队', 'drawer:delete-team', false, 'data-mutate')}</div>`,
                    '保存团队设置',
                  ),
                ),
              );
    return `<div class="row between"><div><h2>${esc(team[0])}</h2><p class="muted">增长运营与内容分析 · ${esc(team[4])}</p></div>${link('返回团队列表', 'teams')}</div>${tabs(
      [
        ['members', '成员'],
        ['resources', '资源'],
        ['security', '安全'],
        ['settings', '设置'],
      ],
      tab,
      'team',
    )}${b}`;
  }
  if (id === 'team-join')
    return `<div class="wide-narrow">${panel('通过访问码加入', '向团队管理者获取访问码。', body(form('join-team', `${field('访问码', 'accessCode', '', 'text', '演示使用 DEMO-GEO-TEAM。', true)}${notice('加入使用已有登录账户。成功后显示团队名称与分配角色。')}`, '验证并加入', 'teams')))}${panel(
      '角色说明',
      '权限来自团队管理者的角色设置。',
      body(
        `${definition([
          ['管理员', '管理资源与成员'],
          ['成员', '查看分析并管理授权资源'],
          ['只读', '查看分析，无法修改配置'],
        ])}<hr class="divider"><p class="muted">原型仅演示访问码校验，加入真实团队需要后端确认。</p>`,
      ),
    )}</div>`;
  if (id === 'admin-users')
    return (
      searchPanel(
        '系统用户',
        '创建、查看角色和管理双重验证。',
        ['用户名', '系统角色', '团队', '双重验证', '状态', '操作'],
        S.adminUsers.map((r, i) => [
          esc(r[0]),
          badge(r[1], r[1] === '管理员' ? 'blue' : 'gray'),
          r[2],
          badge(r[3], r[3] === '已启用' ? 'green' : 'amber'),
          badge(r[4], 'green'),
          actionCell('查看', 'admin-user', 'user', i),
        ]),
        btn(icon('plus') + '创建用户', 'drawer:create-user', true, 'data-mutate'),
        'adminUsers',
        [2],
      ) + notice('系统角色与团队角色独立。编辑当前管理员时，禁止修改自己的系统角色。')
    );
  if (id === 'admin-user')
    return (
      `<div class="row between"><h2>用户 · ${esc(user[0])}</h2>${link('返回用户管理', 'admin-users')}</div><div class="two">${panel('账户信息', '管理员可修改用户资料，密码留空表示保留。', body(form('admin-user-save', `${field('用户名', 'username', user[0], 'text', '', true)}${field('新密码（可选）', 'password', '', 'password', '留空保留当前密码，修改需至少 6 位。')}${select('系统角色', 'role', ['管理员', '用户', '只读'], user[1], user[0] === S.username ? 'disabled title="当前账户的系统角色保持原样"' : '')}`, '保存用户')))}${panel(
        '账户安全',
        '重置双重验证后，用户需要重新绑定。',
        body(
          `${definition([
            ['双重验证', badge(user[3], user[3] === '已启用' ? 'green' : 'amber')],
            ['团队要求', '自主选择'],
            ['账户状态', badge('正常', 'green')],
          ])}<div class="form-actions">${btn('重置双重验证', 'drawer:reset-user-2fa', false, 'data-mutate')}${btn('删除用户', 'drawer:delete-user', false, `data-mutate ${user[0] === S.username ? 'disabled title="保留当前管理员账户"' : ''}`)}</div>`,
        ),
      )}</div>` +
      panel(
        '用户资源',
        '管理员查看该账户的网站和团队。',
        table(
          ['类型', '资源名称', '角色', '操作'],
          [
            ['团队', '移山增长团队', '成员', actionCell('查看', 'team-detail')],
            [
              '网站',
              '猎看产品文档',
              '所有者',
              actionCell(
                '查看',
                'website-settings',
                'site',
                S.sites.findIndex(r => r[0] === '猎看产品文档'),
              ),
            ],
          ],
          'userResources',
        ),
      )
    );
  if (id === 'admin-websites')
    return searchPanel(
      '全局网站',
      '系统管理员检索资源及所属账户、团队。',
      ['网站', '域名', '所属空间', '所有者', '操作'],
      S.sites.map((r, i) => [
        esc(r[0]),
        esc(r[1]),
        esc(r[2]),
        'admin',
        actionCell('设置', 'website-settings', 'site', i),
      ]),
      btn('按空间筛选', 'drawer:admin-filter'),
      'adminSites',
    );
  if (id === 'admin-teams')
    return searchPanel(
      '全局团队',
      '系统管理员管理团队与所有者。',
      ['团队', '所有者', '成员', '网站', '操作'],
      S.teams.map((r, i) => [
        esc(r[0]),
        esc(r[1]),
        String(S.teamMembers[i]?.length || 0),
        String(S.sites.filter(site => site[2] === r[0]).length),
        actionCell('管理', 'team-detail', 'team', i),
      ]),
      btn(icon('plus') + '创建团队', 'drawer:create-team', true, 'data-mutate'),
      'adminTeams',
      [2, 3],
    );
  if (id === 'admin-security')
    return `<div class="wide-narrow">${panel('系统双重验证策略', '全局要求覆盖个人与团队的自主设置。', body(`${switchRow('所有用户必须启用双重验证', '下次登录时引导尚未绑定的用户完成设置。', 'required', S.required, `data-control="required" data-mutate ${S.configMissing ? 'disabled' : ''}`)}<hr class="divider">${S.configMissing ? notice('服务缺少加密配置，暂时无法开启全局策略。请先完成服务端配置。', 'red') : notice('加密配置已就绪。开启前请确认管理员已保存恢复码。', 'blue')}<div class="form-actions">${btn('保存全局策略', 'save-system-policy', true, `data-mutate ${S.configMissing ? 'disabled' : ''}`)}</div>`))}${panel(
      '配置状态',
      '后端需要返回配置是否可用与当前策略。',
      body(
        `${definition([
          [
            '加密配置',
            badge(S.configMissing ? '未配置' : '已配置', S.configMissing ? 'red' : 'green'),
          ],
          ['全局要求', S.required ? '开启' : '关闭'],
          ['团队策略', '全局要求开启时，团队无法覆盖'],
        ])}${switchRow('演示配置缺失', '仅切换原型状态。', 'configMissing', S.configMissing, 'data-control="configMissing"')}`,
      ),
    )}</div>`;
  if (id === 'boards')
    return (
      searchPanel(
        '自定义看板',
        '按网站、链接、像素或多个资源组织分析。',
        ['名称', '类型', '关联资源', '更新时间', '操作'],
        S.boards.map((r, i) => [
          esc(r[0]),
          badge(r[1], 'gray'),
          esc(r[2]),
          r[3],
          actionCell('打开', 'board-view', 'board', i),
        ]),
        link(icon('plus') + '创建看板', 'board-editor', true),
        'boards',
      ) + notice('看板包括基本信息、图表编排和只读分享。复制看板会保留布局，并允许替换关联资源。')
    );
  if (id === 'board-editor')
    return panel(
      '看板信息',
      '资源类型沿用上游网站、像素、链接与混合看板。',
      body(
        form(
          'board-save',
          `${field('看板名称', 'name', S.boards[S.selected.board]?.[0] || '', 'text', '', true)}${textarea('说明', 'description', '观察 AI 引荐、搜索访问与预约转化。')}<div class="form-grid">${select(
            '看板类型',
            'boardType',
            [
              ['website', '网站'],
              ['link', '链接'],
              ['pixel', '像素'],
              ['mixed', '混合'],
            ],
            S.tab.boardType || 'website',
            'data-chart-control',
          )}${(S.tab.boardType || 'website') === 'mixed' ? '' : select('关联资源', 'entity', S.tab.boardType === 'link' ? S.links.map(r => r[0]) : S.tab.boardType === 'pixel' ? S.pixels.map(r => r[0]) : S.sites.map(r => r[0]), S.tab.boardEntity || S.site)}</div>${notice('网站、链接、像素看板需要选择对应资源。混合看板由各图表分别选择资源。')}`,
          '保存并编排',
          'boards',
        ),
      ),
    );
  if (id === 'board-design')
    return (
      `<div class="row between"><div><h2>${esc(S.boards[S.selected.board]?.[0] || 'GEO 增长周报')}</h2><p class="muted">图表顺序与布局宽度均可调整。</p></div><div class="actions">${btn(icon('plus') + '添加组件', 'drawer:widget', false, 'data-mutate')}${btn('保存编排', 'save-board-design', true, 'data-mutate')}${link('预览', 'board-view')}</div></div>` +
      boardWidgets(true) +
      notice('当前排序与组件配置保存在浏览器内存。刷新后恢复初始示例。')
    );
  if (id === 'board-view')
    return (
      `<div class="row between"><div><h2>${esc(S.boards[S.selected.board]?.[0] || 'GEO 增长周报')}</h2><p class="muted">AI 与搜索访问、内容转化 · 移山 GEO 官网</p></div><div class="actions">${link('基本信息', 'board-editor', false, `data-entity="board" data-index="${S.selected.board >= 0 ? S.selected.board : 0}"`)}${link('编排', 'board-design')}${link('分享', 'sharing')}</div></div>` +
      metrics([
        ['访客', '12,131', '较前期增长 18.42%', 'blue'],
        ['AI 引荐', '1,286', '占访客 10.60%'],
        ['预约转化', '386', '事件触发次数'],
        ['转化访客', '348', '独立转化访客'],
      ]) +
      boardWidgets(false)
    );
  if (id === 'dashboard')
    return (
      metrics([
        ['全部网站访客', '17,638', '所选 2 个网站'],
        ['页面访问', '34,743', '所选期间'],
        ['AI 引荐访客', '1,584', '已识别来源'],
        ['管理空间', '个人 / 团队', '跨网站快速访问'],
      ]) +
      `<div class="row between"><h2>固定的网站</h2>${link('编辑工作台', 'dashboard-edit')}</div>` +
      `<div class="two">${S.dashboardSites.map((name, i) => chart('trend', esc(name), i ? '6,327 次访问 · 文档网站' : '28,416 次访问 · GEO 官网', link('网站设置', 'website-settings', false, `data-entity="site" data-index="${S.sites.findIndex(r => r[0] === name)}"`))).join('')}</div>` +
      panel(
        '快速入口',
        '从工作台进入常用管理与分析。',
        body(
          `<div class="row">${link('管理网站', 'websites')}${link('自定义看板', 'boards')}${link('实时访客', 'realtime')}${link('完整导出', 'exports')}</div>`,
        ),
      )
    );
  if (id === 'dashboard-edit')
    return panel(
      '工作台布局',
      '选择要固定的网站，使用按钮调整次序。',
      body(
        form(
          'dashboard-save',
          `${S.sites.map((r, i) => `<div class="switch-row">${check(`<strong>${esc(r[0])}</strong><small style="display:block">${esc(r[1])}</small>`, `dashboard-${i}`, S.dashboardSites.includes(r[0]))}</div>`).join('')}<div class="condition-group"><h3 style="margin-bottom:12px">当前顺序</h3>${S.dashboardSites.map((name, i) => `<div class="row between" style="margin:8px 0"><span>${i + 1}. ${esc(name)}</span>${btn('上移', 'dashboard-up', false, `data-index="${i}" ${i === 0 ? 'disabled' : ''}`)}</div>`).join('')}</div>${check('显示 AI 引荐访客摘要', 'showAI', true)}${check('显示前期对比', 'showCompare', true)}`,
          '保存工作台',
          'dashboard',
        ),
      ),
    );
  if (id === 'sharing')
    return (
      searchPanel(
        '公开分享',
        '网站和看板的只读链接与可见范围。',
        ['名称', '资源类型', '页面范围', '筛选权限', '状态', '操作'],
        S.shares.map((r, i) => [
          esc(r[0]),
          r[1],
          esc(r[2]),
          r[3],
          badge(r[4], r[4] === '启用' ? 'green' : 'gray'),
          `<div class="actions">${link('预览', 'share-preview', false, `data-entity="share" data-index="${i}"`)}${btn('编辑', 'drawer:share', false, `data-index="${i}" data-mutate`)}${btn(r[4] === '启用' ? '停用' : '启用', 'share-toggle', false, `data-index="${i}" data-mutate`)}</div>`,
        ]),
        btn(icon('plus') + '创建分享', 'drawer:share', true, 'data-mutate'),
        'shares',
      ) +
      notice(
        '公开视角只显示分享配置允许的统计页面。团队、账户、API Key、会话管理与敏感配置保持登录权限。',
      )
    );
}
export function boardWidgets(edit = false) {
  return `<div class="board-grid">${S.widgets.map((w, i) => `<section class="panel board-widget ${w.full ? 'full' : ''}">${edit ? `<div class="widget-tools"><strong>${esc(w.title)}</strong><div class="actions" style="margin-left:auto">${btn('上移', 'widget-up', false, `data-index="${i}" ${i === 0 ? 'disabled' : ''} data-mutate`)}${btn(w.full ? '半宽' : '全宽', 'widget-width', false, `data-index="${i}" data-mutate`)}${btn(icon('close'), 'widget-remove', false, `data-index="${i}" aria-label="移除组件 ${esc(w.title)}" data-mutate`)}</div></div>` : `<div class="panel-head"><h2>${esc(w.title)}</h2></div>`}<div class="chart" data-chart="${w.type}" role="img" aria-label="${esc(w.title)}，示例数据"></div><div class="legend-note">示例数据 · 当前日期范围</div></section>`).join('')}</div>`;
}
export function publicPage() {
  const share = S.shares[S.selected.share] || S.shares[0];
  const enabled = share?.[4] === '启用';
  const allowed = (share?.[2] || '总览、事件')
    .split('、')
    .map(
      t =>
        ({
          总览: ['overview', '总览'],
          事件: ['events', '事件'],
          UTM: ['utm', 'UTM'],
          目标与漏斗: ['goals', '目标与漏斗'],
        })[t],
    )
    .filter(Boolean);
  if (!allowed.length) allowed.push(['overview', '资源统计']);
  const active = allowed.some(([k]) => k === S.tab.public) ? S.tab.public : allowed[0][0];
  return `<main class="public-shell" id="main-content"><header class="public-head"><div class="public-brand"><img src="assets/logo.svg" alt=""><div><strong>猎看统计</strong><small style="display:block">移山 GEO 官网 · 只读分享</small></div></div><div class="actions">${badge('公开 · 只读', 'gray')}${link('返回原型合集', 'index')}</div></header><div class="public-body">${notice('公开分享 UI 原型 · 使用示例数据 · 不访问内部账户或生产接口。', 'amber')}${
    enabled
      ? `${tabs(allowed, active, 'public')}${
          active === 'overview'
            ? metrics([
                ['访客', '12,131', '当前期间'],
                ['访问次数', '28,416', '当前期间'],
                ['AI 引荐', '1,286', '已识别来源', 'blue'],
                ['预约演示', '386', '事件触发次数'],
              ])
            : ''
        }${chart({ events: 'events', utm: 'utm', goals: 'goal', overview: 'trend' }[active], { events: '事件趋势', utm: 'UTM 来源', goals: '目标转化', overview: '访问趋势' }[active], '2026-09-01 至 09-30')}`
      : `<div class="state-box"><h2>分享已关闭</h2><p>此链接目前无法查看数据，请联系分享创建者。</p>${link('返回原型合集', 'index')}</div>`
  }</div></main>`;
}
