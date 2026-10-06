import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useWebsiteQuery } from '@/components/hooks/queries/useWebsiteQuery';
import { touch } from '@/components/hooks/useModified';
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/components/hooks/useApi', async () => ({
  useApi: () => ({ get: mocks.get, useQuery: (awaitQuery: any) => useQuery(awaitQuery) }),
}));
import { useQuery } from '@tanstack/react-query';
function Site() {
  const query = useWebsiteQuery('metadata-regression', {
    queryKey: ['liekan-feature', 'user', 'site', 'metadata-regression'],
    staleTime: 300000,
  });
  return <p>{query.data?.name}</p>;
}
it('bridges native website modification into the shared metadata query', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.get.mockResolvedValue({ name: '原名称' });
  render(
    <QueryClientProvider client={client}>
      <Site />
    </QueryClientProvider>,
  );
  await screen.findByText('原名称');
  mocks.get.mockResolvedValue({ name: '更新名称' });
  act(() => touch('website:metadata-regression'));
  await waitFor(() => expect(screen.getByText('更新名称')).toBeInTheDocument());
  expect(mocks.get).toHaveBeenCalledTimes(2);
});

it('reuses refreshed metadata and reports after remounting following an earlier edit', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.get.mockClear();
  mocks.get.mockResolvedValue({ name: '原名称' });
  const page = <QueryClientProvider client={client}><Site /></QueryClientProvider>;
  const view = render(page);
  await screen.findByText('原名称');
  mocks.get.mockResolvedValue({ name: '更新名称' });
  act(() => touch('website:metadata-regression'));
  await screen.findByText('更新名称');
  const reportKey = ['liekan', 'metadata-regression', undefined, 'overview'];
  client.setQueryData(reportKey, { visitors: 123 });
  const calls = mocks.get.mock.calls.length;
  view.unmount();
  render(page);
  await screen.findByText('更新名称');
  expect(mocks.get).toHaveBeenCalledTimes(calls);
  expect(client.getQueryState(reportKey)?.isInvalidated).toBe(false);
});
