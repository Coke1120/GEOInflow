import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeoWeightSummary } from './GeoWeightSummary';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';
import { geoPoint } from '@/lib/liekan/geo-weight/evidence';
import { geoWindow } from '@/lib/liekan/geo-weight/window';
import type { GeoWeightResponse } from '@/lib/liekan/contracts/geo-weight';
const h = vi.hoisted(() => ({
  data: undefined as GeoWeightResponse,
  detail: undefined as GeoWeightResponse,
  error: null as any,
  detailError: null as any,
  updatedAt: 1,
  calls: [] as any[],
  refetch: vi.fn(),
  download: vi.fn(),
}));
vi.mock('@/lib/liekan/contracts/geo-weight-client', () => ({
  useGeoWeight: (...args: any[]) => {
    h.calls.push(args);
    const error = args[4] === 'detail' ? h.detailError || h.error : h.error;
    return {
      data: args[4] === 'detail' ? h.detail || h.data : h.data,
      error,
      isError: !!error,
      isSuccess: !error,
      dataUpdatedAt: h.updatedAt,
      errorUpdatedAt: error ? h.updatedAt : 0,
      isFetching: false,
      isPlaceholderData: false,
      refetch: args[5] === false ? () => Promise.resolve({}) : h.refetch,
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
  h.calls = [];
  h.error = null;
  h.detailError = null;
  h.updatedAt = 1;
  h.refetch.mockReset();
  h.download.mockReset();
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
    websiteId: 'site-a',
    hostname: 'www.example.com',
    timezone: 'Asia/Shanghai',
    algorithm: 'geo-weight-v1.2-beta',
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
    observations: [current].map(p => ({ ...p, connectPrevious: false })),
    comparison: { comparable: false, delta: null, reasons: current.reasons },
  };
});
describe('GEO summary and shared details', () => {
  it('refreshes invalidated details after the dialog closes so a retry can recover', async () => {
    const view = render(<GeoWeightSummary {...props} />);
    fireEvent.click(screen.getByText('查看计算依据'));
    h.detailError = { status: 409, message: 'invalidated' };
    view.rerender(<GeoWeightSummary {...props} />);
    fireEvent.click(screen.getByText('Close'));
    fireEvent.click(screen.getByText('重新读取'));
    await waitFor(() => expect(h.refetch).toHaveBeenCalledTimes(2));
  });
  it('keeps the completed-day window frozen across midnight until the page is refreshed', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-21T15:59:50Z'));
    try {
      const p = { ...props, endAt: Date.parse('2026-10-21T15:59:59.999Z'), readAt: Date.now() };
      const view = render(<GeoWeightSummary {...p} />);
      expect(h.calls.at(-1)[2]).toBe('2026-10-20');
      clock.mockReturnValue(Date.parse('2026-10-21T16:00:10Z'));
      view.rerender(<GeoWeightSummary {...p} expanded />);
      expect(h.calls.at(-1)[2]).toBe('2026-10-20');
      view.rerender(<GeoWeightSummary {...p} readAt={Date.now()} />);
      expect(h.calls.at(-1)[2]).toBe('2026-10-21');
    } finally {
      clock.mockRestore();
    }
  });
  it('carries the scored historical window to related analytics and keeps management unscoped', () => {
    h.data.current = { ...h.data.current, ...geoWindow('2026-09-30', props.timezone) };
    h.data.canManageCatalog = true;
    render(<GeoWeightSummary {...props} endAt={h.data.current.endAt} />);
    fireEvent.click(screen.getByText('查看计算依据'));
    for (const name of ['查看 AI 爬虫分析', '查看抓取页面']) {
      const url = new URL(
        screen.getByRole('link', { name }).getAttribute('href'),
        'https://liekan.test',
      );
      expect(url.searchParams.get('date')).toBe(
        `range:${h.data.current.startAt}:${h.data.current.endAt - 1}`,
      );
      expect(url.searchParams.has('dateMode')).toBe(false);
    }
    expect(screen.getByRole('link', { name: '管理爬虫库' })).toHaveAttribute(
      'href',
      '/crawlers/manage',
    );
  });
  it.each([401, 403, 404, 409])(
    'keeps old scores withdrawn after export %s and unsuccessful rereads',
    async status => {
      h.data.current = { ...h.data.current, state: 'reference', score: 10, level: 1 };
      h.download.mockRejectedValue({ status, message: 'invalidated' });
      h.refetch.mockResolvedValue({ isSuccess: false, isError: true, error: { status: 503 } });
      render(<GeoWeightSummary {...props} />);
      fireEvent.click(screen.getByText('查看计算依据'));
      fireEvent.click(screen.getByText('导出计算依据'));
      await waitFor(() => expect(h.refetch).toHaveBeenCalledTimes(2));
      expect(screen.queryByText('10.0 / 100')).not.toBeInTheDocument();
      expect(screen.queryByText('当前读取未完成，保留上次计算结果')).not.toBeInTheDocument();
      if (status !== 409)
        expect(screen.getByText('访问权限已变更，请重新打开页面')).toBeInTheDocument();
    },
  );
  it('restores an invalidated score only after a successful fresh read, including an unchanged snapshot', async () => {
    h.data.current = { ...h.data.current, state: 'reference', score: 10, level: 1 };
    h.download.mockRejectedValue({ status: 409, message: 'invalidated' });
    h.refetch.mockResolvedValue({ isSuccess: false, isError: true, error: { status: 503 } });
    const view = render(<GeoWeightSummary {...props} />);
    fireEvent.click(screen.getByText('查看计算依据'));
    fireEvent.click(screen.getByText('导出计算依据'));
    await waitFor(() => expect(h.refetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('10.0 / 100')).not.toBeInTheDocument();
    h.updatedAt++;
    view.rerender(<GeoWeightSummary {...props} />);
    expect(screen.getByText('10.0 / 100')).toBeInTheDocument();
    expect(screen.getByText('导出计算依据')).toBeEnabled();
  });
  it.each([403, 409])(
    'keeps a query boundary %s latched when the next read fails transiently',
    status => {
      h.data.current = { ...h.data.current, state: 'reference', score: 10, level: 1 };
      const view = render(<GeoWeightSummary {...props} />);
      h.error = { status, message: 'invalidated' };
      view.rerender(<GeoWeightSummary {...props} />);
      h.error = { status: 503, message: 'unavailable' };
      view.rerender(<GeoWeightSummary {...props} />);
      expect(screen.queryByText('10.0 / 100')).not.toBeInTheDocument();
      h.error = null;
      h.updatedAt++;
      view.rerender(<GeoWeightSummary {...props} />);
      expect(screen.getByText('10.0 / 100')).toBeInTheDocument();
    },
  );
  it('offers retry instead of an indefinite loader when cached details predate the summary', () => {
    h.detail = { ...h.data, calculatedAt: '2026-10-20T23:59:00Z' };
    render(<GeoWeightSummary {...props} />);
    fireEvent.click(screen.getByText('查看计算依据'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('GEO 权重计算未完成，请重新读取')).toBeInTheDocument();
    expect(within(dialog).queryByText('正在计算 GEO 权重')).not.toBeInTheDocument();
    expect(within(dialog).getByText('重新读取')).toBeEnabled();
    expect(within(dialog).getByText('导出计算依据')).toBeDisabled();
  });
  it('clears cached scores on a reset conflict while keeping manual retry available', () => {
    h.data.current = { ...h.data.current, state: 'reference', score: 10, level: 1 };
    const view = render(<GeoWeightSummary {...props} />);
    expect(screen.getByText('10.0 / 100')).toBeInTheDocument();
    h.error = { status: 409, message: 'reset' };
    view.rerender(<GeoWeightSummary {...props} />);
    expect(screen.queryByText('10.0 / 100')).not.toBeInTheDocument();
    expect(screen.queryByText('当前读取未完成，保留上次计算结果')).not.toBeInTheDocument();
    expect(screen.getByText('重新读取')).toBeEnabled();
    expect(screen.getByText('查看计算依据')).toBeDisabled();
  });
  it('keeps a newer detail result in the summary after the dialog closes', () => {
    h.data.current = { ...h.data.current, state: 'reference', score: 10, level: 1 };
    const view = render(<GeoWeightSummary {...props} />);
    fireEvent.click(screen.getByText('查看计算依据'));
    h.detail = {
      ...h.data,
      calculatedAt: '2026-10-21T00:01:00Z',
      snapshot: 'new-detail',
      current: { ...h.data.current, score: 20, level: 2 },
    };
    view.rerender(<GeoWeightSummary {...props} />);
    fireEvent.click(screen.getByText('Close'));
    expect(screen.getByText('20.0 / 100')).toBeInTheDocument();
    expect(screen.queryByText('10.0 / 100')).not.toBeInTheDocument();
  });
  it('keeps missing scores empty, loads details only on demand and gives both entries the same query scope', () => {
    render(<GeoWeightSummary {...props} />);
    expect(screen.getByText('暂无评分')).toBeInTheDocument();
    expect(screen.queryByText('0.0 / 100')).not.toBeInTheDocument();
    expect(h.calls.find(c => c[4] === 'detail')[5]).toBe(false);
    fireEvent.click(screen.getByText('查看计算依据'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(h.calls.some(c => c[4] === 'detail' && c[5] === true)).toBe(true);
    expect(screen.queryByText('管理爬虫库')).not.toBeInTheDocument();
  });
  it('uses English labels and numbers without altering stable identifiers', () => {
    h.data.current = { ...h.data.current, state: 'reference', score: 63.8, level: 7 };
    render(
      <LiekanLocaleContext.Provider value="en-US">
        <GeoWeightSummary {...props} expanded />
      </LiekanLocaleContext.Provider>,
    );
    expect(screen.getByText('63.8 / 100')).toBeInTheDocument();
    expect(screen.getByText(/Reference level/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('View calculation evidence'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('geo-weight-v1.2-beta')).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/[\u3400-\u9fff]/);
    expect(within(dialog).getByText(/6\.3 points to the next level/)).toBeInTheDocument();
  });
  it('withdraws cached results on permission errors and closes details across websites', () => {
    const view = render(<GeoWeightSummary {...props} />);
    fireEvent.click(screen.getByText('查看计算依据'));
    h.error = { status: 403, message: 'revoked' };
    view.rerender(<GeoWeightSummary {...props} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('暂无评分')).not.toBeInTheDocument();
    h.error = null;
    view.rerender(<GeoWeightSummary {...props} websiteId="site-b" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('查看计算依据')).toBeDisabled();
  });
});
