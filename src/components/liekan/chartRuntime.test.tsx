import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiekanShell } from './LiekanShell';
import { ReferenceChart } from './ReportComponents';
import type { LiekanReport } from './types';

const runtime = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('./chartRuntime', () => ({ loadEcharts: runtime.load }));
vi.mock('@/lib/liekan/upstream/client', () => ({
  useNavigation: () => ({
    pathname: '/websites/site/geo',
    websiteId: 'site',
    renderUrl: (path: string) => path,
  }),
  AdminNav: () => null,
  SettingsNav: () => null,
  UserButton: () => null,
  WebsiteNav: () => null,
}));

const report: LiekanReport = {
  contractVersion: 1,
  website: { id: 'site', name: '站点', domain: 'example.test' },
  range: { startAt: 1, endAt: 2, timezone: 'Asia/Shanghai' },
  states: { human: 'available', logs: 'available', catalog: 'available', goals: 'available' },
  cards: [],
  charts: { h1: { labels: ['当前'], series: [{ name: 'UV', values: [4] }] } },
  tables: {},
  insights: [],
  meta: { demo: false, canManage: false, latestImportAt: null, ruleCount: 0 },
};
const instance = () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() });
beforeEach(() => runtime.load.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe('recoverable chart runtime', () => {
  it('recovers from a rejected bundle load without changing chart geometry', async () => {
    const chart = instance();
    const init = vi.fn().mockReturnValue(chart);
    runtime.load.mockRejectedValueOnce(new Error('Chunk unavailable')).mockResolvedValue({ init });
    const { unmount } = render(<ReferenceChart id="h1" height={260} report={report} />);
    await screen.findByText('图表加载失败');
    expect(screen.getByRole('group')).toHaveStyle({ height: '260px', position: 'relative' });
    fireEvent.click(screen.getByRole('button', { name: '重试图表' }));
    await waitFor(() => expect(chart.setOption).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveStyle({ height: '260px' });
    unmount();
    expect(chart.dispose).toHaveBeenCalledOnce();
  });
  it('disposes a chart after rendering fails and retries with a fresh instance', async () => {
    const broken = instance(),
      recovered = instance();
    broken.setOption.mockImplementation(() => {
      throw new Error('Rendering failed');
    });
    const init = vi.fn().mockReturnValueOnce(broken).mockReturnValue(recovered);
    runtime.load.mockResolvedValue({ init });
    render(<ReferenceChart id="h1" height={260} report={report} />);
    await screen.findByText('图表加载失败');
    expect(broken.dispose).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '重试图表' }));
    await waitFor(() => expect(recovered.setOption).toHaveBeenCalledOnce());
    expect(broken.dispose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('captures resize failures and disconnects the observer', async () => {
    const chart = instance();
    const disconnect = vi.fn();
    let resize: ResizeObserverCallback;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    runtime.load.mockResolvedValue({ init: () => chart });
    render(<ReferenceChart id="h1" height={260} report={report} />);
    await waitFor(() => expect(chart.setOption).toHaveBeenCalledOnce());
    chart.resize.mockImplementation(() => {
      throw new Error('Resize failed');
    });
    act(() => resize([], null));
    await screen.findByText('图表加载失败');
    expect(disconnect).toHaveBeenCalledOnce();
    expect(chart.dispose).toHaveBeenCalledOnce();
  });
  it('does not initialize a chart after its pending load outlives the page', async () => {
    let complete: (value: { init: ReturnType<typeof vi.fn> }) => void;
    runtime.load.mockReturnValue(
      new Promise(resolve => {
        complete = resolve;
      }),
    );
    const init = vi.fn();
    const { unmount } = render(<ReferenceChart id="h1" height={260} report={report} />);
    unmount();
    complete({ init });
    await Promise.resolve();
    expect(init).not.toHaveBeenCalled();
  });
  it('keeps the GEO shell in Chinese when the account changes the document language', () => {
    const previous = document.documentElement.lang;
    try {
      document.documentElement.lang = 'en-US';
      render(
        <LiekanShell>
          <span>中文统计区域</span>
        </LiekanShell>,
      );
      expect(screen.getByText('中文统计区域').closest('[lang]')).toHaveAttribute('lang', 'zh-CN');
    } finally {
      document.documentElement.lang = previous;
    }
  });
});
