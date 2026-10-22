// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getRangeBaselines } from './range-check';
import { installPublishedCatalogResolver } from './published';
import { getBundledPublishedCatalog } from './catalog-seed';
import {
  catalogHash,
  mergeCatalogSeed,
  previewCatalog,
  rollbackCatalog,
  validateCatalog,
} from './catalog-validation';
import { catalogUrlSchema, crawlerRegistryCommandSchema } from '../contracts/crawler-registry';

const seed = () => structuredClone(getBundledPublishedCatalog().payload);
function addIdentity(payload: ReturnType<typeof seed>) {
  const identity = structuredClone(payload.identities[0]);
  Object.assign(identity, {
    id: 'sample-agent',
    name: 'SampleAgent',
    family: 'sample-agent',
    uaSelector: 'SampleAgent',
    status: 'active',
    control: { remote: false, nginx: false },
  });
  Object.assign(identity.metadata, {
    id: identity.id,
    name: identity.name,
    token: identity.uaSelector,
    evidence: 'observed',
  });
  payload.identities.push(identity);
  return identity;
}
describe('catalog publication boundaries', () => {
  it('validates the complete reviewed seed and separates HTTP and robots identities', () => {
    const p = validateCatalog(seed());
    expect(
      p.identities.filter(item => item.status === 'active' && item.kind === 'http_crawler'),
    ).toHaveLength(60);
    expect(
      p.identities.filter(
        item => item.status === 'active' && item.kind === 'http_crawler' && item.aiEligible,
      ),
    ).toHaveLength(26);
    expect(p.identities.filter(item => item.control.remote)).toHaveLength(13);
    expect(Object.isFrozen(getBundledPublishedCatalog().payload.identities[0])).toBe(true);
  });
  it.each([
    'https://127.0.0.1/a',
    'https://[::1]/a',
    'https://2130706433/a',
    'https://localhost/a',
    'https://service.internal/a',
    'https://admin:password@public.com/a',
    'http://public.com/a',
    'https://public.com/a#key',
    'https://public.com:8443/a',
  ])('rejects unsafe URL %s', url => {
    expect(catalogUrlSchema.safeParse(url).success).toBe(false);
  });
  it('rejects parser code, duplicate IDs, duplicate aliases and unsafe network ranges', () => {
    const p = seed();
    p.rangeSources[0].parserVersion = 'javascript' as any;
    expect(() => validateCatalog(p)).toThrow();
    const duplicate = seed();
    duplicate.identities.push(duplicate.identities[0]);
    expect(() => validateCatalog(duplicate)).toThrow(/duplicate/);
    const aliases = seed();
    aliases.identities[1].metadata.aliases.push(aliases.identities[0].uaSelector);
    expect(() => validateCatalog(aliases)).toThrow(/duplicate/);
    const privateRange = seed();
    privateRange.rangeBaselines['openai-gpt'].prefixes = ['10.0.0.0/8'];
    expect(() => validateCatalog(privateRange)).toThrow(/non-public/);
  });
  it.each(['192.1.0.0/8', '8.8.8.8/0', '2000::/3', '192.168.0.1/24'])(
    'rejects ranges that runtime consumers cannot safely load: %s',
    prefix => {
      const p = seed();
      p.rangeBaselines['openai-gpt'].prefixes = [prefix];
      expect(() => validateCatalog(p)).toThrow(/CIDR/);
      expect(() => previewCatalog(seed(), p, '1', '1')).toThrow(/CIDR/);
    },
  );
  it('loads every approved baseline through the real runtime consumer', () => {
    const catalog = getBundledPublishedCatalog();
    const payload = validateCatalog(seed());
    installPublishedCatalogResolver(() => ({ ...catalog, payload }));
    try {
      expect(Object.keys(getRangeBaselines()).length).toBeGreaterThan(20);
    } finally {
      installPublishedCatalogResolver(() => undefined);
    }
  });
  it('rejects broken links, family cycles, promoted purpose-only entries and unreviewed control adapters', () => {
    const missing = seed();
    missing.identities[0].platformId = 'absent';
    expect(() => validateCatalog(missing)).toThrow(/missing platform/);
    const cyclic = seed();
    cyclic.identities[0].parentId = cyclic.identities[0].id;
    expect(() => validateCatalog(cyclic)).toThrow(/cycle/);
    const purpose = seed();
    purpose.identities.find(item => item.kind === 'robots_purpose').aiEligible = true;
    expect(() => validateCatalog(purpose)).toThrow(/robots-purpose/);
    const custom = seed();
    addIdentity(custom).control.remote = true;
    expect(() => validateCatalog(custom)).toThrow(/reviewed adapter/);
    const official = seed();
    official.identities[0].metadata.sources = [];
    expect(() => validateCatalog(official)).toThrow(/official evidence/);
  });
  it('never deletes or reuses a published identity ID', () => {
    const previous = seed(),
      changed = seed();
    changed.identities.shift();
    expect(() => validateCatalog(changed, previous)).toThrow(/retained/);
    const reused = seed();
    reused.identities[0].platformId = 'google';
    expect(() => validateCatalog(reused, previous)).toThrow(/reused/);
  });
  it('normalizes and detects overlapping referral domains and contradictory product bindings', () => {
    const p = seed();
    p.referrals[1].aliases.push('CHATGPT');
    expect(() => validateCatalog(p)).toThrow(/duplicate referral/);
    const domains = seed();
    domains.referrals[0].host = 'parent.vendor.com';
    domains.referrals[0].includeSubdomains = true;
    domains.referrals[1].host = 'child.parent.vendor.com';
    expect(() => validateCatalog(domains)).toThrow(/overlapping/);
    const links = seed();
    links.identities[0].productIds = ['nonexistent'];
    expect(() => validateCatalog(links)).toThrow(/product link/);
  });
  it('creates a durable reproducible preview with positive and token-boundary negative examples', () => {
    const current = seed(),
      candidate = seed();
    candidate.identities[0].status = 'inactive';
    const a = previewCatalog(current, candidate, '4', '3');
    const b = previewCatalog(current, candidate, '4', '3');
    expect(a.hash).toBe(b.hash);
    expect(a.counts.disabled).toBe(1);
    expect(a.samples.some(item => item.expectedId === null)).toBe(true);
    expect(a.samples.every(item => item.passed)).toBe(true);
    expect(previewCatalog(current, candidate, '5', '3').hash).not.toBe(a.hash);
    expect(
      previewCatalog(current, candidate, '4', '3', [
        { userAgent: 'GPTBot/1.0', expectedId: 'gptbot' },
      ]).conflicts,
    ).toContain('match_samples_failed');
  });
  it('rolls historical content into a new draft while retaining newer IDs as inactive', () => {
    const target = seed(),
      current = seed();
    const added = addIdentity(current);
    const rollback = rollbackCatalog(target, current);
    expect(rollback.identities.find(item => item.id === added.id).status).toBe('inactive');
    expect(() => validateCatalog(rollback, current)).not.toThrow();
    expect(current.identities.find(item => item.id === added.id).status).toBe('active');
  });
  it('merges software additions while retaining administrator edits, disabled entries and custom IDs', () => {
    const previous = seed(),
      current = seed(),
      next = seed();
    current.identities[0].status = 'inactive';
    current.identities[0].metadata.summary = 'Administrator summary';
    next.identities[0].metadata.summary = 'Upstream summary';
    next.identities[1].metadata.summary = 'New reviewed summary';
    addIdentity(current);
    const merged = mergeCatalogSeed(previous, current, next);
    expect(merged.payload.identities[0].status).toBe('inactive');
    expect(merged.payload.identities[0].metadata.summary).toBe('Administrator summary');
    expect(merged.payload.identities[1].metadata.summary).toBe('New reviewed summary');
    expect(merged.payload.identities.find(item => item.id === 'sample-agent').status).toBe(
      'active',
    );
    expect(merged.conflicts).toContain('identities.gptbot.metadata.summary');
    expect(() => validateCatalog(merged.payload, current)).not.toThrow();
  });
  it('bounds administrator samples and rejects unknown request fields', () => {
    const command = {
      action: 'preview',
      operationId: 'a34cc481-2083-47ab-9a88-31459ede8081',
      draftId: 'a34cc481-2083-47ab-9a88-31459ede8082',
      expectedDraftRevision: '1',
      samples: [{ userAgent: 'a'.repeat(1001), expectedId: null }],
    };
    expect(crawlerRegistryCommandSchema.safeParse(command).success).toBe(false);
    expect(
      crawlerRegistryCommandSchema.safeParse({ ...command, samples: [], bypass: true }).success,
    ).toBe(false);
    expect(catalogHash({ b: 1, a: 2 })).toBe(catalogHash({ a: 2, b: 1 }));
  });
});

