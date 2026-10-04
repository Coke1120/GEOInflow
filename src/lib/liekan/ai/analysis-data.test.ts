import { expect, it } from 'vitest';
import { isAiContextEmpty } from './analysis-data';
import type { AiFactsContext } from './facts-contracts';
const context = (facts: unknown[] = []) =>
  ({ metrics: [{ value: 0 }, { value: null }], facts }) as AiFactsContext;
it('keeps connected zero and missing input local without treating configuration counts as traffic', () => {
  expect(isAiContextEmpty(context())).toBe(true);
  expect(
    isAiContextEmpty(
      context([{ id: 'goals', data: { configured: 1, rows: [{ count: 0, previousCount: 0 }] } }]),
    ),
  ).toBe(true);
});
it.each([
  {
    id: 'summary',
    data: {
      current: null,
      previous: { pageviews: 3, visitors: 2, visits: 2 },
      logs: null,
      previousLogs: null,
    },
  },
  {
    id: 'summary',
    data: { current: null, previous: null, logs: null, previousLogs: { requests: 2 } },
  },
  { id: 'bots', data: { requests: 0, previousRequests: 2 } },
  { id: 'log-errors', data: { requests: 0, previousRequests: 2 } },
  {
    id: 'ai-referrals',
    data: { visits: 0, pageviews: 0, previousVisits: 2, previousPageviews: 2 },
  },
  {
    id: 'pages',
    data: {
      rows: [
        {
          humanPageviews: null,
          aiRequests: 0,
          previousHumanPageviews: null,
          previousAiRequests: 2,
        },
      ],
    },
  },
  { id: 'goals', data: { rows: [{ count: 2, previousCount: 0 }] } },
])('analyzes real current or previous evidence even when headline metrics are zero', fact =>
  expect(isAiContextEmpty(context([fact]))).toBe(false),
);
