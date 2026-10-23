import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeoWeightResponse } from '@/lib/liekan/contracts/geo-weight';
import { geoPoint } from '@/lib/liekan/geo-weight/evidence';
import { geoWindow } from '@/lib/liekan/geo-weight/window';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';
import { GeoWeightSummary } from './GeoWeightSummary';

const firstId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const secondId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const h = vi.hoisted(() => ({
  data: undefined as GeoWeightResponse,
  detail: undefined as GeoWeightResponse,
  error: null as any,
  detailError: null as any,
  detailPending: false,
  updatedAt: 1,
  taskStatus: 'ready',
  stale: false,
  noResult: false,
  strongVersion: 'v1',
  requestedAsOf: '2026-10-20',
  nextRetryAt: null as string | null,
  canRecalculate: false,
  pollExpired: false,
  calls: [] as any[],
  refetch: vi.fn(),
  detailRefetch: vi.fn(),
  recalculate: vi.fn(),
  download: vi.fn(),
}));
function envelope(data = h.data, view = 'summary') {
  const noResult = view === 'summary' && h.noResult;
  return {
    format: 'geo-snapshot-v1',
    taskId: null,
    taskStatus: h.taskStatus,
    result: noResult ? null : { ...data, view },
    snapshotId: noResult ? null : data.snapshotId,
    requestedAsOf: h.requestedAsOf,
    servedAsOf: noResult ? null : data.current.asOf,
    stale: h.stale,
    nextRetryAt: h.nextRetryAt,
    errorCode: null,
    canRecalculate: h.canRecalculate,
    strongVersion: view === 'summary' ? h.strongVersion : 'v1',
  };
}
vi.mock('@/lib/liekan/contracts/geo-weight-client', () => ({
  useGeoWeight: (...args: any[]) => {
    h.calls.push(args);
    const isDetail = args[4] === 'detail';
    const error = isDetail ? h.detailError || h.error : h.error;
    return {
      data: isDetail
        ? h.detailPending
          ? undefined
          : { ...envelope(h.detail || h.data, 'detail'), requestedAsOf: args[2] || h.requestedAsOf }
        : { ...envelope(), requestedAsOf: args[2] || h.requestedAsOf },
      error,
      isError: !!error,
      isSuccess: !error,
      dataUpdatedAt: h.updatedAt,
      errorUpdatedAt: error ? h.updatedAt : 0,
      isFetching: isDetail && h.detailPending,
      isPlaceholderData: false,
      pollExpired: h.pollExpired,
      refetch: isDetail ? h.detailRefetch : h.refetch,
      recalculate: h.recalculate,
    };
  },
  downloadGeoWeight: h.download,
}));
vi.mock('../Link', () => ({ default: ({ href, children }: any) => <a href={href}>{children}</a> }));
vi.mock('./ui', () => ({
  LiekanDialog: ({ title, children, onClose }: any) => (
    <div role="dialog" aria-label={title}>
      <button onClick={onClose}>Close</button>
      {children}
    </div>
  ),
  Button: (props: any) => <button {...props} />,
  Notice: ({ children }: any) => <div>{children}</div>,
}));
const props = {
  userId: 'user-a',
  websiteId: 'site-a',
  endAt: Date.parse('2026-10-20T16:00:00Z'),
  timezone: 'Asia/Shanghai',
  readAt: Date.parse('2026-10-21T08:00:00Z'),
};
beforeEach(() => {
  h.detail = undefined;
  h.detailPending = false;
  h.calls = [];
  h.error = null;
  h.detailError = null;
  h.updatedAt = 1;
  h.taskStatus = 'ready';
  h.stale = false;
  h.noResult = false;
  h.strongVersion = 'v1';
  h.requestedAsOf = '2026-10-20';
  h.nextRetryAt = null;
  h.canRecalculate = false;
  h.pollExpired = false;
  h.refetch.mockReset();
  h.detailRefetch.mockReset();
  h.download.mockReset();
  h.recalculate.mockReset();
  h.refetch.mockImplementation(async () => ({ data: envelope() }));
  h.detailRefetch.mockImplementation(async () => ({
    data: envelope(h.detail || h.data, 'detail'),
  }));
  h.recalculate.mockResolvedValue({});
  const current = geoPoint(
    geoWindow('2026-10-20', 'Asia/Shanghai'),
    {},
    {
      state: 'missing',
      basis: 'event_time',
      classificationVersion: '',
      sourceVersion: '',
      timezone: 'Asia/Shanghai',
    },
    false,
    false,
  );
  h.data = {
    snapshotId: firstId,
    websiteId: 'site-a',
    hostname: 'www.example.com',
    timezone: 'Asia/Shanghai',
    algorithm: 'geo-weight-v2.1-bands-evidence-beta',
    scoreScopeHash: 'scope',
    readCatalogVersion: 'catalog',
    readCatalogHash: 'hash',
    catalogState: 'published',
    directoryCounts: { platforms: 54, products: 79, identities: 65 },
    scope: [],
    canManageCatalog: false,
    epoch: 1,
    dataRevision: '1',
    calculatedAt: '2026-10-21T00:00:00Z',
    snapshot: 'snapshot',
    view: 'detail',
    current,
    previous: current,
    observations: [{ ...current, connectPrevious: false }],
    comparison: { comparable: false, delta: null, reasons: current.reasons },
  };
});

