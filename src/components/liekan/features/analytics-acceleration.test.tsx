import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ManualRefreshProvider } from '@/lib/liekan/contracts/manual-refresh';
import { FeatureProvider } from './context';
import { AnalyticsAccelerationPage } from './AnalyticsAccelerationPage';
vi.mock('next/link', () => ({
  default: ({ children, prefetch: _prefetch, ...props }: any) => <a {...props}>{children}</a>,
}));
vi.mock('@/lib/liekan/upstream/catalog-client', () => ({
  clientCatalogVersion: vi.fn(async () => 'fixture'),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const id = '11111111-1111-4111-8111-111111111111';
const detail = {
  websiteId: id,
  revision: 1,
  mode: 'live',
  captureFrom: '2026-10-01T00:00:00Z',
  expansion: { path: true, visit: true },
  capacity: { siteBytes: '1', siteLimit: 1024, globalBytes: '1', globalLimit: 2048 },
  builds: [],
  coverage: [],
};
function mount(get: any, post: any) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const value = {
    user: { id: 'owner' },
    query: { websiteId: id },
    api: { get, post },
    range: { timezone: 'UTC' },
    href: () => '/websites',
    navigate: vi.fn(),
  } as any;
  return render(
    <QueryClientProvider client={client}>
      <ManualRefreshProvider>
        <FeatureProvider value={value}>
          <AnalyticsAccelerationPage />
        </FeatureProvider>
      </ManualRefreshProvider>
    </QueryClientProvider>,
  );
}
const advance = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
it('registers ordinary reads and keeps the submitted message after the status refresh', async () => {
  vi.useFakeTimers();
  const get = vi.fn(async (path: string) =>
    path === '/liekan/analytics-acceleration'
      ? { websites: [{ id, name: 'Fixture' }], nextCursor: null }
      : detail,
  );
  const post = vi.fn(async () => ({}));
  mount(get, post);
  await advance();
  await advance();
  expect(screen.getByRole('button', { name: '开始构建' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '开始构建' }));
  await advance();
  await advance();
  expect(post).toHaveBeenCalledWith(
    `/liekan/websites/${id}/analytics-acceleration/build`,
    expect.objectContaining({ preset: 'common', expectedRevision: 1, timezone: 'UTC' }),
  );
  expect(screen.getByText('操作已提交，关闭页面后后台继续处理。')).toBeVisible();
  expect(
    get.mock.calls.filter(([path]) => path.endsWith('/analytics-acceleration')).length,
  ).toBeGreaterThanOrEqual(3);
});
it('shows a failed initial read as an error without fabricating a maintenance state', async () => {
  vi.useFakeTimers();
  const get = vi.fn(async (path: string) => {
    if (path === '/liekan/analytics-acceleration') return { websites: [], nextCursor: null };
    throw Object.assign(new Error('无权访问该站点'), { status: 403 });
  });
  mount(get, vi.fn());
  await advance();
  await advance();
  expect(screen.getByText('无权访问该站点')).toBeVisible();
  expect(screen.queryByRole('button', { name: '开始构建' })).toBeNull();
});

it('removes controls and retained status after a previously authorized action is rejected', async () => {
  vi.useFakeTimers();
  const get = vi.fn(async (path: string) =>
    path === '/liekan/analytics-acceleration'
      ? { websites: [{ id, name: 'Fixture' }], nextCursor: null }
      : detail,
  );
  const post = vi.fn(async () => {
    throw Object.assign(new Error('无权访问该站点'), { status: 403 });
  });
  mount(get, post);
  await advance();
  await advance();
  fireEvent.click(screen.getByRole('button', { name: '开始构建' }));
  await advance();
  await advance();
  expect(screen.getByText('无权访问该站点')).toBeVisible();
  expect(screen.queryByRole('button', { name: '开始构建' })).toBeNull();
  expect(screen.queryByRole('button', { name: '停用加速' })).toBeNull();
});
