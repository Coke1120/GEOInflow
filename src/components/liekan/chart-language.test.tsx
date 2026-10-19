import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';
import { ReferenceChart } from './ReportComponents';
import { Chart } from './features/Chart';
import { DataLoading } from './DataLoading';

const engine = vi.hoisted(() => ({ charts: [] as any[], failNext: false }));
vi.mock('echarts', async importOriginal => {
  const actual = await importOriginal<typeof import('echarts')>();
  actual.setPlatformAPI({ measureText: text => ({ width: String(text).length * 7 }) });
  return {
    ...actual,
    init: () => {
      const chart = actual.init(null, undefined, {
        renderer: 'svg',
        ssr: true,
        width: 480,
        height: 260,
      });
      if (engine.failNext) {
        engine.failNext = false;
        const setOption = chart.setOption;
        chart.setOption = () => {
          chart.setOption = setOption;
          throw new Error('Test render failure');
        };
      }
      engine.charts.push(chart);
      return chart;
    },
  };
});
vi.mock('./chartRuntime', () => ({ loadEcharts: () => import('echarts') }));

beforeEach(() => {
  engine.charts.length = 0;
  engine.failNext = false;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(480);
});
afterEach(() => {
  for (const chart of engine.charts) if (!chart.isDisposed()) chart.dispose();
});

async function hideLastSeries() {
  await waitFor(() => expect(engine.charts.at(-1)?.getOption().series).toHaveLength(2));
  const chart = engine.charts.at(-1);
  const name = chart.getOption().series[1].name;
  act(() => chart.dispatchAction({ type: 'legendUnSelect', name }));
  expect(chart.getOption().legend[0].selected[name]).toBe(false);
}

it('retains a GEO chart legend choice while displaying the same snapshot in English', async () => {
  const report = {
    website: { id: 'site' },
    range: { startAt: 1, endAt: 2, timezone: 'UTC' },
    states: { logs: 'available' },
    meta: { aiCrawlerEnabled: true },
    charts: {
      d1: {
        labels: ['2026-10-01'],
        series: [
          { name: '浏览 PV', values: [3] },
          { name: 'AI 蜘蛛请求', values: [2] },
        ],
      },
    },
  } as any;
  const view = render(
    <LiekanLocaleContext.Provider value="zh-CN">
      <ReferenceChart id="d1" height={260} report={report} />
    </LiekanLocaleContext.Provider>,
  );
  await hideLastSeries();
  view.rerender(
    <LiekanLocaleContext.Provider value="en-US">
      <ReferenceChart id="d1" height={260} report={report} />
    </LiekanLocaleContext.Provider>,
  );
  await waitFor(() => {
    expect(engine.charts).toHaveLength(2);
    const option = engine.charts[1].getOption();
    expect(option.series[1].name).toBe('AI crawler requests');
    expect(option.legend[0].selected[option.series[1].name]).toBe(false);
  });
});

it.each([true, false])(
  'restores a feature chart legend only for the same raw snapshot (%s)',
  sameSnapshot => {
    const chart = (english: boolean) => (
      <LiekanLocaleContext.Provider value={english ? 'en-US' : 'zh-CN'}>
        <Chart
          interactionKey={sameSnapshot || !english ? 'snapshot-a' : 'snapshot-b'}
          labels={['2026-10-01']}
          series={[
            { name: english ? 'Current' : '当前', values: [3] },
            { name: english ? 'Previous' : '上期', values: [2] },
          ]}
        />
      </LiekanLocaleContext.Provider>
    );
    return (async () => {
      const view = render(chart(false));
      await hideLastSeries();
      view.rerender(chart(true));
      await waitFor(() => {
        expect(engine.charts).toHaveLength(2);
        const option = engine.charts[1].getOption();
        expect(option.series[1].name).toBe('Previous');
        expect(option.legend[0].selected.Previous === false).toBe(sameSnapshot);
      });
    })();
  },
);

