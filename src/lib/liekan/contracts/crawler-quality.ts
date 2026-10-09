import { z } from 'zod';
export const crawlerCoverageSchema = z
  .strictObject({
    epoch: z.number().int().positive(),
    fromBatchId: z.uuid(),
    toBatchId: z.uuid(),
    startsAt: z.number().int().nonnegative(),
    endsAt: z.number().int().nonnegative(),
    cursors: z
      .array(
        z.strictObject({
          generation: z.uuid(),
          confirmed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
          read: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        }),
      )
      .min(1)
      .max(256),
  })
  .refine(value => value.startsAt < value.endsAt && value.endsAt - value.startsAt <= 15 * 86400000);
export type CrawlerCoverage = z.infer<typeof crawlerCoverageSchema>;
