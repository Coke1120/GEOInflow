import { z } from 'zod';

export const websiteSummaryQuery = z
  .object({
    ids: z
      .string()
      .max(1850)
      .refine(
        value =>
          !value ||
          (value.split(',').length <= 50 &&
            value.split(',').every(id => z.uuid().safeParse(id).success)),
        '网站 ID 无效',
      ),
    startAt: z.coerce.number().int().min(0),
    endAt: z.coerce.number().int().min(0),
    timezone: z.string().max(80).default('Asia/Shanghai'),
  })
  .refine(p => p.endAt >= p.startAt, '日期范围无效');
const totals = z.object({
  pageviews: z.number(),
  visitors: z.number(),
  visits: z.number(),
  bounces: z.number(),
  totaltime: z.number(),
  aiVisits: z.number(),
});
export const websiteSummarySchema = z.array(
  totals.extend({
    id: z.uuid(),
    views: z.number(),
    received: z.boolean(),
    lastAt: z.string().nullable(),
    comparison: totals,
  }),
);
export type WebsiteSummary = z.infer<typeof websiteSummarySchema>;
