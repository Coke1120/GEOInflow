import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FeatureApp } from './FeatureApp';
const m = vi.hoisted(() => ({
  sites: vi.fn(),
  get: vi.fn(),
  nav: {
    pathname: '/websites',
    query: {},
    router: { push: vi.fn(), replace: vi.fn() },
    updateParams: vi.fn(),
  },
}));
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ href, children, prefetch: _p, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/liekan/upstream/client', () => ({
  useNavigation: () => m.nav,
  useFeatureDateRange: () => ({
    dateRange: {
      value: 'range:1000000000000:1000086400000:day',
      startDate: new Date(1000000000000),
      endDate: new Date(1000086400000),
      unit: 'day',
    },
  }),
}));
vi.mock('@/lib/liekan/upstream/features-client', async original => ({
  ...(await original<typeof import('@/lib/liekan/upstream/features-client')>()),
  getFeatureSites: m.sites,
  getAllFeatureRows: async () => [],
  getFeaturePreferences: () => ({ timezone: 'Asia/Shanghai' }),
  featureApi: { get: m.get, post: vi.fn(), del: vi.fn() },
}));
it('keeps the website loading-search input focused when metadata resolves', async () => {
  let finish: any;
  m.sites.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  m.get.mockResolvedValue([{ id: 's', views: 12, received: true }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <FeatureApp user={{ id: 'u', username: 'u', role: 'user' }} route={{ page: 'websites' }} />
    </QueryClientProvider>,
  );
  const initial = await screen.findByRole('searchbox', { name: '搜索本页记录' });
  initial.focus();
  fireEvent.change(initial, { target: { value: 'foo' } });
  Object.assign(m.nav.query, { search: 'foo' });
  expect(document.activeElement).toBe(initial);
  await act(async () => finish([{ id: 's', name: 'site', domain: 'site.example', userId: 'u' }]));
  await waitFor(() => expect(m.get).toHaveBeenCalled());
  const current = screen.getByRole('searchbox', { name: '搜索本页记录' });
  expect(current).toBe(initial);
  expect(current).toHaveValue('foo');
  expect(document.activeElement).toBe(current);
  view.unmount();
  client.clear();
});