describe('reviewed publication regressions', () => {
  it('requires a reviewed baseline before enabling a new automatic IP source', () => {
    const p = seed();
    delete p.rangeBaselines['openai-gpt'];
    expect(() => validateCatalog(p)).toThrow(/baseline required/);
    p.rangeSources.find(source => source.id === 'openai-gpt').enabled = false;
    expect(() => validateCatalog(p)).not.toThrow();
  });
  it('allows only one enabled IP source per canonical identity', () => {
    const p = seed(),
      original = p.rangeSources.find(source => source.id === 'openai-gpt');
    p.rangeSources.push({ ...original, id: 'second-gpt-source' });
    p.rangeBaselines['second-gpt-source'] = structuredClone(p.rangeBaselines['openai-gpt']);
    expect(() => validateCatalog(p)).toThrow(/multiple enabled IP sources/);
    original.enabled = false;
    expect(() => validateCatalog(p)).not.toThrow();
  });
  it.each([
    { samples: [{ userAgent: 'HumanBrowser/1.0', expectedId: null }] },
    { samples: [{ userAgent: 'GPTBot/1.0', expectedId: 'gptbot' }] },
  ])('blocks publication previews that omit a sample category: %j', ({ samples }) => {
    const payload = seed();
    const incomplete = previewCatalog(payload, payload, '1', '1', samples);
    expect(incomplete.samples.every(sample => sample.passed)).toBe(true);
    expect(incomplete.conflicts).toContain('match_samples_incomplete');
    const complete = previewCatalog(payload, payload, '1', '1', [
      { userAgent: 'GPTBot/1.0', expectedId: 'gptbot' },
      { userAgent: 'HumanBrowser/1.0', expectedId: null },
    ]);
    expect(complete.conflicts).toEqual([]);
  });
  it('rebinds retained source display names when rolling back a renamed identity', () => {
    const target = seed(),
      current = seed();
    const identity = current.identities.find(item => item.id === 'kagibot');
    identity.name = identity.metadata.name = 'Kagi Search Crawler';
    const source = current.rangeSources.find(item => item.id === 'kagi-manual');
    source.names = [identity.name];
    source.enabled = false;
    current.rangeSources.push({
      ...source,
      id: 'new-kagi-source',
      url: 'https://kagi.com/crawler-ranges.json',
      parserVersion: 'prefixes-v1',
      enabled: true,
    });
    current.rangeBaselines['new-kagi-source'] = {
      ...current.rangeBaselines['kagi-manual'],
      source: 'https://kagi.com/crawler-ranges.json',
    };
    validateCatalog(current, target);
    const rolled = rollbackCatalog(target, current);
    expect(rolled.identities.find(item => item.id === 'kagibot').name).toBe('Kagibot');
    expect(rolled.rangeSources.find(item => item.id === 'new-kagi-source')).toMatchObject({
      enabled: false,
      crawlerIds: ['kagibot'],
      names: ['Kagibot'],
    });
    expect(() => validateCatalog(rolled, current)).not.toThrow();
    expect(current.rangeSources.at(-1).names).toEqual(['Kagi Search Crawler']);
  });
  it('keeps the UA identity immutable across pending status transitions', () => {
    const previous = seed(),
      pending = seed();
    pending.identities[0].status = 'pending';
    validateCatalog(pending, previous);
    const next = structuredClone(pending);
    next.identities[0].status = 'active';
    next.identities[0].uaSelector = next.identities[0].metadata.token = 'EntirelyNewBot';
    expect(() => validateCatalog(next, pending)).toThrow(/cannot be reused/);
  });
  it('retains and disables newer sources and verification methods on rollback', () => {
    const target = seed(),
      current = seed();
    current.rangeSources.push({
      ...current.rangeSources[0],
      id: 'new-reviewed-source',
      url: 'https://new-source.com/feed.json',
    });
    current.verificationMethods.push({
      id: 'new-reviewed-method',
      crawlerIds: ['gptbot'],
      method: 'dns',
      documentationUrl: 'https://openai.com',
      hostSuffixes: ['openai.com'],
    });
    const rolled = rollbackCatalog(target, current);
    validateCatalog(rolled, current);
    expect(rolled.rangeSources.at(-1).enabled).toBe(false);
    expect(rolled.verificationMethods.at(-1).enabled).toBe(false);
    const p = previewCatalog(current, rolled, '2', '1');
    expect(p.changes).toContainEqual({
      section: 'rangeSources',
      id: 'new-reviewed-source',
      kind: 'disabled',
    });
    expect(p.changes).toContainEqual({
      section: 'verificationMethods',
      id: 'new-reviewed-method',
      kind: 'disabled',
    });
  });
  it.each(['2026-02-31', '2026-99-99'])('rejects impossible reviewed date %s', date => {
    const payload = seed();
    payload.identities[0].metadata.reviewedAt = date;
    expect(() => validateCatalog(payload)).toThrow();
    const ranges = seed();
    ranges.rangeSources[0].reviewedAt = date;
    expect(() => validateCatalog(ranges)).toThrow();
  });
});

