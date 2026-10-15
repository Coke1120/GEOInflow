import { describe, expect, it } from 'vitest';
import { chartOptions } from './chartOptions';

const data = {
  labels: ['A', 'B'],
  series: [
    { name: '真实系列', values: [7, 11] },
    { name: '第二系列', values: [3, 5] },
    { name: '第三系列', values: [20, 30] },
    { name: '第四系列', values: [4, 6] },
    { name: '第五系列', values: [2, 8] },
  ],
  rows: [{ words: 100, structureScore: 40, requests: 7, path: '/actual' }],
};
describe('the 22 supplied ECharts definitions', () => {
  it('preserves imported content category names that collide with application messages', () => {
    const chart = {
      labels: ['网站管理', '页面访问', '自定义分类'],
      series: [{ name: 'AI 蜘蛛', values: [1, 2, 3] }],
    };
    const original = JSON.stringify(chart);
    expect(chartOptions('pf1', chart, 'en-US').xAxis.data).toEqual(chart.labels);
    expect(chartOptions('pf1', chart, 'en-US').series[0].name).not.toBe('AI 蜘蛛');
    expect(JSON.stringify(chart)).toBe(original);
  });
  it('preserves visitor supplied device labels that collide with application messages', () => {
    const chart = {
      labels: ['网站管理', '页面访问', '未知'],
      series: [{ name: '会话', values: [1, 2, 3] }],
    };
    expect(chartOptions('h3', chart, 'en-US').series[0].data.map((row: any) => row.name)).toEqual(
      chart.labels,
    );
  });
  it('localizes owned channel and conversion labels while preserving funnel step values', () => {
    const chart = {
      labels: ['AI 搜索引荐', '直接访问'],
      series: [{ name: '转化率', values: [1, 2] }],
    };
    const option = chartOptions('f2', chart, 'en-US');
    expect(option.xAxis.data.join(' ')).not.toMatch(/AI 搜索引荐|直接访问/);
    expect(option.series[0].name).not.toBe('转化率');
    expect(chartOptions('f1', chart, 'en-US').series[0].data.map((row: any) => row.name)).toEqual(
      chart.labels,
    );
  });
  it('binds contract data across each original chart id', () => {
    for (const id of [
      'd1',
      'd2',
      'd3',
      'a1',
      'a2',
      'a3',
      'a4',
      'b1',
      'ap1',
      'pf1',
      'pf2',
      'h1',
      'h2',
      'h3',
      'g1',
      'g2',
      's1',
      's2',
      'c1',
      'f1',
      'f2',
      'f3',
    ]) {
      const option = chartOptions(id, data);
      expect(option.series.length).toBeGreaterThan(0);
      expect(option.series[0].data.length).toBe(id === 'pf2' ? 1 : 2);
    }
  });
  it('retains the original stacked, dual-axis, doughnut, bubble, and funnel geometry', () => {
    expect(chartOptions('d1', data).series[0]).toMatchObject({
      type: 'bar',
      stack: 'a',
      barWidth: 8,
    });
    expect(chartOptions('h1', data).yAxis).toHaveLength(2);
    expect(chartOptions('d2', data).series[0].radius).toEqual(['50%', '72%']);
    expect(chartOptions('pf2', data).series[0].data).toEqual([[100, 40, 7, '/actual']]);
    expect(chartOptions('f1', data).series[0]).toMatchObject({
      type: 'funnel',
      minSize: '22%',
      maxSize: '96%',
      gap: 4,
    });
  });
  it('only names bots present in the connected data', () => {
    const option = chartOptions('a1', {
      labels: ['A'],
      series: [{ name: 'ActualBot', values: [1] }],
    });
    expect(option.series).toHaveLength(1);
    expect(option.series[0].name).toBe('ActualBot');
  });
  it('keeps the overview bot legend in one row with the five largest request counts', () => {
    const chart = {
      labels: ['Bot A', 'Bot B', 'Bot C', 'Bot D', 'Bot E', 'Bot F', 'Bot G', 'Bot H'],
      series: [{ name: '请求量', values: [5, 70, 10, 40, 90, 20, 30, 60] }],
    };
    const original = structuredClone(chart);
    const option = chartOptions('d2', chart);
    expect(option.legend).toMatchObject({
      type: 'scroll',
      left: 16,
      right: 16,
      bottom: 4,
      data: ['Bot E', 'Bot B', 'Bot H', 'Bot D', 'Bot G'],
    });
    expect(option.series[0].data.map(({ name, value }) => [name, value])).toEqual(
      chart.labels.map((name, index) => [name, chart.series[0].values[index]]),
    );
    expect(option.series[0]).toMatchObject({ radius: ['50%', '72%'], center: ['50%', '44%'] });
    expect(option.tooltip).toMatchObject({ trigger: 'item', formatter: '{b}<br>{c} 次（{d}%）' });
    expect(chart).toEqual(original);
  });
  it('uses the available bot names and stable ordering for tied request counts', () => {
    expect(chartOptions('d2', data).legend.data).toEqual(['B', 'A']);
    expect(chartOptions('d2', { labels: [], series: [] }).legend.data).toEqual([]);
    expect(
      chartOptions('d2', { labels: ['A', 'B', 'C'], series: [{ name: '请求量', values: [1, 1] }] })
        .legend.data,
    ).toEqual(['A', 'B', 'C']);
    expect(chartOptions('d3', data).legend.type).toBeUndefined();
  });
});

