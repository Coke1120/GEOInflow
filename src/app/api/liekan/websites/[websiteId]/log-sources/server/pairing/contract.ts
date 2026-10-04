import { logSourceOperation } from '@/lib/liekan/upstream/log-source-operation';
export const operations = [
  logSourceOperation(
    'post',
    '/api/liekan/websites/{websiteId}/log-sources/server/pairing',
    'createLiekanServerPairing',
    'bearer',
  ),
] as const;
