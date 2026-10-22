import { classifyBot, getBotRules } from '../rules/bots';
import { createHash } from 'node:crypto';
import { normalizePrefixes } from './range-check';
import {
  catalogPayloadSchema,
  type CatalogPayload,
  type RegistryPreview,
} from '../contracts/crawler-registry';

export const reviewedControlIds = new Set([
  'gptbot',
  'oai-searchbot',
  'chatgpt-user',
  'claudebot',
  'claude-searchbot',
  'claude-user',
  'perplexitybot',
  'perplexity-user',
  'googlebot',
  'applebot',
  'bingbot',
  'baiduspider',
  'bytespider',
]);
export class CatalogValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.slice(0, 8).join('; '));
  }
}
export function canonicalCatalogJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalCatalogJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .filter(key => value[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${canonicalCatalogJson(value[key])}`)
    .join(',')}}`;
}
export const catalogHash = (value: unknown) =>
  createHash('sha256').update(canonicalCatalogJson(value)).digest('hex');
export function freezeCatalog<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeCatalog);
    Object.freeze(value);
  }
  return value;
}
const sections = [
  'identities',
  'platforms',
  'products',
  'referrals',
  'rangeSources',
  'verificationMethods',
] as const;
const normalized = (value: string) => value.trim().toLowerCase();
const same = (a: unknown, b: unknown) => canonicalCatalogJson(a) === canonicalCatalogJson(b);

