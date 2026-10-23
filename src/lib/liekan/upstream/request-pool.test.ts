import { describe, expect, it, vi } from 'vitest';
import { RequestPool } from './request-pool';

describe('overlapping browser reads', () => {
  it('leaves a completed response signal intact for downstream consumers', async () => {
    const pool = new RequestPool();
    let shared!: AbortSignal;
    const onAbort = vi.fn();
    const response = await pool.read('completed-response', async signal => {
      shared = signal;
      signal.addEventListener('abort', onAbort);
      return new Response('analytics');
    });
    expect(await response.text()).toBe('analytics');
    expect(shared.aborted).toBe(false);
    expect(onAbort).not.toHaveBeenCalled();
  });
  it('shares a request and keeps it alive when one consumer leaves', async () => {
    const pool = new RequestPool(2);
    let finish!: (value: number) => void;
    let shared!: AbortSignal;
    const load = vi.fn((signal: AbortSignal) => {
      shared = signal;
      return new Promise<number>(resolve => {
        finish = resolve;
      });
    });
    const first = new AbortController();
    const a = pool.read('same', load, first.signal).catch(e => e.name);
    const b = pool.read('same', load);
    await Promise.resolve();
    first.abort();
    expect(await a).toBe('AbortError');
    expect(shared.aborted).toBe(false);
    finish(7);
    expect(await b).toBe(7);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('bounds distinct requests and removes cancelled queued reads', async () => {
    const pool = new RequestPool(1);
    let finish!: (value: number) => void;
    const a = pool.read(
      'active',
      () =>
        new Promise<number>(resolve => {
          finish = resolve;
        }),
    );
    const queued = vi.fn(async () => 2);
    const abort = new AbortController();
    const b = pool.read('queued', queued, abort.signal).catch(e => e.name);
    const c = pool.read('next', async () => 3);
    await Promise.resolve();
    expect(queued).not.toHaveBeenCalled();
    abort.abort();
    expect(await b).toBe('AbortError');
    finish(1);
    expect(await a).toBe(1);
    expect(await c).toBe(3);
    expect(queued).not.toHaveBeenCalled();
  });
  it('aborts the underlying fetch when its last consumer leaves', async () => {
    const pool = new RequestPool();
    let shared!: AbortSignal;
    const caller = new AbortController();
    const result = pool
      .read(
        'cancel',
        signal =>
          new Promise((_, reject) => {
            shared = signal;
            signal.addEventListener('abort', () =>
              reject(new DOMException('cancelled', 'AbortError')),
            );
          }),
        caller.signal,
      )
      .catch(e => e.name);
    await Promise.resolve();
    caller.abort();
    expect(await result).toBe('AbortError');
    expect(shared.aborted).toBe(true);
  });
  it('queues large dashboards without rejecting reads and limits active network requests', async () => {
    const pool = new RequestPool(6);
    let active = 0;
    let peak = 0;
    const values = await Promise.all(
      Array.from({ length: 256 }, (_, index) =>
        pool.read(`site-${index}`, async () => {
          peak = Math.max(peak, ++active);
          await new Promise(resolve => setTimeout(resolve, 0));
          active--;
          return index;
        }),
      ),
    );
    expect(values).toEqual(Array.from({ length: 256 }, (_, index) => index));
    expect(peak).toBe(6);
  });
});
it('holds speculative reads while visible reads are loading and admits only one prefetch', async () => {
  const pool = new RequestPool(6);
  const finish: Array<(value: number) => void> = [];
  const visible = pool.read('visible', () => new Promise<number>(resolve => finish.push(resolve)));
  const speculative = vi.fn(() => new Promise<number>(resolve => finish.push(resolve)));
  const a = pool.read('warm-a', speculative, undefined, 'prefetch');
  const b = pool.read('warm-b', speculative, undefined, 'prefetch');
  await Promise.resolve();
  expect(speculative).not.toHaveBeenCalled();
  finish[0](1);
  await visible;
  await Promise.resolve();
  await Promise.resolve();
  expect(speculative).toHaveBeenCalledTimes(1);
  finish[1](2);
  await a;
  await Promise.resolve();
  await Promise.resolve();
  expect(speculative).toHaveBeenCalledTimes(2);
  finish[2](3);
  expect(await b).toBe(3);
});
it('promotes a queued prefetch when a visible consumer needs the same request', async () => {
  const pool = new RequestPool(1);
  let finish!: (value: number) => void;
  const busy = pool.read(
    'busy',
    () =>
      new Promise<number>(resolve => {
        finish = resolve;
      }),
  );
  const order: string[] = [];
  const warm = pool.read(
    'same',
    async () => {
      order.push('same');
      return 7;
    },
    undefined,
    'prefetch',
  );
  const other = pool.read(
    'other',
    async () => {
      order.push('other');
      return 8;
    },
    undefined,
    'prefetch',
  );
  const visible = pool.read('same', async () => 99);
  await Promise.resolve();
  finish(0);
  await busy;
  expect(await visible).toBe(7);
  expect(await warm).toBe(7);
  expect(await other).toBe(8);
  expect(order).toEqual(['same', 'other']);
});
