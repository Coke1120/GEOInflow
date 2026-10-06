import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { expect, it } from 'vitest';

it('cancels an abandoned prefetch and keeps a read serving a visible observer', async () => {
  const client = new QueryClient();
  const signals: AbortSignal[] = [];
  const queryFn = ({ signal }: { signal: AbortSignal }) => {
    signals.push(signal);
    return new Promise<number>(() => {});
  };
  const first = client.prefetchQuery({ queryKey: ['abandoned'], queryFn });
  await client.cancelQueries({ queryKey: ['abandoned'], exact: true, type: 'inactive' });
  expect(signals[0].aborted).toBe(true);
  await first;
  const second = client.prefetchQuery({ queryKey: ['visible'], queryFn });
  const observer = new QueryObserver(client, { queryKey: ['visible'], queryFn });
  const unsubscribe = observer.subscribe(() => {});
  await client.cancelQueries({ queryKey: ['visible'], exact: true, type: 'inactive' });
  expect(signals[1].aborted).toBe(false);
  unsubscribe();
  expect(signals[1].aborted).toBe(true);
  await second;
  client.clear();
});
