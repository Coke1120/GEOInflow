import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { beforeEach, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  context: null as any,
  audit: null as any,
  risk: null as any,
  refetch: vi.fn(),
  close: vi.fn(),
}));
vi.mock('./context', () => ({
  useFeature: () => mocks.context,
  useData: (key: any) => ({
    data: key[0] === 'traffic-quality' ? mocks.audit : mocks.risk,
    isFetching: false,
    isPending: false,
    refetch: mocks.refetch,
  }),
}));
vi.mock('./LiekanDialog', () => ({
  useDialog: () => ({ requestClose: mocks.close }),
  LiekanDialog: ({ children }: any) => <div>{children}</div>,
  DialogActions: ({ children }: any) => <div>{children}</div>,
}));
import { TrafficQuality } from './TrafficQuality';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.audit = {
    available: true,
    policy: {
      mode: 'standard',
      allowedHostnames: [],
      revision: '7',
      ruleVersion: 'traffic-quality-v1',
    },
    totals: {
      rawPV: 5,
      includedPV: 3,
      excludedPV: 2,
      rawUV: 2,
      includedUV: 2,
      fullyExcludedUV: 0,
      missingVerdictPV: 0,
    },
    domainAudit: { hosts: [] },
    history: [],
    rows: [],
  };
  mocks.risk = {
    available: true,
    mode: 'observe',
    ruleVersion: 'browser-behavior-v1',
    state: null,
    coverage: { windows: 0, partialWindows: 0 },
    findings: [],
    impact: { flaggedPV: 0, fullyExcludedUV: 0 },
  };
  mocks.context = {
    user: { id: 'owner' },
    siteId: 'site',
    query: {},
    route: { page: 'website-settings' },
    range: { startAt: 1000, endAt: 2000, timezone: 'UTC' },
    api: { post: vi.fn(), put: vi.fn() },
    refresh: vi.fn(),
  };
});
it('requires preview and management permission before saving', async () => {
  const view = render(<TrafficQuality canManage={false} onClose={mocks.close} />);
  expect(screen.getByRole('button', { name: '预览影响' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '确认保存' })).toBeDisabled();
  view.rerender(<TrafficQuality canManage onClose={mocks.close} />);
  expect(screen.getByRole('button', { name: '确认保存' })).toBeDisabled();
  mocks.context.api.post.mockResolvedValue({
    current: { includedPV: 3, includedUV: 2 },
    preview: { includedPV: 2, includedUV: 1 },
  });
  fireEvent.click(screen.getByRole('button', { name: '预览影响' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '确认保存' })).toBeEnabled());
  expect(mocks.context.api.post).toHaveBeenCalledWith(
    '/liekan/websites/site/traffic-quality/preview',
    expect.objectContaining({
      policy: { mode: 'standard', allowedHostnames: [], expectedRevision: '7' },
    }),
  );
  fireEvent.change(screen.getByLabelText('统计模式'), { target: { value: 'strict' } });
  await waitFor(() => expect(screen.getByRole('button', { name: '确认保存' })).toBeDisabled());
});
it('shows unsupported and missing evidence separately from zero', () => {
  mocks.audit = { available: false, reason: '流量质量分析当前支持 PostgreSQL' };
  render(<TrafficQuality canManage onClose={mocks.close} />);
  expect(screen.getByText('流量质量分析当前支持 PostgreSQL')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '确认保存' })).toBeNull();
});
it('does not read in the background and uses the dialog unsaved-close guard', async () => {
  vi.useFakeTimers();
  try {
    render(<TrafficQuality canManage onClose={mocks.close} />);
    await act(async () => {
      vi.advanceTimersByTime(600001);
    });
    expect(mocks.refetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(mocks.close).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

it('labels missing and partial diagnostic coverage explicitly', () => {
  mocks.audit.diagnostics = {
    startedAt: new Date().toISOString(),
    coverage: 'missing',
    bucketStartAt: 0,
    bucketEndAt: 1000,
    written: null,
    duplicate: null,
  };
  const view = render(<TrafficQuality canManage onClose={mocks.close} />);
  expect(
    screen.getByText('所选范围缺少诊断证据；历史请求和失败请求不在分母内'),
  ).toBeInTheDocument();
  mocks.audit.diagnostics = {
    ...mocks.audit.diagnostics,
    coverage: 'partial',
    observedFrom: 0,
    observedUntil: 1000,
    written: 2,
    duplicate: 1,
  };
  view.rerender(<TrafficQuality canManage onClose={mocks.close} />);
  expect(screen.getByText(/仅覆盖部分范围/)).toBeInTheDocument();
});
