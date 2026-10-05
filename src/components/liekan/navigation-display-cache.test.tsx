import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Navigation } from './Navigation';

const mocks = vi.hoisted(() => ({ settings: vi.fn() }));
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ children, prefetch: _prefetch, ...props }: any) => <a {...props}>{children}</a>,
}));
vi.mock('@/lib/liekan/upstream/client', () => ({
  useFeatureDateRange: () => ({ dateRange: { startDate: new Date(0), endDate: new Date(1000) } }),
  useNavigation: () => ({ pathname: '/websites/site-a/geo', query: {}, router: {} }),
}));
vi.mock('@/lib/liekan/upstream/features-client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/liekan/upstream/features-client')>()),
  featureApi: { get: mocks.settings },
  getAllFeatureRows: async () => [],
}));

it('keeps report-confirmed mode across navigation remounts, isolates identities, and prefers recovered settings', async () => {
  mocks.settings.mockRejectedValue({ status: 500 });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const node = (userId = 'user', websiteId = 'site-a', page = 'overview') => (
    <QueryClientProvider client={client}>
      <Navigation
        user={{ id: userId, username: 'admin' } as any}
        route={{ page, websiteId }}
        width={228}
        onWidth={vi.fn()}
      />
    </QueryClientProvider>
  );
  try {
    let view = render(node());
    await waitFor(() => expect(mocks.settings).toHaveBeenCalled());
    expect(screen.getByRole('link', { name: '抓取总览' })).toBeInTheDocument();
    act(() =>
      client.setQueryData(['liekan-feature', 'user', 'reported-crawler-display', 'site-a'], false),
    );
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: '抓取总览' })).not.toBeInTheDocument(),
    );
    view.unmount();
    view = render(node('user', 'site-a', 'website-settings'));
    expect(screen.queryByRole('link', { name: '抓取总览' })).not.toBeInTheDocument();
    view.rerender(node('user', 'site-b'));
    expect(screen.getByRole('link', { name: '抓取总览' })).toBeInTheDocument();
    view.rerender(node('another-user', 'site-a'));
    expect(screen.getByRole('link', { name: '抓取总览' })).toBeInTheDocument();
    view.rerender(node());
    expect(screen.queryByRole('link', { name: '抓取总览' })).not.toBeInTheDocument();
    act(() =>
      client.setQueryData(['liekan-feature', 'user', 'website-display-settings', 'site-a'], {
        aiCrawlerEnabled: true,
      }),
    );
    await waitFor(() => expect(screen.getByRole('link', { name: '抓取总览' })).toBeInTheDocument());
    view.unmount();
  } finally {
    client.clear();
  }
});
