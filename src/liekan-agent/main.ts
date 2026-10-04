import { readFile, mkdir, open } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Collector, atomicWrite, type AgentConfig } from './collector';

async function main() {
  const args = process.argv.slice(2);
  const option = (key: string) => args[args.indexOf(key) + 1];
  if (args[0] === 'pair') {
    const url = option('--url'),
      code = option('--code'),
      logPath = option('--log'),
      directory = option('--directory');
    if (
      !args.includes('--url') ||
      !args.includes('--code') ||
      !args.includes('--log') ||
      !args.includes('--directory')
    )
      throw new Error();
    const address = new URL(url);
    if (
      address.protocol !== 'https:' ||
      address.origin !== url ||
      !/^[A-Za-z0-9_-]{43}$/.test(code) ||
      !logPath.startsWith('/') ||
      !directory.startsWith('/')
    )
      throw new Error();
    const response = await fetch(`${url}/api/liekan/collectors/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error();
    const paired = await response.json();
    if (
      !/^[a-f0-9-]{36}$/.test(paired.sourceId) ||
      !/^[A-Za-z0-9_-]{43}$/.test(paired.token) ||
      !Number.isSafeInteger(paired.epoch)
    )
      throw new Error();
    const stateDir = resolve(directory, paired.sourceId);
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    const config: AgentConfig = {
      version: 1,
      url,
      sourceId: paired.sourceId,
      token: paired.token,
      epoch: paired.epoch,
      logPath,
      stateDir,
      key: randomBytes(32).toString('base64'),
    };
    await atomicWrite(join(stateDir, 'config.json'), JSON.stringify(config));
    console.log(paired.sourceId);
    return;
  }
  if (!['run', 'ready'].includes(args[0]) || !args.includes('--config')) throw new Error();
  const config = JSON.parse(await readFile(resolve(option('--config')), 'utf8'));
  if (args[0] === 'ready') {
    const pid = Number(option('--pid'));
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error();
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      process.kill(pid, 0);
      const ready = await readFile(join(config.stateDir, 'ready.json'), 'utf8')
        .then(JSON.parse)
        .catch(() => null);
      if (ready?.pid === pid && ready.sourceId === config.sourceId) {
        await delay(1000);
        process.kill(pid, 0);
        return;
      }
      await delay(200);
    }
    throw new Error();
  }
  const agent = new Collector(config);
  await agent.initialize();
  const log = await open(config.logPath, 'r');
  try {
    if (!(await log.stat()).isFile()) throw new Error();
  } finally {
    await log.close();
  }
  await atomicWrite(
    join(config.stateDir, 'ready.json'),
    JSON.stringify({ pid: process.pid, sourceId: config.sourceId }),
  );
  let stopped = false,
    active = !!agent.state.authorized,
    nextHealth = 0,
    nextFlush = 0,
    backoff = 1000;
  const stop = new AbortController();
  const shutdown = () => {
    stopped = true;
    stop.abort();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  try {
    while (!stopped) {
      if (Date.now() >= nextHealth) {
        active = await agent.synchronize();
        nextHealth = Date.now() + 60000;
      }
      if (active) {
        await agent.read();
        if (Date.now() >= nextFlush) {
          const success = await agent.flush();
          backoff = success ? 1000 : Math.min(backoff * 2, 60000);
          nextFlush = Date.now() + backoff;
        }
      }
      await delay(active ? 1000 : 5000, undefined, { signal: stop.signal }).catch(() => {});
    }
  } finally {
    await agent.close();
  }
}
main().catch(() => {
  console.error('采集器已停止：请检查配置、日志权限及服务连接。');
  process.exitCode = 1;
});
