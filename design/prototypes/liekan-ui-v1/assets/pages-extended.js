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
  definition,
  tabs,
  searchPanel,
  form,
  code,
  actionCell,
  sampleWeb,
} from './components.js';
export function extendedPage(id) {
  const linkIndex = S.selected.link >= 0 ? S.selected.link : 0,
    selectedLink = S.links[linkIndex] || S.links[0];
  const pixelIndex = S.selected.pixel >= 0 ? S.selected.pixel : 0,
    selectedPixel = S.pixels[pixelIndex] || S.pixels[0];
  const replay = fixtures.sessions[S.selected.replay] || fixtures.sessions[0];
  const savedReplay = fixtures.sessions[S.savedReplayRecord] || fixtures.sessions[0];
  const pixelCode =
    '<img src="https://pixel.liekan.example/' +
    (id === 'pixel-editor' && S.selected.pixel < 0
      ? 'demo-pixel'
      : selectedPixel?.[1] || 'demo-pixel') +
    '" width="1" height="1" alt="" />';
  if (id === 'performance') {
    const m = S.tab.metric || 'lcp',
      p = S.tab.percentile || 'p75';
    const multiplier = { p50: 0.68, p75: 1, p95: 1.75 }[p];
    const performanceValue = (lcp, inp, cls, fcp, ttfb) => {
      const n = { lcp, inp, cls, fcp, ttfb }[m] * multiplier;
      return m === 'cls'
        ? n.toFixed(3)
        : n >= 1000
          ? (n / 1000).toFixed(2) + ' s'
          : Math.round(n) + ' ms';
    };
    const vals = [
      ['LCP', (1.86 * multiplier).toFixed(2) + ' s', '最大内容绘制'],
      ['INP', Math.round(148 * multiplier) + ' ms', '交互延迟'],
      ['CLS', (0.047 * multiplier).toFixed(3), '累计布局偏移'],
      ['FCP', (1.24 * multiplier).toFixed(2) + ' s', '首次内容绘制'],
      ['TTFB', Math.round(386 * multiplier) + ' ms', '首字节时间'],
    ];
    return (
      `<div class="row between">${tabs(
        [
          ['lcp', 'LCP'],
          ['inp', 'INP'],
          ['cls', 'CLS'],
          ['fcp', 'FCP'],
          ['ttfb', 'TTFB'],
        ],
        m,
        'metric',
      )}${select(
        '摘要分位数',
        'percentile',
        [
          ['p50', 'p50 · 中位数'],
          ['p75', 'p75 · 第 75 分位'],
          ['p95', 'p95 · 第 95 分位'],
        ],
        p,
        'data-chart-control',
      )}</div>` +
      metrics(
        vals.map(([l, v, f]) => [l, v, `${f} · ${p}`, l.toLowerCase() === m ? 'blue' : '']),
        'five',
      ) +
      chart('performance', `${m.toUpperCase()} 分位数趋势`, 'p50、p75、p95 · 12,684 次示例采样') +
      `<div class="two">${panel(
        '页面性能',
        '所选指标和分位数，保留单位。',
        table(
          ['页面', `${m.toUpperCase()} · ${p}`, '采样数'],
          [
            ['/guide/geo', performanceValue(1930, 152, 0.048, 1290, 398), '3,416'],
            ['/pricing', performanceValue(1620, 128, 0.031, 1060, 328), '2,137'],
            ['/solutions', performanceValue(2140, 176, 0.065, 1470, 437), '1,846'],
          ],
          'performance',
          [1, 2],
        ),
      )}${panel(
        '环境拆分',
        '设备与浏览器分别查看。',
        table(
          ['设备', `${m.toUpperCase()} · ${p}`, '采样数'],
          [
            ['桌面', performanceValue(1670, 134, 0.037, 1110, 349), '7,486'],
            ['移动', performanceValue(2190, 181, 0.062, 1490, 451), '4,864'],
            ['平板', performanceValue(1840, 157, 0.043, 1220, 381), '334'],
          ],
          'performanceDevices',
          [1, 2],
        ),
      )}</div>` +
      notice(
        '性能数据需采集对应浏览器指标。没有样本时显示“未采集”，不以 0 代替。CLS 不使用时间单位。',
      )
    );
  }
  if (id === 'revenue') {
    const currency = S.tab.currency || 'CNY',
      prefix = currency === 'USD' ? '$' : '¥',
      f = currency === 'USD' ? 0.14 : 1;
    return (
      `<div class="row between">${select('币种', 'currency', ['CNY', 'USD'], currency, 'data-chart-control')}${tabs(
        [
          ['period', '按期间'],
          ['cumulative', '累计'],
        ],
        S.tab.revenueMode || 'period',
        'revenueMode',
      )}</div>` +
      metrics([
        [
          '收入',
          prefix +
            (52487.36 * f).toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }),
          currency + ' · 所选币种',
        ],
        ['付费事件', '147', 'revenue 事件触发次数'],
        ['付费访客', '132', '独立访客'],
        ['平均事件金额', prefix + (357.05687 * f).toFixed(2), '收入 / 付费事件'],
      ]) +
      chart('revenue', '收入趋势', '按币种分开分析，原型切换为对应示例数据。') +
      `<div class="two">${panel(
        '收入来源',
        '当前币种的收入贡献。',
        table(
          ['来源', '收入', '占比'],
          [
            ['自然搜索', prefix + (23864.12 * f).toFixed(2), '45.47%'],
            ['AI 引荐', prefix + (14286.47 * f).toFixed(2), '27.22%'],
            ['直接与其他', prefix + (14336.77 * f).toFixed(2), '27.31%'],
          ],
          'revenue',
          [1, 2],
        ),
      )}${panel(
        '交易会话',
        '事件金额与币种属性。',
        table(
          ['会话', '事件', '金额', '操作'],
          [
            [
              '访客 8f3c',
              'purchase',
              prefix + (698 * f).toFixed(2),
              actionCell('详情', 'session-detail'),
            ],
            [
              '访客 c7a1',
              'purchase',
              prefix + (349 * f).toFixed(2),
              actionCell('详情', 'session-detail'),
            ],
          ],
          'transactions',
          [2],
        ),
      )}</div>` +
      notice('不同币种分别展示。原型金额用于视觉排版，汇率换算与交易去重需在后端融合时确定。')
    );
  }
  if (id === 'heatmaps') {
    const mode = S.heatMode;
    const overlay =
      mode === 'click'
        ? `<span class="hot-spot" style="width:115px;height:115px;left:24px;top:205px"></span><span class="hot-spot" style="width:78px;height:78px;right:15px;top:0"></span><span class="hot-spot" style="width:68px;height:68px;left:48%;top:290px"></span>`
        : `<div class="scroll-layer"></div>`;
    return (
      notice('热力图画布使用内置示例页面，不加载外部网页，也不采集真实点击。', 'amber') +
      `<div class="row between"><div class="row">${select('页面', 'heatPath', ['/guide/geo', '/pricing', '/solutions'], S.tab.heatPath || '/guide/geo', 'data-chart-control')}${select(
        '设备',
        'device',
        [
          ['desktop', '桌面'],
          ['phone', '移动'],
        ],
        S.device,
        'data-control="device"',
      )}</div>${tabs(
        [
          ['click', '点击热力图'],
          ['scroll', '滚动热力图'],
        ],
        mode,
        'heatMode',
      )}</div>` +
      metrics(
        mode === 'click'
          ? [
              ['采样会话', '864', '当前页面与设备'],
              ['点击次数', '1,327', '示例点击'],
              ['主要点击', '预约诊断', '点击聚集位置'],
              ['采样率', '15%', '行为采集配置'],
            ]
          : [
              ['采样会话', '864', '当前页面与设备'],
              ['到达 50%', '61.34%', '530 / 864'],
              ['到达 75%', '34.14%', '295 / 864'],
              ['到达底部', '18.75%', '162 / 864'],
            ],
      ) +
      `<div class="wide-narrow">${panel(mode === 'click' ? '点击分布' : '滚动深度', '热度表达聚合强度，右侧同时提供数值。', body(sampleWeb(overlay, S.device === 'phone')))}${panel(
        '页面明细',
        '示例采样区间：2026-09-01 至 09-30。',
        body(
          `${definition([
            ['页面', esc(S.tab.heatPath || '/guide/geo')],
            ['设备', S.device === 'phone' ? '移动' : '桌面'],
            ['采集范围', '已遮蔽敏感输入'],
            ['热度颜色', '蓝：低；橙：中；红：高'],
          ])}<hr class="divider">${table(
            mode === 'click' ? ['区域', '点击'] : ['深度', '到达会话'],
            mode === 'click'
              ? [
                  ['预约诊断', '427'],
                  ['导航联系', '186'],
                  ['内容卡片', '143'],
                ]
              : [
                  ['25%', '721'],
                  ['50%', '530'],
                  ['75%', '295'],
                  ['100%', '162'],
                ],
            'heatDetails',
            [1],
          )}<div class="form-actions">${link('采集设置', 'recorder-settings')}</div>`,
        ),
      )}</div>`
    );
  }
  if (id === 'replays')
    return (
      tabs(
        [
          ['all', '所有录制'],
          ['saved', '已保存'],
        ],
        S.tab.replays || 'all',
        'replays',
      ) +
      searchPanel(
        '会话录制',
        '隐私遮蔽后的示例录制，原型播放器使用合成页面。',
        ['录制', '来源', '设备', '时长', '页面数', '状态', '操作'],
        S.tab.replays === 'saved'
          ? S.savedReplay
            ? [
                [
                  esc(S.savedReplayName || '预约路径检查'),
                  savedReplay[3],
                  S.savedReplayRecord === 1 ? '移动' : '桌面',
                  savedReplay[6],
                  savedReplay[5],
                  badge('已保存', 'blue'),
                  actionCell('播放', 'replay-player', 'replay', S.savedReplayRecord),
                ],
              ]
            : []
          : [
              [
                '访客 8f3c · 09:42:18',
                'ChatGPT',
                '桌面',
                '03:24',
                '4',
                badge('可播放', 'green'),
                actionCell('播放', 'replay-player', 'replay', 0),
              ],
              [
                '访客 c7a1 · 09:41:52',
                'Google',
                '移动',
                '02:16',
                '3',
                badge('可播放', 'green'),
                actionCell('播放', 'replay-player', 'replay', 1),
              ],
              [
                '访客 d2f8 · 09:39:16',
                '百度',
                '桌面',
                '05:31',
                '6',
                badge('可播放', 'green'),
                actionCell('播放', 'replay-player', 'replay', 3),
              ],
            ],
        link('采集设置', 'recorder-settings'),
        'replays',
        [3, 4],
      ) +
      (S.tab.replays === 'saved' && !S.savedReplay
        ? notice('还没有保存录制。打开任一示例录制后点击“保存录制”。')
        : notice('采集开关、采样与存储策略从行为采集设置管理。此处不会展示未遮蔽的输入内容。'))
    );
  if (id === 'replay-player')
    return (
      `<div class="row between"><div><h2>${esc(replay[0])} · 访问路径</h2><p class="muted">2026-09-30 ${replay[1]} · ${S.selected.replay === 1 ? '移动' : '桌面'} · 合成示例录制</p></div><div class="actions">${link('返回录制列表', 'replays')}${btn(S.savedReplay && S.savedReplayRecord === S.selected.replay ? '已保存' : '保存录制', 'drawer:save-replay', false, 'data-mutate')}</div></div>` +
      notice('播放器以合成页面演示控制器与时间线，真实录制数据和隐私处理待融合。', 'amber') +
      `<div class="wide-narrow">${panel(
        '回放画布',
        '遮蔽输入 · 示例视口',
        body(
          `${sampleWeb('<span class="replay-cursor">↖</span>')}<div class="player-controls">${btn(icon(S.playing ? 'pause' : 'play') + (S.playing ? '暂停' : '播放'), 'replay-toggle')}<span class="num" id="replay-clock">${clock(S.replayTime)} / ${clock(S.replayTotal)}</span><input type="range" min="0" max="${S.replayTotal}" value="${S.replayTime}" data-control="replayTime" aria-label="播放位置">${select(
            '播放速度',
            'speed',
            [
              ['.5', '0.5×'],
              ['1', '1×'],
              ['2', '2×'],
              ['4', '4×'],
            ],
            S.speed,
            'data-control="speed"',
          )}</div>`,
        ),
      )}${panel(
        '行为时间线',
        '点击节点定位到录制时间。',
        body(
          `<ul class="timeline">${[
            ['0', '/guide/geo', '页面进入'],
            ['33', 'navigation_click', '导航点击'],
            ['51', '/pricing', '查看价格'],
            ['123', '/demo', '填写表单 · 内容已遮蔽'],
            ['188', 'demo_submit', '提交演示'],
            ['204', '/demo/thanks', '会话结束'],
          ]
            .map(
              ([t, v, d]) =>
                `<li><time class="timeline-time">${clock(Math.round((Number(t) * S.replayTotal) / 204))}</time><button class="table-action" data-action="replay-seek" data-time="${Math.round((Number(t) * S.replayTotal) / 204)}">${v}</button><p>${d}</p></li>`,
            )
            .join(
              '',
            )}</ul><hr class="divider">${link('会话详情', 'session-detail', false, `data-entity="session" data-index="${S.selected.replay}"`)}`,
        ),
      )}</div>`
    );
  if (id === 'links')
    return (
      searchPanel(
        '追踪链接',
        '短链沿用原有链接访问统计接口。',
        ['名称', '目标地址', '短链标识', '点击次数', '操作'],
        S.links.map((r, i) => [
          esc(r[0]),
          esc(r[1]),
          `<code>${esc(r[2])}</code>`,
          r[3],
          actionCell('详情', 'link-detail', 'link', i),
        ]),
        link(icon('plus') + '创建链接', 'link-editor', true),
        'links',
        [3],
      ) + notice('本轮短链仅为示例文字，点击页面中的详情入口查看统计设计。')
    );
  if (id === 'link-editor')
    return panel(
      '链接信息',
      '名称、目标地址与自定义短链标识。',
      body(
        form(
          'link-save',
          `${field('链接名称', 'name', S.selected.link >= 0 ? selectedLink[0] : '', 'text', '', true)}${field('目标 URL', 'url', S.selected.link >= 0 ? selectedLink[1] : 'https://yishan.example/research', 'url', '需要完整 https:// 或 http:// 地址。', true)}<div class="row">${field('短链标识', 'slug', S.selected.link >= 0 ? selectedLink[2] : 'geo-report', 'text', '字母、数字、短横线与下划线。', true)}${btn('随机生成', 'generate-slug')}</div>${field('预览地址', 'preview', 'https://go.liekan.example/' + (S.selected.link >= 0 ? selectedLink[2] : 'geo-report'), 'text', '原型地址，不会实际创建重定向。', false, 'readonly')}`,
          '保存链接',
          'links',
        ),
      ),
    );
  if (id === 'link-detail')
    return (
      `<div class="row between"><div><h2>${esc(selectedLink[0])}</h2><p class="muted">https://go.liekan.example/${esc(selectedLink[2])}</p></div><div class="actions">${link('编辑', 'link-editor', false, `data-entity="link" data-index="${linkIndex}"`)}${btn('分享设置', 'drawer:resource-share', false, 'data-mutate')}${link('返回列表', 'links')}</div></div>` +
      metrics([
        ['点击次数', selectedLink[3], '当前期间'],
        [
          '独立访客',
          Math.round(Number(selectedLink[3].replaceAll(',', '')) * 0.76).toLocaleString('en-US'),
          '示例访问标识聚合',
        ],
        ['主要来源', 'Newsletter', '已提供的引荐信息'],
        ['目标网站', '移山 GEO', 'yishan.example'],
      ]) +
      chart('links', '链接访问趋势', '短链点击次数，按日期聚合。') +
      panel(
        '来源与地域',
        '从链接详情查看访问构成。',
        table(
          ['来源', '地域', '点击次数'],
          [
            ['Newsletter', '中国', '846'],
            ['LinkedIn', '美国', '487'],
            ['直接访问', '其他', '540'],
          ],
          'linkSources',
          [2],
        ),
      )
    );
  if (id === 'pixels')
    return (
      searchPanel(
        '追踪像素',
        '图片请求的统计，与网页访问分开显示。',
        ['名称', '像素标识', '请求次数', '操作'],
        S.pixels.map((r, i) => [
          esc(r[0]),
          `<code>${esc(r[1])}</code>`,
          r[2],
          actionCell('详情', 'pixel-detail', 'pixel', i),
        ]),
        link(icon('plus') + '创建像素', 'pixel-editor', true),
        'pixels',
        [2],
      ) + notice('邮件代理、缓存和重复请求会影响像素请求量。请求次数不能直接视为真实阅读人数。')
    );
  if (id === 'pixel-editor')
    return panel(
      '像素信息',
      '名称和自动生成的像素地址。',
      body(
        form(
          'pixel-save',
          `${field('像素名称', 'name', S.selected.pixel >= 0 ? selectedPixel[0] : '', 'text', '', true)}${field('像素地址', 'url', 'https://pixel.liekan.example/' + (S.selected.pixel >= 0 ? selectedPixel[1] : 'demo-pixel'), 'text', '保存后生成地址，原型地址仅作示例。', false, 'readonly')}${code(pixelCode)}${btn(icon('copy') + '复制示例代码', 'copy:pixel')}`,
          '保存像素',
          'pixels',
        ),
      ),
    );
  if (id === 'pixel-detail')
    return (
      `<div class="row between"><div><h2>${esc(selectedPixel[0])}</h2><p class="muted">像素标识 · ${esc(selectedPixel[1])}</p></div><div class="actions">${link('编辑', 'pixel-editor', false, `data-entity="pixel" data-index="${pixelIndex}"`)}${btn('分享设置', 'drawer:resource-share', false, 'data-mutate')}${link('返回列表', 'pixels')}</div></div>` +
      metrics([
        ['请求次数', selectedPixel[2], '按像素请求计数'],
        ['统计口径', '图片请求', '包括代理与缓存影响'],
        ['主要环境', '邮件代理', '示例识别结果'],
        ['最近请求', '09:38:47', '2026-09-30'],
      ]) +
      chart('pixels', '像素请求趋势', '请求次数与独立打开人数使用不同口径。') +
      panel(
        '安装代码',
        '图片引用沿用现有像素地址格式。',
        body(`${code(pixelCode)}${btn(icon('copy') + '复制示例代码', 'copy:pixel')}`),
      )
    );
  if (id === 'exports')
    return `<div class="wide-narrow">${panel(
      '创建导出任务',
      '完整导出的新增 UI 方案，权限与执行由后端融合阶段补齐。',
      body(
        form(
          'export-create',
          `${select(
            '导出网站',
            'website',
            S.sites.map(r => r[0]),
            S.site,
          )}<div class="form-grid">${field('开始日期', 'start', '2026-09-01', 'date', '', true)}${field('结束日期', 'end', '2026-09-30', 'date', '', true)}</div><h3>数据范围</h3><div class="two">${check('汇总指标', 'summary', true)}${check('页面与来源', 'dimensions', true)}${check('事件与属性', 'events', true)}${check('会话明细（脱敏）', 'sessions', false)}${check('已保存配置', 'config', true)}</div>${select(
            '文件格式',
            'format',
            [
              ['zip', 'ZIP：CSV 与字段清单'],
              ['csv', 'CSV：汇总指标'],
              ['json', 'JSON：汇总与字段清单'],
            ],
            'zip',
          )}${notice('可下载的文件仅包含内置示例数据，文件名与清单均标记 demo。真实数据导出不会在本轮执行。', 'amber')}`,
          '生成示例导出',
        ),
      ),
    )}${panel('导出任务', '演示排队、生成和完成状态。', body(`<div id="export-task">${exportTask()}</div>`))}</div>`;
}
export const clock = v =>
  `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(Math.floor(v % 60)).padStart(2, '0')}`;
