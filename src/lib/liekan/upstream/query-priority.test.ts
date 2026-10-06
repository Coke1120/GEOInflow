import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { observeRequestPriority, withClientFreshness } from './client-freshness';
import { RequestPool } from './request-pool';

it('promotes an existing queued prefetch when a query observer attaches without invoking its loader again', async () => {
  const pool = new RequestPool(2);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stop = observeRequestPriority(client);
  let finish!: () => void;
  const busy = pool.read(
    'unrelated',
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  const queryKey = ['page', 'visible'];
  const load = vi.fn(async () => 7);
  const query = {
    queryKey,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      withClientFreshness(signal, () => pool.read('target', load, signal, 'prefetch'), {
        priority: 'prefetch',
        queryKey,
      }),
  };
  const warm = client.prefetchQuery(query);
  await Promise.resolve();
  expect(load).not.toHaveBeenCalled();
  const observer = new QueryObserver(client, query);
  const unsubscribe = observer.subscribe(() => {});
  await warm;
  expect(load).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(queryKey)).toBe(7);
  finish();
  await busy;
  unsubscribe();
  stop();
  client.clear();
});
