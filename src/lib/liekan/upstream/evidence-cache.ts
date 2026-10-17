import { QueryCache } from './query-cache';
import { processSingleton } from './process-singleton';
import { LiekanError } from './errors';
/** Consumer leases make cancellation local to a request until the last reader leaves. */
export class EvidenceCache {
  readonly cache = new QueryCache();
  private flights = new Map<
    string,
    { controller: AbortController; readers: number; done: boolean; promise: Promise<any> }
  >();
  read<T>(
    key: string,
    tags: string[],
    load: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(new LiekanError('统计读取已取消', 499));
    const cached = this.cache.getLocal<T>(key);
    if (cached) return Promise.resolve(cached.value);
    let flight = this.flights.get(key);
    if (!flight) {
      const controller = new AbortController();
      flight = { controller, readers: 0, done: false, promise: undefined };
      const owned = flight;
      flight.promise = Promise.resolve()
        .then(() => load(controller.signal))
        .then(value => {
          if (!controller.signal.aborted)
            this.cache.putLocal(
              key,
              { value, generatedAt: Date.now(), expiresAt: Date.now() + 5000, status: 'miss' },
              tags,
            );
          return value;
        })
        .finally(() => {
          owned.done = true;
          if (this.flights.get(key) === owned) this.flights.delete(key);
        });
      this.flights.set(key, flight);
    }
    const owned = flight;
    owned.readers++;
    return new Promise<T>((resolve, reject) => {
      let ended = false;
      const leave = () => {
        if (ended) return false;
        ended = true;
        signal?.removeEventListener('abort', abort);
        owned.readers--;
        if (!owned.readers && !owned.done) {
          if (this.flights.get(key) === owned) this.flights.delete(key);
          owned.controller.abort();
        }
        return true;
      };
      const abort = () => {
        if (leave()) reject(new LiekanError('统计读取已取消', 499));
      };
      signal?.addEventListener('abort', abort, { once: true });
      owned.promise.then(
        value => {
          if (leave()) resolve(value);
        },
        error => {
          if (leave()) reject(error);
        },
      );
      if (signal?.aborted) abort();
    });
  }
}
export const evidenceCache = processSingleton('traffic-evidence-cache', () => new EvidenceCache());