it('preserves explicit browser exclusion approval independently from official log verification', () => {
  const current = seed();
  expect(current.rangeSources.find(source => source.id === 'kimi-bot')?.browserExclusion).toBe(
    'dedicated_crawler',
  );
  expect(
    current.rangeSources.find(source => source.id === 'kagi-manual')?.browserExclusion,
  ).toBeUndefined();
  const previous = seed();
  previous.rangeSources.forEach(source => {
    delete source.browserExclusion;
  });
  const restored = validateCatalog(previous);
  expect(restored.rangeSources.every(source => source.browserExclusion === undefined)).toBe(true);
  expect(catalogHash(restored)).toBe(catalogHash(previous));
  const merged = mergeCatalogSeed(previous, previous, current);
  expect(
    merged.payload.rangeSources.find(source => source.id === 'kimi-bot')?.browserExclusion,
  ).toBe('dedicated_crawler');
  expect(merged.conflicts).toEqual([]);
  const revoked = structuredClone(current);
  revoked.rangeSources[0].browserExclusion = 'unsupported';
  expect(validateCatalog(revoked).rangeSources[0].browserExclusion).toBe('unsupported');
  const unreviewed = seed();
  unreviewed.identities.find(identity => identity.id === 'gptbot')!.metadata.evidence = 'observed';
  expect(() => validateCatalog(unreviewed)).toThrow(/browser exclusion requires reviewed/);
});
