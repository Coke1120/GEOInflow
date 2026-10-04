import { describe, expect, it, vi } from 'vitest';
import { RequestPool } from './request-pool';

describe('overlapping browser reads', () => {
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
    const values = await Promise.all(Array.from({ length: 256 }, (_, index) =>
      pool.read(`site-${index}`, async () => {
        peak = Math.max(peak, ++active);
        await new Promise(resolve => setTimeout(resolve, 0));
        active--;
        return index;
      }),
    ));
    expect(values).toEqual(Array.from({ length: 256 }, (_, index) => index));
    expect(peak).toBe(6);
  });

});
