'use client';

interface Flight<T> {
  controller: AbortController;
  promise: Promise<T>;
  consumers: number;
}

/** Shares overlapping GETs and bounds fan-out without retaining completed responses. */
export class RequestPool {
  private flights = new Map<string, Flight<unknown>>();
  private queue: Array<() => void> = [];
  private active = 0;
  constructor(private limit = 6) {}

  read<T>(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const aborted = () => new DOMException('请求已取消', 'AbortError');
    if (signal?.aborted) return Promise.reject(aborted());
    let flight = this.flights.get(key) as Flight<T> | undefined;
    if (!flight) {
      const controller = new AbortController();
      flight = { controller, promise: null, consumers: 0 };
      const current = flight;
      current.promise = new Promise<T>((resolve, reject) => {
        const run = () => {
          controller.signal.removeEventListener('abort', cancelQueued);
          if (controller.signal.aborted) {
            reject(aborted());
            return;
          }
          this.active++;
          Promise.resolve()
            .then(() => load(controller.signal))
            .then(resolve, reject)
            .finally(() => {
              this.active--;
              this.drain();
            });
        };
        const cancelQueued = () => {
          const index = this.queue.indexOf(run);
          if (index >= 0) this.queue.splice(index, 1);
          reject(aborted());
        };
        controller.signal.addEventListener('abort', cancelQueued, { once: true });
        this.queue.push(run);
      }).finally(() => {
        if (this.flights.get(key) === current) this.flights.delete(key);
      });
      this.flights.set(key, current);
      this.drain();
    }
    const current = flight;
    current.consumers++;
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const release = () => {
        if (finished) return false;
        finished = true;
        signal?.removeEventListener('abort', cancel);
        if (--current.consumers === 0) {
          if (this.flights.get(key) === current) this.flights.delete(key);
          current.controller.abort();
        }
        return true;
      };
      const cancel = () => {
        if (release()) reject(aborted());
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
  }

  private drain() {
    while (this.active < this.limit && this.queue.length) this.queue.shift()!();
  }
}
