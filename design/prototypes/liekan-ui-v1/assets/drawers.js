import {
  S,
  esc,
  btn,
  link,
  badge,
  body,
  field,
  select,
  textarea,
  check,
  definition,
  form,
  notice,
  code,
} from './components.js';
import { passwordField } from './pages-core.js';
export function drawerContent(type, index = -1, data = {}) {
  const confirm = (title, scope, word, action) => [
    title,
    `${notice(scope, 'red')}${form(action, `${field(`输入 ${word} 确认`, 'confirmation', '', 'text', '此处只修改原型示例，不执行生产操作。', true)}<input type="hidden" name="expected" value="${esc(word)}"><input type="hidden" name="index" value="${index}">`, '确认示例操作')}`,
  ];
  switch (type) {
    case 'site-switch':
      return [
        '切换网站',
        `<div class="stack">${S.sites.map(r => btn(esc(r[0]), 'select-site', false, `data-site="${esc(r[0])}"`)).join('')}</div>`,
      ];
    case 'date':
      return [
        '日期范围',
        form(
          'date-range',
          `<div class="form-grid">${field('开始日期', 'start', '2026-09-01', 'date', '', true)}${field('结束日期', 'end', '2026-09-30', 'date', '', true)}</div>${select('时区', 'timezone', ['Asia/Shanghai', 'UTC'], 'Asia/Shanghai')}${notice('本轮切换日期后更新显示范围，图表使用固定的示例数据。')}`,
          '应用日期',
        ),
      ];
    case 'compare-date':
      return [
        '对照期间',
        form(
          'compare-range',
          `<div class="form-grid">${field('开始日期', 'start', '2026-08-01', 'date', '', true)}${field('结束日期', 'end', '2026-08-30', 'date', '', true)}</div>${notice('正式分析按相同单位对齐所选日期。')}`,
          '应用对照',
        ),
      ];
    case 'username':
      return [
        '修改用户名',
        form(
          'username-save',
          field('用户名', 'username', S.username, 'text', '原型内存修改，生产账户保持原样。', true),
        ),
      ];
    case 'password':
      return [
        '修改密码',
        form(
          'password-save',
          `${passwordField('当前密码', 'currentPassword')}${passwordField('新密码', 'newPassword')}${passwordField('确认新密码', 'confirmPassword')}<p class="field-help">演示当前密码：liekan。新密码至少 6 位。</p>`,
          '保存密码',
        ),
      ];
    case 'disable-2fa':
      return [
        '关闭双重验证',
        form(
          'disable-2fa',
          `${notice('关闭后登录只使用密码。系统或团队强制要求时无法关闭。', 'amber')}${passwordField('当前密码', 'currentPassword')}`,
          '确认关闭',
        ),
      ];
    case 'create-key':
      return [
        '创建 API Key',
        form(
          'key-create',
          field('密钥名称', 'name', '', 'text', '如：研究报告集成。', true),
          '创建示例密钥',
        ),
      ];
    case 'revoke-key':
      return confirm(
        '撤销 API Key',
        '撤销后对应集成将失去访问权限。原型中仅移除示例行。',
        'REVOKE',
        'key-revoke',
      );
    case 'transfer':
      return [
        '转移网站',
        form(
          'site-transfer',
          `${definition([
            ['网站', esc(S.site)],
            ['当前所属', '移山增长团队'],
          ])}${select('目标空间', 'team', ['个人空间', '白鹭研究小组'], '个人空间')}${notice('仅可转移到当前账户拥有管理权限的空间。网站标识和历史数据保持一致。', 'amber')}`,
          '确认转移',
        ),
      ];
    case 'reset':
      return confirm(
        '重置网站数据',
        '将清空当前网站的访问、事件与会话数据，保留网站和安装标识。',
        'RESET',
        'site-reset',
      );
    case 'delete-site':
      return confirm(
        '删除网站',
        '将删除网站及访问数据。原型操作仅移除当前示例网站。',
        S.site,
        'site-delete',
      );
    case 'retention-info':
      return [
        '留存计算口径',
        `${definition([
          ['入组', '按首次访问日期分组'],
          ['留存', '第 N 天再次访问的人数'],
          ['分母', '当日入组访客数'],
          ['待观察', '尚未达到对应观察日'],
          ['零值', '已经观察，返回人数为 0'],
        ])}<hr class="divider">${notice('上游留存为日队列，本轮以同样的日期逻辑绘制矩阵。汇总指标为示例，融合时与查询口径核对。')}`,
      ];
    case 'retention-cell':
      return [
        '留存单元格',
        `${definition([
          ['入组日期', esc(data.date)],
          ['观察时间', `第 ${esc(data.day)} 天`],
          ['入组访客', esc(data.total)],
          ['返回访客', esc(data.count)],
          ['留存比例', `${((Number(data.count) / Number(data.total)) * 100).toFixed(2)}%`],
        ])}<hr class="divider">${link('查看示例会话', 'sessions')}`,
      ];
    case 'dimensions':
      return [
        '选择拆分维度',
        form(
          'dimensions-save',
          `<div class="stack">${check('页面路径', 'path', true)}${check('国家 / 地区', 'country', true)}${check('浏览器', 'browser', !!S.tab.breakdownExtra)}${check('设备', 'device', false)}${check('来源', 'referrer', false)}</div>${notice('原型支持添加一个示例维度。正式版本支持上游多字段组合。')}`,
          '应用维度',
        ),
      ];
    case 'annotation':
      return [
        '图表注释',
        form(
          'annotation-save',
          `${field('日期', 'date', index >= 0 ? S.annotations[index][0] : '2026-09-30', 'date', '', true)}${textarea('注释内容', 'note', index >= 0 ? S.annotations[index][1] : '')}<input type="hidden" name="index" value="${index}">`,
          '保存注释',
        ),
      ];
    case 'create-team':
      return [
        '创建团队',
        form(
          'team-create',
          `${field('团队名称', 'name', '', 'text', '', true)}${select('团队所有者', 'owner', ['admin', 'ruozhu'], 'admin')}`,
          '创建团队',
        ),
      ];
    case 'add-member':
      return [
        '添加已有用户',
        form(
          'member-add',
          `${select('用户名', 'username', ['qianhe', 'miaoran', 'weichen'], 'qianhe')}${select('团队角色', 'role', ['管理员', '成员', '只读'], '成员')}${notice('沿用上游添加已有用户的流程，不触发邮件或外部消息。')}`,
          '添加成员',
        ),
      ];
    case 'member':
      return [
        '编辑成员角色',
        form(
          'member-save',
          `${field('用户名', 'username', S.members[index]?.[1] || 'yuan', 'text', '', false, 'readonly')}${select('角色', 'role', ['管理员', '成员', '只读'], S.members[index]?.[2] || '成员')}<input type="hidden" name="index" value="${index}">${btn('移除成员', 'drawer:remove-member', false, `data-index="${index}" data-mutate`)}`,
          '保存角色',
        ),
      ];
    case 'remove-member':
      return confirm(
        '移除成员',
        '成员将失去本团队资源的访问权限，个人账户继续保留。',
        'REMOVE',
        'member-remove',
      );
    case 'delete-team':
      return confirm(
        '删除团队',
        '确认前需要核对团队成员与资源归属。原型仅演示确认，不删除实际资源。',
        'DELETE',
        'team-delete',
      );
    case 'create-user':
      return [
        '创建系统用户',
        form(
          'user-create',
          `${field('用户名', 'username', '', 'text', '', true)}${passwordField('初始密码', 'password')}${select('系统角色', 'role', ['用户', '只读', '管理员'], '用户')}`,
          '创建用户',
        ),
      ];
    case 'reset-user-2fa':
      return confirm(
        '重置用户双重验证',
        '该用户需重新绑定验证器，现有恢复码将失效。',
        'RESET',
        'user-2fa-reset',
      );
    case 'delete-user':
      return confirm(
        '删除用户',
        '删除前需要检查网站和团队所有权。原型不操作真实用户或数据。',
        'DELETE',
        'user-delete',
      );
    case 'admin-filter':
      return [
        '筛选全局资源',
        form(
          'admin-filter',
          select('所属空间', 'space', ['全部空间', '个人空间', '移山增长团队'], '全部空间'),
          '应用筛选',
        ),
      ];
    case 'widget':
      return [
        '添加看板组件',
        form(
          'widget-add',
          `${field('组件标题', 'title', '', 'text', '', true)}${select(
            '图表类型',
            'type',
            [
              ['trend', '访客趋势'],
              ['channels', '访问来源'],
              ['events', '转化事件'],
            ],
            'trend',
          )}${select(
            '关联网站',
            'site',
            S.sites.map(r => r[0]),
            S.site,
          )}${check('占据整行', 'full', false)}`,
          '添加组件',
        ),
      ];
    case 'share':
      return [
        '分享设置',
        form(
          'share-save',
          `${field('分享名称', 'name', index >= 0 ? S.shares[index][0] : '', '', '', true)}${select('分享类型', 'resource', ['网站', '看板', '链接', '像素'], index >= 0 ? S.shares[index][1] : '网站')}${check('允许访客调整筛选', 'allowFilter', index >= 0 ? S.shares[index][3] === '允许' : true)}${select('主题', 'theme', ['浅色', '深色', '跟随系统'], '浅色')}<h3>允许显示的统计页面</h3><div class="two">${check('总览', 'overview', index >= 0 ? S.shares[index][2].split('、').includes('总览') : true)}${check('事件', 'events', index >= 0 ? S.shares[index][2].split('、').includes('事件') : true)}${check('UTM', 'utm', index >= 0 ? S.shares[index][2].split('、').includes('UTM') : false)}${check('目标与漏斗', 'goals', index >= 0 ? S.shares[index][2].split('、').includes('目标与漏斗') : false)}</div>${notice('上游分享支持按页面选择范围。公开访客无法进入账户、团队及内部配置。')}<input type="hidden" name="index" value="${index}">`,
          '保存分享',
        ),
      ];
    case 'resource-share':
      return [
        '资源分享',
        form(
          'share-save',
          `${field('分享名称', 'name', '', 'text', '', true)}${select('资源类型', 'resource', ['链接', '像素'], '链接')}${check('允许筛选', 'allowFilter', true)}${select('主题', 'theme', ['浅色', '深色', '跟随系统'], '浅色')}<input type="hidden" name="index" value="-1">`,
          '创建分享',
        ),
      ];
    case 'save-replay':
      return [
        '保存录制',
        form(
          'replay-save',
          field('录制名称', 'name', '预约路径检查', 'text', '保存后从“已保存”列表访问。', true),
          '保存录制',
        ),
      ];
    case 'export-manifest':
      return [
        '示例导出清单',
        `${notice('下载只包含内置的示例记录。原型文件中不包含生产访客、账户或密钥。', 'amber')}${code(JSON.stringify({ demo: true, product: 'Liekan', dateRange: [S.exportConfig?.start, S.exportConfig?.end], selected: Object.keys(S.exportConfig || {}).filter(k => S.exportConfig[k] === 'on'), fields: { summary: ['visitors', 'views', 'events'], dimensions: ['path', 'referrer', 'count'], events: ['event', 'property', 'value', 'count'], sessions: ['maskedVisitor', 'time', 'device'], config: ['name', 'type', 'definition'] } }, null, 2))}`,
      ];
  }
  return ['操作预览', notice('此操作将在对应后端融合阶段接入。')];
}