describe('search engine pie charts', () => {
  it('keeps all platforms and fixes the denominator while preserving stable platform colors', () => {
    const input = {
      labels: ['Google', 'Bing', '百度', '搜狗', '360', 'DuckDuckGo', 'Yahoo'],
      series: [{ name: '会话', values: [7, 6, 5, 4, 3, 2, 1] }],
    };
    const option = chartOptions('se1', input);
    expect(option.series[0].data).toHaveLength(7);
    expect(option.legend).toMatchObject({ type: 'scroll', selectedMode: false });
    expect(option.legend.formatter('Google')).toBe('Google 25%');
    expect(option.tooltip.formatter({ name: '<script>', value: 7 })).toBe(
      '&lt;script&gt;<br>7 会话（25%）',
    );
    const reordered = chartOptions('se1', { ...input, labels: [...input.labels].reverse() });
    expect(option.series[0].data[0].itemStyle.color).toBe(
      reordered.series[0].data.at(-1).itemStyle.color,
    );
  });
});

it.each(['se1', 'se2'])('preserves platform colors and values in English %s', id => {
  const chart = {
    labels: id === 'se1' ? ['Google', 'Bing'] : ['ChatGPT', 'Perplexity'],
    series: [{ name: '会话', values: [7, 11] }],
  };
  const chinese = chartOptions(id, chart, 'zh-CN');
  const english = chartOptions(id, chart, 'en-US');
  expect(english.series[0].data).toEqual(chinese.series[0].data);
  expect(english.tooltip.formatter({ name: '<script>', value: 7 })).toContain('&lt;script&gt;');
  expect(english.tooltip.formatter({ name: 'Google', value: 7 })).not.toContain('会话');
});

it('translates generated overview channels while preserving raw AI referral names', () => {
  const chart = {
    labels: ['直接访问', '其他引荐', '网站管理'],
    series: [{ name: '会话', values: [3, 2, 1] }],
  };
  const original = structuredClone(chart);
  const channels = chartOptions('d3', chart, 'en-US').series[0].data;
  expect(channels.slice(0, 2).map(row => row.name)).toEqual(['Direct traffic', 'Other referrals']);
  expect(channels.map(row => row.value)).toEqual([3, 2, 1]);
  const raw = chartOptions('s2', chart, 'en-US').series[0].data;
  expect(raw.map(row => row.name)).toEqual(chart.labels);
  expect(raw.map(row => row.itemStyle)).toEqual(
    chartOptions('s2', chart).series[0].data.map(row => row.itemStyle),
  );
  expect(chart).toEqual(original);
});

it('distinguishes same-name crawler identities without translating raw names or vendors', () => {
  const chart = {
    labels: ['网站管理', '网站管理'],
    series: [
      { name: '网站管理', values: [2] },
      { name: '网站管理', values: [1] },
    ],
    rows: [
      { name: '网站管理', vendor: '页面访问', botId: 'gptbot' },
      { name: '网站管理', vendor: '页面访问', botId: null },
    ],
  };
  const english = chartOptions('a1', chart, 'en-US');
  expect(english.series[0].name).toBe('网站管理 (页面访问 · Official identity)');
  expect(english.series[1].name).toBe('网站管理 (页面访问 · Custom / historical unmapped)');
  expect(chartOptions('a1', chart).series[1].name).toBe(
    '网站管理（页面访问 · 自定义／历史未映射）',
  );
  expect(english.series.map(row => row.data)).toEqual([[2], [1]]);
});
