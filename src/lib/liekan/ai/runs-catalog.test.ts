// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  execute: vi.fn(),
  conversation: vi.fn(),
  pointer: vi.fn(),
  catalog: vi.fn(),
}));
vi.mock('../upstream/ai-db', () => ({ aiTransaction: (work: any) => work(mocks) }));
vi.mock('../upstream/ai-access', () => ({
  aiId: (id: string) => id,
  aiSpaceFromRow: (row: any) => ({ kind: 'personal', id: row.owner_user_id }),
  authorizeAiSpace: vi.fn(),
}));
vi.mock('./connections', () => ({ requireAiEnabled: vi.fn(), loadAiConnection: vi.fn() }));
vi.mock('./conversations', () => ({ loadAiConversation: mocks.conversation }));
vi.mock('../upstream/crawler-registry', () => ({
  readCrawlerRegistryPointer: mocks.pointer,
  readPublishedRegistry: mocks.catalog,
  initializeCrawlerRegistry: vi.fn(),
}));

import { acceptAiRun, saveAiContext, type AiRunHandle } from './runs';
import { getBundledPublishedCatalog } from '../crawlers/catalog-seed';
import { TRAFFIC_POLICY_VERSION } from '../upstream/traffic-query';

const actor = { id: randomUUID(), role: 'user' };
const websiteId = randomUUID(),
  conversationId = randomUUID(),
  epoch = randomUUID();
const input = {
  operation: 'analysis' as const,
  targetId: conversationId,
  clientRequestId: randomUUID(),
  expectedConfigVersion: 1,
  localOnly: true,
  question: '分析网站访问',
};
let catalogVersion: string;
beforeEach(() => {
  vi.clearAllMocks();
  catalogVersion = randomUUID();
  const catalog = { ...getBundledPublishedCatalog(), version: catalogVersion };
  mocks.pointer.mockReset().mockResolvedValue(catalog);
  mocks.catalog.mockReset().mockResolvedValue(catalog);
  mocks.execute.mockReset().mockResolvedValue(1);
  mocks.query.mockReset().mockResolvedValue([]);
  mocks.conversation.mockResolvedValue({
    space: { kind: 'personal', id: actor.id },
    row: {
      id: conversationId,
      owner_user_id: actor.id,
      team_id: null,
      website_id: websiteId,
      website_epoch: epoch,
    },
  });
});

it('durably captures server versions at admission and replays the same request after publication', async () => {
  let stored: any;
  mocks.query.mockImplementation(async (sql: string, ...params: unknown[]) => {
    if (sql.startsWith('INSERT INTO liekan_ai_run')) {
      stored = {
        id: params[0],
        operation: 'analysis',
        request_hash: params[5],
        connection_snapshot: JSON.parse(params[8] as string),
        conversation_id: conversationId,
      };
      return [stored];
    }
    if (sql.startsWith('SELECT * FROM liekan_ai_run')) return stored ? [stored] : [];
    if (sql.startsWith('SELECT count(*)')) return [{ global: 0n, user: 0n, minute: 0n, day: 0n }];
    return [];
  });
  const accepted = await acceptAiRun(actor, input);
  expect(accepted.fresh).toBe(true);
  expect(stored.connection_snapshot).toEqual({
    catalogVersion,
    trafficPolicyVersion: TRAFFIC_POLICY_VERSION,
  });
  const next = { ...getBundledPublishedCatalog(), version: randomUUID() };
  mocks.pointer.mockResolvedValue(next);
  mocks.catalog.mockResolvedValue(next);
  const replay = await acceptAiRun(actor, input);
  expect(replay.fresh).toBe(false);
  expect(replay.row.connection_snapshot.catalogVersion).toBe(catalogVersion);
  expect(
    mocks.query.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO liekan_ai_run')),
  ).toHaveLength(1);
});

function saving(snapshot: Record<string, unknown>) {
  const row = {
    id: randomUUID(),
    operation: 'analysis',
    conversation_id: conversationId,
    website_id: websiteId,
    website_epoch: epoch,
    owner_user_id: actor.id,
    team_id: null,
    connection_id: null,
    connection_snapshot: snapshot,
    state: 'preparing',
    lease_token: randomUUID(),
    lease_until: new Date(Date.now() + 60_000),
  };
  mocks.query.mockResolvedValue([row]);
  return { row, token: row.lease_token, connection: null, fresh: true } as AiRunHandle;
}
function context() {
  return {
    id: randomUUID(),
    website: { id: websiteId },
    websiteEpoch: epoch,
    space: { kind: 'personal', id: actor.id },
    catalogVersion,
    trafficPolicyVersion: TRAFFIC_POLICY_VERSION,
  };
}

it.each(['catalogVersion', 'trafficPolicyVersion'])(
  'rejects facts whose %s differs from the admitted immutable snapshot',
  async field => {
    const facts = context();
    const handle = saving({
      ...facts,
      [field]: field === 'catalogVersion' ? randomUUID() : 'older-policy',
    });
    await expect(saveAiContext(actor, handle, facts)).rejects.toMatchObject({
      code: 'invalidated',
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  },
);

it('persists matching facts and preserves historical contexts without invented version metadata', async () => {
  const facts = context();
  await saveAiContext(actor, saving(facts), facts);
  expect(JSON.parse(mocks.execute.mock.calls[0][4])).toMatchObject({
    catalogVersion,
    trafficPolicyVersion: TRAFFIC_POLICY_VERSION,
  });
  mocks.execute.mockClear();
  const { catalogVersion: _catalog, trafficPolicyVersion: _policy, ...legacy } = facts;
  await saveAiContext(actor, saving({}), legacy);
  const saved = JSON.parse(mocks.execute.mock.calls[0][4]);
  expect(saved).not.toHaveProperty('catalogVersion');
  expect(saved).not.toHaveProperty('trafficPolicyVersion');
});