export function exportTask() {
  return S.exportStatus === 'idle'
    ? `<div class="state-box" style="border:0;padding:24px 0"><h3>还没有导出任务</h3><p>左侧选择范围并生成示例文件。</p></div>`
    : S.exportStatus === 'working'
      ? `<div class="stack"><div class="row between"><strong>正在生成示例文件</strong><span class="num">${S.exportProgress}%</span></div><div class="progress"><i style="width:${S.exportProgress}%"></i></div><p class="muted">模拟步骤：校验范围 → 整理字段 → 生成下载。</p>${btn('取消任务', 'export-cancel')}</div>`
      : `<div class="stack">${badge('示例文件已就绪', 'green')}${definition([
          ['网站', esc(S.exportConfig?.website || S.site)],
          [
            '范围',
            esc(
              `${S.exportConfig?.start || '2026-09-01'} 至 ${S.exportConfig?.end || '2026-09-30'}`,
            ),
          ],
          ['格式', S.exportConfig?.format?.toUpperCase() || 'ZIP'],
          ['敏感字段', '不包含原始 IP 或账户凭据'],
          ['数据性质', '内置示例，与生产数据无关'],
        ])}${btn(icon('download') + '下载示例文件', 'download:export', true)}${btn('查看字段清单', 'drawer:export-manifest')}</div>`;
}
