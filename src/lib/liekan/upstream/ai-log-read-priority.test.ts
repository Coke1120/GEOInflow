// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { withLogStatisticsRead, waitForLogStatisticsReads } from './ai-log-read-priority';
import { withinQuerySnapshot } from './query-snapshot';

describe('AI preprocessing foreground priority', () => {
  it('releases failed reads and never counts private AI snapshot work as foreground', async () => {
    await expect(
      withLogStatisticsRead(async () => {
        throw new Error('read failed');
      }),
    ).rejects.toThrow('read failed');
    await waitForLogStatisticsReads(new AbortController().signal, Date.now() + 1000);
    let release!: () => void;
    const pending = new Promise<void>(resolve => {
      release = resolve;
    });
    const read = withinQuerySnapshot(
      { aiPrivate: true, $queryRawUnsafe: () => [], $executeRawUnsafe: () => 0 },
      () => withLogStatisticsRead(() => pending),
    );
    try {
      await waitForLogStatisticsReads(new AbortController().signal, Date.now() + 1000);
    } finally {
      release();
      await read;
    }
  });

  it('bounds a busy foreground wait and cancellation by the caller deadline', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => {
      release = resolve;
    });
    const read = withLogStatisticsRead(() => pending);
    try {
      const controller = new AbortController();
      const waiting = waitForLogStatisticsReads(controller.signal, Date.now() + 1000);
      controller.abort();
      await expect(waiting).rejects.toMatchObject({ code: 'cancelled' });
      await expect(
        waitForLogStatisticsReads(new AbortController().signal, Date.now() + 20),
      ).rejects.toMatchObject({ code: 'facts_timeout' });
    } finally {
      release();
      await read;
    }
    await waitForLogStatisticsReads(new AbortController().signal, Date.now() + 1000);
  });
});
