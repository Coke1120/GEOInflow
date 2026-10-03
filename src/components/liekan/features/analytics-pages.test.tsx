import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AnalyticsPages } from './AnalyticsPages';

const mocks = vi.hoisted(() => ({
  context: null as any,
  query: {} as Record<string, any>,
  href: vi.fn(),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));
vi.mock('./context', () => ({
  useFeature: () => mocks.context,
  useData: (key: any[]) => ({
    data:
      typeof mocks.query[key[0]] === 'function' ? mocks.query[key[0]](key) : mocks.query[key[0]],
    error: null,
    isPending: false,
  }),
  useAction: () => ({
    run: async (action: () => Promise<any>) => action(),
    busy: false,
    error: '',
  }),
}));
vi.mock('./Chart', () => ({
  Chart: ({ title, labels, series }: any) => (
    <div role="img" aria-label={title}>
      {JSON.stringify({ labels, series })}
    </div>
  ),
}));
vi.mock('@/lib/liekan/upstream/features-client', () => ({ getAllFeatureRows: vi.fn() }));

beforeEach(() => {
  mocks.query = {};
  mocks.href.mockReset().mockReturnValue('/sessions');
  mocks.context = {
    user: { id: 'owner', isAdmin: true },
    siteId: 'site',
    site: { userId: 'owner' },
    route: { page: 'breakdown' },
    query: {},
    range: { startAt: 1, endAt: 2, timezone: 'UTC' },
    filters: {},
    teams: [],
    api: { get: vi.fn() },
    href: mocks.href,
  };
});

it('orders the breakdown chart by views and emits explicit missing-dimension drill conditions', () => {
  mocks.query.breakdown = [
    { path: '/small', country: 'CN', views: 2, visitors: 2 },
    { path: '/large', country: null, views: 20, visitors: 1 },
  ];
  render(<AnalyticsPages page="breakdown" />);
  expect(JSON.parse(screen.getByRole('img').textContent!)).toMatchObject({
    labels: ['/large × 未提供', '/small × CN'],
    series: [{ values: [20, 2] }],
  });
  expect(mocks.href).toHaveBeenCalledWith(
    'sessions',
    expect.objectContaining({
      drill_path: 'eq./large',
      drill_country: 'empty.',
    }),
  );
  expect(mocks.href).toHaveBeenCalledWith(
    'sessions',
    expect.objectContaining({ drill_path: 'eq./small', drill_country: 'eq.CN' }),
  );
});

it('keeps the selected event property while its value query is pending', () => {
  mocks.context.query.eventName = 'signup';
  const keys: string[] = [];
  let initialReads = 0;
  const data = {
    totals: { total: 3, visitors: 2 },
    properties: [{ name: 'plan', total: 3 }],
    values: [{ value: 'pro', dataType: 1, total: 3 }],
  };
  mocks.query['event-detail'] = (key: any[]) => {
    keys.push(key[2]);
    if (!key[2] && initialReads++ < 2) return data;
    return undefined;
  };
  const view = render(<AnalyticsPages page="event-detail" />);
  expect(keys.at(-1)).toBe('plan');
  view.rerender(<AnalyticsPages page="event-detail" />);
  expect(keys.at(-1)).toBe('plan');
  expect(keys.filter(key => key === '')).toHaveLength(1);
  mocks.query['event-detail'] = (key: any[]) => {
    keys.push(key[2]);
    return data;
  };
  view.rerender(<AnalyticsPages page="event-detail" />);
  expect(screen.getByText('plan 的各属性值对应触发次数。')).toBeInTheDocument();
  expect(JSON.parse(screen.getByRole('img').textContent!).series[0].values).toEqual([3]);
});
