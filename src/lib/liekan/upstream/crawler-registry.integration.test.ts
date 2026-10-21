// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ transaction: vi.fn(), seed: undefined as any }));
vi.mock('./ai-db', () => ({ aiTransaction: (...args: any[]) => h.transaction(...args) }));
vi.mock('./crawler-access', () => ({
  crawlerTransaction: (...args: any[]) => h.transaction(...args),
}));
vi.mock('../crawlers/catalog-seed', async importOriginal => {
  const actual = await importOriginal<typeof import('../crawlers/catalog-seed')>();
  return {
    ...actual,
    getBundledPublishedCatalog: () => h.seed ?? actual.getBundledPublishedCatalog(),
  };
});
import { getBundledPublishedCatalog } from '../crawlers/catalog-seed';
import { catalogHash } from '../crawlers/catalog-validation';
import {
  crawlerRegistry,
  initializeCrawlerRegistry,
  mutateCrawlerRegistry,
  readPublishedRegistry,
  registryVersionIsCurrent,
} from './crawler-registry';
import type { AiTx } from './ai-db';
import type {
  CrawlerRegistryCommand,
  RegistryDraft,
  RegistryPreview,
} from '../contracts/crawler-registry';

const enabled = !!process.env.LIEKAN_REGISTRY_TEST_URL;
const actor = { id: randomUUID(), role: 'admin' };
let pool: Pool, schema: string;
const command = (input: Omit<CrawlerRegistryCommand, 'operationId'> | Record<string, unknown>) =>
  mutateCrawlerRegistry(actor, { operationId: randomUUID(), ...input });
const draft = async () => (await command({ action: 'createDraft' })).draft;
const preview = async (value: RegistryDraft) =>
  (await command({ action: 'preview', draftId: value.id, expectedDraftRevision: value.revision }))
    .preview;
const publish = async (value: RegistryDraft, proof: RegistryPreview) =>
  command({
    action: 'publish',
    draftId: value.id,
    expectedDraftRevision: value.revision,
    expectedCurrentRevision: proof.currentRevision,
    previewHash: proof.hash,
  });
const query = (sql: string, ...params: unknown[]) =>
  h.transaction((tx: AiTx) => tx.query(sql, ...params));

