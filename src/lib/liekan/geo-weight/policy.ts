import type { GeoPurpose } from '../contracts/geo-weight';

export const GEO_ALGORITHM = 'geo-weight-v2.1-bands-evidence-beta';
export const GEO_COEFFICIENTS = Object.freeze({ search: 10, user: 7, training: 3 });
export const GEO_PURPOSES = ['search', 'user', 'training'] as const;
// Inclusive lower bounds for levels 1–10; zero is reserved for observed zero activity.
export const GEO_LEVEL_MINIMUMS = Object.freeze([
  1, 100, 500, 2000, 10000, 50000, 200000, 1000000, 5000000, 20000000,
]);
export const GEO_ACTIVITY_FORMULA = 'W = 10 × E_search + 7 × E_user + 3 × E_training';
export const GEO_FORMULA = Object.freeze({ days: 30, operatorMinUnits: 10, operatorMinDays: 3 });
// This is the scoring policy. Identity descriptions and verification sources live in the catalog.
export const GEO_SCOPE: ReadonlyArray<{ id: string; purpose: GeoPurpose; platformId: string }> = [
  { id: 'oai-searchbot', purpose: 'search', platformId: 'openai' },
  { id: 'claude-searchbot', purpose: 'search', platformId: 'anthropic' },
  { id: 'perplexitybot', purpose: 'search', platformId: 'perplexity' },
  { id: 'amzn-searchbot', purpose: 'search', platformId: 'amazon' },
  { id: 'mistralai-index', purpose: 'search', platformId: 'mistral' },
  { id: 'duckassistbot', purpose: 'search', platformId: 'duckduckgo' },
  { id: 'kimi-searchbot', purpose: 'search', platformId: 'kimi' },
  { id: 'chatgpt-user', purpose: 'user', platformId: 'openai' },
  { id: 'claude-user', purpose: 'user', platformId: 'anthropic' },
  { id: 'perplexity-user', purpose: 'user', platformId: 'perplexity' },
  { id: 'amzn-user', purpose: 'user', platformId: 'amazon' },
  { id: 'mistralai-user', purpose: 'user', platformId: 'mistral' },
  { id: 'kimi-user', purpose: 'user', platformId: 'kimi' },
  { id: 'gptbot', purpose: 'training', platformId: 'openai' },
  { id: 'claudebot', purpose: 'training', platformId: 'anthropic' },
  { id: 'amazonbot', purpose: 'training', platformId: 'amazon' },
  { id: 'kimibot', purpose: 'training', platformId: 'kimi' },
  { id: 'hyspider', purpose: 'training', platformId: 'tencent' },
].map(row => Object.freeze(row)) as ReadonlyArray<{
  id: string;
  purpose: GeoPurpose;
  platformId: string;
}>;
export const GEO_VERIFICATION = 'verified_range';
export const GEO_CONTENT_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'text/markdown',
  'application/pdf',
];
export const GEO_METADATA_PATH =
  '^/(robots[.]txt|llms[.]txt|llms-full[.]txt)$|(^|/)sitemap[^/]*[.]xml([.]gz)?$';
export const GEO_NON_CONTENT_EXTENSION =
  '[.](js|mjs|cjs|css|map|avif|webp|png|jpg|jpeg|gif|svg|ico|bmp|tif|tiff|woff|woff2|ttf|otf|eot|mp3|m4a|wav|ogg|mp4|webm|mov|avi|json|xml|rss|atom|zip|gz|br|tar|7z|rar|exe|dmg|iso|wasm)([?#]|$)';
