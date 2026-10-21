import { extendCatalogCoverage } from './coverage-seed';
import { createHash } from 'node:crypto';
import { crawlerCatalog } from './catalog';
import { crawlerPlatformIds } from './registry';
import { rangeSources } from './range-sources';
import baselines from '../../../../config/liekan/crawler-range-baselines.json';
import type { CatalogPayload, PublishedCatalog } from '../contracts/crawler-registry';
import { catalogHash, validateCatalog, freezeCatalog } from './catalog-validation';

let bundled: PublishedCatalog | undefined;
/** A lazy factory keeps static identity modules safe while their runtime getters use the bridge. */
export function getBundledPublishedCatalog(): PublishedCatalog {
  if (bundled) return bundled;
  const domestic = new Set([
    'kimi',
    'tencent',
    'bytedance',
    'baidu',
    'sogou',
    '360',
    'petal',
    'deepseek',
  ]);
  const platforms: CatalogPayload['platforms'] = crawlerPlatformIds.map(id => {
    const identity = crawlerCatalog.find(item => item.platformId === id)!;
    const documentationUrls = [...new Set(identity.metadata.sources.map(item => item.url))];
    return {
      id,
      name: identity.vendor,
      operator: identity.vendor,
      region: domestic.has(id) ? 'domestic' : 'global',
      website: new URL(documentationUrls[0]).origin,
      documentationUrls,
    };
  });
  platforms.push({
    id: 'deepseek',
    name: 'DeepSeek',
    operator: 'DeepSeek',
    region: 'domestic',
    website: 'https://www.deepseek.com',
    documentationUrls: ['https://www.deepseek.com'],
  });
  const aliasSeeds = [
    ['chatgpt', 'chatgpt.com', 'openai'],
    ['openai', 'chat.openai.com', 'openai'],
    ['perplexity', 'perplexity.ai', 'perplexity'],
    ['claude', 'claude.ai', 'anthropic'],
    ['gemini', 'gemini.google.com', 'google'],
    ['copilot', 'copilot.microsoft.com', 'microsoft'],
    ['doubao', 'doubao.com', 'bytedance'],
    ['kimi', 'kimi.com', 'kimi'],
    ['kimi.moonshot.cn', 'kimi.moonshot.cn', 'kimi'],
    ['yiyan', 'yiyan.baidu.com', 'baidu'],
    ['deepseek', 'deepseek.com', 'deepseek'],
  ];
  const payload = validateCatalog(
    extendCatalogCoverage(
      validateCatalog({
        schemaVersion: 1,
        identities: crawlerCatalog.map(item => ({
          ...item,
          purpose: ['training', 'search', 'user'].includes(item.type) ? item.type : 'other',
          productForm: 'unknown',
          productIds: [],
        })),
        platforms,
        products: [],
        referrals: aliasSeeds.map(([alias, host, platformId]) => ({
          id: host.replaceAll('.', '-'),
          platformId,
          productId: null,
          host,
          includeSubdomains: true,
          aliases: [alias],
          kind: 'ai',
          enabled: true,
          documentationUrls: [],
        })),
        rangeSources: structuredClone(rangeSources),
        rangeBaselines: structuredClone(baselines),
        verificationMethods: [],
      }),
    ),
  );
  const contentHash = catalogHash(payload);
  const bytes = createHash('sha256').update(`liekan-catalog-seed:${contentHash}`).digest('hex');
  const version = `${bytes.slice(0, 8)}-${bytes.slice(8, 12)}-5${bytes.slice(13, 16)}-a${bytes.slice(17, 20)}-${bytes.slice(20, 32)}`;
  bundled = freezeCatalog({
    version,
    revision: '1',
    contentHash,
    publishedAt: '2026-10-21T00:00:00.000Z',
    payload,
    state: 'fallback',
  });
  return bundled;
}
