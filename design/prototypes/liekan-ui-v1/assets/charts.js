import { eventSample, journeySample } from './sample-data.js';
const C = ['#0F62FE', '#4589FF', '#009D9A', '#7C5CFC', '#B7791F', '#9AA3B2'];
let instances = [];
const dates = Array.from({ length: 14 }, (_, i) => `09/${String(i + 17).padStart(2, '0')}`);
const values = [648, 719, 674, 892, 931, 876, 964, 1103, 986, 1084, 1273, 1148, 1306, 1286];
const base = () => ({
  animation: false,
  color: C,
  textStyle: { fontFamily: 'Inter, PingFang SC, sans-serif' },
  tooltip: {
    trigger: 'axis',
    backgroundColor: '#fff',
    borderColor: '#E9ECF1',
    borderWidth: 1,
    textStyle: { color: '#16181D', fontSize: 12 },
    extraCssText: 'box-shadow:0 4px 16px rgba(22,24,29,.08);border-radius:9px',
  },
  legend: {
    top: 2,
    right: 8,
    itemWidth: 10,
    itemHeight: 10,
    textStyle: { color: '#697386', fontSize: 11 },
  },
  grid: { left: 48, right: 24, top: 34, bottom: 26 },
  xAxis: {
    type: 'category',
    data: dates,
    boundaryGap: false,
    axisLine: { lineStyle: { color: '#E9ECF1' } },
    axisTick: { show: false },
    axisLabel: { fontSize: 10, color: '#9AA3B2' },
  },
  yAxis: {
    type: 'value',
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { fontSize: 10.5, color: '#9AA3B2' },
    splitLine: { lineStyle: { color: '#E9ECF1', type: 'solid' } },
  },
  series: [],
});
const line = (name, data, color = C[0]) => ({
  name,
  type: 'line',
  data,
  smooth: true,
  symbol: 'none',
  lineStyle: { width: 2.5, color },
  itemStyle: { color },
});
export function option(kind, settings = {}) {
  const o = base();
  switch (kind) {
    case 'trend':
      o.series = [
        line('访客', values),
        line(
          'AI 引荐',
          values.map((v, i) => Math.round(v * (0.09 + i * 0.004))),
          C[2],
        ),
      ];
      break;
    case 'events':
      o.series = [
        line(
          '预约演示',
          values.map((v, i) => Math.round(v * (0.03 + i * 0.0006))),
        ),
        line(
          '报告下载',
          values.map(v => Math.round(v * 0.047)),
          C[1],
        ),
      ];
      break;
    case 'goal':
      o.series = [
        line(
          '目标转化',
          values.map((v, i) => Math.round(v * (0.03 + i * 0.0006))),
        ),
      ];
      break;
    case 'realtime':
      o.xAxis.data = ['09:13', '09:18', '09:23', '09:28', '09:33', '09:38', '09:43'];
      o.series = [
        {
          name: '活跃访客',
          type: 'bar',
          data: [13, 17, 14, 21, 27, 23, 31],
          barWidth: 9,
          itemStyle: { borderRadius: [3, 3, 0, 0] },
        },
      ];
      break;
    case 'compare':
      o.series = [
        line('当前期间', values),
        {
          ...line(
            '对照期间',
            values.map((v, i) => Math.round(v * (0.76 + i * 0.006))),
            C[1],
          ),
          lineStyle: { type: 'dashed', width: 2, color: C[1] },
        },
      ];
      break;
    case 'channels':
    case 'utm':
    case 'properties':
    case 'attribution':
    case 'breakdown': {
      const map = {
        channels: [
          ['自然搜索', '直接访问', '社交与其他', 'AI 引荐'],
          [4216, 3178, 3451, 1286],
        ],
        utm: [
          ['google', 'newsletter', 'chatgpt', 'linkedin', 'perplexity'],
          [2817, 1476, 938, 654, 348],
        ],
        properties: [
          ['growth', 'starter', 'enterprise', '未提供'],
          [187, 112, 64, 23],
        ],
        attribution: [
          ['自然搜索', 'AI 引荐', '直接访问', '社交与其他'],
          [147, 87, 96, 56],
        ],
        breakdown: [
          ['/guide/geo · 中国', '/pricing · 中国', '/guide/geo · 日本', '/case-study · 美国'],
          [1384, 947, 724, 512],
        ],
      };
      let [labels, data] = map[kind];
      if (kind === 'properties' && settings.property) {
        const properties = {
          placement: [
            ['header', 'pricing', 'footer', '未提供'],
            [164, 117, 83, 22],
          ],
          source: [
            ['organic', 'ai-referral', 'direct', '未提供'],
            [147, 87, 96, 56],
          ],
          value: [
            ['0–99', '100–299', '300–699', '700+'],
            [73, 128, 117, 68],
          ],
        };
        if (properties[settings.property]) [labels, data] = properties[settings.property];
      }
      if (kind === 'attribution' && settings.model === 'last-click') data = [124, 68, 137, 57];
      if (kind === 'utm' && settings.utmDimension) {
        const dims = {
          medium: [
            ['organic', 'email', 'referral', 'social'],
            [2817, 1476, 1286, 654],
          ],
          campaign: [
            ['秋季研究报告', '增长诊断', 'GEO 指南'],
            [2137, 846, 1324],
          ],
          content: [
            ['header-link', 'case-study', 'footer-cta'],
            [934, 671, 482],
          ],
          term: [
            ['GEO 分析', 'AI 流量', '品牌搜索'],
            [884, 712, 537],
          ],
        };
        if (dims[settings.utmDimension]) [labels, data] = dims[settings.utmDimension];
      }
      if (kind === 'properties') {
        const sample = eventSample(settings.property || 'plan');
        labels = sample.values.map(row => row[0]);
        data = sample.values.map(row => row[1]);
      }
      const ranked = labels.map((label, i) => [label, data[i]]).sort((a, b) => b[1] - a[1]);
      labels = ranked.map(row => row[0]);
      data = ranked.map(row => row[1]);
      o.xAxis = { ...o.yAxis, type: 'value' };
      o.yAxis = {
        type: 'category',
        data: labels.reverse(),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 11, color: '#697386' },
      };
      o.grid.left = kind === 'breakdown' ? 150 : 96;
      o.grid.right = 56;
      o.series = [
        {
          name:
            kind === 'attribution' ? '归因转化' : kind === 'properties' ? '触发次数' : '访问次数',
          type: 'bar',
          data: data.reverse(),
          barWidth: 14,
          itemStyle: { borderRadius: [0, 3, 3, 0] },
          label: { show: true, position: 'right', fontSize: 11, color: '#697386' },
        },
      ];
      o.legend.show = false;
      break;
    }
    case 'journey': {
      delete o.xAxis;
      delete o.yAxis;
      delete o.grid;
      o.legend.show = false;
      o.tooltip.trigger = 'item';
      const paths = journeySample(settings);
      const names = [...new Set(paths.flatMap(path => path.nodes))];
      const connections = new Map();
      for (const path of paths)
        for (let i = 1; i < path.nodes.length; i++) {
          const source = path.nodes[i - 1],
            target = path.nodes[i],
            key = JSON.stringify([source, target]);
          connections.set(key, (connections.get(key) || 0) + path.count);
        }
      o.series = [
        {
          type: 'sankey',
          left: 20,
          right: 110,
          top: 32,
          bottom: 30,
          nodeWidth: 14,
          nodeGap: 24,
          layoutIterations: 32,
          data: names.map((name, i) => ({ name, itemStyle: { color: C[i % C.length] } })),
          links: [...connections].map(([key, value]) => {
            const [source, target] = JSON.parse(key);
            return { source, target, value };
          }),
          lineStyle: { color: 'source', opacity: 0.16, curveness: 0.5 },
          label: { color: '#697386', fontSize: 11 },
        },
      ];
      break;
    }
    case 'performance': {
      const scale = { lcp: 1, inp: 0.08, cls: 0.000035, fcp: 0.64, ttfb: 0.21 }[
        settings.metric || 'lcp'
      ];
      o.series = [
        line(
          'p50',
          values.map(v => Math.round((v + 320) * scale)),
          C[2],
        ),
        line(
          'p75',
          values.map(v => Math.round((v + 840) * scale)),
          C[0],
        ),
        line(
          'p95',
          values.map(v => Math.round((v + 1900) * scale)),
          C[1],
        ),
      ];
      if (settings.metric === 'cls')
        o.series.forEach(
          (s, j) =>
            (s.data = values.map(v => Number(((v + [320, 840, 1900][j]) * scale).toFixed(3)))),
        );
      o.tooltip.valueFormatter = value =>
        settings.metric === 'cls'
          ? Number(value).toFixed(3) + ' CLS'
          : Number(value).toLocaleString('en-US') + ' ms';
      o.yAxis.name = settings.metric === 'cls' ? 'CLS' : 'ms';
      o.yAxis.nameTextStyle = { color: '#697386', fontSize: 10.5 };
      break;
    }
    case 'revenue': {
      const currency = settings.currency || 'CNY',
        factor = currency === 'USD' ? 0.14 : 1;
      const data = [438, 527, 384, 697, 643, 581, 746, 923, 817, 864, 1147, 932, 1258, 1086].map(
        v => Number((v * factor).toFixed(2)),
      );
      let acc = 0;
      const r =
        settings.revenueMode === 'cumulative' ? data.map(v => Number((acc += v).toFixed(2))) : data;
      o.series = [
        line(`${settings.revenueMode === 'cumulative' ? '累计收入' : '收入'} (${currency})`, r),
      ];
      o.yAxis.name = currency;
      o.tooltip.valueFormatter = value =>
        (currency === 'USD' ? '$' : '¥') +
        Number(value).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }) +
        ' ' +
        currency;
      break;
    }
    case 'links':
      o.series = [
        line(
          '点击次数',
          values.map(v => Math.round(v * 0.11)),
        ),
      ];
      break;
    case 'pixels':
      o.series = [
        line(
          '像素请求',
          values.map(v => Math.round(v * 0.23)),
        ),
      ];
      break;
  }
  return o;
}
export function disposeCharts() {
  instances.forEach(x => x.dispose());
  instances = [];
}
export function hydrateCharts(settings = {}) {
  if (!window.echarts) return;
  document.querySelectorAll('[data-chart]').forEach(el => {
    const ins = window.echarts.init(el);
    ins.setOption(option(el.dataset.chart, settings));
    instances.push(ins);
  });
}
export function resizeCharts() {
  instances.forEach(x => x.resize());
}
export function updateCharts(settings = {}) {
  document.querySelectorAll('[data-chart]').forEach(el => {
    const ins = window.echarts.getInstanceByDom(el);
    ins?.setOption(option(el.dataset.chart, settings), true);
  });
}