describe.skipIf(!enabled)('crawler registry transactions in isolated PostgreSQL', () => {
  beforeAll(async () => {
    const url = new URL(process.env.LIEKAN_REGISTRY_TEST_URL);
    if (
      url.hostname !== '127.0.0.1' ||
      url.port !== '15449' ||
      url.pathname !== '/liekan_registry_test'
    )
      throw new Error('Only owned registry acceptance database on 15449 is allowed');
    pool = new Pool({ connectionString: url.toString(), max: 8 });
    h.transaction.mockImplementation(async (work: (tx: AiTx) => unknown) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL search_path TO "${schema}"`);
        await client.query("SET LOCAL statement_timeout='10s'");
        const tx: AiTx = {
          query: async (sql, ...params) => (await client.query(sql, params)).rows,
          execute: async (sql, ...params) => (await client.query(sql, params)).rowCount,
        };
        const result = await work(tx);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  });
  beforeEach(async () => {
    h.seed = undefined;
    schema = 'registry_' + randomUUID().replaceAll('-', '');
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await h.transaction(async (tx: AiTx) => {
      await tx.execute(
        'CREATE TABLE "user" (user_id uuid PRIMARY KEY,role text NOT NULL,deleted_at timestamptz)',
      );
      await tx.execute('INSERT INTO "user"(user_id,role) VALUES($1::uuid,$2)', actor.id, 'admin');
      await tx.execute(await readFile('db/liekan/migrations/029_crawler_registry.sql', 'utf8'));
      await tx.execute(await readFile('db/liekan/migrations/031_registry_seed_review.sql', 'utf8'));
    });
    await initializeCrawlerRegistry();
  });
  afterEach(async () => {
    if (pool && schema) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
  });
  afterAll(async () => {
    await pool?.end();
  });

  it('initializes once and stores only immutable complete catalog versions', async () => {
    await initializeCrawlerRegistry();
    expect(await query('SELECT version FROM liekan_crawler_registry_version')).toHaveLength(1);
    const state = await crawlerRegistry(actor);
    expect(state.current.state).toBe('published');
    expect(state.history).toHaveLength(1);
    expect(state.drafts).toHaveLength(0);
    await expect(
      query('UPDATE liekan_crawler_registry_version SET action=$1', 'rollback'),
    ).rejects.toThrow(/immutable/);
    await expect(query('DELETE FROM liekan_crawler_registry_version')).rejects.toThrow(/immutable/);
  });
  it('persists the preview, rejects changed drafts and accepts a fresh atomic publication', async () => {
    const original = await draft(),
      proof = await preview(original);
    expect((await crawlerRegistry(actor)).drafts[0].preview.hash).toBe(proof.hash);
    const payload = structuredClone(original.payload);
    payload.identities[0].metadata.summary = 'Updated reviewed summary';
    const updated = (
      await command({
        action: 'updateDraft',
        draftId: original.id,
        expectedDraftRevision: original.revision,
        payload,
      })
    ).draft;
    expect(updated.revision).toBe('2');
    expect(updated.preview).toBeNull();
    await expect(publish(original, proof)).rejects.toMatchObject({ status: 409 });
    const result = await publish(updated, await preview(updated));
    expect(result.current.revision).toBe('2');
    expect(result.current.payload.identities[0].metadata.summary).toBe('Updated reviewed summary');
    expect((await crawlerRegistry(actor)).history).toHaveLength(2);
  });
  it('serializes simultaneous publications and rejects stale current revisions', async () => {
    const a = await draft(),
      b = await draft(),
      pa = await preview(a),
      pb = await preview(b);
    const results = await Promise.allSettled([publish(a, pa), publish(b, pb)]);
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(item => item.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.status).toBe(409);
    expect((await crawlerRegistry(actor)).current.revision).toBe('2');
    expect(
      await query(
        "SELECT operation_id FROM liekan_crawler_registry_operation WHERE action='publish'",
      ),
    ).toHaveLength(1);
  });
  it('refuses publication when a caller supplies only negative matching samples', async () => {
    const value = await draft();
    const result = await command({
      action: 'preview',
      draftId: value.id,
      expectedDraftRevision: value.revision,
      samples: [{ userAgent: 'HumanBrowser/1.0', expectedId: null }],
    });
    await expect(publish(value, result.preview)).rejects.toMatchObject({ status: 409 });
    expect((await crawlerRegistry(actor)).current.revision).toBe('1');
    expect((await publish(value, await preview(value))).current.revision).toBe('2');
  });
  it('merges a newer publication into an older draft before generating its next preview', async () => {
    const a = await draft(),
      b = await draft();
    const payloadA = structuredClone(a.payload),
      payloadB = structuredClone(b.payload);
    payloadA.identities[0].metadata.summary = 'Published administrator edit';
    payloadB.identities.find(item => item.id === 'kimibot').metadata.summary = 'Other draft edit';
    const savedA = (
      await command({
        action: 'updateDraft',
        draftId: a.id,
        expectedDraftRevision: a.revision,
        payload: payloadA,
      })
    ).draft;
    const savedB = (
      await command({
        action: 'updateDraft',
        draftId: b.id,
        expectedDraftRevision: b.revision,
        payload: payloadB,
      })
    ).draft;
    const current = (await publish(savedA, await preview(savedA))).current;
    const rebased = await command({
      action: 'preview',
      draftId: savedB.id,
      expectedDraftRevision: savedB.revision,
    });
    expect(rebased.draft.payload.identities[0].metadata.summary).toBe(
      'Published administrator edit',
    );
    expect(
      rebased.draft.payload.identities.find(item => item.id === 'kimibot').metadata.summary,
    ).toBe('Other draft edit');
    expect(rebased.draft.revision).not.toBe(savedB.revision);
    expect(rebased.draft.baseVersion).toBe(current.version);
    await expect(
      command({
        action: 'updateDraft',
        draftId: savedB.id,
        expectedDraftRevision: savedB.revision,
        payload: payloadB,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const state = await crawlerRegistry(actor);
    expect(state.current.version).toBe(current.version);
    expect(state.current.payload.identities[0].metadata.summary).toBe(
      'Published administrator edit',
    );
    expect(state.drafts.find(item => item.id === b.id).payload).toEqual(rebased.draft.payload);
    const fresh = await draft();
    expect(fresh.payload.identities[0].metadata.summary).toBe('Published administrator edit');
    expect((await preview(fresh)).conflicts).toEqual([]);
    expect(
      (await publish(rebased.draft, rebased.preview)).current.payload.identities[0].metadata
        .summary,
    ).toBe('Published administrator edit');
  });
  it('keeps same-field rebase conflicts pending until an administrator saves the resolution', async () => {
    const a = await draft(),
      b = await draft();
    const payloadA = structuredClone(a.payload),
      payloadB = structuredClone(b.payload);
    payloadA.identities[0].metadata.summary = 'Published edit';
    payloadB.identities[0].metadata.summary = 'Draft edit';
    const savedA = (
      await command({
        action: 'updateDraft',
        draftId: a.id,
        expectedDraftRevision: a.revision,
        payload: payloadA,
      })
    ).draft;
    const savedB = (
      await command({
        action: 'updateDraft',
        draftId: b.id,
        expectedDraftRevision: b.revision,
        payload: payloadB,
      })
    ).draft;
    await publish(savedA, await preview(savedA));
    await expect(
      command({
        action: 'updateDraft',
        draftId: savedB.id,
        expectedDraftRevision: savedB.revision,
        payload: payloadB,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const rebased = await command({
      action: 'preview',
      draftId: savedB.id,
      expectedDraftRevision: savedB.revision,
    });
    expect(rebased.draft.conflicts).toContain('identities.gptbot.metadata.summary');
    expect(rebased.draft.payload.identities[0].metadata.summary).toBe('Draft edit');
    await expect(publish(rebased.draft, rebased.preview)).rejects.toMatchObject({ status: 409 });
    const resolved = structuredClone(rebased.draft.payload);
    resolved.identities[0].metadata.summary = 'Reviewed resolution';
    const updated = (
      await command({
        action: 'updateDraft',
        draftId: savedB.id,
        expectedDraftRevision: rebased.draft.revision,
        payload: resolved,
      })
    ).draft;
    expect(
      (await publish(updated, await preview(updated))).current.payload.identities[0].metadata
        .summary,
    ).toBe('Reviewed resolution');
  });
  it('rebases a stale software candidate without losing its seed adoption metadata', async () => {
    const next = structuredClone(getBundledPublishedCatalog());
    next.payload.identities[1].metadata.summary = 'Software addition';
    next.contentHash = catalogHash(next.payload);
    h.seed = next;
    await initializeCrawlerRegistry();
    const candidate = (await crawlerRegistry(actor)).drafts[0];
    const local = await draft(),
      payload = structuredClone(local.payload);
    payload.identities[0].metadata.summary = 'Administrator edit';
    const updated = (
      await command({
        action: 'updateDraft',
        draftId: local.id,
        expectedDraftRevision: local.revision,
        payload,
      })
    ).draft;
    await publish(updated, await preview(updated));
    const rebased = await command({
      action: 'preview',
      draftId: candidate.id,
      expectedDraftRevision: candidate.revision,
    });
    expect(rebased.draft.payload.identities[0].metadata.summary).toBe('Administrator edit');
    expect(rebased.draft.payload.identities[1].metadata.summary).toBe('Software addition');
    await publish(rebased.draft, rebased.preview);
    expect(
      (await query('SELECT seed_hash FROM liekan_crawler_registry_current'))[0].seed_hash,
    ).toBe(next.contentHash);
    await initializeCrawlerRegistry();
    expect((await crawlerRegistry(actor)).drafts).toHaveLength(0);
  });
  it('replays identical operations, rejects key collisions, and reauthorizes the live administrator', async () => {
    const operationId = randomUUID();
    const request = { action: 'createDraft', operationId, title: 'One draft' };
    const first = await mutateCrawlerRegistry(actor, request);
    expect(await mutateCrawlerRegistry(actor, request)).toEqual(first);
    await expect(
      mutateCrawlerRegistry(actor, { ...request, title: 'Different draft' }),
    ).rejects.toMatchObject({ status: 409 });
    const p = await preview(first.draft);
    const publishRequest = {
      action: 'publish',
      operationId: randomUUID(),
      draftId: first.draft.id,
      expectedDraftRevision: '1',
      expectedCurrentRevision: p.currentRevision,
      previewHash: p.hash,
    };
    const result = await mutateCrawlerRegistry(actor, publishRequest);
    expect(await mutateCrawlerRegistry(actor, publishRequest)).toEqual(result);
    await query('UPDATE "user" SET role=$1 WHERE user_id=$2::uuid', 'user', actor.id);
    await expect(mutateCrawlerRegistry(actor, publishRequest)).rejects.toMatchObject({
      status: 403,
    });
    await expect(crawlerRegistry(actor)).rejects.toMatchObject({ status: 403 });
  });
  it('retains newer IDs during rollback and keeps both previous versions readable', async () => {
    const originalVersion = (await readPublishedRegistry()).version;
    const d = await draft(),
      payload = structuredClone(d.payload),
      added = structuredClone(payload.identities[0]);
    Object.assign(added, {
      id: 'new-agent',
      family: 'new-agent',
      name: 'NewAgent',
      uaSelector: 'NewAgent',
      control: { remote: false, nginx: false },
    });
    Object.assign(added.metadata, {
      id: added.id,
      name: added.name,
      token: added.uaSelector,
      evidence: 'observed',
    });
    payload.identities.push(added);
    const updated = (
      await command({
        action: 'updateDraft',
        draftId: d.id,
        expectedDraftRevision: d.revision,
        payload,
      })
    ).draft;
    const newVersion = (await publish(updated, await preview(updated))).current.version;
    const rollback = (await command({ action: 'rollbackDraft', sourceVersion: originalVersion }))
      .draft;
    expect(rollback.payload.identities.find(item => item.id === added.id).status).toBe('inactive');
    const result = await publish(rollback, await preview(rollback));
    expect(result.current.version).not.toBe(originalVersion);
    expect(
      (await readPublishedRegistry(newVersion)).payload.identities.find(
        item => item.id === added.id,
      ).status,
    ).toBe('active');
    expect(
      (await readPublishedRegistry(originalVersion)).payload.identities.some(
        item => item.id === added.id,
      ),
    ).toBe(false);
    expect((await crawlerRegistry(actor)).history[0].action).toBe('rollback');
  });
  it('creates one pending software candidate and preserves administrator edits with explicit conflicts', async () => {
    const d = await draft(),
      local = structuredClone(d.payload);
    local.identities[0].status = 'inactive';
    local.identities[0].metadata.summary = 'Local edit';
    const updated = (
      await command({
        action: 'updateDraft',
        draftId: d.id,
        expectedDraftRevision: '1',
        payload: local,
      })
    ).draft;
    const live = (await publish(updated, await preview(updated))).current;
    const next = structuredClone(getBundledPublishedCatalog());
    next.payload.identities[0].metadata.summary = 'New software summary';
    next.payload.identities[1].metadata.summary = 'Reviewed software edit';
    next.contentHash = catalogHash(next.payload);
    h.seed = next;
    await initializeCrawlerRegistry();
    await initializeCrawlerRegistry();
    const state = await crawlerRegistry(actor);
    expect(state.current.version).toBe(live.version);
    expect(state.drafts).toHaveLength(1);
    expect(state.drafts[0].payload.identities[0].status).toBe('inactive');
    expect(state.drafts[0].payload.identities[0].metadata.summary).toBe('Local edit');
    expect(state.drafts[0].payload.identities[1].metadata.summary).toBe('Reviewed software edit');
    expect(state.drafts[0].conflicts).toContain('identities.gptbot.metadata.summary');
    const proof = await preview(state.drafts[0]);
    await expect(publish(state.drafts[0], proof)).rejects.toMatchObject({ status: 409 });
  });
  it('creates an editable rollback draft when retained newer names collide with historical names', async () => {
    const originalVersion = (await readPublishedRegistry()).version;
    const d = await draft(),
      payload = structuredClone(d.payload);
    const kimi = payload.products.find(item => item.id === 'kimi');
    const oldName = kimi.name;
    kimi.name = 'Renamed product';
    kimi.aliases = [];
    payload.products.push({
      ...structuredClone(kimi),
      id: 'new-kimi-product',
      name: oldName,
      aliases: [],
      identityIds: [],
      supportStatus: 'pending',
    });
    const updated = (
      await command({
        action: 'updateDraft',
        draftId: d.id,
        expectedDraftRevision: d.revision,
        payload,
      })
    ).draft;
    await publish(updated, await preview(updated));
    const rollback = (await command({ action: 'rollbackDraft', sourceVersion: originalVersion }))
      .draft;
    expect(rollback.conflicts.some(value => value.includes('duplicate product alias'))).toBe(true);
    expect(
      rollback.payload.products.find(item => item.id === 'new-kimi-product').supportStatus,
    ).toBe('inactive');
    expect((await crawlerRegistry(actor)).drafts.some(item => item.id === rollback.id)).toBe(true);
    const resolved = structuredClone(rollback.payload);
    resolved.products.find(item => item.id === 'new-kimi-product').name = 'Archived newer product';
    const saved = (
      await command({
        action: 'updateDraft',
        draftId: rollback.id,
        expectedDraftRevision: rollback.revision,
        payload: resolved,
      })
    ).draft;
    expect(
      (await publish(saved, await preview(saved))).current.payload.products.find(
        item => item.id === 'kimi',
      ).name,
    ).toBe(oldName);
  });
  it('keeps unadopted software edits through consecutive upgrades and advances the seed only on publication', async () => {
    const s0 = structuredClone(getBundledPublishedCatalog()),
      s1 = structuredClone(s0);
    s1.payload.identities[0].metadata.summary = 'S1 reviewed fix';
    s1.contentHash = catalogHash(s1.payload);
    h.seed = s1;
    await initializeCrawlerRegistry();
    const s2 = structuredClone(s1);
    s2.payload.identities[1].metadata.summary = 'S2 additional fix';
    s2.contentHash = catalogHash(s2.payload);
    h.seed = s2;
    await initializeCrawlerRegistry();
    const state = await crawlerRegistry(actor);
    const candidate = state.drafts.find(
      row => row.payload.identities[1].metadata.summary === 'S2 additional fix',
    );
    expect(candidate.payload.identities[0].metadata.summary).toBe('S1 reviewed fix');
    expect(candidate.conflicts).toEqual([]);
    expect(
      (await query('SELECT seed_hash FROM liekan_crawler_registry_current'))[0].seed_hash,
    ).toBe(s0.contentHash);
    await publish(candidate, await preview(candidate));
    expect(
      (await query('SELECT seed_hash FROM liekan_crawler_registry_current'))[0].seed_hash,
    ).toBe(s2.contentHash);
  });
  it('holds the pointer stable while a source worker commits a checked version', async () => {
    const d = await draft(),
      p = await preview(d),
      current = await readPublishedRegistry();
    let release: () => void, entered: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const ready = new Promise<void>(resolve => {
      entered = resolve;
    });
    const worker = h.transaction(async (tx: AiTx) => {
      expect(await registryVersionIsCurrent(tx, current.version)).toBe(true);
      entered();
      await gate;
    });
    await ready;
    let completed = false;
    const publication = publish(d, p).then(value => {
      completed = true;
      return value;
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(completed).toBe(false);
    release();
    await worker;
    await publication;
    expect(await h.transaction(tx => registryVersionIsCurrent(tx, current.version))).toBe(false);
  });
});
