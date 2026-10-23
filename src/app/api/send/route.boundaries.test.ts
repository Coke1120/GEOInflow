// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  events: [] as any[],
  identities: [] as any[],
  properties: new Map<string, unknown>(),
  allowedHostnames: [] as string[],
  transaction: false,
  writes: [] as any[],
  duplicate: false,
  getLink: vi.fn(),
  getPixel: vi.fn(),
  fetchWebsite: vi.fn(),
}));
vi.mock('@/lib/liekan/upstream/collection-admission', async importOriginal => ({
  ...(await importOriginal<any>()),
  collectionAdmission: async () => ({
    revision: '0',
    mode: 'standard',
    allowedHostnames: state.allowedHostnames,
  }),
}));
vi.mock('@/lib/clickhouse', () => ({ default: { enabled: false } }));
vi.mock('@/lib/liekan/upstream/crawler-registry-context', () => ({
  withPublishedRegistry: (work: () => unknown) => work(),
  collectionRegistryIsCurrent: () => true,
}));
vi.mock('@/lib/liekan/upstream/collection-snapshots', () => ({
  collectionSnapshots: async () => ({}),
}));
vi.mock('@/lib/liekan/upstream/geography-ingress', () => ({ recordGeographyIngress: vi.fn() }));
vi.mock('@/lib/detect', () => ({
  getClientInfo: async (request: Request, payload: any) => ({
    ip: payload.ip || request.headers.get('true-client-ip') || '192.0.2.1',
    ipEvidence: { trusted: !request.headers.has('true-client-ip'), source: 'trusted_ingress' },
    userAgent: payload.userAgent || request.headers.get('user-agent'),
    browser: 'chrome',
    os: 'Mac OS',
    device: 'desktop',
  }),
  hasBlockedIp: () => false,
}));
vi.mock('@/lib/load', () => ({ fetchWebsite: state.fetchWebsite }));
vi.mock('@/queries/prisma', () => ({ getLink: state.getLink, getPixel: state.getPixel }));
vi.mock('@/lib/request', () => ({
  parseRequest: async (request: Request, schema: any) => {
    const parsed = schema.safeParse(await request.json());
    return parsed.success
      ? { body: parsed.data }
      : { error: () => Response.json({ error: 'invalid' }, { status: 400 }) };
  },
}));
vi.mock('@/queries/sql', () => ({
  createSession: async (data: any) => {
    state.identities.push({ ...data, atomic: state.transaction });
  },
  saveEvent: async (data: any) => {
    state.events.push(data);
  },
  saveSessionData: async (data: any) => {
    state.properties.set(data.sessionId, data.sessionData);
  },
  saveSessionLink: vi.fn(),
  updateSession: vi.fn(),
}));
vi.mock('@/lib/liekan/upstream/collection-write', () => ({
  CollectionConflictError: class extends Error {},
  recordCollectionIdentity: vi.fn(),
  withCollectionWrite: async (input: any, work: () => unknown) => {
    state.writes.push(input);
    if (state.duplicate)
      return { status: 'duplicate', sessionId: 'original', visitId: 'original-visit' };
    state.transaction = true;
    try {
      return { status: 'written', value: await work() };
    } finally {
      state.transaction = false;
    }
  },
}));
import { POST } from './route';
import { withAuthenticatedCollection } from '@/lib/liekan/upstream/collection-auth';

const website = '89be6d70-22a5-4433-8bfe-f5b9bd4f08f1';
const link = 'e8573dca-e64f-477b-a204-24cc81f36ba2';
const browser =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const request = (payload: any, type = 'event', headers = {}) =>
  new Request('https://collector.test/api/send', {
    method: 'POST',
    headers: { 'user-agent': browser, ...headers },
    body: JSON.stringify({ type, payload: { hostname: 'example.com', url: '/', ...payload } }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_SECRET = 'boundary-test-secret';
  state.events.length = state.identities.length = state.writes.length = 0;
  state.properties.clear();
  state.duplicate = false;
  state.allowedHostnames = [];
  state.fetchWebsite.mockImplementation(async id =>
    id === website ? { id, deletedAt: null } : null,
  );
  state.getLink.mockImplementation(async id => (id === link ? { id, deletedAt: null } : null));
  state.getPixel.mockResolvedValue(null);
});

describe('collection source boundaries', () => {
  it.each(['link', 'pixel'])('rejects a website UUID sent as %s before writes', async type => {
    expect((await POST(request({ [type]: website, webdriver: true }))).status).toBe(400);
    expect(state.events).toHaveLength(0);
    expect(state.identities).toHaveLength(0);
  });
  it('retains valid link collection', async () => {
    expect((await POST(request({ link }))).status).toBe(200);
    expect(state.events[0]).toMatchObject({ websiteId: link, eventType: 3 });
  });
  it('isolates authorized identify from the same browser identity', async () => {
    await POST(request({ website, id: 'person' }));
    const humanSession = state.events[0].sessionId;
    await POST(request({ website, id: 'person', data: { plan: 'human' } }, 'identify'));
    const server = request({ website, id: 'person', data: { plan: 'server' } }, 'identify');
    expect((await withAuthenticatedCollection(server, () => POST(server))).status).toBe(200);
    expect(state.properties.get(humanSession)).toEqual({ plan: 'human' });
    expect(state.properties.size).toBe(2);
  });
  it('prevents automated identify from overwriting browser attributes', async () => {
    await POST(request({ website, id: 'person', data: { plan: 'human' } }, 'identify'));
    const humanSession = state.identities[0].id;
    await POST(
      request({ website, id: 'person', webdriver: true, data: { plan: 'bot' } }, 'identify'),
    );
    expect(state.properties.get(humanSession)).toEqual({ plan: 'human' });
  });
  it('does not create a session before duplicate receipt handling', async () => {
    state.duplicate = true;
    await POST(request({ website, eventId: '39762582-0b44-4052-a6f1-3c0c8ac3fa85' }));
    expect(state.identities).toHaveLength(0);
  });
  it('commits browser session and identify writes inside the collection transaction', async () => {
    await POST(request({ website, data: { plan: 'human' } }, 'identify'));
    expect(state.identities[0].atomic).toBe(true);
    expect(state.writes[0].eventId).toBeUndefined();
  });
  it('does not turn rotating untrusted forwarded addresses into reliable visitor IDs', async () => {
    await POST(request({ website }, 'event', { 'true-client-ip': '192.0.2.1' }));
    await POST(request({ website }, 'event', { 'true-client-ip': '192.0.2.2' }));
    expect(state.events[0].sessionId).toBe(state.events[1].sessionId);
    expect(state.writes[0].identity?.available).toBe(false);
  });
});

it('quarantines conflicting Origin identify before it can update browser attributes', async () => {
  state.allowedHostnames = ['example.com'];
  await POST(
    request({ website, id: 'person', data: { plan: 'human' } }, 'identify', {
      origin: 'https://example.com',
    }),
  );
  const humanSession = state.identities[0].id;
  await POST(
    request({ website, id: 'person', data: { plan: 'conflicted' } }, 'identify', {
      origin: 'https://other.test',
    }),
  );
  expect(state.properties.get(humanSession)).toEqual({ plan: 'human' });
  expect(state.writes[1].identity.scope).toBe('browser_conflicted');
  expect(state.writes[1].expectedPolicyRevision).toBe('0');
});
