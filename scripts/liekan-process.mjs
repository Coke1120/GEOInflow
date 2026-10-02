import { spawn } from 'node:child_process';

// Child diagnostics can contain command arguments or credentials. Keep failures named.
export function assertProcessSuccess(result, name) {
  if (result.status !== 0 || result.signal || result.error) throw new Error(`${name} failed`);
}

export function createCancellation() {
  const controller = new AbortController();
  const handlers = new Map(
    ['SIGINT', 'SIGTERM'].map(signal => [
      signal,
      () => controller.abort(new Error(`Acceptance cancelled (${signal})`)),
    ]),
  );
  for (const [signal, handler] of handlers) process.on(signal, handler);
  return {
    signal: controller.signal,
    checkpoint: () => controller.signal.throwIfAborted(),
    dispose: () => {
      for (const [signal, handler] of handlers) process.off(signal, handler);
    },
    pause: ms =>
      new Promise((resolve, reject) => {
        if (controller.signal.aborted) return reject(controller.signal.reason);
        const abort = () => {
          clearTimeout(timer);
          reject(controller.signal.reason);
        };
        const timer = setTimeout(() => {
          controller.signal.removeEventListener('abort', abort);
          resolve();
        }, ms);
        controller.signal.addEventListener('abort', abort, { once: true });
      }),
  };
}

// Wait for close before releasing file descriptors or cleaning the child's resources.
export function runProcess(command, args, options = {}) {
  const { signal, ...spawnOptions } = options;
  if (signal?.aborted) return Promise.resolve({ status: null, error: signal.reason });
  return new Promise(resolve => {
    let child, error, killTimer;
    try {
      child = spawn(command, args, spawnOptions);
    } catch (failure) {
      resolve({ status: null, error: failure });
      return;
    }
    const abort = () => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
      killTimer.unref();
    };
    child.on('error', failure => {
      error = failure;
    });
    child.once('close', (status, childSignal) => {
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort);
      resolve({ status, signal: childSignal, error });
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
