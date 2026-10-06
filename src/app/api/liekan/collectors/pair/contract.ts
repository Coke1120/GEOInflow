import { logSourceOperation } from '@/lib/liekan/upstream/log-source-operation';
import { pairingSchema } from '@/lib/liekan/contracts/log-sources';
export const operations = [
  logSourceOperation(
    'post',
    '/api/liekan/collectors/pair',
    'pairLiekanCollector',
    'none',
    pairingSchema,
  ),
] as const;
