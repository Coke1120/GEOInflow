import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import { crawlerDomainInput } from '@/lib/liekan/crawler-control/diagnostics';
export const operations = [
  crawlerOperation(
    'get',
    '/api/liekan/websites/{websiteId}/crawler-domain-verification',
    'getLiekanCrawlerDomainVerification',
    undefined,
  ),
  crawlerOperation(
    'post',
    '/api/liekan/websites/{websiteId}/crawler-domain-verification',
    'postLiekanCrawlerDomainVerification',
    crawlerDomainInput,
  ),
] as const;
