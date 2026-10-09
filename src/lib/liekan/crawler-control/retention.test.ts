// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { LiekanError } from '../upstream/errors';
const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  execute: vi.fn(async (_sql: string, ..._args: unknown[]) => 1),
  query: vi.fn(),
}));
vi.mock('../upstream/crawler-access', () => ({
  authorizeCrawler: mocks.authorize,
  crawlerTransaction: async (work: any) => work({ execute: mocks.execute, query: mocks.query }),
}));
import { maintainCrawlerRecords } from './retention';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockImplementation(async (sql: string) =>
    sql.includes("WHERE state='active'")
      ? [
          {
            id: 'connection',
            website_id: 'site',
            created_by: 'owner',
            domain: 'example.com',
            owner_user_id: 'owner',
            team_id: null,
          },
        ]
      : [],
  );
});
it('retains credentials and queued work during an infrastructure failure', async () => {
  mocks.authorize.mockRejectedValue(new Error('temporary database outage'));
  await maintainCrawlerRecords();
  expect(
    mocks.execute.mock.calls.some(
      ([sql]) => sql.includes("state='frozen'") || sql.includes('control-permission-changed'),
    ),
  ).toBe(false);
});
it('freezes credentials and cancels queued writes after confirmed permission revocation', async () => {
  mocks.authorize.mockRejectedValue(new LiekanError('no longer authorized', 403));
  await maintainCrawlerRecords();
  expect(
    mocks.execute.mock.calls.some(([sql]) => sql.includes("state='frozen',token_encrypted=NULL")),
  ).toBe(true);
  expect(mocks.execute.mock.calls.some(([sql]) => sql.includes('control-permission-changed'))).toBe(
    true,
  );
});