/** Performs structural, provenance, reference and historical-ID validation with no network I/O. */
export function validateCatalog(input: unknown, previous?: CatalogPayload): CatalogPayload {
  const parsed = catalogPayloadSchema.safeParse(input);
  if (!parsed.success)
    throw new CatalogValidationError(
      parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
    );
  const payload = parsed.data;
  const issues: string[] = [];
  const fail = (message: string) => issues.push(message);
  const maps = Object.fromEntries(
    sections.map(section => {
      const entries = payload[section];
      const map = new Map<string, any>(entries.map(item => [item.id, item] as [string, any]));
      if (map.size !== entries.length) fail(`${section}: duplicate ID`);
      if (previous)
        for (const old of previous[section])
          if (!map.has(old.id)) fail(`${section}.${old.id}: published IDs must be retained`);
      return [section, map];
    }),
  ) as Record<(typeof sections)[number], Map<string, any>>;
  const tokens = new Map<string, string>();
  for (const identity of payload.identities) {
    if (!maps.platforms.has(identity.platformId)) fail(`${identity.id}: missing platform`);
    if (
      identity.metadata.id !== identity.id ||
      identity.metadata.name !== identity.name ||
      identity.metadata.vendor !== identity.vendor ||
      identity.metadata.token !== (identity.uaSelector ?? '')
    )
      fail(`${identity.id}: metadata identity mismatch`);
    if (
      identity.kind === 'robots_purpose' &&
      (identity.uaSelector !== null ||
        identity.aiEligible ||
        identity.control.remote ||
        identity.control.nginx)
    )
      fail(`${identity.id}: robots-purpose cannot classify HTTP or grant control`);
    if (identity.kind === 'http_crawler' && !identity.uaSelector)
      fail(`${identity.id}: HTTP token required`);
    if (
      (identity.control.remote || identity.control.nginx) &&
      (!reviewedControlIds.has(identity.id) || identity.kind !== 'http_crawler')
    )
      fail(`${identity.id}: control capability has no reviewed adapter`);
    if (
      identity.status === 'active' &&
      identity.metadata.evidence === 'operator' &&
      (!identity.metadata.sources.length || !identity.metadata.reviewedAt)
    )
      fail(`${identity.id}: official evidence requires sources and review date`);
    if (
      identity.status === 'active' &&
      ['pending', 'inactive'].includes(identity.metadata.evidence)
    )
      fail(`${identity.id}: unresolved evidence cannot be active`);
    if (identity.parentId) {
      const parent = maps.identities.get(identity.parentId);
      if (!parent || parent.family !== identity.family || parent.platformId !== identity.platformId)
        fail(`${identity.id}: parent must share family and platform`);
      const visited = new Set([identity.id]);
      let cursor = parent;
      while (cursor) {
        if (visited.has(cursor.id)) {
          fail(`${identity.id}: parent cycle`);
          break;
        }
        visited.add(cursor.id);
        cursor = maps.identities.get(cursor.parentId);
      }
    }
    for (const productId of identity.productIds) {
      const product = maps.products.get(productId);
      if (
        !product ||
        product.platformId !== identity.platformId ||
        !product.identityIds.includes(identity.id)
      )
        fail(`${identity.id}: invalid product link ${productId}`);
    }
    if (identity.uaSelector)
      for (const token of [identity.uaSelector, ...identity.metadata.aliases]) {
        const key = normalized(token),
          owner = tokens.get(key);
        if (owner && owner !== identity.id)
          fail(`${identity.id}: duplicate token or alias ${token}`);
        tokens.set(key, identity.id);
      }
    const old = previous?.identities.find(item => item.id === identity.id);
    if (
      old &&
      (old.kind !== identity.kind ||
        old.platformId !== identity.platformId ||
        old.family !== identity.family ||
        normalized(old.uaSelector ?? '') !== normalized(identity.uaSelector ?? ''))
    )
      fail(`${identity.id}: published identity ID cannot be reused`);
  }
  const productAliases = new Map<string, string>();
  for (const product of payload.products) {
    if (!maps.platforms.has(product.platformId)) fail(`${product.id}: missing platform`);
    const old = previous?.products.find(item => item.id === product.id);
    if (old && old.platformId !== product.platformId)
      fail(`${product.id}: published product ID cannot be reused`);
    for (const alias of [product.name, ...product.aliases]) {
      const key = normalized(alias),
        owner = productAliases.get(key);
      if (owner && owner !== product.id) fail(`${product.id}: duplicate product alias ${alias}`);
      productAliases.set(key, product.id);
    }
    for (const id of product.identityIds) {
      const identity = maps.identities.get(id);
      if (
        !identity ||
        identity.platformId !== product.platformId ||
        !identity.productIds.includes(product.id)
      )
        fail(`${product.id}: invalid identity link ${id}`);
    }
  }
  const aliases = new Map<string, string>();
  for (const referral of payload.referrals) {
    if (!maps.platforms.has(referral.platformId)) fail(`${referral.id}: missing platform`);
    if (
      referral.productId &&
      maps.products.get(referral.productId)?.platformId !== referral.platformId
    )
      fail(`${referral.id}: invalid referral product`);
    const old = previous?.referrals.find(item => item.id === referral.id);
    if (old && (old.platformId !== referral.platformId || old.host !== referral.host))
      fail(`${referral.id}: published referral ID cannot be reused`);
    for (const alias of [referral.host, ...referral.aliases]) {
      const key = normalized(alias),
        owner = aliases.get(key);
      if (owner && owner !== referral.id)
        fail(`${referral.id}: duplicate referral host or alias ${alias}`);
      aliases.set(key, referral.id);
    }
    if (referral.enabled)
      for (const other of payload.referrals) {
        if (
          other.id !== referral.id &&
          other.enabled &&
          other.includeSubdomains &&
          referral.host.endsWith(`.${other.host}`)
        )
          fail(`${referral.id}: overlapping referral domain ${other.id}`);
      }
  }
  const enabledFeeds = new Map<string, string>();
  for (const source of payload.rangeSources) {
    if (source.enabled !== false && !payload.rangeBaselines[source.id])
      fail(`${source.id}: reviewed baseline required for enabled IP source`);
    if (
      source.names.length !== source.crawlerIds.length ||
      new Set(source.crawlerIds).size !== source.crawlerIds.length
    )
      fail(`${source.id}: invalid feed identity bindings`);
    source.crawlerIds.forEach((id, index) => {
      const identity = maps.identities.get(id);
      if (!identity || identity.kind !== 'http_crawler' || identity.name !== source.names[index])
        fail(`${source.id}: invalid HTTP feed identity ${id}`);
      if (
        source.browserExclusion === 'dedicated_crawler' &&
        identity?.metadata.evidence !== 'operator'
      )
        fail(`${source.id}: browser exclusion requires reviewed operator crawler evidence`);
      if (source.enabled !== false) {
        if (enabledFeeds.has(id)) fail(`${id}: multiple enabled IP sources`);
        enabledFeeds.set(id, source.id);
      }
    });
  }
  for (const [id, baseline] of Object.entries(payload.rangeBaselines)) {
    if (maps.rangeSources.get(id)?.url !== baseline.source) fail(`${id}: baseline source mismatch`);
    try {
      normalizePrefixes(baseline.prefixes);
    } catch {
      fail(`${id}: invalid or non-public CIDR`);
    }
  }
  for (const method of payload.verificationMethods) {
    if (
      method.crawlerIds.some(
        id => !maps.identities.has(id) || maps.identities.get(id).kind === 'robots_purpose',
      )
    )
      fail(`${method.id}: invalid verification identity`);
    if (method.method === 'dns' && !method.hostSuffixes?.length)
      fail(`${method.id}: DNS suffixes required`);
    if (method.method === 'signature' && !method.keyDirectory)
      fail(`${method.id}: signature key directory required`);
    if (method.method === 'edge' && (!method.provider || !method.detectionIds?.length))
      fail(`${method.id}: edge provider and detection IDs required`);
  }
  if (issues.length) throw new CatalogValidationError(issues);
  return payload;
}

