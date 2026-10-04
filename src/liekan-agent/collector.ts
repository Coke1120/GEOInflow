import { randomUUID, createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { openSecret, sealSecret } from '../lib/liekan/log-ingestion/secrets';

export interface AgentConfig {
  version: 1;
  sourceId: string;
  token: string;
  url: string;
  logPath: string;
  stateDir: string;
  key: string;
  epoch: number;
}
interface Cursor {
  generation: string;
  offset: number;
  confirmed: number;
  prefix: string;
  prefixLength: number;
  discarding?: boolean;
}
interface State {
  version: 1;
  sourceId: string;
  epoch: number;
  active: string | null;
  files: Record<string, Cursor>;
  gap: boolean;
  rejected: number;
  authorized?: boolean;
  observedAt?: number;
}
interface Batch {
  id: string;
  epoch: number;
  key: string;
  generation: string;
  end: number;
  events: { generation: string; offset: number; line: string }[];
  createdAt: number;
}

export async function atomicWrite(path: string, value: string) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, 'wx', 0o600);
  try {
    await file.writeFile(value);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temp, path);
  const directory = await open(dirname(path), 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
export class Collector {
  state!: State;
  errorCode: 'none' | 'offline' | 'buffer-full' | 'rotation-gap' | 'unreadable' | 'format-error' =
    'none';
  private handles = new Map<string, Awaited<ReturnType<typeof open>>>();
  constructor(
    readonly config: AgentConfig,
    private fetcher: typeof fetch = fetch,
    readonly maxBufferBytes = 256 * 1024 * 1024,
  ) {
    const url = new URL(config.url);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new Error('采集地址无效');
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        config.sourceId,
      ) ||
      !/^([A-Za-z0-9_-]{43})$/.test(config.token) ||
      config.version !== 1 ||
      !Number.isSafeInteger(config.epoch) ||
      config.epoch < 1
    )
      throw new Error('采集配置无效');
    if (!config.logPath.startsWith('/') || !config.stateDir.startsWith('/'))
      throw new Error('需要本机绝对路径');
  }
  private get statePath() {
    return join(this.config.stateDir, 'cursor.json');
  }
  private get spoolPath() {
    return join(this.config.stateDir, 'spool');
  }
  private save() {
    return atomicWrite(this.statePath, JSON.stringify(this.state));
  }
  async initialize() {
    await mkdir(this.spoolPath, { recursive: true, mode: 0o700 });
    try {
      this.state = JSON.parse(await readFile(this.statePath, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('位点记录无效，已暂停读取');
      this.state = {
        version: 1,
        sourceId: this.config.sourceId,
        epoch: this.config.epoch,
        active: null,
        files: {},
        gap: false,
        rejected: 0,
      };
      await this.save();
    }
    if (this.state.version !== 1 || this.state.sourceId !== this.config.sourceId)
      throw new Error('位点与来源不匹配');
    if (!this.state.active) {
      const file = await open(this.config.logPath, 'r');
      try {
        const info = await file.stat();
        if (!info.isFile()) throw new Error('日志需要常规文件');
        const buffer = Buffer.alloc(Math.min(info.size, 4096));
        const prefix = await file.read(buffer, 0, buffer.length, 0);
        const key = `${info.dev}:${info.ino}`;
        this.state.active = key;
        this.state.files[key] = {
          generation: randomUUID(),
          offset: info.size,
          confirmed: info.size,
          prefix: createHash('sha256').update(buffer.subarray(0, prefix.bytesRead)).digest('hex'),
          prefixLength: prefix.bytesRead,
        };
        this.state.observedAt = Date.now();
        await this.save();
      } finally {
        await file.close();
      }
    }
    for (const name of await this.pendingFiles()) {
      const batch = await this.readBatch(name);
      if (batch.epoch > this.state.epoch) throw new Error('缓冲代次超出已确认配置');
      if (batch.epoch < this.state.epoch) {
        batch.epoch = this.state.epoch;
        await atomicWrite(
          join(this.spoolPath, name),
          sealSecret(JSON.stringify(batch), this.config.key, this.config.sourceId),
        );
      }
      const cursor = this.state.files[batch.key];
      // Previously spooled generations remain replayable after truncate or inode reuse.
      if (cursor?.generation === batch.generation)
        cursor.offset = Math.max(cursor.offset, batch.end);
    }
    await this.save();
  }
  private async pendingFiles() {
    const names = (await readdir(this.spoolPath)).filter(name =>
      /^[0-9a-f-]{36}\.batch$/.test(name),
    );
    const rows = await Promise.all(
      names.map(async name => ({ name, time: (await stat(join(this.spoolPath, name))).mtimeMs })),
    );
    return rows
      .sort((a, b) => a.time - b.time || a.name.localeCompare(b.name))
      .map(row => row.name);
  }
  private async readBatch(name: string): Promise<Batch> {
    const data = await readFile(join(this.spoolPath, name), 'utf8');
    return JSON.parse(openSecret(data, this.config.key, this.config.sourceId));
  }
  async health() {
    const files = await this.pendingFiles();
    let bytes = 0;
    for (const file of files) bytes += (await stat(join(this.spoolPath, file))).size;
    return {
      version: '1.0.0',
      pending: files.length,
      bytes,
      gap: this.state.gap,
      errorCode: this.errorCode,
    };
  }
  async synchronize() {
    try {
      const log = await open(this.config.logPath, 'r');
      try {
        if (!(await log.stat()).isFile()) throw new Error();
      } finally {
        await log.close();
      }
      const response = await this.fetcher(
        `${this.config.url}/api/liekan/log-sources/${this.config.sourceId}/heartbeat`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.config.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(await this.health()),
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) {
        this.errorCode = 'offline';
        if ([401, 403, 404, 409].includes(response.status)) {
          this.state.authorized = false;
          await this.save();
        }
        return !!this.state.authorized;
      }
      const remote = await response.json();
      if (!Number.isSafeInteger(remote.epoch) || remote.epoch < 1 || remote.version !== 1)
        throw new Error();
      if (remote.epoch !== this.state.epoch) {
        // A website reset explicitly fences the previous collection generation.
        this.state.epoch = remote.epoch;
        this.state.gap = true;
        for (const handle of this.handles.values()) await handle.close();
        this.handles.clear();
        // Retain file positions and replay buffered rows through the server's reset cutoff.
        // Fresh rows may already be buffered while this collector was disconnected.
        await this.save();
        for (const file of await this.pendingFiles()) {
          const batch = await this.readBatch(file);
          if (batch.epoch !== remote.epoch) {
            batch.epoch = remote.epoch;
            await atomicWrite(
              join(this.spoolPath, file),
              sealSecret(JSON.stringify(batch), this.config.key, this.config.sourceId),
            );
          }
        }
      }
      if (this.errorCode === 'offline') this.errorCode = 'none';
      this.state.authorized = remote.state === 'active';
      await this.save();
      return this.state.authorized;
    } catch {
      this.errorCode = 'offline';
      return !!this.state.authorized;
    }
  }
  async read() {
    const health = await this.health();
    if (health.bytes >= this.maxBufferBytes) {
      this.errorCode = 'buffer-full';
      return;
    }
    const pending = await this.pendingFiles();
    for (const name of pending)
      if (Date.now() - (await this.readBatch(name)).createdAt > 24 * 3600000) {
        this.errorCode = 'buffer-full';
        return;
      }
    let current: Awaited<ReturnType<typeof open>>;
    try {
      current = await open(this.config.logPath, 'r');
    } catch {
      this.errorCode = 'unreadable';
      return;
    }
    const info = await current.stat();
    if (!info.isFile()) {
      await current.close();
      this.errorCode = 'unreadable';
      return;
    }
    const observedAt = Date.now();
    const key = `${info.dev}:${info.ino}`;
    const previousActive = this.state.active;
    const changed = !!previousActive && previousActive !== key;
    const existing = this.state.files[key];
    if (!existing) {
      this.state.files[key] = {
        generation: randomUUID(),
        offset: this.state.active ? 0 : info.size,
        confirmed: this.state.active ? 0 : info.size,
        prefix: '',
        prefixLength: 0,
      };
    }
    this.state.active = key;
    if (this.handles.has(key)) await current.close();
    else this.handles.set(key, current);
    // Recover known inodes with either numeric or date suffixes. During rename/create,
    // discover recent intermediate generations that appeared between polling cycles.
    const base = basename(this.config.logPath);
    const names = (await readdir(dirname(this.config.logPath)))
      .filter(name => name === base || name.startsWith(`${base}.`) || name.startsWith(`${base}-`))
      .sort();
    if (names.length > 256) this.state.gap = true;
    const recovered = new Set<string>();
    for (const name of names.slice(-256)) {
      if (this.handles.size >= 32) {
        this.state.gap = true;
        break;
      }
      if (name.endsWith('.gz')) continue;
      const path = join(dirname(this.config.logPath), name);
      const rotated = await open(path, 'r').catch(() => null);
      if (!rotated) continue;
      const s = await rotated.stat(),
        fileKey = `${s.dev}:${s.ino}`;
      if (
        s.isFile() &&
        !this.state.files[fileKey] &&
        changed &&
        this.state.observedAt &&
        s.mtimeMs >= this.state.observedAt - 2000
      ) {
        this.state.files[fileKey] = {
          generation: randomUUID(),
          offset: 0,
          confirmed: 0,
          prefix: '',
          prefixLength: 0,
        };
      }
      if (s.isFile() && this.state.files[fileKey]) {
        recovered.add(fileKey);
        const cursor = this.state.files[fileKey];
        let changedPrefix = false;
        if (!this.handles.has(fileKey) && cursor.prefixLength && s.size <= cursor.offset) {
          const buffer = Buffer.alloc(cursor.prefixLength);
          const result = await rotated.read(buffer, 0, buffer.length, 0);
          changedPrefix =
            createHash('sha256').update(buffer.subarray(0, result.bytesRead)).digest('hex') !==
            cursor.prefix;
        }
        if (!this.handles.has(fileKey) && (s.size !== cursor.offset || changedPrefix))
          this.handles.set(fileKey, rotated);
        else await rotated.close();
      } else await rotated.close();
    }
    if (
      changed &&
      previousActive &&
      !recovered.has(previousActive) &&
      !this.handles.has(previousActive)
    )
      this.state.gap = true;
    for (const [fileKey, cursor] of Object.entries(this.state.files))
      if (cursor.offset > cursor.confirmed && !recovered.has(fileKey) && !this.handles.has(fileKey))
        this.state.gap = true;
    this.state.observedAt = observedAt;
    await this.save();
    for (const [fileKey, handle] of this.handles) {
      const cursor = this.state.files[fileKey],
        s = await handle.stat();
      const prefixLength = cursor.prefixLength || Math.min(s.size, 4096);
      const prefixBuffer = Buffer.alloc(prefixLength);
      const prefixRead = await handle.read(prefixBuffer, 0, prefixLength, 0);
      const prefix = createHash('sha256')
        .update(prefixBuffer.subarray(0, prefixRead.bytesRead))
        .digest('hex');
      if (s.size < cursor.offset || (cursor.prefixLength && prefix !== cursor.prefix)) {
        this.state.files[fileKey] = {
          generation: randomUUID(),
          offset: 0,
          confirmed: 0,
          prefix: '',
          prefixLength: 0,
        };
        this.state.gap = true;
        this.errorCode = 'rotation-gap';
        await this.save();
      }
      const live = this.state.files[fileKey];
      if (!live.prefixLength && prefixRead.bytesRead) {
        live.prefixLength = prefixRead.bytesRead;
        live.prefix = prefix;
        await this.save();
      }
      let position = live.offset;
      const events: Batch['events'] = [];
      let lineBytes: Buffer[] = [];
      let lineLength = 0;
      let oversize = !!live.discarding;
      let start = position;
      let eventBytes = 0;
      let consumed = 0;
      reading: while (events.length < 1000 && consumed < 4 * 1024 * 1024) {
        const buffer = Buffer.alloc(64 * 1024);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (!bytesRead) break;
        let sliceStart = 0;
        for (let i = 0; i < bytesRead; i++) {
          position++;
          consumed++;
          if (buffer[i] !== 10) continue;
          const part = buffer.subarray(sliceStart, i);
          lineLength += part.length;
          if (lineLength > 64 * 1024) oversize = true;
          if (!oversize) lineBytes.push(part);
          if (oversize) {
            this.state.rejected++;
            this.errorCode = 'format-error';
          } else {
            const line = Buffer.concat(lineBytes).toString('utf8').replace(/\r$/, '');
            if (line) {
              const event = { generation: live.generation, offset: start, line };
              const bytes = Buffer.byteLength(JSON.stringify(event));
              if (eventBytes + bytes > 4500000) break reading;
              events.push(event);
              eventBytes += bytes;
            }
          }
          start = position;
          lineBytes = [];
          lineLength = 0;
          oversize = false;
          sliceStart = i + 1;
          if (events.length >= 1000) break;
        }
        if (events.length < 1000 && sliceStart < bytesRead) {
          const part = buffer.subarray(sliceStart, bytesRead);
          lineLength += part.length;
          if (lineLength > 64 * 1024) {
            oversize = true;
            lineBytes = [];
          } else if (!oversize) lineBytes.push(part);
        }
      }
      if (oversize) start = position;
      if (events.length) {
        const batch: Batch = {
          id: randomUUID(),
          epoch: this.state.epoch,
          key: fileKey,
          generation: live.generation,
          end: start,
          events,
          createdAt: Date.now(),
        };
        const encrypted = sealSecret(JSON.stringify(batch), this.config.key, this.config.sourceId);
        if ((await this.health()).bytes + Buffer.byteLength(encrypted) > this.maxBufferBytes) {
          this.errorCode = 'buffer-full';
          return;
        }
        await atomicWrite(join(this.spoolPath, `${batch.id}.batch`), encrypted);
        live.offset = start;
        live.discarding = oversize;
        await this.save();
      } else if (start > live.offset) {
        live.offset = start;
        live.discarding = oversize;
        await this.save();
      }
      if (fileKey !== this.state.active && start >= s.size) {
        await handle.close();
        this.handles.delete(fileKey);
      }
    }
    if (Object.keys(this.state.files).length > 256) {
      const retained = new Set(
        (await Promise.all((await this.pendingFiles()).map(name => this.readBatch(name)))).map(
          batch => batch.key,
        ),
      );
      for (const fileKey of Object.keys(this.state.files))
        if (fileKey !== this.state.active && !this.handles.has(fileKey) && !retained.has(fileKey))
          delete this.state.files[fileKey];
      await this.save();
    }
    if (this.errorCode === 'buffer-full' || this.errorCode === 'unreadable')
      this.errorCode = 'none';
  }
  async flush() {
    for (const name of await this.pendingFiles()) {
      const batch = await this.readBatch(name);
      if (batch.epoch !== this.state.epoch) continue;
      let response: Response;
      try {
        response = await this.fetcher(
          `${this.config.url}/api/liekan/log-sources/${this.config.sourceId}/batches`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${this.config.token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              version: 1,
              batchId: batch.id,
              epoch: batch.epoch,
              events: batch.events,
            }),
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
          },
        );
      } catch {
        this.errorCode = 'offline';
        return false;
      }
      if (!response.ok) {
        this.errorCode = 'offline';
        return false;
      }
      const ack = await response.json();
      if (
        ack.requestBatchId !== batch.id ||
        ack.epoch !== batch.epoch ||
        ack.received !== batch.events.length ||
        !Number.isSafeInteger(ack.valid) ||
        !Number.isSafeInteger(ack.rejected) ||
        ack.valid < 0 ||
        ack.rejected < 0 ||
        ack.valid + ack.rejected !== batch.events.length
      ) {
        this.errorCode = 'offline';
        return false;
      }
      const cursor = this.state.files[batch.key];
      if (cursor?.generation === batch.generation)
        cursor.confirmed = Math.max(cursor.confirmed, batch.end);
      await this.save();
      await unlink(join(this.spoolPath, name));
    }
    if (this.errorCode === 'offline') this.errorCode = 'none';
    return true;
  }
  async close() {
    for (const file of this.handles.values()) await file.close();
    this.handles.clear();
  }
}
