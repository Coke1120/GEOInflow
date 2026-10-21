import {
  crawlerIdentityScopeSchema,
  type CrawlerIdentityScope,
} from '../contracts/crawler-metrics';

/** All callers retain their own raw, recognized or AI-qualified population. */
export function crawlerIdentitySql(scope: CrawlerIdentityScope = 'all', alias: '' | 'l' = '') {
  const parsed = crawlerIdentityScopeSchema.parse(scope);
  return parsed === 'verified_range'
    ? ` AND ${alias ? `${alias}.` : ''}verification='verified_range'`
    : parsed === 'verified_identity' ? ` AND ${alias ? `${alias}.` : ''}verification IN('verified_range','verified_dns','verified_edge')` : '';
}
