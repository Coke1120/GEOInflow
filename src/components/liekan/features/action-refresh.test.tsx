import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FeatureProvider, useAction } from './context';
import { ManualRefreshProvider, useManualQuery } from '@/lib/liekan/contracts/manual-refresh';
const location = vi.hoisted(() => ({ path: '/websites/101/settings' }));
vi.mock('next/navigation', () => ({
  usePathname: () => location.path,
  useSearchParams: () => new URLSearchParams(),
}));

it('shows board save success immediately and keeps editing locked until its metadata refresh completes', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const notify = vi.fn();
  let finish!: (value: any) => void;
  const load = vi
    .fn()
    .mockResolvedValueOnce({ id: 'board', parameters: { rows: [] } })
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
  function Editor() {
    const query = useQuery({
      queryKey: ['liekan-feature', 'user', 'board-record', 'board'],
      queryFn: load,
    });
    const action = useAction();
    return (
      <button
        disabled={query.isPending || action.busy}
        onClick={() => {
          void action.run(async () => ({}));
        }}
      >
        保存
      </button>
    );
  }
  render(
    <QueryClientProvider client={client}>
      <FeatureProvider
        value={
          { user: { id: 'user' }, route: { page: 'board-design', id: 'board' }, notify } as any
        }
      >
        <Editor />
      </FeatureProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByRole('button')).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('已保存'));
  expect(screen.getByRole('button')).toBeDisabled();
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await act(async () => finish({ id: 'board', parameters: { rows: [] } }));
  await waitFor(() => expect(screen.getByRole('button')).not.toBeDisabled());
});

it('cancels inactive report prefetches before a successful site edit invalidates them', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = [
    'liekan',
    'site',
    undefined,
    'overview',
    0,
    1,
    'UTC',
    '30d',
    '',
    '',
    1,
    '',
    '',
    '{}',
    'user',
  ];
  client.setQueryData(key, { value: 'before' });
  let finish!: (value: any) => void;
  let oldSignal!: AbortSignal;
  const pending = client.prefetchQuery({
    queryKey: key,
    queryFn: ({ signal }) => {
      oldSignal = signal;
      return new Promise(resolve => {
        finish = resolve;
      });
    },
  });
  const notify = vi.fn();
  function Editor() {
    const action = useAction();
    return <button onClick={() => void action.run(async () => ({}))}>编辑</button>;
  }
  render(
    <QueryClientProvider client={client}>
      <FeatureProvider
        value={
          {
            user: { id: 'user' },
            siteId: 'site',
            route: { page: 'website-settings' },
            notify,
          } as any
        }
      >
        <Editor />
      </FeatureProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText('编辑'));
  await waitFor(() => expect(client.getQueryState(key)?.isInvalidated).toBe(true));
  expect(oldSignal.aborted).toBe(true);
  finish({ value: 'stale' });
  await pending;
  expect(client.getQueryData(key)).toEqual({ value: 'before' });
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
});

it('cancels active reads before leaving a deleted resource and invalidates only the acting user caches', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ['liekan-feature', 'user', 'board-record', 'board'];
  const foreign = ['liekan-feature', 'other-user', 'board-record', 'other'];
  client.setQueryData(key, { name: 'before' });
  client.setQueryData(foreign, { name: 'foreign' });
  const notify = vi.fn(),
    navigate = vi.fn();
  let signal!: AbortSignal;
  let finish!: (value: any) => void;
  const load = vi.fn(({ signal: current }: { signal: AbortSignal }) => {
    signal = current;
    return new Promise(resolve => {
      finish = resolve;
    });
  });
  function Editor() {
    useQuery({ queryKey: key, queryFn: load });
    const action = useAction();
    return (
      <button
        onClick={() => void action.run(async () => ({}), '看板已删除', { navigateTo: 'boards' })}
      >
        删除
      </button>
    );
  }
  render(
    <QueryClientProvider client={client}>
      <FeatureProvider
        value={
          {
            user: { id: 'user' },
            route: { page: 'board-design', id: 'board' },
            notify,
            navigate,
          } as any
        }
      >
        <Editor />
      </FeatureProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(signal).toBeDefined());
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith('boards', undefined, { replace: true }),
  );
  expect(signal.aborted).toBe(true);
  expect(load).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledExactlyOnceWith('看板已删除');
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(client.getQueryState(foreign)?.isInvalidated).toBe(false);
  await act(async () => finish({ name: 'stale-after-deletion' }));
  expect(client.getQueryData(key)).toEqual({ name: 'before' });
  client.clear();
});

