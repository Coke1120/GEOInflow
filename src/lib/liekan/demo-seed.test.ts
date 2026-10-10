// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DEMO_DOMAIN,
  DEFAULT_DEMO_ID,
  DEFAULT_DEMO_NAME,
  demoRecord,
  readDemoManifest,
  readDemoRecords,
  seedOfficialDemo,
} from '../../../scripts/liekan-demo.mjs';

describe('default official demo bundle', () => {
  it('contains every bundled record and valid anonymous session references', async () => {
    const manifest = await readDemoManifest();
    const counts = { session: 0, event: 0, log: 0, catalog: 0, report: 0 };
    let invalidReference = false;
    let futureTraffic = false;
    let visitorIdentifier = false;
    for await (const record of readDemoRecords()) {
      const kind = record[0];
      if (kind in counts) counts[kind] += 1;
      if (kind === 'event')
        invalidReference ||= record[1] < 0 || record[1] >= manifest.counts.session;
      if (kind === 'session') futureTraffic ||= record[10] > 0;
      if (kind === 'event') futureTraffic ||= record[3] > 0;
      if (kind === 'log') futureTraffic ||= record[1] > 0;
      if (kind !== 'metadata')
        visitorIdentifier ||= record.some(
          value =>
            typeof value === 'string' &&
            /\b\d{1,3}(?:\.\d{1,3}){3}\b|^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
              value,
            ),
        );
    }
    expect(counts).toEqual(manifest.counts);
    expect(counts).toEqual({ session: 150876, event: 599478, log: 80005, catalog: 18, report: 4 });
    expect(invalidReference).toBe(false);
    expect(futureTraffic).toBe(false);
    expect(visitorIdentifier).toBe(false);
  }, 30000);

  it('moves traffic dates to the installation window and keeps generated identities stable', () => {
    const row = [
      'session',
      23,
      'chrome',
      'Windows 11',
      'desktop',
      null,
      'zh-CN',
      'CN',
      'CN-31',
      '上海',
      -60000,
    ];
    const anchor = Date.parse('2026-10-10T03:00:00Z');
    const first = demoRecord('session', row, 0, anchor, 'temporary-test-key');
    const later = demoRecord('session', row, 0, anchor + 86400000, 'temporary-test-key');
    expect(first.time).toBe('2026-10-10T02:59:00.000Z');
    expect(later.id).toBe(first.id);
    expect(later.time).toBe('2026-10-11T02:59:00.000Z');
  });

  it('rejects unsafe schema names before executing any SQL', async () => {
    const query = vi.fn();
    await expect(
      seedOfficialDemo(
        { query },
        { secret: 'temporary-test-key', schema: 'public; DROP TABLE website' },
      ),
    ).rejects.toThrow('schema');
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses to mark a real website as a demo and rolls back', async () => {
    const query = vi.fn(async (sql: string) => ({
      rows: sql.includes('FOR UPDATE OF w')
        ? [
            {
              name: DEFAULT_DEMO_NAME,
              domain: DEFAULT_DEMO_DOMAIN,
              is_demo: false,
              deleted_at: null,
            },
          ]
        : [],
    }));
    await expect(seedOfficialDemo({ query }, { secret: 'temporary-test-key' })).rejects.toThrow(
      '其他网站',
    );
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(query.mock.calls.some(([sql]) => /INSERT|DELETE|UPDATE "user"/.test(sql))).toBe(false);
  });

  it('preserves an existing populated example on repeated initialization', async () => {
    const query = vi.fn(async (sql: string) => ({
      rows: sql.includes('FOR UPDATE OF w')
        ? [
            {
              name: DEFAULT_DEMO_NAME,
              domain: DEFAULT_DEMO_DOMAIN,
              is_demo: true,
              deleted_at: null,
            },
          ]
        : sql.includes('AS occupied')
          ? [{ occupied: true }]
          : [],
    }));
    await expect(seedOfficialDemo({ query }, { secret: 'temporary-test-key' })).resolves.toEqual({
      websiteId: DEFAULT_DEMO_ID,
      status: 'existing',
      inserted: false,
    });
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(query.mock.calls.some(([sql]) => /INSERT|DELETE|UPDATE "user"/.test(sql))).toBe(false);
  });

  it('keeps a deleted example deleted', async () => {
    const query = vi.fn(async (sql: string) => ({
      rows: sql.includes('FOR UPDATE OF w')
        ? [
            {
              name: DEFAULT_DEMO_NAME,
              domain: DEFAULT_DEMO_DOMAIN,
              is_demo: true,
              deleted_at: new Date(),
            },
          ]
        : [],
    }));
    await expect(seedOfficialDemo({ query }, { secret: 'temporary-test-key' })).resolves.toEqual({
      websiteId: DEFAULT_DEMO_ID,
      status: 'deleted',
      inserted: false,
    });
    expect(query.mock.calls.some(([sql]) => /INSERT|DELETE|UPDATE "user"/.test(sql))).toBe(false);
  });

  it('preserves a hard-deleted example using its durable analytics revision', async () => {
    const query = vi.fn(async (sql: string) => ({
      rows: sql.includes('AS previously_created') ? [{ previously_created: true }] : [],
    }));
    await expect(seedOfficialDemo({ query }, { secret: 'temporary-test-key' })).resolves.toEqual({
      websiteId: DEFAULT_DEMO_ID,
      status: 'deleted',
      inserted: false,
    });
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(query.mock.calls.some(([sql]) => /INSERT|DELETE|UPDATE "user"/.test(sql))).toBe(false);
  });
});
