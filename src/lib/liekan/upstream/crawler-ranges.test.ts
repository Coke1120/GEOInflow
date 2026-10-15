// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  rows: [] as any[],
  activeTransactions: 0,
  inspectReads: false,
  qualificationTransactions: [] as number[],
  rejectMaintenanceReads: false,
}));
vi.mock('./ai-db', () => ({
  aiTransaction: async (work: any, options: any = {}) => {
    if (options.readOnly && state.rejectMaintenanceReads)
      throw new Error('Maintenance transaction acquisition budget exhausted');
    state.activeTransactions++;
    try {
      return await work({
        execute: async () => 0,
        query: async (sql: string) => (sql.includes('SELECT r.*') ? state.rows : [{}]),
      });
    } finally {
      state.activeTransactions--;
    }
  },
}));
vi.mock('./server', () => ({ query: async () => state.rows }));
vi.mock('../crawlers/range-check', async importOriginal => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    isQualifiedRangeContent: (...args: any[]) => {
      if (state.inspectReads) state.qualificationTransactions.push(state.activeTransactions);
      return actual.isQualifiedRangeContent(...args);
    },
  };
});
import { readRangeSnapshots } from './crawler-ranges';
import { rangeBaselines } from '../crawlers/range-check';
const baseline = rangeBaselines['openai-gpt'];
function snapshot() {
  const { content } = baseline;
  return {
    source_id: content.sourceId,
    version: content.version,
    source_url: content.sourceUrl,
    parser_version: content.parserVersion,
    names: [...content.names],
    crawler_ids: [...content.crawlerIds],
    prefixes: [...content.prefixes],
    published_at: content.publishedAt,
    current_observed_at: baseline.observedAt,
  };
}
describe('ingestion official range snapshot reads', () => {
  beforeAll(async () => {
    state.rows = [snapshot()];
    await readRangeSnapshots();
  });
  beforeEach(() => {
    state.rows = [snapshot()];
    state.inspectReads = true;
    state.qualificationTransactions = [];
    state.rejectMaintenanceReads = false;
  });
  it('releases the database transaction before qualifying immutable source contents', async () => {
    const result = await readRangeSnapshots();
    expect(result.GPTBot.version).toBe(baseline.content.version);
    expect(state.qualificationTransactions).toEqual([0]);
    expect(Object.isFrozen(result.GPTBot.prefixes)).toBe(true);
  });
  it('reads the latest observation on every call and rejects changed or future evidence', async () => {
    const first = await readRangeSnapshots();
    const renewed = new Date(Date.now() - 1000).toISOString();
    state.rows[0].current_observed_at = renewed;
    expect((await readRangeSnapshots()).GPTBot.retrievedAt).toBe(renewed);
    expect(first.GPTBot.retrievedAt).toBe(new Date(baseline.observedAt).toISOString());
    state.rows[0] = { ...snapshot(), prefixes: ['10.0.0.0/8'] };
    expect(await readRangeSnapshots()).toEqual({});
    state.rows[0] = {
      ...snapshot(),
      current_observed_at: new Date(Date.now() + 60000).toISOString(),
    };
    expect(await readRangeSnapshots()).toEqual({});
    state.rows = [snapshot()];
    expect((await readRangeSnapshots()).GPTBot.version).toBe(baseline.content.version);
  });
  it('keeps ingestion reads available when the maintenance acquisition budget is exhausted', async () => {
    state.rejectMaintenanceReads = true;
    expect((await readRangeSnapshots()).GPTBot.version).toBe(baseline.content.version);
  });
});
