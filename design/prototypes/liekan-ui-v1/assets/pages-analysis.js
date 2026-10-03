import { fixtures } from './catalog.js';
import { eventSample, sessionSample, journeySample } from './sample-data.js';
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
  definition,
  tabs,
  searchPanel,
  form,
  actionCell,
  conditionBuilder,
} from './components.js';
export function activityPage(id) {
  if (id === 'realtime')
    return (
      metrics([
        ['当前活跃', '31', '过去 5 分钟 · 示例', 'blue'],
        ['页面访问', '184', '过去 30 分钟'],
        ['访问事件', '47', '过去 30 分钟'],
        ['AI 引荐访客', '6', '由访问来源识别'],
      ]) +
      chart(
        'realtime',
        '过去 30 分钟的访客',
        '本轮数据固定，刷新按钮演示更新状态。',
        btn('刷新示例', 'refresh-sample'),
      ) +
      `<div class="two">${panel(
        '热门页面',
        '当前活跃访客访问的页面。',
        table(
          ['页面', '活跃访客'],
          [
            ['/guide/geo', '12'],
            ['/pricing', '9'],
            ['/solutions', '6'],
            ['/case-study', '4'],
          ],
          'activePages',
          [1],
        ),
      )}${panel(
        '访问来源',
        '来源识别基于可用的引荐信息。',
        table(
          ['来源', '活跃访客'],
          [
            ['Google', '13'],
            ['ChatGPT', '4'],
            ['直接访问', '8'],
            ['其他', '6'],
          ],
          'activeSources',
          [1],
        ),
      )}</div>` +
      sessionTable('最新访问')
    );
  if (id === 'events')
    return (
      metrics([
        ['事件触发次数', '3,595', '当前期间'],
        ['事件种类', '4', '按事件名称聚合'],
        ['关联独立访客', '2,138', '事件触发访客'],
        ['带属性事件', '2,486', '有属性的事件触发次数'],
      ]) +
      chart('events', '事件触发趋势', '日期范围与下方明细一致。') +
      searchPanel(
        '事件列表',
        '点击事件名称进入属性分布与关联会话。',
        ['事件名称', '触发次数', '触发访客', '属性数', '最近触发', '操作'],
        fixtures.events.map((r, i) => [
          `<a data-nav="event-detail" data-entity="event" data-index="${i}" href="event-detail.html"><code>${r[0]}</code></a>`,
          r[1],
          r[2],
          r[3],
          r[4],
          actionCell('属性', 'event-detail', 'event', i),
        ]),
        '',
        'events',
        [1, 2, 3],
      )
    );
  if (id === 'event-detail') {
    const property = S.tab.property || 'plan';
    const { event, total, values } = eventSample(property);
    return (
      `<div class="row between"><div>${badge('事件', 'blue')} <code>${esc(event[0])}</code></div>${link('返回事件列表', 'events')}</div>` +
      metrics([
        ['触发次数', event[1], '当前期间'],
        ['触发访客', event[2], '独立访客'],
        ['属性字段', event[3], '示例属性：plan、placement、source、value'],
        ['最近触发', event[4], '2026-09-30'],
      ]) +
      `<div class="two">${chart('properties', '事件属性分布', property + ' 的各属性值对应触发次数。', tabs(['plan', 'placement', 'source', 'value'], property, 'property'))}${panel(
        '属性值明细',
        '值类型和缺失状态分别显示。',
        table(
          ['属性值', '类型', '触发次数', '占比'],
          values.map(([v, n]) => [
            v === '未提供' ? badge(v, 'gray') : v,
            v === '未提供' ? '缺失' : property === 'value' ? '数值区间' : '字符串',
            String(n),
            ((n / total) * 100).toFixed(2) + '%',
          ]),
          'eventProperties',
          [2, 3],
        ),
      )}</div>` +
      sessionTable('关联会话')
    );
  }
  if (id === 'sessions')
    return (
      `${tabs(
        [
          ['activity', '访问活动'],
          ['visitors', '访客'],
          ['properties', '会话属性'],
        ],
        S.tab.sessions || 'activity',
        'sessions',
      )}` +
      (S.tab.sessions === 'properties'
        ? searchPanel(
            '会话属性',
            '按已提供的身份属性查看人群。',
            ['属性名称', '属性值', '关联会话', '操作'],
            [
              ['plan', 'growth', '187', actionCell('详情', 'session-detail')],
              ['plan', 'starter', '112', actionCell('详情', 'session-detail')],
            ],
            '',
            'sessionAttributes',
            [2],
          )
        : S.tab.sessions === 'visitors'
          ? searchPanel(
              '访客记录',
              '以脱敏访客标识聚合访问。',
              ['访客', '最近访问', '会话次数', '访问页面', '操作'],
              fixtures.sessions.map((r, i) => [
                r[0],
                r[1],
                '2',
                r[4],
                actionCell('详情', 'session-detail', 'session', i),
              ]),
              '',
              'visitors',
              [2],
            )
          : sessionTable('会话记录')) +
      notice('每个会话保留访问时间、环境、来源和行为时间线。访客标识脱敏展示，不显示原始 IP。')
    );
  if (id === 'session-detail') {
    const sample = sessionSample(),
      row = sample.row;
    return (
      `<div class="row between"><div class="row">${badge('会话', 'blue')}<strong>${fixtures.sessions[S.selected.session]?.[0] || '访客 8f3c'}</strong><span class="muted">2026-09-30 · ${fixtures.sessions[S.selected.session]?.[1] || '09:42:18'}</span></div><div class="actions">${link('返回会话列表', 'sessions')}${link('查看示例回放', 'replay-player', false, `data-entity="replay" data-index="${S.selected.session >= 0 ? S.selected.session : 0}"`)}</div></div>` +
      metrics([
        ['页面访问', row[5], '当前会话'],
        [
          '事件触发',
          String(sample.events.length),
          sample.events.join('、') || '当前会话未触发事件',
        ],
        ['会话时长', row[6], '首次至最近一次行为'],
        ['访问来源', row[3], '引荐域名识别', 'blue'],
      ]) +
      `<div class="narrow-wide">${panel(
        '访客信息',
        '环境信息与已提供的会话属性。',
        body(
          `${definition([
            ['地域', fixtures.sessions[S.selected.session]?.[2] || '上海，中国'],
            ['设备', '桌面设备'],
            ['浏览器', 'Chrome 128'],
            ['操作系统', 'macOS'],
            ['语言', 'zh-CN'],
            ['引荐来源', fixtures.sessions[S.selected.session]?.[3] || 'ChatGPT'],
            ['入口页面', sample.entry],
            ['出口页面', sample.exit],
          ])}<hr class="divider"><h3>会话属性</h3><div style="margin-top:12px">${definition([
            ['plan', 'growth'],
            ['customer_id', badge('未提供', 'gray')],
          ])}</div>`,
        ),
      )}${panel(
        '访问时间线',
        '按发生时间排列页面与事件。',
        body(
          `<ul class="timeline">${sample.timeline
            .map(
              ({ time, value, description }) =>
                `<li><time class="timeline-time">${time}</time><strong>${esc(value)}</strong><p>${description}</p>${value === 'demo_submit' ? actionCell('查看事件属性', 'event-detail', 'event', 0) : ''}</li>`,
            )
            .join('')}</ul>`,
        ),
      )}</div>`
    );
  }
}
export function sessionTable(title) {
  return searchPanel(
    title,
    '所有记录均为脱敏的原型示例。',
    ['访客', '访问时间', '地域', '来源', '当前页面', '页面数', '时长', '操作'],
    fixtures.sessions.map((r, i) => [
      r[0],
      r[1],
      r[2],
      r[3],
      r[4],
      r[5],
      r[6],
      actionCell('详情', 'session-detail', 'session', i),
    ]),
    link('筛选', 'filters'),
    'sessions',
    [5, 6],
  );
}
export function audiencePage(id) {
  if (id === 'filters')
    return `<div class="wide-narrow">${panel('条件筛选', '访问条件按全部或任一组合，会话属性单独设置。', body(form('filter-apply', `${conditionBuilder()}<div class="condition-group"><h3 style="margin-bottom:12px">会话属性</h3><div class="form-grid">${field('属性名称', 'sessionProperty', 'plan')}${field('属性值', 'sessionValue', 'growth')}</div><p class="field-help">会话属性条件与访问条件共同限定结果。</p></div><div class="row">${btn('预览匹配人数', 'preview-match')}${btn('重置条件', 'condition-reset')}</div><p class="blue num" id="match-preview">示例预览：1,286 位访客</p>`, '应用筛选', 'sessions')))}${panel(
      '保存与复用',
      '将当前条件保存为动态分群。',
      body(
        `<p class="muted">日期范围变化后，分群按相同条件重新计算。</p><div class="form-actions">${link('保存为分群', 'segment-editor', true)}</div><hr class="divider">${definition(
          [
            ['当前网站', esc(S.site)],
            ['日期', esc(S.range)],
            ['当前逻辑', S.match === 'all' ? '全部匹配 (AND)' : '任一匹配 (OR)'],
          ],
        )}`,
      ),
    )}</div>`;
  if (id === 'segments')
    return (
      searchPanel(
        '已保存分群',
        '动态匹配访问维度和会话属性。',
        ['分群名称', '条件摘要', '匹配访客', '占比', '操作'],
        S.segments.map((r, i) => [
          esc(r[0]),
          esc(r[1]),
          r[2],
          r[3],
          actionCell('编辑', 'segment-editor', 'segment', i),
        ]),
        link(icon('plus') + '创建分群', 'segment-editor', true),
        'segments',
        [2, 3],
      ) + notice('分群保存条件定义，不固定一份访客列表。可从分析页复用并按所选日期重新计算。')
    );
  if (id === 'segment-editor')
    return panel(
      '分群条件',
      '名称、匹配逻辑、访问条件与会话属性。',
      body(
        form(
          'segment-save',
          `${field('分群名称', 'name', S.segments[S.selected.segment]?.[0] || '', 'text', '', true)}${conditionBuilder()}<div class="form-grid">${field('会话属性（可选）', 'sessionProperty', 'plan')}${field('属性值', 'sessionValue', 'growth')}</div>${notice('示例匹配 1,286 位访客。正式预览将在后端融合时计算。', 'blue')}`,
          '保存分群',
          'segments',
        ),
      ),
    );
  if (id === 'cohorts')
    return (
      searchPanel(
        '行为队列',
        '以指定时间内完成某个行为的访客为分析人群。',
        ['队列名称', '行为与期间', '访客', '更新时间', '操作'],
        S.cohorts.map((r, i) => [
          esc(r[0]),
          esc(r[1]),
          r[2],
          r[3],
          actionCell('编辑', 'cohort-editor', 'cohort', i),
        ]),
        link(icon('plus') + '创建队列', 'cohort-editor', true),
        'cohorts',
        [2],
      ) +
      `<div class="two">${panel('队列与留存', '观察完成行为后的访客是否返回。', body(`<p class="muted">队列定义保留动作、日期范围和访问条件。</p><div class="form-actions">${link('查看留存矩阵', 'retention')}</div>`))}${panel('队列与路径', '观察人群的访问行为组合。', body(`<p class="muted">在旅程中选择已保存的人群条件。</p><div class="form-actions">${link('查看访问旅程', 'journeys')}</div>`))}</div>`
    );
  if (id === 'cohort-editor')
    return panel(
      '队列定义',
      '指定时间内完成一个页面访问或事件行为。',
      body(
        form(
          'cohort-save',
          `${field('队列名称', 'name', S.cohorts[S.selected.cohort]?.[0] || '', 'text', '', true)}<div class="form-grid">${select(
            '行为类型',
            'actionType',
            [
              ['path', '访问页面'],
              ['event', '触发事件'],
            ],
            'event',
          )}${field('行为值', 'actionValue', S.cohorts[S.selected.cohort]?.[1].split(' · ')[0] || 'trial_start', 'text', '', true)}${select('日期范围', 'dateRange', ['过去 7 天', '过去 30 天', '本月'], '过去 30 天')}</div>${conditionBuilder()}${notice('行为队列的附加条件使用来源、地域、设备等维度。动作由上方字段单独定义。')}`,
          '保存队列',
          'cohorts',
        ),
      ),
    );
  if (id === 'retention')
    return (
      `<div class="row between"><div class="row">${select('月份', 'retentionMonth', ['2026 年 9 月', '2026 年 8 月'], '2026 年 9 月')}${select('人群', 'retentionAudience', ['全部访客', '9 月试用用户', 'AI 引荐访客'], '全部访客')}</div>${btn('口径说明', 'drawer:retention-info')}</div>` +
      metrics([
        ['入组访客', '2,476', '按首次访问日期分组'],
        ['次日留存', '24.76%', '完整观察队列 · 示例'],
        ['第 7 天留存', '13.41%', '完整观察队列 · 示例'],
        ['第 28 天留存', '6.72%', '完整观察队列 · 示例'],
      ]) +
      panel(
        '日队列留存矩阵',
        '点击单元格查看分子、分母及关联记录。未到观察日的格子显示“待观察”。',
        retentionMatrix(),
      ) +
      notice(
        '按首次访问日期入组，以第 N 天再次访问衡量留存。汇总只统计已完整观察的队列；0% 与待观察分别表达。',
      )
    );
  if (id === 'journeys') {
    const paths = journeySample();
    return (
      `<div class="panel"><div class="panel-body" style="padding-top:16px"><div class="form-grid">${select(
        '路径类型',
        'journeyType',
        [
          ['all', '页面与事件'],
          ['pages', '仅页面'],
          ['events', '仅事件'],
        ],
        S.tab.journeyType || 'all',
      )}${select('步数', 'journeySteps', [2, 3, 4, 5, 6, 7], S.tab.journeySteps || 3)}${field('起点（可选）', 'journeyStart', S.tab.journeyStart || '', 'text', '输入当前类型中的页面或事件。')}${field('终点（可选）', 'journeyEnd', S.tab.journeyEnd || '', 'text', '留空时显示全部示例终点。')}</div><div class="form-actions">${btn('应用路径条件', 'journey-apply', true)}</div></div></div>` +
      chart(
        'journey',
        '从内容到转化的访问路径',
        paths.length
          ? '连线宽度代表示例访客量。点击节点查看路径详情。'
          : '当前示例中没有匹配路径，请调整类型、起点或终点。',
        '',
        'tall',
      ) +
      searchPanel(
        '路径明细',
        '按选定条件展示行为组合。',
        ['路径', '访客', '完成比例', '操作'],
        paths.map((path, i) => [
          esc(path.nodes.join(' → ')),
          String(path.count),
          ((path.count / 1764) * 100).toFixed(2) + '%',
          actionCell('详情', 'path-detail', 'path', i),
        ]),
        '',
        'paths',
        [1, 2],
      )
    );
  }
  if (id === 'path-detail') {
    const path = journeySample()[S.selected.path] || journeySample()[0];
    if (!path)
      return (
        notice('当前示例条件没有匹配路径，请返回访问旅程调整条件。') +
        link('返回访问旅程', 'journeys')
      );
    return (
      `<div class="row between"><h2>${esc(path.nodes.join(' → '))}</h2>${link('返回访问旅程', 'journeys')}</div>` +
      metrics([
        ['完成路径', String(path.count), '同一访客'],
        ['路径占比', ((path.count / 1764) * 100).toFixed(2) + '%', path.count + ' / 1,764'],
        ['平均完成时间', '04:17', path.nodes.length + ' 步路径 · 示例'],
        ['主要来源', '自然搜索', '按示例数据排序'],
      ]) +
      panel(
        '路径节点',
        '展示所选行为路径及各节点流失。',
        body(
          `<ol class="timeline">${path.nodes
            .map(
              (node, i) =>
                `<li><strong>${esc(node)}</strong><p>${i === 0 ? '示例入口' : i === path.nodes.length - 1 ? path.count + ' 位访客完成所选路径' : '示例中间节点'}</p></li>`,
            )
            .join('')}</ol>`,
        ),
      ) +
      sessionTable('完成路径的会话')
    );
  }
}
export function retentionMatrix() {
  const days = [1, 2, 3, 4, 5, 6, 7, 14, 21, 28];
  return `<div class="table-wrap"><table class="heat-matrix"><thead><tr><th>入组日期 / 人数</th>${days.map(d => `<th>第 ${d} 天</th>`).join('')}</tr></thead><tbody>${[
    1, 5, 9, 13, 17, 21, 25, 29,
  ]
    .map((date, r) => {
      const total = [374, 291, 328, 347, 296, 314, 287, 239][r];
      return `<tr><td><strong>09-${String(date).padStart(2, '0')}</strong><small style="display:block">${total} 位访客</small></td>${days
        .map((day, c) => {
          if (day > 30 - date)
            return '<td><span class="heat-cell unobserved" style="display:block">待观察</span></td>';
          const count =
            r === 5 && c === 6
              ? 0
              : Math.round(total * Math.max(0.045, 0.282 - c * 0.019 - r * 0.006));
          const pct = ((count / total) * 100).toFixed(2);
          return `<td><button class="heat-cell" style="background:rgba(15,98,254,${Number(pct) / 90 + 0.06})" data-action="retention-cell" data-date="09-${date}" data-day="${day}" data-count="${count}" data-total="${total}" aria-label="9 月 ${date} 日入组，第 ${day} 天，留存 ${pct}%">${pct}%</button></td>`;
        })
        .join('')}</tr>`;
    })
    .join(
      '',
    )}</tbody></table></div><div class="table-footer"><span>深浅表示留存比例，百分比同时显示。</span><span>观察截止：2026-09-30</span></div>`;
}
export function advancedPage(id) {
  if (id === 'utm') {
    const dim = S.tab.utmDimension || 'source';
    const rows = {
      source: [
        ['google', '2,817', '45.20%'],
        ['newsletter', '1,476', '23.68%'],
        ['chatgpt', '938', '15.05%'],
        ['linkedin', '654', '10.49%'],
        ['perplexity', '348', '5.58%'],
      ],
      medium: [
        ['organic', '2,817', '45.20%'],
        ['email', '1,476', '23.68%'],
        ['referral', '1,286', '20.63%'],
        ['social', '654', '10.49%'],
      ],
      campaign: [
        ['秋季研究报告', '2,137', '49.62%'],
        ['GEO 指南', '1,324', '30.74%'],
        ['增长诊断', '846', '19.64%'],
      ],
      content: [
        ['header-link', '934', '44.75%'],
        ['case-study', '671', '32.15%'],
        ['footer-cta', '482', '23.10%'],
      ],
      term: [
        ['GEO 分析', '884', '41.45%'],
        ['AI 流量', '712', '33.38%'],
        ['品牌搜索', '537', '25.18%'],
      ],
    };
    return (
      tabs(
        [
          ['source', '来源 source'],
          ['medium', '媒介 medium'],
          ['campaign', '活动 campaign'],
          ['content', '内容 content'],
          ['term', '关键词 term'],
        ],
        dim,
        'utmDimension',
      ) +
      metrics([
        ['带 UTM 访问', '6,233', '有至少一个 UTM 字段'],
        ['带 UTM 访客', '4,817', '独立访客'],
        ['已标记转化', '217', '目标：预约演示'],
        ['字段缺失', '分别保留', '未提供字段不补推断'],
      ]) +
      `<div class="two">${chart('utm', `utm_${dim} 分布`, '按当前维度的访问次数排序。')}${panel(
        '维度明细',
        '点击属性值筛选关联访问。',
        table(
          ['属性值', '访问次数', '占比', '操作'],
          rows[dim].map(r => [...r, actionCell('访问', 'sessions')]),
          'utm',
          [1, 2],
        ),
      )}</div>` +
      notice(
        '五个 UTM 字段分别聚合。来源识别与 UTM 命名相互独立，AI 来源不会自动写入缺失的 UTM 字段。',
      )
    );
  }
  if (id === 'attribution')
    return (
      `<div class="panel">${body(
        `<div class="form-grid">${select(
          '归因模型',
          'model',
          [
            ['first-click', '首次点击'],
            ['last-click', '末次点击'],
          ],
          S.tab.model || 'first-click',
          'data-chart-control',
        )}${select(
          '转化类型',
          'conversionType',
          [
            ['path', '访问页面'],
            ['event', '触发事件'],
          ],
          'event',
        )}${field('转化步骤', 'conversionValue', 'demo_submit', 'text', '填写实际页面路径或事件名称。', true)}</div><div class="form-actions">${btn('应用归因设置', 'attribution-apply', true)}</div>`,
      )}</div>` +
      metrics([
        ['归因转化', '386', '目标：demo_submit'],
        [
          '归因模型',
          S.tab.model === 'last-click' ? '末次点击' : '首次点击',
          '两种模型使用相同转化集合',
        ],
        ['可归因转化', '330', '有来源路径的转化'],
        ['直接 / 未知', '56', '单独保留，避免误分配'],
      ]) +
      chart('attribution', '渠道贡献', '按所选模型分配转化次数。') +
      searchPanel(
        '归因明细',
        '模型变化后贡献分配变化，总转化次数一致。',
        ['渠道', '转化次数', '贡献占比', '操作'],
        (S.tab.model === 'last-click'
          ? [
              ['自然搜索', '124', '32.12%'],
              ['AI 引荐', '68', '17.62%'],
              ['直接访问', '137', '35.49%'],
              ['社交与其他', '57', '14.77%'],
            ]
          : [
              ['自然搜索', '147', '38.08%'],
              ['AI 引荐', '87', '22.54%'],
              ['直接访问', '96', '24.87%'],
              ['社交与其他', '56', '14.51%'],
            ]
        ).map(r => [...r, actionCell('会话', 'sessions')]),
        '',
        'attribution',
        [1, 2],
      ) +
      notice(
        'AI 引荐按真实 referrer 识别。来源缺失时显示直接或未知，归因口径将在融合阶段与上游查询逐项核对。',
      )
    );
  if (id === 'breakdown')
    return (
      `<div class="row between"><div class="row">${badge('页面路径')}${badge('国家 / 地区')}${S.tab.breakdownExtra ? badge(esc(S.tab.breakdownExtra)) : ''}</div>${btn('选择维度', 'drawer:dimensions', true)}</div>` +
      chart('breakdown', '页面 × 地域的访问次数', '维度组合按访问次数排序。') +
      searchPanel(
        '组合明细',
        '选择维度后，表格字段随组合更新。',
        [
          '页面路径',
          '国家 / 地区',
          ...(S.tab.breakdownExtra ? [S.tab.breakdownExtra] : []),
          '访问次数',
          '访客',
          '操作',
        ],
        [
          ['/guide/geo', '中国', '1,384', '1,102'],
          ['/pricing', '中国', '947', '814'],
          ['/guide/geo', '日本', '724', '586'],
          ['/case-study', '美国', '512', '433'],
        ].map(r => [
          r[0],
          r[1],
          ...(S.tab.breakdownExtra ? ['Chrome'] : []),
          r[2],
          r[3],
          actionCell('访问', 'sessions'),
        ]),
        '',
        'breakdown',
        S.tab.breakdownExtra ? [3, 4] : [2, 3],
      ) +
      notice('维度拆分使用多字段组合，保留缺失维度的“未提供”记录。事件名称沿用上游字段选择范围。')
    );
  if (id === 'compare')
    return (
      `<div class="notice row between"><span><strong>当前：</strong>${esc(S.range)}　<strong>对照：</strong>${esc(S.tab.compareRange || '2026-08-01 至 08-30')}</span>${btn('调整对照期间', 'drawer:compare-date')}</div>` +
      metrics([
        ['访客', '12,131', '较对照期增长 18.42%', 'blue'],
        ['页面访问', '28,416', '较对照期增长 22.67%'],
        ['跳出率', '38.27%', '较对照期下降 3.14 个百分点'],
        ['平均访问时长', '02:46', '较对照期增长 00:21'],
      ]) +
      chart('compare', '同期访问趋势', '对照序列按相对天数对齐，使用同一单位。') +
      panel(
        '来源变化',
        '各来源的绝对数量与变化比例。',
        table(
          ['来源', '当前访客', '对照访客', '变化'],
          [
            ['自然搜索', '4,216', '3,586', '+17.57%'],
            ['AI 引荐', '1,286', '864', '+48.84%'],
            ['直接访问', '3,178', '2,957', '+7.47%'],
            ['社交与其他', '3,451', '2,837', '+21.64%'],
          ],
          'compare',
          [1, 2, 3],
        ),
      )
    );
  if (id === 'annotations')
    return (
      searchPanel(
        '图表注释',
        '记录产品上线、内容发布与推广日期。',
        ['日期', '注释', '操作'],
        S.annotations.map((r, i) => [
          r[0],
          esc(r[1]),
          btn('编辑', 'drawer:annotation', false, `data-index="${i}" data-mutate`),
        ]),
        btn(icon('plus') + '添加注释', 'drawer:annotation', true, 'data-mutate'),
        'annotations',
      ) + chart('trend', '访问趋势', '日期注释将显示在相应时间节点。')
    );
}
