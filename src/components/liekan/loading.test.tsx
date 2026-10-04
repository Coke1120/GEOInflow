import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiekanPage } from './LiekanPage';
import { LiekanShell } from './LiekanShell';

const mocks = vi.hoisted(() => ({
  metadata: { data: undefined, isPending: true, isError: false, refetch: vi.fn() } as any,
  report: { data: undefined, isPending: true, isError: false, refetch: vi.fn() } as any,
  pathname: '/websites/site-a/geo/content',
}));
vi.mock('@tanstack/react-query', async importOriginal => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ children, prefetch: _prefetch, ...props }: any) => <a {...props}>{children}</a>,
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock('./Navigation', () => ({
  useSidebarWidth: () => [228, vi.fn()],
  Navigation: ({ site }: any) => <div data-test="site-name">{site?.name}</div>,
}));
vi.mock('./pages/Content', () => ({
  Content: ({ report }: any) => <div>{report ? '实际报表' : '报表占位'}</div>,
}));
vi.mock('@/lib/liekan/upstream/client', () => ({
  useFeatureAppState: (select: any) => select({ user: { id: 'current-user' } }),
  useWebsiteQuery: () => mocks.metadata,
  useWebsite: () => ({ id: 'site-a', name: '当前网站', domain: 'a.test' }),
  useFeatureDateRange: () => ({
    dateRange: { startDate: new Date('2026-09-01'), endDate: new Date('2026-10-01') },
  }),
  useApi: () => ({ useQuery: () => mocks.report }),
  useNavigation: () => ({
    pathname: mocks.pathname,
    websiteId: 'site-a',
    query: { date: '30day' },
    router: { push: vi.fn(), replace: vi.fn() },
    updateParams: vi.fn(),
  }),
}));
describe('analysis loading states', () => {
  beforeEach(() => {
    mocks.metadata = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    mocks.report = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
  });
  it('keeps the current title and tabs visible before website metadata arrives', () => {
    const view = render(
      <LiekanShell user={{ id: 'user' } as any}>
        <div>报表子页面</div>
      </LiekanShell>,
    );
    expect(screen.getByRole('heading', { name: '页面与事件' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('status')).toHaveTextContent('正在读取统计数据');
    expect(screen.queryByText('报表子页面')).not.toBeInTheDocument();
    mocks.metadata = {
      ...mocks.metadata,
      isPending: false,
      data: { id: 'site-a', name: '当前网站' },
    };
    view.rerender(
      <LiekanShell user={{ id: 'user' } as any}>
        <div>报表子页面</div>
      </LiekanShell>,
    );
    expect(screen.getByTestId('site-name')).toHaveTextContent('当前网站');
    expect(screen.getByText('报表子页面')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('rejects cached metadata from another website and offers retry on metadata failure', () => {
    mocks.metadata = { ...mocks.metadata, data: { id: 'site-b', name: '上个网站' } };
    const view = render(
      <LiekanShell user={{ id: 'user' } as any}>
        <div>报表子页面</div>
      </LiekanShell>,
    );
    expect(screen.queryByText('上个网站')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    mocks.metadata = { ...mocks.metadata, isPending: false, isError: true };
    view.rerender(
      <LiekanShell user={{ id: 'user' } as any}>
        <div>报表子页面</div>
      </LiekanShell>,
    );
    expect(screen.getByText('无法读取网站信息')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(screen.queryByText('报表子页面')).not.toBeInTheDocument();
  });
  it('distinguishes a pending report from missing data and request errors', () => {
    const view = render(<LiekanPage resource="content" />);
    expect(screen.getByRole('status')).toHaveTextContent('正在读取统计数据');
    expect(screen.queryByText('待接入')).not.toBeInTheDocument();
    mocks.report = { ...mocks.report, isPending: false, isError: true };
    view.rerender(<LiekanPage resource="content" />);
    expect(screen.getByText('无法读取此范围的数据')).toBeInTheDocument();
    expect(screen.queryByText('待接入')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    mocks.report = { ...mocks.report, isError: false, data: { website: { id: 'site-a' } } };
    view.rerender(<LiekanPage resource="content" />);
    expect(screen.getByText('实际报表')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

it('uses the human overview frame for the human parent route before metadata arrives', () => {
  mocks.pathname = '/websites/site-a/geo/human';
  mocks.metadata = { data: undefined, isPending: true };
  render(
    <LiekanShell user={{ id: 'user' } as any}>
      <div>业务正文</div>
    </LiekanShell>,
  );
  expect(screen.getByRole('img', { name: 'h1 数据图表: 正在读取' })).toHaveStyle({
    height: '270px',
  });
  expect(screen.queryByRole('img', { name: /d1 数据图表/ })).not.toBeInTheDocument();
});