it.each(['resource', 'identity', 'unmount'])(
  'ignores late deletion completion after a change of %s',
  async change => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const notify = vi.fn(),
      navigate = vi.fn();
    const oldKey = ['liekan-feature', 'user', 'board-record', 'board'];
    client.setQueryData(oldKey, { id: 'board' });
    let finish!: (value: any) => void;
    const remove = () =>
      new Promise(resolve => {
        finish = resolve;
      });
    function Editor() {
      const action = useAction();
      return (
        <button onClick={() => void action.run(remove, '看板已删除', { navigateTo: 'boards' })}>
          删除
        </button>
      );
    }
    const value = {
      user: { id: 'user' },
      route: { page: 'board-design', id: 'board' },
      notify,
      navigate,
    } as any;
    const view = (current: any, mounted = true) => (
      <QueryClientProvider client={client}>
        <FeatureProvider value={current}>{mounted && <Editor />}</FeatureProvider>
      </QueryClientProvider>
    );
    const rendered = render(view(value));
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(finish).toBeDefined());
    const next =
      change === 'identity'
        ? { ...value, user: { id: 'other' } }
        : { ...value, route: { page: 'board-design', id: 'other-board' } };
    rendered.rerender(view(next, change !== 'unmount'));
    await act(async () => finish({ ok: true }));
    expect(navigate).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(client.getQueryState(oldKey)?.isInvalidated).toBe(true);
    client.clear();
  },
);

it('preserves the next website read when a previous website deletion finishes late', async () => {
  location.path = '/websites/101/settings';
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const notify = vi.fn(),
    navigate = vi.fn();
  let finishWrite!: (v: any) => void;
  let finishRead!: (v: any) => void;
  let readSignal!: AbortSignal;
  function Editor() {
    const action = useAction();
    return (
      <button
        onClick={() =>
          void action.run(() => new Promise(resolve => (finishWrite = resolve)), '旧站已删除', {
            navigateTo: 'websites',
          })
        }
      >
        删除
      </button>
    );
  }
  function NextPage() {
    const query = useManualQuery({
      queryKey: ['liekan-feature', 'actor', 'site-b', 'new-site-record'],
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        readSignal = signal;
        return new Promise(resolve => (finishRead = resolve));
      },
    });
    return <span>{query.data ? '新网站已加载' : '新网站加载中'}</span>;
  }
  const value = {
    user: { id: 'actor' },
    route: { page: 'website-settings' },
    siteId: 'site-a',
    site: { id: 'site-a' },
    notify,
    navigate,
  } as any;
  const view = (next = false) => (
    <QueryClientProvider client={client}>
      <ManualRefreshProvider>
        <FeatureProvider
          value={next ? { ...value, siteId: 'site-b', site: { id: 'site-b' } } : value}
        >
          {next ? <NextPage /> : <Editor />}
        </FeatureProvider>
      </ManualRefreshProvider>
    </QueryClientProvider>
  );
  const rendered = render(view());
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  await waitFor(() => expect(finishWrite).toBeDefined());
  location.path = '/websites/102/settings';
  rendered.rerender(view(true));
  await waitFor(() => expect(readSignal).toBeDefined());
  await act(async () => {
    finishWrite({ ok: true });
    await new Promise(resolve => setTimeout(resolve, 30));
  });
  expect(navigate).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
  expect(readSignal.aborted).toBe(false);
  await act(async () => finishRead({ id: 'site-b' }));
  expect(await screen.findByText('新网站已加载')).toBeInTheDocument();
  client.clear();
});
