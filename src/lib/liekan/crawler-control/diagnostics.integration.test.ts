// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiTransaction } from '../upstream/ai-db';
import { tokenHash } from '../log-ingestion/secrets';
const mocks = vi.hoisted(() => ({ txt: vi.fn(), probe: vi.fn() }));
vi.mock('node:dns/promises', () => ({
  Resolver: class {
    resolveTxt(name: string) {
      return mocks.txt(name);
    }
  },
}));
vi.mock('./public-probe', () => ({ publicCrawlerProbe: mocks.probe }));
import { changeCrawlerDomain, queueCrawlerCheck, processCrawlerCheck } from './diagnostics';
const enabled = process.env.LIEKAN_CRAWLER_TEST === '1';
describe.skipIf(!enabled)('public diagnostics with isolated PostgreSQL authorization', () => {
  const owner = randomUUID(),
    site = randomUUID(),
    actor = { id: owner, role: 'user' };
  const q = (sql: string, ...args: unknown[]) => aiTransaction(tx => tx.query(sql, ...args));
  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL || 'http://invalid');
    if (
      target.hostname !== '127.0.0.1' ||
      target.port !== '15440' ||
      target.pathname !== '/liekan_crawler_acceptance'
    )
      throw new Error('Only isolated DB15440 is allowed');
    await q(
      "INSERT INTO \"user\"(user_id,username,password,role) VALUES($1::uuid,$2,'test-demo-no-login','user')",
      owner,
      'test-demo-probe-' + owner,
    );
    await q(
      "INSERT INTO website(website_id,name,domain,user_id) VALUES($1::uuid,'test-demo-probe','example.com',$2::uuid)",
      site,
      owner,
    );
    await q('INSERT INTO liekan_log_state(website_id) VALUES($1::uuid)', site);
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    await q('DELETE FROM liekan_crawler_check WHERE website_id=$1::uuid', site);
    await q('DELETE FROM liekan_crawler_domain_verification WHERE website_id=$1::uuid', site);
  });
  afterAll(async () => {
    for (const table of [
      'liekan_crawler_check',
      'liekan_crawler_domain_verification',
      'liekan_crawler_state',
      'liekan_log_state',
    ])
      await q(`DELETE FROM ${table} WHERE website_id=$1::uuid`, site);
    await q('DELETE FROM website WHERE website_id=$1::uuid', site);
    await q('DELETE FROM "user" WHERE user_id=$1::uuid', owner);
  });
  async function createChallenge() {
    const challenge = await changeCrawlerDomain(actor, site, 'create');
    if (!('value' in challenge)) throw new Error('Challenge value missing');
    return challenge;
  }
  async function verified() {
    const challenge = await createChallenge();
    mocks.txt.mockResolvedValue([[challenge.value]]);
    await changeCrawlerDomain(actor, site, 'verify');
    return challenge;
  }
  it('stores the challenge hash and verifies only the current TXT challenge', async () => {
    const challenge = await createChallenge();
    const [stored] = await q(
      'SELECT * FROM liekan_crawler_domain_verification WHERE website_id=$1::uuid',
      site,
    );
    expect(stored.challenge_hash).toBe(tokenHash(challenge.value!));
    expect(JSON.stringify(stored)).not.toContain(challenge.value);
    mocks.txt.mockResolvedValue([['wrong-value']]);
    await expect(changeCrawlerDomain(actor, site, 'verify')).rejects.toMatchObject({ status: 409 });
    mocks.txt.mockResolvedValue([[challenge.value]]);
    expect(await changeCrawlerDomain(actor, site, 'verify')).toMatchObject({
      verifiedAt: expect.any(Date),
    });
  });
  it('rejects stale DNS verification when a challenge is rotated during lookup', async () => {
    const old = await createChallenge();
    mocks.txt.mockImplementationOnce(async () => {
      await createChallenge();
      return [[old.value]];
    });
    await expect(changeCrawlerDomain(actor, site, 'verify')).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await q(
          'SELECT verified_at FROM liekan_crawler_domain_verification WHERE website_id=$1::uuid',
          site,
        )
      )[0].verified_at,
    ).toBeNull();
  });
  it('requires verification and serializes each site to one pending check', async () => {
    await expect(queueCrawlerCheck(actor, site, { paths: ['/docs'] })).rejects.toMatchObject({
      status: 409,
    });
    await verified();
    await queueCrawlerCheck(actor, site, { paths: ['/docs', '/docs'] });
    await expect(queueCrawlerCheck(actor, site, { paths: [] })).rejects.toMatchObject({
      status: 429,
    });
    expect(
      (await q('SELECT paths FROM liekan_crawler_check WHERE website_id=$1::uuid', site))[0].paths,
    ).toEqual(['/docs']);
  });
  it('rechecks epoch before probing pages after a reset', async () => {
    await verified();
    const job = await queueCrawlerCheck(actor, site, { paths: ['/docs'] });
    mocks.probe.mockImplementationOnce(async () => {
      await q('UPDATE liekan_log_state SET epoch=epoch+1 WHERE website_id=$1::uuid', site);
      return { status: 200, body: 'User-agent: *\nAllow: /' };
    });
    await processCrawlerCheck(randomUUID());
    expect(mocks.probe).toHaveBeenCalledTimes(1);
    expect(
      (await q('SELECT state,result FROM liekan_crawler_check WHERE id=$1::uuid', job.id))[0],
    ).toMatchObject({ state: 'failed', result: null });
  });
});
