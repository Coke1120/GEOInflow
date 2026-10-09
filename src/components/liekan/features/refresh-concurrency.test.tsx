import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ManualRefreshProvider } from '@/lib/liekan/contracts/manual-refresh';
import { featureApi } from '@/lib/liekan/upstream/features-client';
import { ManualRefreshControl } from '@/components/liekan/ManualRefreshControl';
import { FeatureProvider } from '@/components/liekan/features/context';
import { LinksPixelsPages } from '@/components/liekan/features/LinksPixelsPages';
import { WorkspacePages } from '@/components/liekan/features/WorkspacePages';

vi.mock('next/link', () => ({
  default: ({ children, prefetch: _p, ...props }: any) => <a {...props}>{children}</a>,
}));
vi.mock('@/components/liekan/features/Chart', () => ({ Chart: () => <div /> }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const advance = (ms = 50) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const value = (page: string) =>
  ({
    user: { id: 'actor', role: 'admin', isAdmin: true },
    route: { page, id: page === 'admin-user' ? 'target' : undefined },
    api: featureApi,
    sites: [],
    teams: [],
    siteId: '',
    site: null,
    query: {},
    filters: {},
    range: { startAt: 0, endAt: 1000, timezone: 'UTC', unit: 'day' },
    href: () => '/edit',
    navigate: vi.fn(),
    notify: vi.fn(),
    refresh: vi.fn(),
  }) as any;
const mount = (page: string, child: any) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ManualRefreshProvider>
        <FeatureProvider value={value(page)}>
          <ManualRefreshControl />
          {child}
        </FeatureProvider>
      </ManualRefreshProvider>
    </QueryClientProvider>,
  );
  return client;
};
it.each(['links', 'pixels'])('waits for final %s ids before reading charts', async kind => {
  vi.useFakeTimers();
  let reads = 0;
  let finish!: (response: Response) => void;
  const charts: URL[] = [];
  const sources = (ids: string[]) => ({
    data: ids.map(id => ({ id, name: id, slug: id, url: 'https://example.invalid/' })),
    count: ids.length,
    pageSize: 20,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/' + kind)
        return ++reads === 1
          ? Response.json(sources(['a', 'b']))
          : new Promise<Response>(resolve => (finish = resolve));
      if (url.pathname.endsWith('/charts')) {
        charts.push(url);
        return Response.json({ data: { a: { total: 7 }, b: { total: 7 }, c: { total: 7 } } });
      }
      return Response.json([]);
    }),
  );
  const client = mount(kind, <LinksPixelsPages page={kind} />);
  try {
    await advance(100);
    expect(charts).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await advance(100);
    const during = charts.map(url => ({
      ids: url.searchParams.get('ids'),
      forced: url.searchParams.get('refresh') === '1',
    }));
    await act(async () => finish(Response.json(sources(['c', 'a']))));
    await advance(100);
    const after = charts.map(url => ({
      ids: url.searchParams.get('ids'),
      forced: url.searchParams.get('refresh') === '1',
    }));

    expect(during).toHaveLength(1);
    expect(after).toHaveLength(2);
    expect(after.at(-1)).toEqual({ ids: 'c,a', forced: true });
  } finally {
    client.clear();
  }
});
it.each(['dirty', 'clean'])(
  'handles a %s administrator form when a concurrent account update arrives',
  async mode => {
    vi.useFakeTimers();
    let reads = 0;
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/users/target')
          return ++reads === 1
            ? Response.json({
                id: 'target',
                username: 'original',
                role: 'user',
              })
            : new Promise<Response>(resolve => (finish = resolve));
        return Response.json([]);
      }),
    );
    const client = mount('admin-user', <WorkspacePages page="admin-user" />);
    try {
      await advance(100);
      const input = screen.getByRole('textbox', { name: /用户名/ });
      fireEvent.click(screen.getByRole('button', { name: '刷新' }));
      await advance(50);
      expect(reads).toBe(2);
      if (mode === 'dirty') {
        fireEvent.change(input, { target: { value: 'local-draft' } });
        fireEvent.change(screen.getByLabelText(/新密码/), {
          target: { value: 'local-password-draft' },
        });
        fireEvent.change(screen.getByRole('combobox', { name: /系统角色/ }), {
          target: { value: 'admin' },
        });
        expect(input.closest('form')?.dataset.unsaved).toBe('true');
      }
      await act(async () =>
        finish(
          Response.json({
            id: 'target',
            username: 'parallel-user',
            role: 'user',
          }),
        ),
      );
      await advance(100);

      expect(screen.getByRole('textbox', { name: /用户名/ })).toHaveValue(
        mode === 'dirty' ? 'local-draft' : 'parallel-user',
      );
      expect(screen.getByLabelText(/新密码/)).toHaveValue(
        mode === 'dirty' ? 'local-password-draft' : '',
      );
      expect(screen.getByRole('combobox', { name: /系统角色/ })).toHaveValue(
        mode === 'dirty' ? 'admin' : 'user',
      );
    } finally {
      client.clear();
    }
  },
);
