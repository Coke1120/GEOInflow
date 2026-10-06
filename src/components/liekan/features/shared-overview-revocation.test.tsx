import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { freshAggregateFixture } from '@/test/liekan-freshness';
import { SharedWebsiteOverview } from './SharedWebsiteOverview';

vi.mock('../ReportComponents', () => ({
  ReferenceChart: () => <div role="img" aria-label="分享图表" />,
  InsightRows: () => null,
}));

it.each([401, 403, 404])('purges inactive ranges using the authorized cache scope after %s', async status => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const range = { startAt: 1, endAt: 10, timezone: 'UTC' };
  const report = {
    website: { id: 'site-1', name: '分享网站', domain: 'site.example' },
    states: { human: 'available', logs: 'not_connected' },
    cards: [], charts: {}, tables: { envGrid: [], cityBody: [] }, insights: [],
    meta: { demo: false }, capabilities: { goals: false },
  };
  const request = vi.fn(async (_path: string, _params: any, signal?: AbortSignal) =>
    freshAggregateFixture(report, signal),
  );
  const page = (selectedRange: typeof range) => (
    <QueryClientProvider client={client}>
      <SharedWebsiteOverview id="site-1" token="rotating-token" cacheKey="authorized-scope"
        range={selectedRange} request={request} />
    </QueryClientProvider>
  );
  const view = render(page(range));
  try {
    await screen.findByRole('heading', { name: '分享网站' });
    const previousKey = ['liekan-shared-report', 'authorized-scope', 'site-1', range, '24h'];
    expect(client.getQueryData(previousKey)).toBeDefined();
    request.mockRejectedValueOnce(Object.assign(new Error('Share access revoked'), { status }));
    view.rerender(page({ ...range, endAt: 20 }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(client.getQueryData(previousKey)).toBeUndefined());
    expect(screen.queryByRole('heading', { name: '分享网站' })).not.toBeInTheDocument();
    expect(screen.queryByText('site.example')).not.toBeInTheDocument();
  } finally {
    view.unmount(); client.clear();
  }
});
