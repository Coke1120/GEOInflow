import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertProcessSuccess, runProcess } from '../../../scripts/liekan-process.mjs';

describe('acceptance child processes', () => {
  it('accepts a completed child and rejects actual launch and signal failures', async () => {
    const success = await runProcess(process.execPath, ['-e', 'process.exit(0)']);
    expect(() => assertProcessSuccess(success, 'Fixture')).not.toThrow();
    const missing = await runProcess('/liekan-fixture-missing-executable', []);
    expect(() => assertProcessSuccess(missing, 'Fixture')).toThrow('Fixture failed');
    const killed = await runProcess(process.execPath, [
      '-e',
      "process.kill(process.pid, 'SIGTERM')",
    ]);
    expect(killed).toMatchObject({ status: null, signal: 'SIGTERM' });
    expect(() => assertProcessSuccess(killed, 'Fixture')).toThrow('Fixture failed');
  });
  it('terminates and reaps a running child when cancellation arrives', async () => {
    const helper = pathToFileURL(path.resolve('scripts/liekan-process.mjs')).href;
    const script = `import { createCancellation, runProcess } from ${JSON.stringify(helper)};
      const cancellation = createCancellation();
      const result = await runProcess(process.execPath, ['-e', "console.log('fixture-ready'); setInterval(() => {}, 1000)"], { signal: cancellation.signal, stdio: 'inherit' });
      cancellation.dispose(); console.log(JSON.stringify(result));`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const completed = new Promise(resolve =>
      child.once('close', (code, signal) => resolve({ code, signal })),
    );
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Helper child did not become ready')),
          10000,
        );
        child.once('error', reject);
        if (!child.stdout) throw new Error('Child stdout was not piped');
        child.stdout.on('data', chunk => {
          output += chunk.toString();
          if (output.includes('fixture-ready')) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
      child.kill('SIGTERM');
      expect(await completed).toEqual({ code: 0, signal: null });
      const result = output.trim().split('\n').at(-1);
      if (!result) throw new Error('Helper did not emit its child result');
      expect(JSON.parse(result)).toMatchObject({
        status: null,
        signal: 'SIGTERM',
      });
    } finally {
      child.kill('SIGKILL');
    }
  });
});
