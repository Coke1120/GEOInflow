import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiekanError } from './errors';

const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), supported: vi.fn() }));
vi.mock('./ai-db', () => ({ aiTransaction: mocks.transaction }));
vi.mock('@/lib/db', () => ({ isRelationalOnly: mocks.supported }));
vi.mock('@/lib/auth', () => ({ hasPermission: async (role: string) => role === 'admin' }));
import {
  installationObservationSql,
  readInstallationObservation,
} from './installation-observation';

const websiteId = 'f06d262c-3300-4e08-850f-3d7abe83db03';
const userId = '033a00bf-ce3e-4f78-b8fa-cb6923847736';
const endAt = Date.parse('2026-10-27T09:30Z');
const access = { userId, ownerId: userId, teamId: null, role: 'user', teamRole: null, demo: false };
let row: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DATABASE_URL', 'postgresql://localhost/isolated?schema=public');
  row = {
    samples: 20,
    available: 20,
    unknown: 0,
    fallback: 0,
    lastReceivedAt: new Date(endAt - 1),
  };
  mocks.supported.mockReturnValue(true);
  mocks.query.mockImplementation(sql =>
    Promise.resolve([sql.includes('WITH received') ? row : access]),
  );
  mocks.transaction.mockImplementation(work => work({ query: mocks.query }));
});

describe('installation receipt observation', () => {
  it('uses the complete half-open receipt window and a separate two-second read-only budget', async () => {
    const result = await readInstallationObservation(websiteId, userId, endAt);
    expect(result).toMatchObject({
      version: 'received-browser-identity-v1',
      population: 'raw_public_pv',
      timeBasis: 'received_at',
      range: { startAt: endAt - 1800000, endAt, timezone: 'UTC', endExclusive: true },
      status: 'complete',
      sampleCount: 20,
      availableIdentityCount: 20,
      coverage: 1,
    });
    const [, options] = mocks.transaction.mock.calls[0];
    expect(options).toEqual({
      readOnly: true,
      timeout: 1750,
      transactionTimeout: 1750,
      maxWait: 250,
    });
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('WITH received'),
      websiteId,
      new Date(endAt - 1800000),
      new Date(endAt),
    );
    expect(mocks.query.mock.calls.filter(([sql]) => sql.includes('FROM website w'))).toHaveLength(
      2,
    );
    const sql = installationObservationSql('public');
    expect(sql).toContain('o.received_at>=$2');
    expect(sql).toContain('q.created_at>=$2');
    expect(sql).toContain("q.source IN('browser','legacy_override')");
    expect(sql).toContain('JOIN "public"."session"');
    expect(sql).not.toMatch(/e\.created_at|LIMIT|array_agg|count\(distinct|liekan_browser_risk/i);
  });
  it.each([
    [0, 0, 0, 'empty', null, false],
    [3, 1, 0, 'partial', 1 / 3, true],
    [20, 0, 0, 'unavailable', 0, false],
    [20, 8, 0, 'partial', 0.4, false],
    [20, 20, 0, 'complete', 1, false],
    [20, 8, 12, 'unknown', null, false],
  ])(
    'preserves observed counts %i/%i/%i as %s',
    async (samples, available, unknown, status, coverage, smallSample) => {
      row = {
        ...row,
        samples,
        available,
        unknown,
        lastReceivedAt: samples ? row.lastReceivedAt : null,
      };
      const result = await readInstallationObservation(websiteId, userId, endAt);
      expect(result).toMatchObject({
        status,
        sampleCount: samples,
        availableIdentityCount: available,
        unknownIdentityCount: unknown,
        coverage,
        smallSample,
      });
    },
  );
  it('keeps missing identity evidence unknown on the original receipt fallback', async () => {
    row = { ...row, samples: 2, available: 0, unknown: 2, fallback: 2 };
    const result = await readInstallationObservation(websiteId, userId, endAt);
    expect(result).toMatchObject({ status: 'unknown', coverage: null, unknownIdentityCount: 2 });
    expect(result.reasons).toEqual([
      'small_sample',
      'identity_evidence_missing',
      'reception_fallback',
    ]);
  });
  it('returns only finite aggregate metadata and never echoes database attributes', async () => {
    row = {
      ...row,
      ip: 'DO-NOT-EXPOSE',
      user_agent: 'DO-NOT-EXPOSE',
      distinct_id: 'DO-NOT-EXPOSE',
      reasons: ['DO-NOT-EXPOSE'],
    };
    const result = await readInstallationObservation(websiteId, userId, endAt);
    expect(JSON.stringify(result)).not.toContain('DO-NOT-EXPOSE');
    expect(Object.keys(result).sort()).toEqual(
      [
        'availableIdentityCount',
        'coverage',
        'lastReceivedAt',
        'population',
        'range',
        'reasons',
        'sampleCount',
        'smallSample',
        'status',
        'timeBasis',
        'unknownIdentityCount',
        'version',
      ].sort(),
    );
  });
  it('marks examples and unsupported databases without running the aggregate', async () => {
    mocks.supported.mockReturnValue(false);
    expect(await readInstallationObservation(websiteId, userId, endAt)).toMatchObject({
      status: 'unsupported',
      sampleCount: null,
      coverage: null,
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    mocks.supported.mockReturnValue(true);
    mocks.query.mockResolvedValue([{ ...access, demo: true }]);
    expect(await readInstallationObservation(websiteId, userId, endAt)).toMatchObject({
      status: 'demo',
      sampleCount: null,
      coverage: null,
    });
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
  it.each(['P2028', '57014', '08006'])(
    'degrades only the observation when the diagnostic fails (%s)',
    async code => {
      mocks.transaction.mockRejectedValue({ code });
      expect(await readInstallationObservation(websiteId, userId, endAt)).toMatchObject({
        status: 'temporarily_unavailable',
        sampleCount: null,
        coverage: null,
        reasons: [code === '08006' ? 'diagnostic_unavailable' : 'diagnostic_timeout'],
      });
    },
  );
  it.each([401, 403, 404])('propagates permission failure %i', async status => {
    mocks.transaction.mockRejectedValue(new LiekanError('拒绝读取', status));
    await expect(readInstallationObservation(websiteId, userId, endAt)).rejects.toMatchObject({
      status,
    });
  });
  it.each([
    { ...access, ownerId: 'other-owner' },
    { ...access, userId: null },
    { ...access, ownerId: null, teamId: 'team', teamRole: null },
  ])('rejects loss of current website authority before returning aggregates', async changed => {
    mocks.query
      .mockResolvedValueOnce([access])
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([changed]);
    await expect(readInstallationObservation(websiteId, userId, endAt)).rejects.toMatchObject({
      status: changed.userId ? 403 : 401,
    });
  });
  it('allows a live read-only team member and rechecks the membership', async () => {
    mocks.query.mockImplementation(sql =>
      Promise.resolve([
        sql.includes('WITH received')
          ? row
          : { ...access, ownerId: null, teamId: 'team', teamRole: 'team-view-only' },
      ]),
    );
    expect((await readInstallationObservation(websiteId, userId, endAt)).status).toBe('complete');
  });
  it('does not fabricate zeros from malformed or missing aggregate evidence', async () => {
    row = {};
    expect(await readInstallationObservation(websiteId, userId, endAt)).toMatchObject({
      status: 'temporarily_unavailable',
      sampleCount: null,
      coverage: null,
    });
  });
});
