import { describe, expect, it } from 'vitest';
import { evidenceQuerySchema, performanceQuerySchema } from './traffic-evidence';

const range = { startAt: 1, endAt: 2, timezone: 'UTC' };

describe('crawler performance and outcomes query contract', () => {
  it('retains source and identity filters supported by both readers', () => {
    expect(
      performanceQuerySchema.safeParse({
        ...range,
        sourceId: 'manual',
        botId: 'gptbot',
        botType: '训练',
      }).success,
    ).toBe(true);
  });

  it.each(['workbench', 'personal_agent'] as const)(
    'keeps the report-only %s filter out of performance and outcomes contracts',
    botProductForm => {
      expect(
        evidenceQuerySchema.safeParse({ ...range, reportResource: 'ai/pages', botProductForm })
          .success,
      ).toBe(true);
      expect(
        performanceQuerySchema.safeParse({ ...range, sourceId: 'manual', botProductForm })
          .success,
      ).toBe(false);
    },
  );
});