function inactive(section: string, entry: any) {
  if (section === 'identities') return { ...entry, status: 'inactive' };
  if (section === 'products') return { ...entry, supportStatus: 'inactive' };
  if (['referrals', 'rangeSources', 'verificationMethods'].includes(section))
    return { ...entry, enabled: false };
  return entry;
}
/** Preserve every ID created after the rollback target and disable its behavioral entries. */
export function rollbackCatalog(target: CatalogPayload, current: CatalogPayload): CatalogPayload {
  const result = structuredClone(target);
  for (const section of sections) {
    const known = new Set(result[section].map(item => item.id));
    (result[section] as any[]).push(
      ...current[section].filter(item => !known.has(item.id)).map(item => inactive(section, item)),
    );
  }
  // Retained newer product links remain reciprocal even on disabled definitions.
  for (const product of result.products)
    for (const id of product.identityIds) {
      const identity = result.identities.find(item => item.id === id);
      if (identity && !identity.productIds.includes(product.id))
        identity.productIds.push(product.id);
    }
  for (const identity of result.identities)
    for (const id of identity.productIds) {
      const product = result.products.find(item => item.id === id);
      if (product && !product.identityIds.includes(identity.id))
        product.identityIds.push(identity.id);
    }
  for (const source of result.rangeSources) {
    source.names = source.crawlerIds.map(
      id => result.identities.find(identity => identity.id === id)?.name || id,
    );
    if (
      !result.rangeBaselines[source.id] &&
      current.rangeBaselines[source.id]?.source === source.url
    )
      result.rangeBaselines[source.id] = structuredClone(current.rangeBaselines[source.id]);
  }
  return result;
}

