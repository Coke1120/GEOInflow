// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { aiTransaction } from './ai-db';
import {
  initializeRangeSources,
  rangeSourceHealth,
  readRangeSnapshots,
  refreshRangeSource,
  refreshRangeSources,
  restoreRangeSnapshot,
} from './crawler-ranges';
import { rangeBaselines } from '../crawlers/range-check';
import { rangeSources } from '../crawlers/range-sources';
import { parseLogInput } from '../ingest';

const enabled = process.env.LIEKAN_CRAWLER_TEST === '1';
const q = (sql: string, ...args: unknown[]) => aiTransaction(tx => tx.query(sql, ...args));
const source = 'openai-ads',
  baseline = rangeBaselines[source];
const response = (prefixes = baseline.content.prefixes) =>
  new Response(
    JSON.stringify({
      prefixes: prefixes.map(prefix => ({
        [prefix.includes(':') ? 'ipv6Prefix' : 'ipv4Prefix']: prefix,
      })),
    }),
    { headers: { 'Content-Type': 'application/json', ETag: 'fixture-v1' } },
  );
const fetcher = (prefixes?: string[]) => (async () => response(prefixes)) as typeof fetch;
const state = async () =>
  (await q('SELECT * FROM liekan_crawler_range_source WHERE source_id=$1', source))[0];
describe.skipIf(!enabled)('durable official source observations', () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL || 'http://invalid');
    if (
      url.hostname !== '127.0.0.1' ||
      url.port !== '15440' ||
      url.pathname !== '/liekan_crawler_acceptance'
    )
      throw new Error('Only isolated crawler DB15440 is allowed');
    await initializeRangeSources();
  });
  it('archives all reviewed sources idempotently and preserves legacy versions', async () => {
    await initializeRangeSources();
    const rows = await q('SELECT source_id,version FROM liekan_crawler_range_snapshot');
    for (const entry of rangeSources)
      expect(rows).toContainEqual({
        source_id: entry.id,
        version: rangeBaselines[entry.id].content.version,
      });
    expect(rows.filter(row => row.source_id.startsWith('legacy-bundled:'))).toHaveLength(6);
    expect(Object.keys(await readRangeSnapshots())).toHaveLength(26);
  });
  it('renews unchanged observations, captures per-log evidence and keeps content versions stable', async () => {
    await restoreRangeSnapshot(source, baseline.content.version);
    const before = await state();
    const oldLog = parseLogInput(
      {
        format: 'json',
        records: [
          {
            time: new Date().toISOString(),
            path: '/',
            ip: baseline.content.prefixes[0].split('/')[0],
            status: 200,
            userAgent: 'OAI-AdsBot/1.0',
          },
        ],
      },
      'example.com',
      'fixture-secret',
      undefined,
      await readRangeSnapshots(),
    ).records[0];
    expect(await refreshRangeSource(source, { force: true, fetcher: fetcher() })).toBe('unchanged');
    const after = await state();
    expect(after.current_version).toBe(before.current_version);
    expect(+after.current_observed_at).toBeGreaterThanOrEqual(+before.current_observed_at);
    expect(oldLog.verificationVersion).toBe(before.current_version);
    expect(oldLog.verificationObservedAt).toBe(before.current_observed_at.toISOString());
    expect(
      await refreshRangeSource(source, {
        force: true,
        fetcher: (async () => new Response(null, { status: 304 })) as typeof fetch,
      }),
    ).toBe('unchanged');
    expect((await state()).current_version).toBe(before.current_version);
  });
  it('preserves good evidence on failed updates and reports independent warning/stale health', async () => {
    const before = await state();
    for (const status of [403, 429, 403])
      expect(
        await refreshRangeSource(source, {
          force: true,
          fetcher: (async () => new Response(null, { status })) as typeof fetch,
        }),
      ).toBe('failed');
    const after = await state();
    expect(after.current_version).toBe(before.current_version);
    expect(+after.last_success_at).toBe(+before.last_success_at);
    expect(after.consecutive_failures).toBe(3);
    expect((await rangeSourceHealth()).find(row => row.id === source)).toMatchObject({
      status: 'warning',
      errorCode: 'http_403',
    });
    expect(
      (await rangeSourceHealth(Date.now() + 8 * 86400000)).find(row => row.id === source)?.status,
    ).toBe('stale');
    await refreshRangeSource(source, { force: true, fetcher: fetcher() });
  });
  it('quarantines large changes and only restores previously qualified contents with their own observation', async () => {
    await restoreRangeSnapshot(source, baseline.content.version);
    const before = await state();
    expect(
      await refreshRangeSource(source, { force: true, fetcher: fetcher(['8.8.8.0/24']) }),
    ).toBe('candidate');
    const candidate = await state();
    expect(candidate.current_version).toBe(before.current_version);
    expect(+candidate.current_observed_at).toBe(+before.current_observed_at);
    expect(candidate.candidate_version).not.toBe(before.current_version);
    await expect(restoreRangeSnapshot(source, candidate.candidate_version)).rejects.toThrow(
      'qualified',
    );
    expect(
      await refreshRangeSource(source, {
        force: true,
        fetcher: fetcher([...baseline.content.prefixes, '8.8.8.8/32']),
      }),
    ).toBe('ok');
    expect((await state()).current_version).not.toBe(before.current_version);
    const restored = await restoreRangeSnapshot(source, before.current_version);
    expect(restored.observedAt).toBe(before.current_observed_at.toISOString());
    expect((await state()).candidate_version).toBeNull();
  });
  it('fences late workers after lease expiry and permits recovery by a new worker', async () => {
    let release!: (response: Response) => void, started!: () => void;
    const entered = new Promise<void>(resolve => {
      started = resolve;
    });
    const pending = refreshRangeSource(source, {
      force: true,
      fetcher: (async () => {
        started();
        return new Promise<Response>(resolve => {
          release = resolve;
        });
      }) as typeof fetch,
    });
    await entered;
    expect(await refreshRangeSource(source, { force: true, fetcher: fetcher() })).toBe('skipped');
    await q(
      "UPDATE liekan_crawler_range_source SET lease_until=clock_timestamp()-interval '1 second' WHERE source_id=$1",
      source,
    );
    expect(await refreshRangeSource(source, { force: true, fetcher: fetcher() })).toBe('unchanged');
    const fresh = await state();
    release(response([...baseline.content.prefixes, '8.8.8.8/32']));
    expect(await pending).toBe('superseded');
    expect((await state()).current_version).toBe(fresh.current_version);
    expect(+(await state()).current_observed_at).toBe(+fresh.current_observed_at);
  });
  it('bounds the global refresh to two feeds and keeps concurrent schedulers out', async () => {
    await q(
      "UPDATE liekan_crawler_range_source SET next_check_at=clock_timestamp()-interval '1 hour',lease_until=NULL WHERE source_id<>'__refresh__'",
    );
    let active = 0,
      peak = 0,
      calls = 0;
    let release!: () => void, entered!: () => void;
    const barrier = new Promise<void>(resolve => {
      release = resolve;
    });
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    const fake = (async (url: string) => {
      active++;
      calls++;
      peak = Math.max(peak, active);
      entered();
      await barrier;
      const entry = rangeSources.find(source => source.url === url)!;
      const answer = response(rangeBaselines[entry.id].content.prefixes);
      active--;
      return answer;
    }) as typeof fetch;
    const running = refreshRangeSources({ fetcher: fake });
    await started;
    await refreshRangeSources({ fetcher: fake });
    release();
    await running;
    expect(calls).toBe(16);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
