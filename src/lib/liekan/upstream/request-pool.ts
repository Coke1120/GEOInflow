'use client';

export type RequestPriority = 'foreground' | 'prefetch';
const promotions = new WeakMap<AbortSignal, Set<() => void>>();
export function promoteRequestConsumer(signal: AbortSignal) {
  for (const promote of promotions.get(signal) || []) promote();
}
interface Flight<T> {
  controller: AbortController;
  promise: Promise<T>;
  consumers: number;
  priority: RequestPriority;
  started: boolean;
  run: () => void;
}

/** Shares overlapping GETs; visible work starts before speculative work. */
export class RequestPool {
  private flights = new Map<string, Flight<unknown>>();
  private queue: Flight<unknown>[] = [];
  private active = 0;
  private foreground = 0;
  private prefetch = 0;
  constructor(private limit = 6) {}

  read<T>(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
    priority: RequestPriority = 'foreground',
  ): Promise<T> {
    const aborted = () => new DOMException('请求已取消', 'AbortError');
    if (signal?.aborted) return Promise.reject(aborted());
    let flight = this.flights.get(key) as Flight<T> | undefined;
    if (!flight) {
      const controller = new AbortController();
      flight = { controller, promise: null, consumers: 0, priority, started: false, run: null };
      const current = flight;
      current.promise = new Promise<T>((resolve, reject) => {
        current.run = () => {
          controller.signal.removeEventListener('abort', cancelQueued);
          if (controller.signal.aborted) {
            reject(aborted());
            return;
          }
          current.started = true;
          this.active++;
          const startingPriority = current.priority;
          if (startingPriority === 'prefetch') this.prefetch++;
          else this.foreground++;
          Promise.resolve()
            .then(() => load(controller.signal))
            .then(resolve, reject)
            .finally(() => {
              this.active--;
              if (startingPriority === 'prefetch') this.prefetch--;
              else this.foreground--;
              this.drain();
            });
        };
        const cancelQueued = () => {
          const index = this.queue.indexOf(current);
          if (index >= 0) this.queue.splice(index, 1);
          reject(aborted());
          this.drain();
        };
        controller.signal.addEventListener('abort', cancelQueued, { once: true });
        this.queue.push(current);
      }).finally(() => {
        if (this.flights.get(key) === current) this.flights.delete(key);
      });
      this.flights.set(key, current);
    } else if (priority === 'foreground' && !flight.started) {
      flight.priority = 'foreground';
    }
    const current = flight;
    const promote = () => {
      if (!current.started) {
        current.priority = 'foreground';
        this.drain();
      }
    };
    if (signal) {
      if (!promotions.has(signal)) promotions.set(signal, new Set());
      promotions.get(signal).add(promote);
    }
    current.consumers++;
    const result = new Promise<T>((resolve, reject) => {
      let finished = false;
      const release = (cancelled = false) => {
        if (finished) return false;
        finished = true;
        signal?.removeEventListener('abort', cancel);
        if (signal) promotions.get(signal)?.delete(promote);
        if (--current.consumers === 0) {
          if (this.flights.get(key) === current) this.flights.delete(key);
          if (cancelled) current.controller.abort();
        }
        return true;
      };
      const cancel = () => {
        if (release(true)) reject(aborted());
      };
      signal?.addEventListener('abort', cancel, { once: true });
      current.promise.then(
        value => {
          if (release()) resolve(value);
        },
        error => {
          if (release()) reject(error);
        },
      );
    });
    this.drain();
    return result;
  }

  private drain() {
    while (this.active < this.limit && this.queue.length) {
      const foreground = this.queue.findIndex(flight => flight.priority === 'foreground');
      if (foreground >= 0) this.queue.splice(foreground, 1)[0].run();
      else if (!this.foreground && !this.prefetch) this.queue.shift()!.run();
      else return;
    }
  }
}

/** Native compatibility pages and product pages share the browser's read budget. */
export const browserReads = new RequestPool();
