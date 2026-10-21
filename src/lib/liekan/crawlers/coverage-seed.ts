import coverage from '../../../../config/liekan/ai-platform-coverage.json' with { type: 'json' };
import type { CatalogPayload, CatalogIdentity } from '../contracts/crawler-registry';

const reviewedAt = '2026-10-21';
function identity(
  id: string,
  name: string,
  platformId: string,
  type: CatalogIdentity['type'],
  url: string,
  summary: string,
): CatalogIdentity {
  const vendor = platformId === 'exa' ? 'Exa' : platformId === 'kagi' ? 'Kagi' : 'OpenAI';
  const signed = id === 'chatgpt-agent';
  return {
    id,
    name,
    platformId,
    vendor,
    type,
    kind: signed ? 'signed_agent' : 'http_crawler',
    uaSelector: signed ? null : name,
    family: id,
    parentId: null,
    aiEligible: platformId !== 'kagi',
    status: 'active',
    control: { remote: false, nginx: false },
    robotsToken: ['ExaSearchBot', 'Kagibot'].includes(name) ? name : null,
    purpose: signed
      ? 'unknown'
      : type === 'traditional_search'
        ? 'other'
        : (type as 'search' | 'user'),
    productForm: signed ? 'personal_agent' : 'infrastructure',
    productIds: [signed ? 'chatgpt-agent' : platformId],
    metadata: {
      id,
      name,
      vendor,
      aliases: [],
      purposes:
        type === 'search'
          ? ['AI 搜索']
          : type === 'user'
            ? ['用户触发']
            : type === 'traditional_search'
              ? ['传统搜索']
              : ['通用抓取'],
      kind: 'crawler',
      evidence: 'operator',
      summary,
      token: signed ? '' : name,
      ...(signed ? {} : { ua: `Mozilla/5.0 (compatible; ${name}/1.0; +${url})` }),
      ...(['ExaSearchBot', 'Kagibot'].includes(name) ? { robotsToken: name } : {}),
      feeds: [],
      verification:
        platformId === 'kagi'
          ? '精确 UA 与官方人工复核 IP 基准；过期保持未验证。'
          : '官方签名身份；仅在可用的可信边缘精确核验通过时确认来源。',
      robots: ['ExaSearchBot', 'Kagibot'].includes(name)
        ? '遵循官方 robots 规则。'
        : '用户触发或 Agent 请求的 robots 行为以官方说明为准。',
      advice: '声明身份与请求核验分别展示。',
      sources: [{ label: `${vendor} official`, url }],
      reviewedAt,
    },
  };
}

/** Reviewed product coverage is separate from active network identity evidence. */
export function extendCatalogCoverage(base: CatalogPayload): CatalogPayload {
  const payload = structuredClone(base);
  for (const platform of coverage.platforms) {
    const index = payload.platforms.findIndex(item => item.id === platform.id);
    if (index < 0) payload.platforms.push(platform as CatalogPayload['platforms'][number]);
    else payload.platforms[index] = platform as CatalogPayload['platforms'][number];
  }
  payload.products = structuredClone(coverage.products) as CatalogPayload['products'];
  payload.referrals = structuredClone(coverage.referrals) as CatalogPayload['referrals'];
  payload.identities.push(
    identity(
      'exasearchbot',
      'ExaSearchBot',
      'exa',
      'search',
      'https://crawler.exa.ai/',
      '官方搜索与检索索引身份。',
    ),
    identity(
      'exauser',
      'ExaUser',
      'exa',
      'user',
      'https://crawler.exa.ai/exauser',
      '用户或 API 应用请求当前网页内容时使用的身份。',
    ),
    identity(
      'kagibot',
      'Kagibot',
      'kagi',
      'traditional_search',
      'https://kagi.com/bot',
      'Kagi 搜索基础设施；AI 统计资格独立保留。',
    ),
    identity(
      'chatgpt-agent',
      'ChatGPT Agent',
      'openai',
      'other',
      'https://help.openai.com/en/articles/11845367-chatgpt-works-cloud-browser-allowlisting',
      'ChatGPT 云浏览器签名身份，产品形态为个人 Agent，用途保持未知。',
    ),
  );
  for (const product of payload.products)
    for (const id of product.identityIds) {
      const entry = payload.identities.find(item => item.id === id);
      if (entry && !entry.productIds.includes(product.id)) entry.productIds.push(product.id);
    }
  payload.rangeSources.push({
    id: 'kagi-manual',
    url: 'https://kagi.com/bot',
    names: ['Kagibot'],
    crawlerIds: ['kagibot'],
    parserVersion: 'manual-reviewed-v1',
    reviewedAt,
  });
  payload.rangeBaselines['kagi-manual'] = {
    source: 'https://kagi.com/bot',
    observedAt: '2026-10-21T01:49:35.000Z',
    publishedAt: null,
    prefixes: ['216.18.205.234/32', '35.212.27.76/32', '104.254.65.50/32', '209.151.156.194/32'],
  };
  payload.verificationMethods.push(
    {
      id: 'exa-signature',
      crawlerIds: ['exasearchbot', 'exauser'],
      method: 'signature',
      documentationUrl: 'https://crawler.exa.ai/',
      keyDirectory: 'https://crawler.exa.ai/.well-known/http-message-signatures-directory',
    },
    {
      id: 'chatgpt-agent-signature',
      crawlerIds: ['chatgpt-agent'],
      method: 'signature',
      documentationUrl:
        'https://help.openai.com/en/articles/11845367-chatgpt-works-cloud-browser-allowlisting',
      signatureAgent: 'https://chatgpt.com',
      keyDirectory: 'https://chatgpt.com/.well-known/http-message-signatures-directory',
    },
    {
      id: 'chatgpt-agent-cloudflare',
      crawlerIds: ['chatgpt-agent'],
      method: 'edge',
      documentationUrl:
        'https://help.openai.com/en/articles/11845367-chatgpt-works-cloud-browser-allowlisting',
      provider: 'cloudflare',
      detectionIds: [129220581],
    },
    {
      id: 'googlebot-dns',
      crawlerIds: ['googlebot'],
      method: 'dns',
      documentationUrl:
        'https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests',
      hostSuffixes: ['googlebot.com'],
    },
    {
      id: 'applebot-dns',
      crawlerIds: ['applebot'],
      method: 'dns',
      documentationUrl: 'https://support.apple.com/en-us/119829',
      hostSuffixes: ['applebot.apple.com'],
    },
  );
  return payload;
}
