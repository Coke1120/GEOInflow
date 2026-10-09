import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FeatureProvider, useAction } from './context';

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