it('retains pie choices and data zoom without changing the submitted data', async () => {
  const values = [3, 2];
  const pie = (english: boolean) => (
    <LiekanLocaleContext.Provider value={english ? 'en-US' : 'zh-CN'}>
      <Chart
        interactionKey="pie-snapshot"
        type="pie"
        labels={english ? ['Known', 'Unknown'] : ['已知', '未知']}
        series={[{ name: 'raw-event', values }]}
      />
    </LiekanLocaleContext.Provider>
  );
  const view = render(pie(false));
  await waitFor(() => expect(engine.charts.at(-1)?.getOption()?.series).toHaveLength(1));
  act(() => {
    engine.charts[0].dispatchAction({ type: 'legendUnSelect', name: '未知' });
  });
  view.rerender(pie(true));
  await waitFor(() => {
    expect(engine.charts).toHaveLength(2);
    expect(engine.charts[1].getOption().legend[0].selected.Unknown).toBe(false);
  });
  expect(values).toEqual([3, 2]);
  view.unmount();
  const line = (english: boolean) => (
    <LiekanLocaleContext.Provider value={english ? 'en-US' : 'zh-CN'}>
      <Chart
        interactionKey="zoom-snapshot"
        labels={['a', 'b', 'c']}
        series={[{ name: english ? 'Current' : '当前', values: [1, 2, 3] }]}
        option={{ dataZoom: [{ type: 'inside' }] }}
      />
    </LiekanLocaleContext.Provider>
  );
  const next = render(line(false));
  await waitFor(() => expect(engine.charts).toHaveLength(3));
  act(() => engine.charts[2].dispatchAction({ type: 'dataZoom', start: 25, end: 75 }));
  next.rerender(line(true));
  await waitFor(() => {
    expect(engine.charts).toHaveLength(4);
    expect(engine.charts[3].getOption().dataZoom[0]).toMatchObject({ start: 25, end: 75 });
  });
});

it.each(['loading', 'failure'])(
  'fences chart interactions through %s transitions',
  async transition => {
    const chart = (english: boolean, loading = false) => (
      <LiekanLocaleContext.Provider value={english ? 'en-US' : 'zh-CN'}>
        <DataLoading loading={loading}>
          <Chart
            interactionKey="snapshot"
            labels={['a']}
            series={[
              { name: english ? 'Current' : '当前', values: [3] },
              { name: english ? 'Previous' : '上期', values: [2] },
            ]}
          />
        </DataLoading>
      </LiekanLocaleContext.Provider>
    );
    const view = render(chart(false));
    await hideLastSeries();
    if (transition === 'loading') {
      view.rerender(chart(false, true));
      view.rerender(chart(true));
    } else if (transition === 'failure') {
      engine.failNext = true;
      view.rerender(chart(true));
      fireEvent.click(await screen.findByRole('button', { name: 'Retry chart' }));
    }
    await waitFor(() => {
      const option = engine.charts.at(-1)?.getOption();
      expect(option?.series[1].name).toBe('Previous');
      expect(option.legend[0].selected.Previous === false).toBe(false);
    });
  },
);

it.each(['feature', 'reference'])(
  'retains %s interactions through an unmeasured language render',
  async kind => {
    let width = 480;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    const report = {
      website: { id: 'site' },
      range: { startAt: 1, endAt: 2, timezone: 'UTC' },
      states: { logs: 'available' },
      meta: { aiCrawlerEnabled: true },
      charts: {
        d1: {
          labels: ['2026-10-01'],
          series: [
            { name: '浏览 PV', values: [3] },
            { name: 'AI 蜘蛛请求', values: [2] },
          ],
        },
      },
    } as any;
    const chart = (english: boolean) => (
      <LiekanLocaleContext.Provider value={english ? 'en-US' : 'zh-CN'}>
        {kind === 'feature' ? (
          <Chart
            interactionKey="snapshot"
            labels={['a']}
            series={[
              { name: english ? 'Current' : '当前', values: [3] },
              { name: english ? 'Previous' : '上期', values: [2] },
            ]}
          />
        ) : (
          <ReferenceChart id="d1" height={260} report={report} />
        )}
      </LiekanLocaleContext.Provider>
    );
    const view = render(chart(false));
    await hideLastSeries();
    width = 0;
    view.rerender(chart(true));
    await waitFor(() => expect(engine.charts).toHaveLength(2));
    expect(engine.charts[1].getOption()).toBeUndefined();
    width = 480;
    view.rerender(chart(false));
    await waitFor(() => {
      expect(engine.charts).toHaveLength(3);
      const option = engine.charts[2].getOption();
      expect(option.legend[0].selected[option.series[1].name]).toBe(false);
    });
  },
);
