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
  useData: (key: any[]) => ({ data: mocks.query[key[0]], error: null, isPending: false }),
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
