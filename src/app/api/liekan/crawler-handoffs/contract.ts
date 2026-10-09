import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
export const operations = [
  crawlerOperation('get', '/api/liekan/crawler-handoffs', 'getLiekanCrawlerHandoffs'),
] as const;
