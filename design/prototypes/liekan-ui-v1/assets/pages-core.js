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
  code,
  actionCell,
} from './components.js';
export function sitesPage(id) {
  const site = S.sites.find(r => r[0] === S.site) || S.sites[0];
  if (id === 'websites')
    return (
      metrics([
        ['管理网站', String(S.sites.length), '个人与团队空间'],
        [
          '已接入',
          String(S.sites.filter(r => r[3] === '已接入').length),
          '已收到首条访问',
          'green',
        ],
        ['待验证', String(S.sites.filter(r => r[3] === '待验证').length), '安装后验证接入', 'blue'],
        ['访问次数', '34,743', '过去 30 天 · 示例'],
      ]) +
      searchPanel(
        '网站列表',
        '在当前角色有权访问的网站之间切换。',
        ['网站', '所属空间', '接入状态', '访问次数', '最近接收', '操作'],
        S.sites.map((r, i) => [
          `<span class="table-title">${esc(r[0])}</span><span class="table-meta">${esc(r[1])}</span>`,
          esc(r[2]),
          badge(r[3], r[3] === '已接入' ? 'green' : 'amber'),
          r[4],
          r[5],
          actionCell('设置', 'website-settings', 'site', i),
        ]),
        link(icon('plus') + '添加网站', 'onboarding', true),
        'sites',
        [3],
      ) +
      notice('接入状态根据采集结果展示。新增网站在收到访问前显示“待验证”，访问次数保持为 0。')
    );
  if (id === 'onboarding') {
    const step = S.onboardStep;
    const steps = `<ol class="steps">${['网站信息', '安装脚本', '验证接入'].map((t, i) => `<li class="${i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''}"><span class="step-number">${i + 1 < step ? '✓' : i + 1}</span>${t}</li>`).join('')}</ol>`;
    let b =
      step === 1
        ? form(
            'onboard-info',
            `<div class="form-grid">${field('网站名称', 'name', S.onboardName, 'text', '显示在侧栏和管理列表中。', true)}${field('域名', 'domain', S.onboardDomain, 'text', '输入域名，如 yishan.example，无需 https://。', true)}</div>${select('所属空间', 'space', ['个人空间', '移山增长团队'], '移山增长团队')}<div class="notice blue">下一步会生成当前网站专用代码。网站名称和域名可在设置中修改。</div>`,
            '创建并继续',
            'websites',
          )
        : step === 2
          ? `${notice('网站示例已创建，接入状态为待验证。将下方脚本放入每个需要统计页面的 head 区域。', 'blue')}${trackingCode()}<div class="form-actions">${btn('上一步', 'onboard-back')}${btn('已安装，开始验证', 'onboard-next', true)}</div>`
          : `${definition([
              ['网站名称', esc(S.onboardName || '移山 GEO 官网')],
              ['域名', esc(S.onboardDomain || 'yishan.example')],
              [
                '接入状态',
                badge(S.install >= 3 ? '验证完成' : '待验证', S.install >= 3 ? 'green' : 'amber'),
              ],
            ])}<hr class="divider">${installSteps()}<div class="form-actions">${btn('返回安装代码', 'onboard-back')}${btn('模拟接收访问', 'simulate-install', true)}${S.install >= 3 ? link('进入网站管理', 'websites', true) : ''}</div>`;
    return `<div class="wide-narrow">${panel('接入一个新网站', '三步完成创建、安装与验证。', steps + body(b))}${panel('接入说明', '从访问统计开始，逐步开启行为采集。', body(`<ol style="padding-left:20px" class="stack"><li>HTML 和常见框架使用同一网站标识。</li><li>首次接入后打开网站，等待首条访问。</li><li>回放与热力图需另外开启行为采集。</li></ol><hr class="divider">${link('查看安装说明', 'tracking')}${link('采集与隐私设置', 'recorder-settings')}`))}</div>`;
  }
  if (id === 'tracking')
    return `<div class="wide-narrow">${panel('安装跟踪代码', '网站标识和现有采集协议保持兼容。', body(trackingCode() + `<hr class="divider"><h3>自定义事件示例</h3><p class="muted">用于目标、漏斗和事件属性分析。</p>${code("umami.track('demo_submit', { plan: 'growth', placement: 'header' });")}<div class="form-actions">${link('验证接入', 'install-check', true)}</div>`))}${panel('常见接入问题', '检查顺序与验证结果一致。', body(`<div class="stack"><div><h3>单页应用</h3><p class="muted">默认跟踪路由变化，保留 Umami SDK 接口。</p></div><div><h3>内容安全策略</h3><p class="muted">允许统计服务的脚本与采集请求域名。</p></div><div><h3>本地验证</h3><p class="muted">检查脚本加载、网站标识和采集响应。</p></div></div><hr class="divider">${link('行为采集设置', 'recorder-settings')}`))}</div>`;
  if (id === 'install-check')
    return panel(
      '安装诊断',
      '下方检查通过模拟步骤演示，原型不读取外部网站。',
      body(
        `<div class="row between">${definition([
          ['网站', esc(S.site)],
          ['域名', esc(site?.[1] || 'yishan.example')],
        ])}${btn('重新模拟检查', 'simulate-install', true)}</div><hr class="divider">${installSteps()}<hr class="divider">${notice(S.install >= 3 ? '已收到示例页面访问。正式接入后，此处显示真实接收时间和检查结果。' : '尚未收到访问。安装代码后打开目标网站，再检查首条页面访问。', S.install >= 3 ? 'blue' : 'amber')}<div class="form-actions">${link('查看跟踪代码', 'tracking')}${link('返回网站管理', 'websites')}</div>`,
      ),
    );
  if (id === 'website-settings')
    return `<div class="two">${panel('基本信息', '编辑名称和域名不改变网站标识。', body(form('website-save', `${field('网站 ID', 'id', 'demo-website-id', 'text', '示例标识，原型不能用于实际安装。', false, 'readonly')}${field('网站名称', 'name', S.site, 'text', '', true)}${field('域名', 'domain', S.sites.find(r => r[0] === S.site)?.[1] || 'yishan.example', 'text', '', true)}`, '保存基本信息')))}${panel(
      '安装与协作',
      '同一网站在各分析页面使用一致的数据范围。',
      body(
        `<div class="stack">${definition([
          ['所属空间', esc(site?.[2] || '个人空间')],
          ['接入状态', badge(site?.[3] || '待验证', site?.[3] === '已接入' ? 'green' : 'amber')],
          ['公开分享', '1 个已启用示例分享'],
        ])}<div class="row">${link('跟踪代码', 'tracking')}${link('分享设置', 'sharing')}${link('行为采集', 'recorder-settings')}</div></div>`,
      ),
    )}${panel('转移网站', '保留历史数据，变更资源所属空间。', body(`<p class="muted">只有拥有相应团队管理权限的成员可以转移网站。</p><div class="form-actions">${btn('转移网站', 'drawer:transfer', false, 'data-mutate')}</div>`))}${panel('数据管理', '重置和删除操作需要额外确认。', body(`<div class="switch-row"><div><strong>重置数据</strong><p class="muted">清空访问与事件数据，保留网站设置。</p></div>${btn('重置', 'drawer:reset', false, 'data-mutate')}</div><div class="switch-row"><div><strong>删除网站</strong><p class="muted">删除网站及其数据，确认页显示影响范围。</p></div>${btn('删除', 'drawer:delete-site', false, 'data-mutate')}</div>`))}</div>`;
  if (id === 'recorder-settings')
    return `<div class="wide-narrow">${panel(
      '回放与热力图',
      '先选择采集能力，再设置采样与隐私规则。',
      body(
        form(
          'recorder-save',
          `${switchRow('启用会话回放', '录制访问过程，默认遮蔽输入内容。', 'replay', true)}${switchRow('启用热力图', '记录点击与滚动，按页面聚合。', 'heatmap', true)}<div class="form-grid">${field('回放采样率 (%)', 'replayRate', '15', 'number', '范围 5% 至 100%。', true, 'min="5" max="100" step="5"')}${field('热力图采样率 (%)', 'heatRate', '15', 'number', '范围 5% 至 100%。', true, 'min="5" max="100" step="5"')}${select(
            '隐私遮蔽级别',
            'mask',
            [
              ['strict', '严格：遮蔽文字与输入'],
              ['moderate', '标准：遮蔽输入内容'],
            ],
            'moderate',
          )}${select('最长录制时长', 'duration', ['5 分钟', '10 分钟', '15 分钟', '20 分钟'], '5 分钟')}</div>${field('排除元素选择器', 'blockSelector', '.private-content', 'text', '匹配元素不进入回放。')}${code('<script defer src="https://stats.liekan.example/recorder.js" data-website-id="demo-website-id"></script>')}`,
          '保存采集配置',
        ),
      ),
    )}${panel('采集范围', '此页属于后续能力的 UI 设计。', body(`${notice('当前展示均为示例录制。启用采集、隐私处理和存储限制将在后端融合阶段单独核验。', 'amber')}<hr class="divider"><div class="stack">${link('预览热力图', 'heatmaps')}${link('预览会话回放', 'replays')}${link('跟踪代码', 'tracking')}</div>`))}</div>`;
}
export function trackingCode() {
  const tab = S.tab.install || 'html';
  const snippets = {
    html: '<script defer src="https://stats.liekan.example/script.js"\n  data-website-id="demo-website-id"></script>',
    next: 'import Script from \'next/script\';\n\n<Script src="https://stats.liekan.example/script.js"\n  data-website-id="demo-website-id" strategy="afterInteractive" />',
    gtm: '标签类型：自定义 HTML\n触发器：All pages\n\n<script defer src="https://stats.liekan.example/script.js"\n  data-website-id="demo-website-id"></script>',
  };
  return `${tabs(
    [
      ['html', 'HTML'],
      ['next', 'Next.js'],
      ['gtm', '标签管理器'],
    ],
    tab,
    'install',
  )}${code(snippets[tab])}<div class="row">${btn(icon('copy') + '复制示例代码', 'copy:tracker')}<span class="muted">示例域名与 ID，请勿用于生产安装。</span></div>`;
}
function installSteps() {
  return `<ul class="timeline">${[
    ['脚本加载', 'script.js 可正常加载。'],
    ['网站标识', '网站标识与当前资源一致。'],
    ['首条访问', '已接收页面 /guide/geo 的访问。'],
  ]
    .map(
      ([t, d], i) =>
        `<li><div class="row between"><strong>${t}</strong>${badge(S.install > i ? '通过' : '等待', S.install > i ? 'green' : 'gray')}</div><p>${S.install > i ? d : '等待运行示例检查。'}</p></li>`,
    )
    .join('')}</ul>`;
}
export function authPage(id) {
  let title = '欢迎回来',
    desc = '登录猎看统计，查看 AI 与搜索流量。',
    fields = '';
  if (id === 'login')
    fields = form(
      'login',
      `${field('用户名', 'username', '', 'text', '', true, 'autocomplete="username"')}${passwordField('密码', 'password', '', true)}${check('演示启用双重验证的账户', 'login2fa', S.twoFactor)}<span class="muted">原型演示：用户名 admin，密码 liekan。</span>`,
      '登录原型',
    );
  if (id === 'login-2fa') {
    title = '验证登录';
    desc = '完成验证后进入原型工作台。';
    const backup = S.tab.loginMethod === 'backup';
    fields = `${tabs(
      [
        ['otp', '验证器验证码'],
        ['backup', '恢复码'],
      ],
      backup ? 'backup' : 'otp',
      'loginMethod',
    )}${form('verify-login', field(backup ? '恢复码' : '6 位验证码', 'token', '', 'text', backup ? '示例恢复码：DEMO-01。' : '示例验证码：123456。', true, backup ? 'autocomplete="off"' : 'inputmode="numeric" maxlength="6" autocomplete="one-time-code" class="otp"'), '确认登录', 'login')}`;
  }
  if (id === 'sso') {
    title = '单点登录';
    desc = '正在等待身份提供方回调。';
    fields = `<div style="margin:24px 0">${notice('SSO 流程沿用上游验证逻辑。本轮设计回调等待与异常页面，身份提供方接入待后端核验。', 'blue')}</div><div class="stack">${btn('模拟验证成功', 'sso-success', true)}${btn('模拟回调失败', 'sso-fail')}${link('返回用户名登录', 'login')}</div>`;
  }
  return `<div class="auth-page"><aside class="auth-info"><a class="auth-brand" data-nav="index" href="index.html"><img src="assets/logo.svg" alt=""><span class="brand-name" style="color:var(--ink)">猎看统计<span class="brand-caption">LIEKAN GEO STATS</span></span></a><div class="auth-intro"><h1>从 AI 与搜索访问，<br>看见内容的增长路径</h1><p>把访问来源、内容表现和目标转化放在同一处，理解每一步增长。</p><div class="auth-feature">AI 引荐 · 传统搜索 · 内容转化<br>沿用已确认的猎看统计界面规范</div></div><small>Liekan · MIT 开源</small></aside><main class="auth-main" id="main-content"><div class="auth-form"><span class="badge amber">UI 原型 · 示例登录</span><h1>${title}</h1><p class="sub">${desc}</p>${fields}<div class="auth-bottom"><a data-nav="index" href="index.html">返回页面合集</a><span>未连接生产账户</span></div></div></main></div>`;
}
export function identityPage(id) {
  if (id === 'account')
    return `<div class="two">${panel(
      '账户信息',
      '当前原型身份与角色。',
      body(
        `${definition([
          ['用户名', esc(S.username)],
          ['角色', badge('系统管理员', 'blue')],
          ['所属团队', '移山增长团队'],
          ['账户来源', '本地账户'],
        ])}<div class="form-actions">${btn('修改用户名', 'drawer:username', false, 'data-mutate')}</div>`,
      ),
    )}${panel('登录密码', '初始账户 admin / liekan，已修改的密码会保留。', body(`<p class="muted">修改时需要当前密码，确认后返回账户页。</p><div class="form-actions">${btn('修改密码', 'drawer:password', true, 'data-mutate')}</div>`))}${panel('安全与偏好', '管理双重验证和集成密钥。', body(`<div class="row">${link('账户安全', 'security')}${link('API Key', 'api-keys')}${link('偏好设置', 'preferences')}</div>`))}</div>`;
  if (id === 'security')
    return `<div class="wide-narrow">${panel('双重验证', '在密码之外增加验证器验证码。', body(`<div class="row between"><strong>当前状态</strong>${badge(S.twoFactor ? '已启用' : '未启用', S.twoFactor ? 'green' : 'gray')}</div><hr class="divider">${S.required || S.teamRequired ? notice('当前系统或团队要求启用双重验证，账户无法自行关闭。', 'amber') : notice('启用后，登录流程会要求验证码。恢复码用于无法访问验证器的情况。')}<div class="form-actions">${S.twoFactor ? btn('关闭双重验证', 'drawer:disable-2fa', false, `${S.required || S.teamRequired ? 'disabled' : ''} data-mutate`) : link('启用双重验证', 'two-factor', true)}</div>`))}${panel(
      '策略状态',
      '展示后端融合时需要覆盖的配置分支。',
      body(
        `${switchRow('演示强制要求', '切换账户不能关闭验证的状态。', 'required', S.required, 'data-control="required"')}${switchRow('演示缺少加密配置', '展示服务端配置缺失的提示。', 'configMissing', S.configMissing, 'data-control="configMissing"')}${
          S.configMissing
            ? notice('服务尚未配置双重验证加密密钥。请由系统管理员完成配置后启用。', 'red')
            : definition([
                ['加密配置', badge('已配置', 'green')],
                ['团队要求', S.teamRequired ? '强制启用' : '自主选择'],
              ])
        }`,
      ),
    )}</div>`;
  if (id === 'two-factor')
    return panel(
      '设置验证器',
      '绑定、确认、保存恢复码。',
      body(
        `<div class="steps"><span class="blue">① 绑定验证器</span><span style="margin:0 20px">② 验证代码</span><span>③ 保存恢复码</span></div><div class="row" style="margin:24px 0"><div class="qr-placeholder">二维码位置<br>原型占位<br>不生成真实密钥</div><div><h3>使用验证器扫描</h3><p class="muted">正式接入后由服务端生成绑定二维码与手动密钥。</p><p style="margin:10px 0"><code>DEMO KEY · 不可绑定</code></p>${btn('复制示例密钥', 'copy:2fa')}</div></div>${form('enable-2fa', field('6 位验证码', 'token', '', 'text', '演示输入 123456。', true, 'inputmode="numeric" maxlength="6" autocomplete="one-time-code" class="otp"'), '验证并继续', 'security')}`,
      ),
    );
  if (id === 'backup-codes')
    return panel(
      '双重验证已启用',
      '保存恢复码后完成设置。',
      body(
        `${notice('恢复码只在本次设置完成时展示。下方为不可用于登录的示例恢复码。', 'amber')}<div class="backup-grid" style="margin:20px 0">${Array.from({ length: 8 }, (_, i) => `<code class="backup-code">DEMO-${String(i + 1).padStart(2, '0')}-SAMPLE</code>`).join('')}</div>${btn(icon('download') + '下载示例恢复码', 'download:backup')}<div style="margin-top:16px">${check('我已妥善保存恢复码', 'backupSaved', false, 'data-control="backupSaved"')}</div><div class="form-actions">${btn('完成设置', 'finish-2fa', true, 'disabled id="finish-2fa"')}</div>`,
      ),
    );
  if (id === 'api-keys')
    return (
      searchPanel(
        '集成密钥',
        '密钥继承账户权限，完整值仅在创建时显示一次。',
        ['名称', '密钥', '创建时间', '最近使用', '操作'],
        S.keys.map((r, i) => [
          esc(r[0]),
          `<code>${esc(r[1])}</code>`,
          r[2],
          r[3],
          btn('撤销', 'drawer:revoke-key', false, `data-index="${i}" data-mutate`),
        ]),
        btn(icon('plus') + '创建密钥', 'drawer:create-key', true, 'data-mutate'),
        'keys',
      ) +
      notice(
        '创建示例密钥后可复制一次，关闭抽屉后列表仅显示掩码。演示密钥不能访问实际 API。',
        'blue',
      )
    );
  if (id === 'preferences')
    return panel(
      '显示与分析偏好',
      '设置默认时间范围、时区与界面语言。',
      body(
        form(
          'preferences',
          `<div class="form-grid">${select('默认日期范围', 'range', ['今天', '过去 7 天', '过去 30 天', '本月'], '过去 30 天')}${select('时区', 'timezone', ['Asia/Shanghai', 'Asia/Tokyo', 'Europe/Berlin', 'UTC'], 'Asia/Shanghai')}${select('语言', 'language', ['简体中文', 'English', '日本語'], '简体中文')}${select('主题', 'theme', ['浅色', '深色', '跟随系统'], '浅色')}</div>${notice('本轮视觉稿使用已确认的浅色规范。深色与其他语言保留设置入口，样式与翻译将在对应阶段补齐。')}<hr class="divider">${definition(
            [
              ['当前运行系统', 'Liekan 0.1.2'],
              ['原型版本', 'UI v1 · 等待确认'],
              ['许可', 'MIT，保留 Umami 版权'],
            ],
          )}`,
          '保存偏好',
        ),
      ),
    );
}
export function passwordField(label, name, value = '', required = true) {
  return `<label class="field"><span>${label}${required ? ' <span class="required">*</span>' : ''}</span><span class="password-wrap"><input type="password" name="${name}" value="${esc(value)}" ${required ? 'required' : ''} autocomplete="${name === 'password' || name === 'currentPassword' ? 'current-password' : 'new-password'}"><button type="button" data-action="toggle-password" aria-label="显示密码">${icon('eye')}</button></span><span class="field-error" data-error-for="${name}" aria-live="polite"></span></label>`;
}
export function conversionPage(id) {
  if (id === 'goals')
    return (
      metrics([
        ['目标数量', String(S.goals.length), '当前网站'],
        ['预约演示', '386', '转化次数', 'blue'],
        ['预约转化率', '3.18%', '348 位访客 / 10,944 位访客'],
        ['目标类型', '页面 / 事件', '保留原有目标条件'],
      ]) +
      searchPanel(
        '网站目标',
        '按页面访问或事件触发定义目标。',
        ['目标', '触发条件', '转化次数', '转化率', '操作'],
        S.goals.map((r, i) => [
          esc(r[0]),
          esc(r[1]),
          r[2],
          r[3],
          actionCell('编辑', 'goal-editor', 'goal', i),
        ]),
        link(icon('plus') + '创建目标', 'goal-editor', true),
        'goals',
        [2, 3],
      ) +
      chart('goal', '预约演示的转化趋势', '当前期间 · 示例') +
      notice('目标转化次数和独立转化访客分别展示。转化率按独立转化访客计算。')
    );
  if (id === 'goal-editor')
    return `<div class="wide-narrow">${panel(
      '目标条件',
      '与上游页面或事件目标保持一致。',
      body(
        form(
          'goal-save',
          `${field('目标名称', 'name', S.goals[S.selected.goal]?.[0] || '', 'text', '', true)}${select(
            '触发类型',
            'goalType',
            [
              ['path', '访问页面'],
              ['event', '触发事件'],
            ],
            S.goals[S.selected.goal]?.[1].startsWith('页面') ? 'path' : 'event',
          )}${field('页面路径或事件名称', 'value', S.goals[S.selected.goal]?.[1].split(' · ')[1] || 'demo_submit', 'text', '页面填 /pricing，事件填 demo_submit。', true)}${textarea('说明（可选）', 'description', S.goals[S.selected.goal]?.[4] || '', '用于团队理解目标定义。')}`,
          '保存目标',
          'goals',
        ),
      ),
    )}${panel('口径说明', '一个目标对应一个行为条件。', body(`<div class="stack"><div><h3>访问页面</h3><p class="muted">使用采集到的路径定义目标。</p></div><div><h3>触发事件</h3><p class="muted">使用自定义事件名称定义目标。</p></div></div><hr class="divider">${link('查看事件属性', 'event-detail')}`))}</div>`;
  if (id === 'funnels') {
    const counts = S.steps.map((_, i) => [1764, 847, 386, 203, 114, 67, 38, 21][i]),
      end = counts.at(-1);
    return (
      metrics([
        ['进入漏斗', '1,764', '示例访客'],
        ['完成路径', String(end), '示例完成访客', 'blue'],
        ['整体转化率', ((end / 1764) * 100).toFixed(2) + '%', '相对首次进入'],
        ['步骤数量', String(S.steps.length), '按已保存配置展示'],
      ]) +
      panel(
        esc(S.tab.funnelName || '内容到预约'),
        `${S.steps.length} 步 · 同一访客 · ${S.funnelWindow} 分钟窗口`,
        body(
          `${S.steps.map((step, i) => `<div class="funnel-row"><strong>${i + 1} · ${esc(step.value)}</strong><div class="funnel-bar"><i style="width:${(counts[i] / 1764) * 100}%"></i></div><span class="num numeric">${counts[i].toLocaleString()}</span></div>`).join('')}<hr class="divider">${table(
            ['步骤', '到达访客', '相对上步转化', '累计转化'],
            S.steps.map((step, i) => [
              esc(step.value),
              counts[i].toLocaleString(),
              (i ? (counts[i] / counts[i - 1]) * 100 : 100).toFixed(2) + '%',
              ((counts[i] / 1764) * 100).toFixed(2) + '%',
            ]),
            'funnel',
            [1, 2, 3],
          )}`,
        ),
        link('配置漏斗', 'funnel-editor', true),
      ) +
      notice(
        '保存后的步骤、名称与窗口显示在此页。转化数量使用固定示例，正式结果将在后端融合后计算。',
      )
    );
  }
  if (id === 'funnel-editor')
    return `<div class="wide-narrow">${panel('漏斗配置', '至少两步，最多八步。事件步骤可设置属性条件。', body(form('funnel-save', `${field('漏斗名称', 'name', S.tab.funnelName || '内容到预约', 'text', '', true)}${field('转化窗口（分钟）', 'window', S.funnelWindow, 'number', '大于 0，同一访客需要在窗口内按顺序完成。', true, 'min="1" step="1"')}<div id="funnel-steps">${funnelSteps()}</div>${btn(icon('plus') + '添加步骤', 'step-add', false, `${S.steps.length >= 8 ? 'disabled' : ''}`)}<p class="field-help">已配置 ${S.steps.length} / 8 步。</p>`, '保存漏斗', 'funnels')))}${panel('配置预览', '步骤顺序决定转化路径。', body(`<ol class="timeline">${S.steps.map((s, i) => `<li><strong>${i + 1} · ${esc(s.value || '未填写')}</strong><p>${s.type === 'path' ? '页面访问' : '事件触发'}${s.filters.length ? ' · 带属性条件' : ''}</p></li>`).join('')}</ol>`))}</div>`;
}
export function funnelSteps() {
  return S.steps
    .map(
      (s, i) =>
        `<div class="step-editor" data-step="${i}"><div class="step-editor-head"><strong>步骤 ${i + 1}</strong><div class="actions">${btn(icon('up'), 'step-up', false, `aria-label="上移步骤 ${i + 1}" data-index="${i}" ${i === 0 ? 'disabled' : ''}`)}${btn(icon('down'), 'step-down', false, `aria-label="下移步骤 ${i + 1}" data-index="${i}" ${i === S.steps.length - 1 ? 'disabled' : ''}`)}${btn(icon('close'), 'step-remove', false, `aria-label="移除步骤 ${i + 1}" data-index="${i}" ${S.steps.length <= 2 ? 'disabled' : ''}`)}</div></div><div class="two">${select(
          '行为类型',
          `step-type-${i}`,
          [
            ['path', '访问页面'],
            ['event', '触发事件'],
          ],
          s.type,
          'data-step-type',
        )}${field('路径或事件名称', `step-value-${i}`, s.value, 'text', '', true, 'data-step-value')}</div>${s.type === 'event' ? `<div style="margin-top:12px">${s.filters.map((f, j) => `<div class="condition">${field('事件属性', `property-${i}-${j}`, f.property, 'text', '', true)}${select('运算符', `operator-${i}-${j}`, ['等于', '不等于', '包含', '不包含'], f.operator)}${field('属性值', `filtervalue-${i}-${j}`, f.value, 'text', '', true)}${btn(icon('close'), 'step-filter-remove', false, `data-index="${i}" data-filter="${j}" aria-label="移除属性条件"`)}</div>`).join('')}${btn('添加事件属性', 'step-filter-add', false, `data-index="${i}"`)}</div>` : ''}</div>`,
    )
    .join('');
}
