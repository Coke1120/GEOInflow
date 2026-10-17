import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import {
  evidenceQuerySchema,
  crawlerEvidenceResponseSchema,
} from '@/lib/liekan/contracts/traffic-evidence';
export const operations = [
  crawlerOperation(
    'get',
    '/api/liekan/websites/{websiteId}/crawler-analysis/evidence',
    'getLiekanCrawlerEvidence',
    undefined,
    crawlerEvidenceResponseSchema,
    evidenceQuerySchema,
  ),
] as const;
