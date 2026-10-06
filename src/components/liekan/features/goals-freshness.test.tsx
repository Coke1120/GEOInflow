import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { featureApi } from '@/lib/liekan/upstream/features-client';
import { FeatureProvider } from './context';
import { CorePages } from './CorePages';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));
vi.mock('./Chart', () => ({ Chart: () => <div /> }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

it('retries failed goal analytics on the aggregate interval and on reentry without rereading definitions', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T00:00:00Z'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const range = { startAt: 0, endAt: Date.now(), timezone: 'UTC', unit: 'day' };
  let definitions = 0,
    analytics = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL) => {
      if (new URL(String(input)).pathname.endsWith('/goals')) {
        definitions++;
        return Response.json({
          data: [{ id: 'goal', name: '报名', parameters: { type: 'event', value: 'submit' } }],
          count: 1,
        });
      }
      analytics++;
      return Response.json({}, { status: 503 });
    }),
  );
  const mount = () =>
    render(
      <QueryClientProvider client={client}>
        <FeatureProvider
          value={
            {
              user: { id: 'viewer' },
              siteId: 'site',
              site: { id: 'site', userId: 'owner' },
              route: { page: 'goals' },
              api: featureApi,
              query: {},
              filters: {},
              teams: [],
              range,
              href: () => '/edit',
            } as any
          }
        >
          <CorePages page="goals" />
        </FeatureProvider>
      </QueryClientProvider>,
    );
  try {
    const view = mount();
    await advance(1);
    expect(analytics).toBe(1);
    await advance(29998);
    expect(analytics).toBe(1);
    await advance(2);
    expect(analytics).toBe(2);
    view.unmount();
    await advance(31000);
    const next = mount();
    await advance(1);
    expect(analytics).toBe(3);
    expect(definitions).toBe(1);
    next.unmount();
  } finally {
    client.clear();
  }
});
