import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  auth: { user: { id: 'owner' } } as any,
  allowed: true,
  entity: { id: '11111111-1111-4111-8111-111111111111' },
  query: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ checkAuth: () => state.auth }));
vi.mock('@/permissions', () => ({ canViewLink: () => state.allowed }));
vi.mock('./live-share', () => ({ loadShareEntity: () => state.entity }));
vi.mock('./server', () => ({
  LiekanError: class extends Error {
    constructor(
      message: string,
      public status = 400,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/lib/request', () => ({ getQueryFilters: (p: any) => p }));
vi.mock('@/lib/prisma', () => ({
  default: {
    parseFilters: () => ({
      filterQuery: '',
      cohortQuery: '',
      excludeBounceQuery: '',
      joinSessionQuery: 'JOIN session ON session.session_id=website_event.session_id',
      queryParams: {},
    }),
    rawQuery: state.query,
  },
}));
vi.mock('@/lib/clickhouse', () => ({ default: {} }));
import { linkSources } from './link-sources';
const id = '11111111-1111-4111-8111-111111111111',
  params = { startAt: 0, endAt: 100, timezone: 'UTC', page: 2 };
beforeEach(() => {
  state.auth = { user: { id: 'owner' } };
  state.allowed = true;
  state.query
    .mockReset()
    .mockImplementation(async (sql: string) =>
      sql.startsWith('SELECT COUNT')
        ? [{ count: 30n }]
        : [{ source: 'example.test', country: 'CN', clicks: 5n }],
    );
  delete process.env.CLICKHOUSE_URL;
});
describe('joint link click sources', () => {
  it('counts event type 3 by source and country and honors paging', async () => {
    expect(await linkSources(new Request('http://localhost'), id, params)).toMatchObject({
      rows: [{ source: 'example.test', country: 'CN', clicks: 5 }],
      count: 30,
      page: 2,
      pageSize: 25,
    });
    const [sql, bindings] = state.query.mock.calls[1];
    expect(sql).toContain('website_event.event_type=3');
    expect(sql).toContain('GROUP BY source,country');
    expect(bindings.offset).toBe(25);
  });
  it('rejects malformed, partial, shared and unauthorized identities before analytics', async () => {
    await expect(
      linkSources(new Request('http://localhost'), '-'.repeat(36), params),
    ).rejects.toMatchObject({ status: 400 });
    state.auth = { user: null };
    await expect(linkSources(new Request('http://localhost'), id, params)).rejects.toMatchObject({
      status: 401,
    });
    state.auth = { user: { id: 'owner' }, shareToken: {} };
    await expect(linkSources(new Request('http://localhost'), id, params)).rejects.toMatchObject({
      status: 401,
    });
    state.auth = { user: { id: 'owner' } };
    state.allowed = false;
    await expect(linkSources(new Request('http://localhost'), id, params)).rejects.toMatchObject({
      status: 403,
    });
    expect(state.query).not.toHaveBeenCalled();
  });
});
