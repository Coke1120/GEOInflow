import { logSourceOperation } from '@/lib/liekan/upstream/log-source-operation';
export const operations = [
  logSourceOperation(
    'get',
    '/api/liekan/websites/{websiteId}/log-sources',
    'getLiekanLogSources',
    'bearer',
  ),
] as const;
