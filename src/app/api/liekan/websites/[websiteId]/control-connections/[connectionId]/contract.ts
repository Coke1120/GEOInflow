import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import { crawlerDisconnectInput } from '@/lib/liekan/crawler-control/service';
export const operations = [
  crawlerOperation(
    'delete',
    '/api/liekan/websites/{websiteId}/control-connections/{connectionId}',
    'deleteLiekanCrawlerConnection',
    crawlerDisconnectInput,
  ),
] as const;
