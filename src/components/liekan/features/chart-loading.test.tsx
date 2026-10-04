import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Chart } from './Chart';
const runtime = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../chartRuntime', () => ({ loadEcharts: runtime.load }));
it('updates full options and current click handler without replacing the renderer', async () => {
  const chart = { setOption: vi.fn(), dispose: vi.fn(), resize: vi.fn(), on: vi.fn() };
  const init = vi.fn(() => chart);
  runtime.load.mockResolvedValue({ init });
  const first = vi.fn(),
    latest = vi.fn();
  const { rerender, unmount } = render(
    <Chart
      type="bar"
      horizontal
      labels={['A', 'B']}
      series={[
        { name: 'PV', values: [1, 2] },
        { name: 'UV', values: [2, 3] },
      ]}
      onClick={first}
    />,
  );
  await waitFor(() => expect(chart.setOption).toHaveBeenCalledOnce());
  const click = chart.on.mock.calls[0][1];
  rerender(
    <Chart
      type="bar"
      horizontal
      labels={['B']}
      series={[{ name: 'PV', values: [4] }]}
      onClick={latest}
    />,
  );
  await waitFor(() => expect(chart.setOption).toHaveBeenCalledTimes(2));
  expect(init).toHaveBeenCalledOnce();
  const [option, flags] = chart.setOption.mock.calls[1];
  expect(option.series).toHaveLength(1);
  expect(option.series[0].data).toEqual([4]);
  expect(option.yAxis.data).toEqual(['B']);
  expect(option.animation).toBe(false);
  expect(flags).toEqual({ notMerge: true });
  click({ name: 'B' });
  expect(latest).toHaveBeenCalledWith({ name: 'B' });
  expect(first).not.toHaveBeenCalled();
  unmount();
  expect(chart.dispose).toHaveBeenCalledOnce();
});
it('keeps a failed renderer and its retry inside the fixed chart frame', async () => {
  runtime.load
    .mockRejectedValueOnce(new Error('chunk unavailable'))
    .mockResolvedValue({ init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }) });
  render(<Chart height={400} labels={['A']} series={[{ name: 'PV', values: [1] }]} />);
  const alert = await screen.findByRole('alert');
  expect(alert.parentElement).toHaveStyle({ height: '400px', position: 'relative' });
  expect(alert).toHaveStyle({ position: 'absolute' });
  fireEvent.click(screen.getByRole('button', { name: '重试图表' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(screen.getByRole('img')).toHaveStyle({ height: '400px' });
});
