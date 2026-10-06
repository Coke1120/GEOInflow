import assert from 'node:assert/strict';

/** Allocate an equal end bound inside the synthetic dataset's empty upper range. */
export function pairedCacheUrls(
  oldUrl: string,
  currentUrl: string,
  sequence: number,
  index: number,
) {
  assert(Number.isInteger(sequence) && sequence >= 0 && sequence < 64);
  assert(Number.isInteger(index) && index >= 0 && index < 200);
  const old = new URL(oldUrl), current = new URL(currentUrl);
  assert.equal(old.pathname, current.pathname, 'paired routes must match');
  assert.deepEqual(
    [...old.searchParams].sort(),
    [...current.searchParams].sort(),
    'paired business conditions must match',
  );
  const originalEnd = Number(old.searchParams.get('endAt'));
  assert(old.searchParams.has('endAt') && Number.isSafeInteger(originalEnd) && originalEnd > 0);
  // Cold, Redis, warm, manual-refresh and day-oracle samples use other end-bound intervals.
  const endAt = originalEnd + 600001 + sequence * 1000 + index;
  assert(Number.isSafeInteger(endAt));
  old.searchParams.set('endAt', String(endAt));
  current.searchParams.set('endAt', String(endAt));
  return { oldUrl: old.href, currentUrl: current.href, endAt };
}
