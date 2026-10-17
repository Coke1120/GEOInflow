import { describe, it, expect } from 'vitest';
import { EvidenceCache } from './evidence-cache';
describe('C-03 shared query cancellation', () => {
  it('one cancelled reader leaves the other reader and shared computation alive', async () => {
    const cache = new EvidenceCache(),
      first = new AbortController(),
      second = new AbortController();
    let release: (value: number) => void;
    const loading = new Promise<number>(resolve => {
      release = resolve;
    });
    let shared: AbortSignal;
    const a = cache.read(
      'key',
      [],
      signal => {
        shared = signal;
        return loading;
      },
      first.signal,
    );
    const b = cache.read(
      'key',
      [],
      () => {
        throw new Error('duplicate computation');
      },
      second.signal,
    );
    const rejected = expect(a).rejects.toMatchObject({ status: 499 });
    await Promise.resolve();
    first.abort();
    await rejected;
    expect(shared.aborted).toBe(false);
    release(42);
    expect(await b).toBe(42);
  });
  it('cancels the computation when its final consumer leaves and never caches failure', async () => {
    const cache = new EvidenceCache(),
      request = new AbortController();
    let cancelled = false;
    const read = cache.read(
      'key',
      [],
      signal =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            cancelled = true;
            reject(new Error('cancelled'));
          });
        }),
      request.signal,
    );
    const rejection = expect(read).rejects.toMatchObject({ status: 499 });
    await Promise.resolve();
    request.abort();
    await rejection;
    expect(cancelled).toBe(true);
    expect(await cache.read('key', [], async () => 7)).toBe(7);
  });
});
