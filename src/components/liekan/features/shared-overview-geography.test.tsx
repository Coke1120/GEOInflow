import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { freshAggregateFixture } from '@/test/liekan-freshness';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';
import type { LiekanLocale } from '@/lib/liekan/i18n/locale';
import { SharedWebsiteOverview } from './SharedWebsiteOverview';

vi.mock('../ReportComponents', () => ({
  ReferenceChart: () => <div role="img" aria-label="Share chart" />,
  InsightRows: () => null,
}));

const range = { startAt: 1, endAt: 10, timezone: 'UTC' };
function fixture() {
  return {
    website: { id: 'shared-site', name: '网站原名', domain: 'site.example' },
    states: { human: 'available', logs: 'not_connected', goals: 'unsupported' },
    cards: [
      { key: 'top-city', label: 'TOP1 城市', value: '西安', state: 'available' },
      { key: 'overseas-country', label: '海外 TOP1', value: '美国', state: 'available' },
    ],
    charts: {},
    tables: {
      envGrid: [],
      cityBody: ['西安', '未审核城镇', '陕西 · 城市未知'].map(city => ({
        city,
        sessions: 1,
        share: 33.33,
        duration: 60,
        bounceRate: 0,
        conversionRate: null,
      })),
    },
    insights: [],
    meta: {
      demo: false,
      geography: {
        cards: {
          'top-city': { country: 'CN', region: 'CN-61', city: '西安', cityId: 1790630 },
          'overseas-country': { country: 'US', region: null, city: null, cityId: null },
        },
        tables: {
          cityBody: [
            { country: 'CN', region: 'CN-61', city: '西安', cityId: 1790630 },
            { country: 'CN', region: null, city: '未审核城镇', cityId: null },
            { country: 'CN', region: 'CN-61', city: null, cityId: null },
          ],
        },
      },
    },
    capabilities: { goals: false },
  };
}

it('renders English shared geography from retained stable identities and restores Chinese without refetching', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const report = fixture();
  const original = JSON.stringify(report);
  const request = vi.fn(async (_path, _params, signal?: AbortSignal) =>
    freshAggregateFixture(report, signal),
  );
  const page = (locale: LiekanLocale) => (
    <QueryClientProvider client={client}>
      <LiekanLocaleContext.Provider value={locale}>
        <SharedWebsiteOverview
          id="shared-site"
          token="share-token"
          range={range}
          request={request}
        />
      </LiekanLocaleContext.Provider>
    </QueryClientProvider>
  );
  const view = render(page('en-US'));
  try {
    await screen.findByRole('heading', { name: '网站原名' });
    expect(screen.getAllByText("Xi'an")).toHaveLength(2);
    expect(screen.getByText('United States')).toBeVisible();
    expect(screen.getByText('Shaanxi · Unknown city')).toBeVisible();
    expect(screen.getByText('未审核城镇')).toBeVisible();
    expect(screen.queryByText('西安')).not.toBeInTheDocument();
    expect(screen.getAllByText('1m 0s')).toHaveLength(3);
    expect(request).toHaveBeenCalledTimes(1);
    view.rerender(page('zh-CN'));
    expect(screen.getAllByText('西安')).toHaveLength(2);
    expect(screen.getByText('美国')).toBeVisible();
    expect(screen.getByText('陕西 · 城市未知')).toBeVisible();
    expect(screen.getByText('未审核城镇')).toBeVisible();
    expect(screen.getAllByText('1分0秒')).toHaveLength(3);
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(report)).toBe(original);
  } finally {
    view.unmount();
    client.clear();
  }
});

it('localizes shared long-range chart subtitles without changing the snapshot range', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const request = vi.fn(async (_path, _params, signal?: AbortSignal) =>
    freshAggregateFixture(fixture(), signal),
  );
  const selected = { startAt: Date.UTC(2026, 7, 1), endAt: Date.UTC(2026, 9, 14), timezone: 'UTC' };
  const view = render(
    <QueryClientProvider client={client}>
      <LiekanLocaleContext.Provider value="en-US">
        <SharedWebsiteOverview
          id="shared-site"
          token="share-token"
          range={selected}
          request={request}
        />
      </LiekanLocaleContext.Provider>
    </QueryClientProvider>,
  );
  try {
    await screen.findByRole('heading', { name: '网站原名' });
    expect(screen.getAllByText(/Last 30 days as of end date/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/截至结束日期的近 30 天/)).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toMatchObject(selected);
  } finally {
    view.unmount();
    client.clear();
  }
});
it('retains legacy raw geography labels when optional shared display metadata is absent', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const report = fixture();
  delete report.meta.geography;
  const request = vi.fn(async (_path, _params, signal?: AbortSignal) =>
    freshAggregateFixture(report, signal),
  );
  const view = render(
    <QueryClientProvider client={client}>
      <LiekanLocaleContext.Provider value="en-US">
        <SharedWebsiteOverview
          id="shared-site"
          token="share-token"
          range={range}
          request={request}
        />
      </LiekanLocaleContext.Provider>
    </QueryClientProvider>,
  );
  try {
    await screen.findByRole('heading', { name: '网站原名' });
    expect(screen.getAllByText('西安')).toHaveLength(2);
    expect(screen.getByText('未审核城镇')).toBeVisible();
    expect(screen.queryByText("Xi'an")).not.toBeInTheDocument();
  } finally {
    view.unmount();
    client.clear();
  }
});
