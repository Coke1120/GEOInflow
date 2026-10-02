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
});
