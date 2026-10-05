import {
  mkdtemp,
  readFile,
  readdir,
  writeFile,
  appendFile,
  rename,
  rm,
  open,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { Collector, atomicWrite } from './collector';
import { openSecret, sealSecret } from '../lib/liekan/log-ingestion/secrets';
const token = 'a'.repeat(43);
const sourceId = '8afda83d-5c81-4c56-82e1-ff923b5c3ee0';
const line = '192.0.2.5 - - [04/Oct/2026:10:00:01 +0800] "GET / HTTP/1.1" 200 5 "-" "GPTBot"\n';
async function fixture(fetcher: typeof fetch) {
  const dir = await mkdtemp(join(tmpdir(), 'liekan-agent-test-'));
  const config = {
    version: 1 as const,
    sourceId,
    token,
    url: 'https://logs.example',
    logPath: join(dir, 'access.log'),
    stateDir: join(dir, 'state'),
    key: Buffer.alloc(32, 3).toString('base64'),
    epoch: 1,
  };
  await writeFile(config.logPath, '');
  const agent = new Collector(config, fetcher);
  await agent.initialize();
  await agent.read();
  return {
    agent,
    config,
    dir,
    cleanup: async () => {
      await agent.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
describe('durable website collector', () => {
  it('does not recover a stored inode from an unrelated sibling filename after restart', async () => {
    const sent: any[] = [];
    const fetcher = (async (_url, init) => {
      const body = JSON.parse(String(init.body));
      sent.push(...body.events);
      return Response.json({
        requestBatchId: body.batchId,
        epoch: 1,
        received: body.events.length,
        valid: body.events.length,
        rejected: 0,
      });
    }) as typeof fetch;
    const f = await fixture(fetcher);
    let restarted: Collector | undefined;
    try {
      await appendFile(f.config.logPath, line);
      await f.agent.read();
      await f.agent.flush();
      await rename(f.config.logPath, `${f.config.logPath}.other-site`);
      await writeFile(f.config.logPath, '');
      await f.agent.close();
      await appendFile(`${f.config.logPath}.other-site`, line.replace('GET /', 'GET /foreign'));
      restarted = new Collector(f.config, fetcher);
      await restarted.initialize();
      await restarted.read();
      await restarted.flush();
      expect(sent).toHaveLength(1);
      expect(sent.some(row => row.line.includes('/foreign'))).toBe(false);
    } finally {
      await restarted?.close();
      await f.cleanup();
    }
  });
  it.each([401, 403, 404])(
    'stops reading immediately after an upload denial (%i), retaining the buffer',
    async status => {
      const f = await fixture((async url =>
        String(url).endsWith('/heartbeat')
          ? Response.json({ version: 1, epoch: 1, state: 'active' })
          : Response.json({}, { status })) as typeof fetch);
      try {
        expect(await f.agent.synchronize()).toBe(true);
        await appendFile(f.config.logPath, line);
        await f.agent.read();
        expect(await f.agent.flush()).toBe(false);
        expect(f.agent.state.authorized).toBe(false);
        await appendFile(f.config.logPath, line);
        await f.agent.read();
        expect((await f.agent.health()).pending).toBe(1);
        expect(
          JSON.parse(await readFile(join(f.config.stateDir, 'cursor.json'), 'utf8')).authorized,
        ).toBe(false);
      } finally {
        await f.cleanup();
      }
    },
  );
  it('synchronizes a reset rejection promptly and replays buffered rows in the new epoch', async () => {
    let epoch = 1;
    const sent: any[] = [];
    const f = await fixture((async (url, init) => {
      if (String(url).endsWith('/heartbeat'))
        return Response.json({ version: 1, epoch, state: 'active' });
      const body = JSON.parse(String(init.body));
      sent.push(body);
      if (body.epoch !== epoch) return Response.json({}, { status: 409 });
      return Response.json({
        requestBatchId: body.batchId,
        epoch,
        received: body.events.length,
        valid: body.events.length,
        rejected: 0,
      });
    }) as typeof fetch);
    try {
      await f.agent.synchronize();
      await appendFile(f.config.logPath, line);
      await f.agent.read();
      epoch = 2;
      expect(await f.agent.flush()).toBe(false);
      expect(f.agent.state.epoch).toBe(2);
      expect((await f.agent.health()).pending).toBe(1);
      expect(await f.agent.flush()).toBe(true);
      expect(sent[0].batchId).toBe(sent[1].batchId);
      expect(sent[1].epoch).toBe(2);
      expect((await f.agent.health()).pending).toBe(0);
    } finally {
      await f.cleanup();
    }
  });
  it('discovers numeric and date rotations without importing unrelated sibling logs', async () => {
    const sent: any[] = [];
    const f = await fixture((async (_url, init) => {
      const body = JSON.parse(String(init.body));
      sent.push(...body.events);
      return Response.json({
        requestBatchId: body.batchId,
        epoch: body.epoch,
        received: body.events.length,
        valid: body.events.length,
        rejected: 0,
      });
    }) as typeof fetch);
    try {
      await writeFile(`${f.config.logPath}.other-site`, line.replace('GET /', 'GET /foreign-site'));
      await rename(f.config.logPath, `${f.config.logPath}.1`);
      await writeFile(f.config.logPath, line.replace('GET /', 'GET /numeric'));
      await rename(f.config.logPath, `${f.config.logPath}.2`);
      await writeFile(f.config.logPath, line.replace('GET /', 'GET /dated'));
      await rename(f.config.logPath, `${f.config.logPath}-20261004`);
      await writeFile(f.config.logPath, line.replace('GET /', 'GET /current'));
      await f.agent.read();
      await f.agent.flush();
      expect(sent).toHaveLength(3);
      expect(sent.map(event => event.line)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('/numeric'),
          expect.stringContaining('/dated'),
          expect.stringContaining('/current'),
        ]),
      );
      expect(sent.every(event => !event.line.includes('/foreign-site'))).toBe(true);
    } finally {
      await f.cleanup();
    }
  });
  it('rejects FIFO rotation candidates without blocking the current regular log', async () => {
    const f = await fixture((async () => {
      throw new Error('offline');
    }) as typeof fetch);
    const fifo = `${f.config.logPath}.1`;
    try {
      execFileSync('mkfifo', [fifo]);
      await appendFile(f.config.logPath, line);
      const reading = f.agent.read();
      const completed = await Promise.race([
        reading.then(() => true),
        delay(750).then(() => false),
      ]);
      const writer = await open(fifo, constants.O_RDWR | constants.O_NONBLOCK);
      await reading;
      await writer.close();
      expect(completed).toBe(true);
      expect((await f.agent.health()).pending).toBe(1);
    } finally {
      await f.cleanup();
    }
  });
  it('detects a rewritten shorter known rotated inode after restart', async () => {
    const events: any[] = [];
    const fetcher = (async (_url, init) => {
      const body = JSON.parse(String(init.body));
      events.push(...body.events);
      return Response.json({
        requestBatchId: body.batchId,
        epoch: 1,
        received: body.events.length,
        valid: body.events.length,
        rejected: 0,
      });
    }) as typeof fetch;
    const f = await fixture(fetcher);
    try {
      await appendFile(f.config.logPath, line.replace('GET /', 'GET /a-long-original-path'));
      await f.agent.read();
      await f.agent.flush();
      await f.agent.close();
      await rename(f.config.logPath, `${f.config.logPath}.001`);
      await writeFile(`${f.config.logPath}.001`, line);
      await writeFile(f.config.logPath, line.replace('GET /', 'GET /current'));
      const restarted = new Collector(f.config, fetcher);
      await restarted.initialize();
      await restarted.read();
      await restarted.flush();
      expect(events).toHaveLength(3);
      expect(restarted.state.gap).toBe(true);
      await restarted.close();
    } finally {
      await f.cleanup();
    }
  });
  // Forty durable rotations exceed the 32-file recovery limit and require repeated filesystem syncs.
  it('does not let fully confirmed historical rotations consume the unread-file recovery limit', async () => {
    const sent: any[] = [];
    const fetcher = (async (_url, init) => {
      const body = JSON.parse(String(init.body));
      sent.push(...body.events);
      return Response.json({
        requestBatchId: body.batchId,
        epoch: 1,
        received: body.events.length,
        valid: body.events.length,
        rejected: 0,
      });
    }) as typeof fetch;
    const f = await fixture(fetcher);
    try {
      for (let i = 0; i < 40; i++) {
        await appendFile(f.config.logPath, line);
        await f.agent.read();
        await f.agent.flush();
        await rename(f.config.logPath, `${f.config.logPath}.${String(i).padStart(3, '0')}`);
        await writeFile(f.config.logPath, '');
      }
      await f.agent.read();
      await f.agent.close();
      await appendFile(f.config.logPath, line.replace('GET /', 'GET /known'));
      await rename(f.config.logPath, `${f.config.logPath}.998`);
      await writeFile(f.config.logPath, line.replace('GET /', 'GET /intermediate'));
      await rename(f.config.logPath, `${f.config.logPath}.999`);
      await writeFile(f.config.logPath, line.replace('GET /', 'GET /current'));
      const restarted = new Collector(f.config, fetcher);
      await restarted.initialize();
      await restarted.read();
      await restarted.flush();
      expect(sent).toHaveLength(43);
      expect(restarted.state.gap).toBe(false);
      await restarted.close();
    } finally {
      await f.cleanup();
    }
  }, 15000);
  it('keeps authorized offline buffering across restart and recovers intermediate rotations', async () => {
    let offline = false;
    const events: any[] = [];
    const fetcher = (async (url, init) => {
      if (offline) throw new Error('offline');
      const body = JSON.parse(String(init.body));
      if (String(url).endsWith('/heartbeat'))
        return Response.json({ version: 1, epoch: 1, state: 'active' });
      events.push(...body.events);
      return Response.json({
        requestBatchId: body.batchId,
        epoch: 1,
        received: body.events.length,
        valid: body.events.length,
        rejected: 0,
      });
    }) as typeof fetch;
    const f = await fixture(fetcher);
    try {
      expect(await f.agent.synchronize()).toBe(true);
      offline = true;
      expect(await f.agent.synchronize()).toBe(true);
      await appendFile(f.config.logPath, line);
      await rename(f.config.logPath, `${f.config.logPath}.1`);
      await writeFile(f.config.logPath, line.replace('GET /', 'GET /middle'));
      await rename(f.config.logPath, `${f.config.logPath}.2`);
      await writeFile(f.config.logPath, line.replace('GET /', 'GET /current'));
      await f.agent.close();
      const restarted = new Collector(f.config, fetcher);
      await restarted.initialize();
      expect(await restarted.synchronize()).toBe(true);
      await restarted.read();
      expect((await restarted.health()).pending).toBe(3);
      offline = false;
      await restarted.flush();
      expect(events).toHaveLength(3);
      await restarted.close();
    } finally {
      await f.cleanup();
    }
  });
  it('stops authorization after an authenticated pause or credential rejection', async () => {
    let state = 'active',
      status = 200;
    const f = await fixture((async () =>
      Response.json({ version: 1, epoch: 1, state }, { status })) as typeof fetch);
    try {
      expect(await f.agent.synchronize()).toBe(true);
      state = 'paused';
      expect(await f.agent.synchronize()).toBe(false);
      state = 'active';
      expect(await f.agent.synchronize()).toBe(true);
      status = 401;
      expect(await f.agent.synchronize()).toBe(false);
      expect(f.agent.state.authorized).toBe(false);
    } finally {
      await f.cleanup();
    }
  });
  it('recovers a known unread generation with a logrotate date suffix after restart', async () => {
    const f = await fixture((async () => {
      throw new Error();
    }) as typeof fetch);
    try {
      await appendFile(f.config.logPath, line);
      await f.agent.close();
      await rename(f.config.logPath, `${f.config.logPath}-20261004`);
      await writeFile(f.config.logPath, line.replace('GET /', 'GET /next'));
      const restarted = new Collector(f.config);
      await restarted.initialize();
      await restarted.read();
      expect((await restarted.health()).pending).toBe(2);
      await restarted.close();
    } finally {
      await f.cleanup();
    }
  });
  it('replays buffered post-reset rows with the confirmed epoch, including interrupted migration', async () => {
    const sent: any[] = [];
    const f = await fixture((async (url, init) => {
      if (String(url).endsWith('/heartbeat'))
        return Response.json({ version: 1, epoch: 2, state: 'active' });
      const body = JSON.parse(String(init.body));
      sent.push(body);
      return Response.json({
        requestBatchId: body.batchId,
        epoch: body.epoch,
        received: body.events.length,
        valid: body.events.length,
        rejected: 0,
      });
    }) as typeof fetch);
    try {
      await appendFile(f.config.logPath, line);
      await f.agent.read();
      await appendFile(f.config.logPath, line.replace('GET /', 'GET /after-reset'));
      expect(await f.agent.synchronize()).toBe(true);
      await f.agent.read();
      const spool = join(f.config.stateDir, 'spool');
      const file = join(spool, (await readdir(spool))[0]);
      const old = JSON.parse(openSecret(await readFile(file, 'utf8'), f.config.key, sourceId));
      old.epoch = 1;
      await atomicWrite(file, sealSecret(JSON.stringify(old), f.config.key, sourceId));
      await f.agent.close();
      const restarted = new Collector(f.config, f.agent['fetcher']);
      await restarted.initialize();
      await restarted.flush();
      expect(sent.flatMap(batch => batch.events)).toHaveLength(2);
      expect(sent.every(batch => batch.epoch === 2)).toBe(true);
      expect((await restarted.health()).pending).toBe(0);
      await restarted.close();
    } finally {
      await f.cleanup();
    }
  });
  it('keeps encrypted batches after lost ACK and replays the same IDs on restart', async () => {
    const sent: any[] = [];
    let fail = true;
    const f = await fixture((async (_url, init) => {
      sent.push(JSON.parse(String(init.body)));
      if (fail) throw new Error('offline');
      return Response.json({
        batchId: 'saved',
        requestBatchId: JSON.parse(String(init.body)).batchId,
        epoch: 1,
        received: 1,
        valid: 1,
        rejected: 0,
      });
    }) as typeof fetch);
    try {
      await appendFile(f.config.logPath, line);
      await f.agent.read();
      expect((await f.agent.health()).pending).toBe(1);
      const encrypted = await readFile(
        join(f.config.stateDir, 'spool', (await readdir(join(f.config.stateDir, 'spool')))[0]),
        'utf8',
      );
      expect(encrypted).not.toContain('192.0.2.5');
      await f.agent.flush();
      await f.agent.close();
      const restarted = new Collector(f.config, (async (_url, init) => {
        sent.push(JSON.parse(String(init.body)));
        return Response.json({
          batchId: 'saved',
          requestBatchId: JSON.parse(String(init.body)).batchId,
          epoch: 1,
          received: 1,
          valid: 1,
          rejected: 0,
        });
      }) as typeof fetch);
      await restarted.initialize();
      fail = false;
      await restarted.flush();
      await restarted.read();
      expect(sent[0]).toEqual(sent[1]);
      expect((await restarted.health()).pending).toBe(0);
      await restarted.close();
    } finally {
      await f.cleanup();
    }
  });
  it('reads both sides of rename/create and uses distinct file generations', async () => {
    const sent: any[] = [];
    const f = await fixture((async (_url, init) => {
      sent.push(JSON.parse(String(init.body)));
      return Response.json({
        batchId: 'saved',
        requestBatchId: JSON.parse(String(init.body)).batchId,
        epoch: 1,
        received: 1,
        valid: 1,
        rejected: 0,
      });
    }) as typeof fetch);
    try {
      await appendFile(f.config.logPath, line);
      await f.agent.read();
      await rename(f.config.logPath, `${f.config.logPath}.1`);
      await writeFile(f.config.logPath, line);
      await f.agent.read();
      await f.agent.flush();
      const events = sent.flatMap(b => b.events);
      expect(events).toHaveLength(2);
      expect(events[0].generation).not.toBe(events[1].generation);
    } finally {
      await f.cleanup();
    }
  });
  it('waits for complete lines and pauses without dropping a full buffer', async () => {
    const f = await fixture((async () => {
      throw new Error('offline');
    }) as typeof fetch);
    try {
      await appendFile(f.config.logPath, line.slice(0, -1));
      await f.agent.read();
      expect((await f.agent.health()).pending).toBe(0);
      await appendFile(f.config.logPath, '\n');
      await f.agent.read();
      expect((await f.agent.health()).pending).toBe(1);
      const limited = new Collector(
        f.config,
        (async () => {
          throw new Error();
        }) as typeof fetch,
        1,
      );
      await limited.initialize();
      await appendFile(f.config.logPath, line);
      await limited.read();
      expect((await limited.health()).pending).toBe(1);
      expect(limited.errorCode).toBe('buffer-full');
      await limited.close();
    } finally {
      await f.cleanup();
    }
  });
  it('replays an offline old generation after truncate and restart', async () => {
    const sent: any[] = [];
    const fetcher = (async (_url, init) => {
      const body = JSON.parse(String(init.body));
      sent.push(body);
      return Response.json({
        batchId: 'saved',
        requestBatchId: body.batchId,
        epoch: body.epoch,
        received: body.events.length,
        valid: body.events.length,
        rejected: 0,
      });
    }) as typeof fetch;
    const f = await fixture(fetcher);
    try {
      await appendFile(f.config.logPath, line);
      await f.agent.read();
      await writeFile(f.config.logPath, line.replace('GET /', 'GET /new'));
      await f.agent.read();
      expect(f.agent.state.gap).toBe(true);
      await f.agent.close();
      const restarted = new Collector(f.config, fetcher);
      await restarted.initialize();
      await restarted.flush();
      expect(sent.flatMap(batch => batch.events)).toHaveLength(2);
      expect(new Set(sent.flatMap(batch => batch.events.map(event => event.generation))).size).toBe(
        2,
      );
      await restarted.close();
    } finally {
      await f.cleanup();
    }
  });
  it('retains the encrypted batch when an ACK refers to a different request', async () => {
    const f = await fixture((async () =>
      Response.json({
        batchId: 'saved',
        requestBatchId: 'wrong',
        epoch: 1,
        received: 1,
        valid: 1,
        rejected: 0,
      })) as typeof fetch);
    try {
      await appendFile(f.config.logPath, line);
      await f.agent.read();
      expect(await f.agent.flush()).toBe(false);
      expect((await f.agent.health()).pending).toBe(1);
    } finally {
      await f.cleanup();
    }
  });
});
