import { logSourceOperation } from '@/lib/liekan/upstream/log-source-operation';
import { healthSchema } from '@/lib/liekan/contracts/log-sources';
export const operations = [
  logSourceOperation(
    'get',
    '/api/liekan/log-sources/{sourceId}/heartbeat',
    'readLiekanCollectorConnection',
    'source-token',
  ),
  logSourceOperation(
    'post',
    '/api/liekan/log-sources/{sourceId}/heartbeat',
    'heartbeatLiekanCollector',
    'source-token',
    healthSchema,
  ),
] as const;
