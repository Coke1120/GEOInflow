import { describe, expect, it, vi } from 'vitest';
import { mobileChartOptions, observeChartLayout } from './mobileChart';
const source = {
  tooltip: { trigger: 'axis' },
  legend: { top: 2 },
  grid: { left: 48, right: 24, top: 34, bottom: 26 },
  xAxis: {
    type: 'category',
    data: Array.from({ length: 30 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`),
  },
  yAxis: [{ type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } }],
  series: [{ type: 'line', name: '访客', data: [0, 2, 4], itemStyle: { color: '#0F62FE' } }],
};
describe('mobile chart presentation', () => {
  it('preserves complete data, units and desktop options while reducing date labels', () => {
    const before = JSON.stringify(source);
    const mobile = mobileChartOptions(source, 280, true);
    expect(mobile.series[0]).toBe(source.series[0]);
    expect(mobile.xAxis.data).toBe(source.xAxis.data);
    expect(mobile.xAxis.axisLabel.formatter('2026-10-03', 2)).toBe('10-03');
    expect(mobile.yAxis[0].axisLabel.formatter).toBe('{value}%');
    expect(mobile.tooltip.confine).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
    expect(mobileChartOptions(source, 480, false)).toBe(source);
  });
  it('retains category labels and pie data in the tooltip source', () => {
    const pie = {
      legend: {},
      series: [{ type: 'pie', data: [{ name: '完整长名称', value: 4 }], radius: ['48%', '70%'] }],
    };
    const mobile = mobileChartOptions(pie, 280, true);
    expect(mobile.series[0].data).toBe(pie.series[0].data);
    expect(mobile.series[0].radius).toBe(pie.series[0].radius);
  });
  it('keeps legend selections across rotation and releases all listeners', () => {
    const element = document.createElement('div');
    let width = 320;
    Object.defineProperty(element, 'clientWidth', { get: () => width });
    let change!: () => void;
    const remove = vi.fn();
    const media = {
      matches: true,
      addEventListener: (_event: string, fn: () => void) => (change = fn),
      removeEventListener: remove,
    };
    vi.spyOn(window, 'matchMedia').mockReturnValue(media as any);
    const instance = {
      setOption: vi.fn(),
      resize: vi.fn(),
      getOption: () => ({ legend: [{ selected: { 访客: false }, scrollDataIndex: 10 }] }),
    };
    const stop = observeChartLayout(instance, element, source);
    width = 1000;
    media.matches = false;
    change();
    const restored = instance.setOption.mock.calls.at(-1)![0];
    expect(restored.xAxis.axisLabel).toBeUndefined();
    expect(restored.legend.selected).toEqual({ 访客: false });
    expect(restored.legend.scrollDataIndex).toBe(10);
    expect(restored.series[0].data).toBe(source.series[0].data);
    stop();
    expect(remove).toHaveBeenCalledWith('change', change);
  });
});
it('distinguishes minutes and hours while keeping explicit formatters', () => {
  const base = {
    ...source,
    xAxis: { type: 'category', data: ['2026-10-04 09:00', '2026-10-04 10:30'] },
  };
  const axis = mobileChartOptions(base, 280, true).xAxis;
  expect(axis.axisLabel.formatter(base.xAxis.data[0], 0)).toBe('09:00');
  expect(axis.axisLabel.formatter(base.xAxis.data[1], 1)).toBe('10:30');
  const custom = {
    ...base,
    xAxis: {
      ...base.xAxis,
      axisLabel: { formatter: (value: string) => '时间 ' + value.slice(11) },
    },
  };
  expect(
    mobileChartOptions(custom, 280, true).xAxis.axisLabel.formatter(base.xAxis.data[0], 0),
  ).toBe('时间 09:00');
});
it('recalculates exact geometry when shrinking within the same tick-density group', () => {
  const element = document.createElement('div');
  let width = 343;
  let resize!: () => void;
  Object.defineProperty(element, 'clientWidth', { get: () => width });
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as any);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const instance = { setOption: vi.fn(), resize: vi.fn(), getOption: () => ({}) };
  const stop = observeChartLayout(instance, element, source);
  width = 288;
  resize();
  expect(instance.setOption).toHaveBeenCalledTimes(2);
  expect(instance.setOption.mock.calls[1][0].tooltip.extraCssText).toContain('max-width:264px');
  stop();
  vi.unstubAllGlobals();
});
