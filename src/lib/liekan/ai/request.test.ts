import { expect, it } from 'vitest';
import { hashAiRequest } from './request';
it('keeps retries stable across JSON property order, but distinguishes changed paid requests', () => {
  const a = { operation: 'test', target: 'abc', expectedConfigVersion: 1 };
  expect(hashAiRequest(a)).toBe(
    hashAiRequest({ expectedConfigVersion: 1, target: 'abc', operation: 'test' }),
  );
  expect(hashAiRequest({ ...a, expectedConfigVersion: 2 })).not.toBe(hashAiRequest(a));
  expect(hashAiRequest({ ...a, operation: 'analysis' })).not.toBe(hashAiRequest(a));
});