/** Three-way field merge keeps operator edits and reports simultaneous upstream edits. */
export function mergeCatalogSeed(
  previous: CatalogPayload,
  current: CatalogPayload,
  next: CatalogPayload,
) {
  const conflicts: string[] = [];
  function merge(old: any, local: any, upstream: any, path: string): any {
    if (same(local, old)) return structuredClone(upstream);
    if (same(upstream, old) || same(local, upstream)) return structuredClone(local);
    if (
      old &&
      local &&
      upstream &&
      [old, local, upstream].every(item => typeof item === 'object' && !Array.isArray(item))
    ) {
      return Object.fromEntries(
        [...new Set([...Object.keys(old), ...Object.keys(local), ...Object.keys(upstream)])].map(
          key => [key, merge(old[key], local[key], upstream[key], `${path}.${key}`)],
        ),
      );
    }
    conflicts.push(path);
    return structuredClone(local);
  }
  const payload = structuredClone(current);
  for (const section of sections) {
    const old = new Map<string, any>(
      previous[section].map(item => [item.id, item] as [string, any]),
    );
    const local = new Map<string, any>(
      current[section].map(item => [item.id, item] as [string, any]),
    );
    const upstream = new Map<string, any>(
      next[section].map(item => [item.id, item] as [string, any]),
    );
    (payload[section] as any[]) = [...new Set([...local.keys(), ...upstream.keys()])].map(id => {
      if (!upstream.has(id)) {
        if (!old.has(id)) return structuredClone(local.get(id));
        if (!same(old.get(id), local.get(id))) {
          conflicts.push(`${section}.${id}`);
          return structuredClone(local.get(id));
        }
        return inactive(section, local.get(id));
      }
      if (!local.has(id)) return structuredClone(upstream.get(id));
      return merge(old.get(id), local.get(id), upstream.get(id), `${section}.${id}`);
    });
  }
  payload.rangeBaselines = merge(
    previous.rangeBaselines,
    current.rangeBaselines,
    next.rangeBaselines,
    'rangeBaselines',
  );
  return { payload, conflicts };
}

/** Samples are administrator-authored examples; collected visitor user agents never enter this API. */
export function previewCatalog(
  current: CatalogPayload,
  candidate: CatalogPayload,
  currentRevision: string,
  draftRevision: string,
  samples: Array<{ userAgent: string; expectedId: string | null }> = [],
): RegistryPreview {
  const payload = validateCatalog(candidate, current);
  const changes: RegistryPreview['changes'] = [];
  for (const section of sections)
    for (const item of payload[section]) {
      const old = current[section].find(entry => entry.id === item.id);
      if (!old) changes.push({ section, id: item.id, kind: 'added' });
      else if (!same(old, item))
        changes.push({
          section,
          id: item.id,
          kind:
            ('status' in item && item.status === 'inactive') ||
            ('enabled' in item && !item.enabled) ||
            ('supportStatus' in item && item.supportStatus === 'inactive')
              ? 'disabled'
              : 'changed',
        });
    }
  if (!same(current.rangeBaselines, payload.rangeBaselines))
    changes.push({ section: 'rangeBaselines', id: 'baselines', kind: 'changed' });
  const matchable = payload.identities
    .filter(item => item.status === 'active' && item.kind === 'http_crawler' && item.uaSelector)
    .sort((a, b) => b.uaSelector.length - a.uaSelector.length);
  const examples = samples.length
    ? samples
    : [
        ...matchable
          .slice(0, 49)
          .map(item => ({ userAgent: `${item.uaSelector}/1.0`, expectedId: item.id })),
        { userAgent: 'Mozilla/5.0 HumanBrowser/1.0', expectedId: null },
        ...matchable
          .slice(0, 49)
          .map(item => ({ userAgent: `Unrelated${item.uaSelector}Suffix/1.0`, expectedId: null })),
      ];
  const results = examples.map(sample => {
    const matchedId =
      classifyBot(sample.userAgent, getBotRules(payload.identities), payload.identities)
        .crawlerId ?? null;
    return { ...sample, matchedId, passed: matchedId === sample.expectedId };
  });
  const content = {
    currentRevision,
    draftRevision,
    contentHash: catalogHash(payload),
    changes,
    counts: {
      added: changes.filter(item => item.kind === 'added').length,
      changed: changes.filter(item => item.kind === 'changed').length,
      disabled: changes.filter(item => item.kind === 'disabled').length,
    },
    conflicts: [
      ...(results.some(item => !item.passed) ? ['match_samples_failed'] : []),
      ...(!results.some(item => item.expectedId !== null) ||
      !results.some(item => item.expectedId === null)
        ? ['match_samples_incomplete']
        : []),
    ],
    samples: results,
  };
  return { ...content, hash: catalogHash(content) };
}
