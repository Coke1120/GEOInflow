import { describe, expect, it } from 'vitest';
import { getQuerySnapshot, withinQuerySnapshot } from './query-snapshot';
const executor = () => ({ $executeRawUnsafe: async () => 0, $queryRawUnsafe: async () => [] });
describe('request-local query snapshots', () => {
  it('keeps independent concurrent exports isolated and releases the scope after completion', async () => {
    const first = executor(),
      second = executor();
    expect(getQuerySnapshot()).toBeUndefined();
    await Promise.all(
      [first, second].map(value =>
        withinQuerySnapshot(value, async () => {
          await Promise.resolve();
          expect(getQuerySnapshot()).toBe(value);
        }),
      ),
    );
    expect(getQuerySnapshot()).toBeUndefined();
  });
  it('releases the scope after a cancelled or failed query', async () => {
    await expect(
      withinQuerySnapshot(executor(), async () => {
        throw new Error('cancelled');
      }),
    ).rejects.toThrow('cancelled');
    expect(getQuerySnapshot()).toBeUndefined();
  });
});
