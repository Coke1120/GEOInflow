import { logSourceOperation } from '@/lib/liekan/upstream/log-source-operation';
import { sourceActionSchema } from '@/lib/liekan/contracts/log-sources';
export const operations = [
  logSourceOperation(
    'put',
    '/api/liekan/websites/{websiteId}/log-sources/{sourceId}',
    'manageLiekanLogSource',
    'bearer',
    sourceActionSchema,
  ),
  logSourceOperation(
    'delete',
    '/api/liekan/websites/{websiteId}/log-sources/{sourceId}',
    'disconnectLiekanLogSource',
    'bearer',
  ),
] as const;
