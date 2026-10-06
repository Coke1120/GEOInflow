import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { featureApi } from '@/lib/liekan/upstream/features-client';
import { FeatureProvider } from './context';
import { AnalyticsPages } from './AnalyticsPages';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));
let client: QueryClient;
let visibility = 'visible';
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T00:00:00Z'));
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility as any);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const advance = (time: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(time);
  });
it.each(['segment', 'cohort'])(
  'renews visible %s row statistics, pauses while hidden and bounds retained failed rows',
  async type => {
    let rowReads = 0;
    let failing = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/segments'))
          return Response.json([
            {
              id: 'audience',
              name: '测试人群',
              parameters: { filters: [], action: { value: 'register' }, dateRange: '30day' },
            },
          ]);
        const row = url.searchParams.has(type);
        if (row) rowReads++;
        if (row && failing) return Response.json({}, { status: 503 });
        return Response.json(
          { visitors: row ? 6 + rowReads : 100 },
          {
            headers: {
              'X-Liekan-Server-Time': String(Date.now()),
              'X-Liekan-Generated-At': String(Date.now()),
              'X-Liekan-Expires-At': String(Date.now() + 30000),
            },
          },
        );
      }),
    );
    const page = type === 'segment' ? 'segments' : 'cohorts';
    render(
      <QueryClientProvider client={client}>
        <FeatureProvider
          value={
            {
              user: { id: 'viewer' },
              siteId: 'site',
              site: { id: 'site', userId: 'owner' },
              route: { page },
              api: featureApi,
              query: {},
              filters: {},
              teams: [],
              range: { startAt: 0, endAt: Date.now(), timezone: 'UTC', unit: 'day' },
              href: () => '/edit',
            } as any
          }
        >
          <AnalyticsPages page={page} />
        </FeatureProvider>
      </QueryClientProvider>,
    );
    await advance(1);
    expect(screen.getByText('7')).toBeInTheDocument();
    await advance(30000);
    expect(rowReads).toBe(2);
    expect(screen.getByText('8')).toBeInTheDocument();
    visibility = 'hidden';
    fireEvent(document, new Event('visibilitychange'));
    await advance(35000);
    expect(rowReads).toBe(2);
    failing = true;
    visibility = 'visible';
    fireEvent(document, new Event('visibilitychange'));
    await advance(1);
    expect(rowReads).toBe(3);
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText(/更新失败/)).toBeInTheDocument();
    await advance(25000);
    expect(screen.queryByText('8')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试读取' })).toBeInTheDocument();
  },
);
