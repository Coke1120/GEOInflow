import { setImmediate } from 'node:timers';
import { AiError } from '../ai/error';
import { getQuerySnapshot } from './query-snapshot';

interface ReadState {
  readers: number;
  waiters: Set<() => void>;
}
const priority = Symbol.for('liekan.ai.log.read.priority');
const cache = globalThis as typeof globalThis & { [key: symbol]: ReadState | undefined };
const state = (cache[priority] ??= { readers: 0, waiters: new Set() });

// Count the full report and its individual queries so an early failure keeps pending reads visible.
export async function withLogStatisticsRead<T>(work: () => Promise<T>): Promise<T> {
  if (getQuerySnapshot()?.aiPrivate) return work();
  state.readers++;
  try {
    return await work();
  } finally {
    state.readers--;
    // Let the foreground promise finish before queued AI work starts on the next event-loop turn.
    if (!state.readers && state.waiters.size)
      setImmediate(() => {
        if (!state.readers) for (const notify of [...state.waiters]) notify();
      });
  }
}

function busyError() {
  return new AiError('facts_timeout', '统计服务繁忙，请稍后重试或缩小范围', 503);
}
export async function waitForLogStatisticsReads(signal: AbortSignal, deadline: number) {
  for (;;) {
    if (signal.aborted) throw new AiError('cancelled', 'AI 请求已取消', 409);
    if (Date.now() >= deadline) throw busyError();
    if (!state.readers) return;
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const finish = (error?: AiError) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        state.waiters.delete(notify);
        signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve();
      };
      const notify = () => {
        if (!state.readers) finish();
      };
      const abort = () => finish(new AiError('cancelled', 'AI 请求已取消', 409));
      const timer = setTimeout(() => finish(busyError()), Math.max(1, deadline - Date.now()));
      state.waiters.add(notify);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      else notify();
    });
  }
}
