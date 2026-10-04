import { logSourceOperation } from '@/lib/liekan/upstream/log-source-operation';
import { z } from 'zod';
export const operations = [
  logSourceOperation(
    'post',
    '/api/liekan/log-sources/{sourceId}/batches',
    'receiveLiekanAutomaticBatch',
    'source-token',
    z.record(z.string(), z.unknown()),
    { batch: true },
  ),
] as const;
