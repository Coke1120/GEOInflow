// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  query: vi.fn(),
  relational: vi.fn(),
  versions: vi.fn(),
  rows: new Map<string, any>(),
  teams: new Set<string>(),
  members: new Set<string>(),
  role: 'user',
}));
vi.mock('@/lib/auth', () => ({ checkAuth: h.auth }));
vi.mock('@/lib/db', () => ({ isRelationalOnly: h.relational }));
vi.mock('./ai-db', () => ({ aiTransaction: (work: any) => work({ query: h.query }) }));
vi.mock('./analytics-revision', () => ({ readAnalyticsVersions: h.versions }));
vi.mock('./geo-weight', () => ({ GEO_SCOPE_HASH: 'geo-scope-v1' }));
import { readCacheManifest } from './cache-manifest';

const userId = '84074773-f17b-46e9-9af5-b09bca5e4281';
const site = '84074773-f17b-46e9-9af5-b09bca5e4282';
const board = '84074773-f17b-46e9-9af5-b09bca5e4283';
const instanceId = '84074773-f17b-46e9-9af5-b09bca5e4284';
const team = '84074773-f17b-46e9-9af5-b09bca5e4285';
const request = (resources: unknown = [{ type: 'website', id: site }]) =>
  new Request(
    `https://test.invalid/api/liekan/cache-manifest?resources=${encodeURIComponent(JSON.stringify(resources))}`,
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.rows.clear();
  h.teams.clear();
  h.members.clear();
  h.role = 'user';
  h.auth.mockResolvedValue({ authType: 'session', user: { id: userId, role: 'user' } });
  h.relational.mockReturnValue(true);
  h.versions.mockResolvedValue({ strong: 'policy-v1', data: '42' });
  h.rows.set(site, { id: site, userId, teamId: null, domain: 'test.invalid', resetAt: null });
  h.query.mockImplementation(async (sql: string, id: string) => {
    if (sql.includes('FROM "user"')) return [{ role: h.role }];
    if (sql.includes('FROM liekan_cache_meta')) return [{ instanceId }];
    if (sql.includes('FROM team_user')) return h.members.has(id) ? [{ role: 'team-member' }] : [];
    if (sql.includes('FROM team ')) return h.teams.has(id) ? [{ team_id: id }] : [];
    return h.rows.has(id) ? [h.rows.get(id)] : [];
  });
});

it.each(['partial', 'api-key', undefined])(
  'rejects non-session auth %s before reading metadata',
  async authType => {
    h.auth.mockResolvedValue({ authType, user: { id: userId } });
    await expect(readCacheManifest(request())).rejects.toMatchObject({ status: 401 });
    expect(h.query).not.toHaveBeenCalled();
  },
);
it('rejects public shares even when a user is also present', async () => {
  h.auth.mockResolvedValue({
    authType: 'session',
    user: { id: userId },
    shareToken: { websiteId: site },
  });
  await expect(readCacheManifest(request())).rejects.toMatchObject({ status: 401 });
});
it('returns a persistent deployment namespace and excludes append-only data from strong identity', async () => {
  const first = await readCacheManifest(request());
  h.versions.mockResolvedValue({ strong: 'policy-v1', data: '43' });
  const second = await readCacheManifest(request());
  expect(first.instanceId).toBe(instanceId);
  expect(second.resources[0]).toMatchObject({
    authorized: true,
    strongVersion: (first.resources[0] as any).strongVersion,
    dataRevision: '43',
  });
  h.versions.mockResolvedValue({ strong: 'policy-v2', data: '43' });
  const changed = await readCacheManifest(request());
  expect((changed.resources[0] as any).strongVersion).not.toBe(
    (first.resources[0] as any).strongVersion,
  );
  expect((changed.resources[0] as any).geoVersion).toBe((first.resources[0] as any).geoVersion);
});
it('checks reset and ownership directly and returns no private metadata for denied IDs', async () => {
  const before = await readCacheManifest(request());
  h.rows.get(site).resetAt = new Date('2026-10-22T00:00:00Z');
  const reset = await readCacheManifest(request());
  expect((reset.resources[0] as any).strongVersion).not.toBe(
    (before.resources[0] as any).strongVersion,
  );
  h.rows.get(site).userId = instanceId;
  expect((await readCacheManifest(request())).resources).toEqual([
    { type: 'website', id: site, authorized: false },
  ]);
});
it('revokes the entire board when a dependency loses permission', async () => {
  h.rows.set(board, {
    id: board,
    userId,
    teamId: null,
    type: 'website',
    parameters: { websiteId: site },
  });
  const req = request([{ type: 'board', id: board }]);
  expect((await readCacheManifest(req)).resources[0]).toMatchObject({ authorized: true });
  h.rows.get(site).userId = instanceId;
  expect((await readCacheManifest(req)).resources).toEqual([
    { type: 'board', id: board, authorized: false },
  ]);
});
it('versions a board against its layout and all underlying versions', async () => {
  h.rows.set(board, {
    id: board,
    userId,
    teamId: null,
    type: 'website',
    parameters: { websiteId: site, rows: [] },
  });
  const req = request([{ type: 'board', id: board }]);
  const first = await readCacheManifest(req);
  expect(h.versions).toHaveBeenCalledWith(expect.anything(), [`website:${site}`]);
  h.rows.get(board).parameters.title = 'changed';
  const second = await readCacheManifest(req);
  expect((second.resources[0] as any).strongVersion).not.toBe(
    (first.resources[0] as any).strongVersion,
  );
});
it('checks membership and deleted team state using the primary', async () => {
  Object.assign(h.rows.get(site), { userId: null, teamId: team });
  h.teams.add(team);
  h.members.add(team);
  expect((await readCacheManifest(request())).resources[0]).toMatchObject({ authorized: true });
  h.members.clear();
  expect((await readCacheManifest(request())).resources[0]).toEqual({
    type: 'website',
    id: site,
    authorized: false,
  });
  h.members.add(team);
  h.teams.clear();
  expect((await readCacheManifest(request())).resources[0]).toEqual({
    type: 'website',
    id: site,
    authorized: false,
  });
});
it('rejects logout during verification before returning private versions', async () => {
  h.auth
    .mockResolvedValueOnce({ authType: 'session', user: { id: userId } })
    .mockResolvedValueOnce(null);
  await expect(readCacheManifest(request())).rejects.toMatchObject({ status: 401 });
});
it('bounds descriptors before any database work and deduplicates valid IDs', async () => {
  await expect(
    readCacheManifest(request(Array.from({ length: 21 }, () => ({ type: 'website', id: site })))),
  ).rejects.toMatchObject({ status: 400 });
  expect(h.query).not.toHaveBeenCalled();
  const result = await readCacheManifest(
    request([
      { type: 'website', id: site },
      { type: 'website', id: site.toUpperCase() },
    ]),
  );
  expect(result.resources).toHaveLength(1);
});
