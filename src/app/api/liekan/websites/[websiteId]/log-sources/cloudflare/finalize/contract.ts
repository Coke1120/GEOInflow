import { logSourceOperation } from '@/lib/liekan/upstream/log-source-operation';
import { finalizeSchema } from '@/lib/liekan/contracts/log-sources';
export const operations = [
  logSourceOperation(
    'post',
    '/api/liekan/websites/{websiteId}/log-sources/cloudflare/finalize',
    'finalizeLiekanCloudflare',
    'bearer',
    finalizeSchema,
  ),
] as const;
