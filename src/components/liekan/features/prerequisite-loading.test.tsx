import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DataLoadingContext } from '../LoadingState';
import { FeatureProvider, useData } from './context';

it('waits for current scope metadata before reading totals and keeps cached totals hidden', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const load = vi.fn(async () => ({ views: 12 }));
  const key = ['liekan-feature', 'owner', 'totals'];
  client.setQueryData(key, { views: 99 });
  function Totals() {
    const query = useData('totals', load, true, { queryKey: key, staleTime: 0 });
    return <p>{query.isPending ? '正在读取' : String(query.data?.views)}</p>;
  }
  const app = (pending: boolean) => (
    <QueryClientProvider client={client}>
      <FeatureProvider value={{ user: { id: 'owner' }, route: { page: 'websites' } } as any}>
        <DataLoadingContext.Provider value={pending}>
          <Totals />
        </DataLoadingContext.Provider>
      </FeatureProvider>
    </QueryClientProvider>
  );
  const view = render(app(true));
  expect(screen.getByText('正在读取')).toBeInTheDocument();
  expect(screen.queryByText('99')).not.toBeInTheDocument();
  expect(load).not.toHaveBeenCalled();
  view.rerender(app(false));
  expect(await screen.findByText('12')).toBeInTheDocument();
  expect(load).toHaveBeenCalledOnce();
  view.unmount();
  client.clear();
});
