import { logSourceOperation } from '@/lib/liekan/upstream/log-source-operation';
import { serverPairingSchema } from '@/lib/liekan/contracts/installation';
export const operations = [
  logSourceOperation(
    'post',
    '/api/liekan/websites/{websiteId}/log-sources/server/pairing',
    'createLiekanServerPairing',
    'bearer',
    serverPairingSchema,
  ),
] as const;