describe('saved GEO summary and immutable details', () => {
  it('shows one compact metric with a short action and moves explanation into details', () => {
    h.data.current = { ...h.data.current, state: 'reference', weightedUnits: 56800, level: 6 };
    render(<GeoWeightSummary {...props} />);
    expect(screen.getByText('6', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看 GEO 权重计算依据' })).toHaveTextContent(
      '计算依据',
    );
    expect(screen.getByText('参考等级')).toBeInTheDocument();
    expect(screen.getByText('最高 10')).toBeInTheDocument();
    expect(screen.getByText('截至 10/20')).toHaveAttribute('datetime', '2026-10-20');
    expect(screen.queryByText('AI 抓取版 · 网站整体')).not.toBeInTheDocument();
    expect(screen.queryByText(/本次计算时间/)).not.toBeInTheDocument();
    expect(screen.queryByText('三类用途贡献')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看 GEO 权重计算依据' }));
    expect(within(screen.getByRole('dialog')).getByText('三类用途贡献')).toBeInTheDocument();
    expect(
      within(screen.getByRole('dialog')).getByRole('img', { name: '五个 30 日滚动观察点' }),
    ).toBeInTheDocument();
  });
  it('keeps a proved zero distinct from a missing score', () => {
    h.data.current = { ...h.data.current, state: 'observed_zero', weightedUnits: 0, level: 0 };
    const view = render(<GeoWeightSummary {...props} />);
    expect(screen.getByText('0', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.queryByText('暂无权重')).not.toBeInTheDocument();
    h.data.current = { ...h.data.current, state: 'missing', level: null };
    view.rerender(<GeoWeightSummary {...props} />);
    expect(screen.queryByText('0', { selector: 'strong' })).not.toBeInTheDocument();
    expect(screen.getByText('暂无权重')).toBeInTheDocument();
  });
  it('keeps the year visible for a snapshot from a prior year', () => {
    h.data.current = { ...h.data.current, ...geoWindow('2025-10-20', props.timezone) };
    render(<GeoWeightSummary {...props} endAt={h.data.current.endAt} />);
    expect(screen.getByText('截至 2025/10/20')).toHaveAttribute('datetime', '2025-10-20');
  });
  it('accepts saved results whose timezone is an equivalent canonical alias', () => {
    h.data.current = { ...h.data.current, state: 'reference', weightedUnits: 100, level: 2 };
    render(<GeoWeightSummary {...props} timezone="asia/shanghai" />);
    expect(screen.getByText('2', { selector: 'strong' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看 GEO 权重计算依据' }));
    expect(within(screen.getByRole('dialog')).getByText('导出计算依据')).toBeEnabled();
  });
  it('keeps an open detail and its export on the captured generation when the summary updates', async () => {
    h.data.current = { ...h.data.current, state: 'reference', weightedUnits: 10, level: 1 };
    h.detail = structuredClone(h.data);
    const view = render(<GeoWeightSummary {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '查看 GEO 权重计算依据' }));
    h.data = {
      ...h.data,
      snapshotId: secondId,
      current: { ...h.data.current, weightedUnits: 100, level: 2 },
    };
    h.updatedAt++;
    view.rerender(<GeoWeightSummary {...props} />);
    expect(h.calls.filter(call => call[4] === 'detail').at(-1)[6]).toBe(firstId);
    expect(screen.getByText('2', { selector: 'strong' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('dialog')).getByText('已有新日快照，重新读取可查看最新结果'),
    ).toBeInTheDocument();
    h.download.mockResolvedValue({ csv: 'saved' });
    fireEvent.click(screen.getByText('导出计算依据'));
    await waitFor(() => expect(h.download).toHaveBeenCalled());
    expect(h.download.mock.calls[0][0].snapshotId).toBe(firstId);
    expect(h.detailRefetch).not.toHaveBeenCalled();
  });
  it('revalidates an open exact snapshot when corrected proof leaves the new summary without a result', async () => {
    h.data.current = { ...h.data.current, state: 'reference', weightedUnits: 10, level: 1 };
    h.detail = structuredClone(h.data);
    let finish: (result: any) => void;
    h.detailRefetch.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    const view = render(<GeoWeightSummary {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '查看 GEO 权重计算依据' }));
    expect(within(screen.getByRole('dialog')).getByText('导出计算依据')).toBeEnabled();
    h.strongVersion = 'v2-corrected-proof';
    h.noResult = true;
    h.taskStatus = 'queued';
    h.updatedAt++;
    view.rerender(<GeoWeightSummary {...props} />);
    await waitFor(() => expect(h.detailRefetch).toHaveBeenCalledTimes(1));
    expect(h.refetch).not.toHaveBeenCalled();
    expect(h.calls.filter(call => call[4] === 'detail').at(-1)[6]).toBe(firstId);
    expect(
      within(screen.getByRole('dialog')).queryByText(/www.example.com/),
    ).not.toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('导出计算依据')).toBeDisabled();
    await act(async () => {
      h.detailError = { status: 409, message: 'GEO 快照基准已变化，请重新读取' };
      finish({ error: h.detailError, isError: true });
    });
    view.rerender(<GeoWeightSummary {...props} />);
    expect(
      within(screen.getByRole('dialog')).queryByText(/www.example.com/),
    ).not.toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('导出计算依据')).toBeDisabled();
    expect(h.download).not.toHaveBeenCalled();
  });
  it('keeps a valid pinned fallback after a new requested day has a different strong boundary', async () => {
    h.data.current = { ...h.data.current, state: 'reference', weightedUnits: 10, level: 1 };
    h.detail = structuredClone(h.data);
    let finish: (result: any) => void;
    h.detailRefetch.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    const view = render(<GeoWeightSummary {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '查看 GEO 权重计算依据' }));
    h.requestedAsOf = '2026-10-21';
    h.strongVersion = 'v2-new-requested-window';
    h.stale = true;
    h.taskStatus = 'queued';
    h.updatedAt++;
    view.rerender(<GeoWeightSummary {...props} />);
    await waitFor(() => expect(h.detailRefetch).toHaveBeenCalledTimes(1));
    expect(within(screen.getByRole('dialog')).getByText('导出计算依据')).toBeDisabled();
    await act(async () => {
      finish({ data: envelope(h.detail, 'detail'), error: null, isError: false, isSuccess: true });
    });
    view.rerender(<GeoWeightSummary {...props} />);
    expect(within(screen.getByRole('dialog')).getByText(/www.example.com/)).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('导出计算依据')).toBeEnabled();
    expect(h.calls.filter(call => call[4] === 'detail').at(-1)[6]).toBe(firstId);
    expect(h.detailRefetch).toHaveBeenCalledTimes(1);
    expect(h.refetch).not.toHaveBeenCalled();
  });
  it('keeps corrected proof hidden after a temporary exact-snapshot verification failure', async () => {
    h.detail = structuredClone(h.data);
    let finish: (result: any) => void;
    h.detailRefetch.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    const view = render(<GeoWeightSummary {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '查看 GEO 权重计算依据' }));
    h.strongVersion = 'v2-corrected-proof';
    h.noResult = true;
    h.taskStatus = 'queued';
    h.updatedAt++;
    view.rerender(<GeoWeightSummary {...props} />);
    await waitFor(() => expect(h.detailRefetch).toHaveBeenCalledTimes(1));
    await act(async () => {
      h.detailError = { status: 503, message: 'temporarily unavailable' };
      finish({ data: envelope(h.detail, 'detail'), error: h.detailError, isError: true });
    });
    view.rerender(<GeoWeightSummary {...props} />);
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByText(/www.example.com/)).not.toBeInTheDocument();
    expect(dialog.getByText('导出计算依据')).toBeDisabled();
    expect(dialog.getByText('重新读取')).toBeEnabled();
    expect(h.download).not.toHaveBeenCalled();
  });
  it('ignores late verification of a closed pin after the user opens a newer snapshot', async () => {
    h.data.current = { ...h.data.current, state: 'reference', weightedUnits: 10, level: 1 };
    h.detail = structuredClone(h.data);
    const captured = envelope(h.detail, 'detail');
    let finish: (result: any) => void;
    h.detailRefetch.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    const view = render(<GeoWeightSummary {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '查看 GEO 权重计算依据' }));
    h.requestedAsOf = '2026-10-21';
    h.strongVersion = 'v2-new-requested-window';
    h.stale = true;
    h.updatedAt++;
    view.rerender(<GeoWeightSummary {...props} />);
    await waitFor(() => expect(h.detailRefetch).toHaveBeenCalledTimes(1));
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Close'));
    h.data = {
      ...h.data,
      snapshotId: secondId,
      current: {
        ...h.data.current,
        ...geoWindow('2026-10-21', props.timezone),
        weightedUnits: 100,
        level: 2,
      },
    };
    h.detail = structuredClone(h.data);
    h.stale = false;
    h.updatedAt++;
    view.rerender(<GeoWeightSummary {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '查看 GEO 权重计算依据' }));
    await act(async () => {
      finish({ data: captured, error: null, isError: false, isSuccess: true });
    });
    expect(within(screen.getByRole('dialog')).getByText(/GEO 权重 2/)).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).queryByText(/GEO 权重 1/)).not.toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('导出计算依据')).toBeEnabled();
    expect(h.calls.filter(call => call[4] === 'detail').at(-1)[6]).toBe(secondId);
    expect(h.detailRefetch).toHaveBeenCalledTimes(1);
    h.download.mockRejectedValue({ status: 503, message: 'temporarily unavailable' });
    fireEvent.click(screen.getByText('导出计算依据'));
    await waitFor(() => expect(h.download).toHaveBeenCalledTimes(1));
    expect(h.download.mock.calls[0][0].snapshotId).toBe(secondId);
  });
  it('uses server current-day mode and pins on-demand details to the visible snapshot UUID', () => {
    render(<GeoWeightSummary {...props} />);
    expect(h.calls.find(c => c[4] === 'summary')[2]).toBeUndefined();
    expect(h.calls.find(c => c[4] === 'detail')[5]).toBe(false);
    expect(screen.getByText('暂无权重')).toBeInTheDocument();
    expect(screen.getByText('截至 10/20')).toHaveAttribute('datetime', '2026-10-20');
    fireEvent.click(screen.getByRole('button', { name: '查看 GEO 权重计算依据' }));
    expect(h.calls.some(c => c[4] === 'detail' && c[5] === true && c[6] === firstId)).toBe(true);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('导出计算依据')).toBeEnabled();
    expect(screen.queryByText('管理爬虫库')).not.toBeInTheDocument();
  });
  it('keeps an exact historical scope and carries the scored window to related analytics', () => {
    h.data.current = { ...h.data.current, ...geoWindow('2026-09-30', props.timezone) };
    // The mock adopts the exact historical request, as the server does.
    render(<GeoWeightSummary {...props} endAt={h.data.current.endAt} />);
    expect(h.calls.find(c => c[4] === 'summary')[2]).toBe('2026-09-30');
    expect(screen.getByText('暂无权重')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看 GEO 权重计算依据' }));
    for (const name of ['查看 AI 爬虫分析', '查看抓取页面']) {
      const url = new URL(
        screen.getByRole('link', { name }).getAttribute('href'),
        'https://liekan.test',
      );
      expect(url.searchParams.get('date')).toBe(
        `range:${h.data.current.startAt}:${h.data.current.endAt - 1}`,
      );
    }
  });
  it('shows the ready summary while exact history is pending and withholds incomplete exports', () => {
    h.detailPending = true;
    render(<GeoWeightSummary {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '查看 GEO 权重计算依据' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/www.example.com/)).toBeInTheDocument();
    expect(within(dialog).getByText('导出计算依据')).toBeDisabled();
    expect(
      within(dialog).queryByRole('img', { name: '五个 30 日滚动观察点' }),
    ).not.toBeInTheDocument();
  });
  it('rejects another snapshot generation in details and withdraws the old summary', () => {
    h.data.current = { ...h.data.current, state: 'reference', weightedUnits: 10, level: 1 };
    const view = render(<GeoWeightSummary {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '查看 GEO 权重计算依据' }));
    h.detail = { ...h.data, snapshotId: secondId, epoch: 2 };
    view.rerender(<GeoWeightSummary {...props} />);
    expect(screen.queryByText('1', { selector: 'strong' })).not.toBeInTheDocument();
    expect(screen.getByText('导出计算依据')).toBeDisabled();
    expect(
      within(screen.getByRole('dialog')).queryByText(/www.example.com/),
    ).not.toBeInTheDocument();
  });
  it.each([401, 403, 404, 409, 410])(
    'withdraws scores and exports across a %s boundary until a fresh successful read',
    status => {
      h.data.current = { ...h.data.current, state: 'reference', weightedUnits: 10, level: 1 };
      const view = render(<GeoWeightSummary {...props} />);
      expect(screen.getByText('1', { selector: 'strong' })).toBeInTheDocument();
      h.error = { status, message: 'invalidated' };
      view.rerender(<GeoWeightSummary {...props} />);
      h.error = { status: 503, message: 'unavailable' };
      view.rerender(<GeoWeightSummary {...props} />);
      expect(screen.queryByText('1', { selector: 'strong' })).not.toBeInTheDocument();
      h.error = null;
      h.updatedAt++;
      view.rerender(<GeoWeightSummary {...props} />);
      expect(screen.getByText('1', { selector: 'strong' })).toBeInTheDocument();
    },
  );
  it('preserves a server-approved prior-day result with its actual date and failure/retry status', () => {
    h.data.current = {
      ...h.data.current,
      ...geoWindow('2026-10-19', props.timezone),
      state: 'reference',
      weightedUnits: 100,
      level: 2,
    };
    h.stale = true;
    h.taskStatus = 'failed';
    h.nextRetryAt = '2026-10-21T08:05:00Z';
    render(<GeoWeightSummary {...props} />);
    expect(screen.getByText('2', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/上次结果/)).toHaveTextContent('GEO 权重更新失败，请重新读取');
    expect(screen.getByText('截至 10/19')).toHaveAttribute('datetime', '2026-10-19');
    expect(screen.getByText(/下次可重试时间/)).toBeInTheDocument();
    expect(screen.getByText('重新读取')).toBeEnabled();
  });
  it('renders ready-null and capacity states without an indefinite calculating label', () => {
    h.noResult = true;
    const view = render(<GeoWeightSummary {...props} />);
    expect(screen.getByText('暂无权重')).toBeInTheDocument();
    expect(screen.queryByText('正在计算 GEO 权重')).not.toBeInTheDocument();
    h.taskStatus = 'capacity_blocked';
    view.rerender(<GeoWeightSummary {...props} />);
    expect(screen.getByText('快照存储已满，请稍后重新读取')).toBeInTheDocument();
    expect(screen.getByText('重新读取')).toBeEnabled();
  });
  it('allows managers to recalculate even before the first result, using a UUID and visible cooldown', async () => {
    h.noResult = true;
    h.canRecalculate = true;
    h.taskStatus = 'failed';
    render(<GeoWeightSummary {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '查看 GEO 权重计算依据' }));
    fireEvent.click(screen.getByText('重新计算 GEO 权重'));
    await waitFor(() => expect(h.recalculate).toHaveBeenCalledTimes(1));
    expect(h.recalculate.mock.calls[0][0]).toMatch(/^[a-f0-9-]{36}$/);
    expect(h.recalculate.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    await waitFor(() => expect(screen.getByText('重新计算 GEO 权重')).toBeDisabled());
    expect(screen.getByText(/可于 .* 重新计算/)).toBeInTheDocument();
  });
  it('reuses an idempotency UUID after a transient submission failure and honors Retry-After', async () => {
    h.canRecalculate = true;
    h.recalculate
      .mockRejectedValueOnce({ status: 503, message: 'unavailable' })
      .mockRejectedValueOnce({ status: 429, retryAfterMs: 60000, message: 'cooldown' });
    render(<GeoWeightSummary {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '查看 GEO 权重计算依据' }));
    fireEvent.click(screen.getByText('重新计算 GEO 权重'));
    await waitFor(() => expect(screen.getByText('重新计算 GEO 权重')).toBeEnabled());
    fireEvent.click(screen.getByText('重新计算 GEO 权重'));
    await waitFor(() => expect(h.recalculate).toHaveBeenCalledTimes(2));
    expect(h.recalculate.mock.calls[0][0]).toBe(h.recalculate.mock.calls[1][0]);
    await waitFor(() => expect(screen.getByText('重新计算 GEO 权重')).toBeDisabled());
    expect(screen.getByText('cooldown')).toBeInTheDocument();
  });
  it('keeps ordinary readers on reread and exports the exact visible generation', async () => {
    h.download.mockResolvedValue({ csv: 'saved' });
    // Avoid a DOM download side effect while inspecting the submitted evidence.
    h.download.mockRejectedValue({ status: 503, message: 'temporarily unavailable' });
    render(<GeoWeightSummary {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '查看 GEO 权重计算依据' }));
    expect(screen.queryByText('重新计算 GEO 权重')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('导出计算依据'));
    await waitFor(() => expect(h.download).toHaveBeenCalledTimes(1));
    expect(h.download.mock.calls[0][0].snapshotId).toBe(firstId);
    expect(h.download.mock.calls[0][1]).toBe('zh-CN');
  });
  it('keeps English status/evidence labels translated while preserving stable identifiers and integer scores', () => {
    h.data.current = { ...h.data.current, state: 'reference', weightedUnits: 56800, level: 6 };
    h.canRecalculate = true;
    render(
      <LiekanLocaleContext.Provider value="en-US">
        <GeoWeightSummary {...props} />
      </LiekanLocaleContext.Provider>,
    );
    expect(screen.getByText('6', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/Reference level/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View GEO weight calculation evidence' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('geo-weight-v2.1-bands-evidence-beta')).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/[\u3400-\u9fff]/);
    expect(
      within(dialog).getByText(/Weight 7 requires 143,200 more weighted units/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Recalculate GEO weight')).toBeEnabled();
  });
  it('closes details and removes a different website’s cached result when switching websites', () => {
    const view = render(<GeoWeightSummary {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '查看 GEO 权重计算依据' }));
    view.rerender(<GeoWeightSummary {...props} websiteId="site-b" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('暂无权重')).not.toBeInTheDocument();
  });
});
