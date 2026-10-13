import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./traffic-quality.integration.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function command('),
  end = source.indexOf('async function poll(');
assert.ok(start >= 0 && end > start, 'The actual integration lifecycle must be exercised');

function fixture(unsafe = false, inspectFails = false) {
  const resources = new Map(),
    handlers = new Map();
  let resolveExit;
  const exited = new Promise(resolve => (resolveExit = resolve));
  const spawn = (_binary, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = { resume() {} };
    child.kill = () => child.emit('close', 1);
    child.stdin = new EventEmitter();
    child.stdin.end = () =>
      setTimeout(
        () => {
          let output = '',
            code = 0;
          if (args[0] === 'network' && args[1] === 'create')
            resources.set('network:owned-network', 'owned');
          else if (args[1] === 'inspect') {
            const value = resources.get(`${args[0]}:${args.at(-1)}`);
            if (value && !inspectFails) output = value;
            else code = 1;
          } else if (args[1] === 'rm') resources.delete(`${args[0]}:${args.at(-1)}`);
          child.stdout.emit('data', Buffer.from(output));
          child.emit('close', code);
        },
        args[1] === 'create' ? 50 : 1,
      );
    return child;
  };
  let lifecycle = source.slice(start, end);
  if (unsafe) lifecycle = lifecycle.replace('activeCommands.add(operation);', '');
  const context = {
    spawn,
    Buffer,
    setTimeout,
    clearTimeout,
    console,
    process: {
      env: {},
      once: (signal, handler) => handlers.set(signal, handler),
      exit: resolveExit,
    },
  };
  vm.runInNewContext(
    `
    const root='/fixture',ownerLabel='owner',runId='owned';
    const names={application:'owned-app',database:'owned-db',volume:'owned-volume',network:'owned-network'};
    const activeCommands=new Set(),createdResources=new Set();let stopping=false,uncertainCreation=false,cleanupPromise;
    const ensure=(condition,message)=>{if(!condition)throw new Error(message)};
    ${lifecycle}
    globalThis.harness={command,cleanup};
  `,
    context,
  );
  return { resources, handlers, exited, harness: context.harness };
}

test('cancellation waits for in-flight creation before owned cleanup', async () => {
  const f = fixture();
  const creating = f.harness.command('docker', ['network', 'create', 'owned-network']);
  f.handlers.get('SIGTERM')();
  assert.equal(await f.exited, 130);
  await creating;
  assert.equal(f.resources.size, 0);
  await assert.rejects(
    f.harness.command('docker', ['volume', 'create', 'late-volume']),
    /cancelled/,
  );
});

test('the lifecycle regression fails when creation is removed from the wait set', async () => {
  const f = fixture(true);
  const creating = f.harness.command('docker', ['network', 'create', 'owned-network']);
  f.handlers.get('SIGTERM')();
  assert.equal(await f.exited, 130);
  await creating;
  assert.equal(f.resources.size, 1, 'Untracked creation demonstrably outlives cleanup');
});

test('inspection failure cannot confirm removal of a successfully created resource', async () => {
  const f = fixture(false, true);
  await f.harness.command('docker', ['network', 'create', 'owned-network']);
  await assert.rejects(f.harness.cleanup(), /cleanup could not be fully confirmed/);
  assert.equal(f.resources.size, 1);
});
