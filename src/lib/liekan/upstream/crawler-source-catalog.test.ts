// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  catalog: undefined as any,
  current: true,
  state: {} as any,
  snapshot: undefined as any,
  execute: vi.fn(),
  query: vi.fn(),
}));
vi.mock('../crawlers/published', async importOriginal => ({
  ...(await importOriginal<typeof import('../crawlers/published')>()),
  getPublishedCatalog: () => h.catalog,
}));
vi.mock('./crawler-registry', () => ({ registryVersionIsCurrent: async () => h.current }));
vi.mock('./ai-db', () => ({
  aiTransaction: async work => work({ query: h.query, execute: h.execute }),
}));
vi.mock('./server', () => ({ query: vi.fn(async () => []) }));
import { getBundledPublishedCatalog } from '../crawlers/catalog-seed';
import { getRangeBaselines } from '../crawlers/range-check';
import { updateCatalogRecord } from '@/components/liekan/features/crawlerRegistryUi';
import { initializeRangeSources } from './crawler-ranges';
import { initializeDocumentSources } from './crawler-maintenance';

beforeEach(() => {
  vi.clearAllMocks();
  h.catalog = structuredClone(getBundledPublishedCatalog());
  h.current = true;
  h.state = {};
  h.snapshot = undefined;
  h.query.mockImplementation(async (sql, id) => {
    if (sql.includes('FROM liekan_crawler_range_snapshot')) return h.snapshot ? [h.snapshot] : [];
    return [id === 'kagi-manual' ? h.state : {}];
  });
});

it('does not mutate source baselines, document reviews or leases for a superseded catalog', async () => {
  h.current = false;
  await initializeRangeSources();
  await initializeDocumentSources();
  expect(h.execute).not.toHaveBeenCalled();
  expect(h.query).not.toHaveBeenCalled();
});

it('activates a reviewed manual binding rename without inventing a new observation time', async () => {
  const before = getRangeBaselines()['kagi-manual'];
  h.state = {
    baseline_version: before.content.version,
    baseline_observed_at: new Date(before.observedAt),
    current_version: before.content.version,
    last_success_at: new Date(before.observedAt),
  };
  const bot = h.catalog.payload.identities.find(item => item.id === 'kagibot');
  h.catalog = {
    ...h.catalog,
    payload: updateCatalogRecord(h.catalog.payload, 'identities', { ...bot, name: 'Kagi search' }),
  };
  const after = getRangeBaselines()['kagi-manual'];
  expect(after.content.version).not.toBe(before.content.version);
  expect(after.observedAt).toBe(before.observedAt);
  await initializeRangeSources();
  const update = h.execute.mock.calls.find(
    ([sql, id]) => sql.includes('SET baseline_version=') && id === 'kagi-manual',
  );
  expect(update?.slice(1)).toEqual(['kagi-manual', after.content.version, before.observedAt, true]);
});

it('keeps an unchanged baseline and its newer successful observation intact', async () => {
  const baseline = getRangeBaselines()['kagi-manual'];
  h.state = {
    baseline_version: baseline.content.version,
    baseline_observed_at: new Date(baseline.observedAt),
    current_version: 'newer-reviewed-content',
    last_success_at: new Date(),
  };
  await initializeRangeSources();
  expect(
    h.execute.mock.calls.some(
      ([sql, id]) => sql.includes('SET baseline_version=') && id === 'kagi-manual',
    ),
  ).toBe(false);
});
