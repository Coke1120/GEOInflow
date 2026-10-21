// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '@/lib/prisma';
import { aiTransaction } from './ai-db';
import { crawlerReferralRows } from './analytics';

const enabled = process.env.LIEKAN_CRAWLER_TEST === '1';
describe.skipIf(!enabled)('crawler first-entry attribution on isolated PostgreSQL', () => {
  const owner = randomUUID(),
    site = randomUUID(),
    otherSite = randomUUID();
  const sessions = Array.from({ length: 4 }, () => randomUUID());
  const visit = randomUUID(),
    tieVisit = randomUUID();
  const tiePrefix = randomUUID().slice(0, -12);
  const start = new Date('2026-10-01T00:00:00Z'),
    end = new Date('2026-10-08T00:00:00Z');
  const q = (sql: string, ...params: unknown[]) => aiTransaction(tx => tx.query(sql, ...params));
  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL || 'http://invalid');
    if (
      target.hostname !== '127.0.0.1' ||
      target.port !== '15440' ||
      target.pathname !== '/liekan_crawler_acceptance'
    )
      throw new Error('Only isolated crawler acceptance database15440 is permitted');
    await q(
      "INSERT INTO \"user\"(user_id,username,password,role) VALUES($1::uuid,$2,'test-no-login','user')",
      owner,
      `test-demo-referrals-${owner}`,
    );
    for (const id of [site, otherSite])
      await q(
        "INSERT INTO website(website_id,name,user_id) VALUES($1::uuid,'test-demo-referrals',$2::uuid)",
        id,
        owner,
      );
    for (const [index, session] of sessions.entries())
      await q(
        'INSERT INTO session(session_id,website_id) VALUES($1::uuid,$2::uuid)',
        session,
        index === 3 ? otherSite : site,
      );
    for (let i = 0; i < 2; i++)
      await q(
        'INSERT INTO report(report_id,user_id,website_id,type,name,description,parameters) VALUES($1::uuid,$2::uuid,$3::uuid,\'goal\',\'test-demo-overlap\',\'test-demo\',\'{"type":"event","value":"signup"}\')',
        randomUUID(),
        owner,
        site,
      );
    const event = async (
      session: string,
      visitId: string,
      time: Date,
      path: string,
      source: string | null,
      referrer: string | null,
      name = '',
      id: string = randomUUID(),
    ) =>
      q(
        'INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,url_path,event_type,utm_source,referrer_domain,event_name) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10)',
        id,
        site,
        session,
        visitId,
        time,
        path,
        name ? 2 : 1,
        source,
        referrer,
        name,
      );
    await event(
      sessions[0],
      visit,
      new Date(start.getTime() - 1000),
      '/old-entry',
      null,
      'chatgpt.com',
    );
    await event(sessions[0], visit, start, '/current', 'perplexity', null);
    for (let i = 1; i <= 2; i++)
      await event(
        sessions[0],
        visit,
        new Date(start.getTime() + i * 1000),
        '/current',
        null,
        null,
        'signup',
      );
    await event(sessions[1], visit, start, '/other-session', 'google', null);
    await event(
      sessions[1],
      visit,
      new Date(start.getTime() + 1000),
      '/other-session',
      null,
      null,
      'signup',
    );
    await event(
      sessions[2],
      tieVisit,
      start,
      '/tie-second',
      'chatgpt',
      null,
      '',
      `${tiePrefix}000000000002`,
    );
    await event(
      sessions[2],
      tieVisit,
      start,
      '/tie-first',
      'claude',
      null,
      '',
      `${tiePrefix}000000000001`,
    );
    await event(sessions[0], randomUUID(), start, '/custom-only', null, null, 'signup');
    await event(sessions[3], randomUUID(), start, '/wrong-site-session', 'chatgpt', null);
    await q(
      "INSERT INTO liekan_event_quality(event_id,website_id,classification,source,reasons,rule_version,range_status) SELECT event_id,website_id,'browser','browser','{}','fixture-browser','missing' FROM website_event WHERE website_id=$1::uuid ON CONFLICT DO NOTHING",
      site,
    );
  });
  afterAll(async () => {
    if (!enabled) return;
    for (const id of [site, otherSite]) {
      await q('DELETE FROM website_event WHERE website_id=$1::uuid', id);
      await q('DELETE FROM session WHERE website_id=$1::uuid', id);
      await q('DELETE FROM report WHERE website_id=$1::uuid', id);
      await q('DELETE FROM website WHERE website_id=$1::uuid', id);
    }
    await q('DELETE FROM "user" WHERE user_id=$1::uuid', owner);
    await prisma.client.$disconnect();
  });
  it('preserves historical entry fields, stable ties, session boundaries and unique goal events', async () => {
    const rows = await aiTransaction(tx => crawlerReferralRows(tx, site, start, end, 'UTC'));
    expect(rows).toHaveLength(3);
    expect(rows.find(row => row.path === '/old-entry')).toMatchObject({
      referrer: 'chatgpt.com',
      utmSource: null,
      visits: 1,
      conversions: 1,
      goalEvents: 2,
    });
    expect(rows.find(row => row.path === '/other-session')).toMatchObject({
      utmSource: 'google',
      visits: 1,
      conversions: 1,
      goalEvents: 1,
    });
    expect(rows.find(row => row.path === '/tie-first')).toMatchObject({
      utmSource: 'claude',
      visits: 1,
      conversions: 0,
      goalEvents: 0,
    });
  });
});
