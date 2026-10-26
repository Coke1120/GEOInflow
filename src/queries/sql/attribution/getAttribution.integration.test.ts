// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { identityUsable, unavailableFields } from '@/lib/liekan/contracts/browser-population';
import { analysisTransaction } from '@/lib/liekan/upstream/analysis-rollups-db';
import { readBrowserPopulation } from '@/lib/liekan/upstream/browser-population';
import { withPublishedRegistry } from '@/lib/liekan/upstream/crawler-registry-context';
import { nativeSnapshot } from '@/lib/liekan/upstream/native-snapshot';
import prisma from '@/lib/prisma';
import type { QueryFilters } from '@/lib/types';
import { type AttributionParameters, getAttribution } from './getAttribution';

const enabled = process.env.LIEKAN_ANALYSIS_ROLLUPS_TEST === '1';
const user = randomUUID(),
  site = randomUUID(),
  foreign = randomUUID(),
  unknown = randomUUID(),
  empty = randomUUID();
const groups = [
  'referrer',
  'paidAds',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const;
const range = { startDate: new Date('2026-01-01T00:00Z'), endDate: new Date('2026-01-02T00:00Z') };
const q = (sql: string, ...params: unknown[]) =>
  analysisTransaction(tx => tx.$executeRawUnsafe(sql, ...params));

/** Original eight-statement reader retained as the independent compatibility oracle. */
async function original(
  websiteId: string,
  parameters: AttributionParameters,
  filters: QueryFilters,
) {
  return nativeSnapshot(async () => {
    const column = parameters.type === 'path' ? 'url_path' : 'event_name';
    const { filterQuery, joinSessionQuery, cohortQuery, queryParams } = prisma.parseFilters({
      ...filters,
      ...parameters,
      websiteId,
      eventType: parameters.type === 'path' ? 1 : 2,
    });
    const events = `WITH events AS (
      SELECT DISTINCT website_event.session_id,max(website_event.created_at) max_dt
      FROM website_event ${cohortQuery} ${joinSessionQuery}
      WHERE website_event.website_id={{websiteId::uuid}}
        AND website_event.created_at BETWEEN {{startDate}} AND {{endDate}}
        AND website_event.${column}={{step}} ${filterQuery} GROUP BY 1),`;
    const model = `model AS (
      SELECT e.session_id,${parameters.model === 'first-click' ? 'min' : 'max'}(we.created_at) created_at
      FROM events e JOIN website_event we ON we.session_id=e.session_id
      WHERE we.website_id={{websiteId::uuid}} AND we.created_at BETWEEN {{startDate}} AND {{endDate}}
        ${parameters.model === 'first-click' ? '' : 'AND we.created_at<e.max_dt'} GROUP BY e.session_id)`;
    const source = `FROM model m JOIN website_event we
      ON we.created_at=m.created_at AND we.session_id=m.session_id`;
    const window = `we.website_id={{websiteId::uuid}} AND we.created_at BETWEEN {{startDate}} AND {{endDate}}`;
    const result: Record<string, any> = {};
    for (const group of groups) {
      const select =
        group === 'referrer'
          ? `SELECT coalesce(we.referrer_domain,'') AS name,count(DISTINCT we.session_id) AS value
           ${source} JOIN session s ON s.session_id=m.session_id
           WHERE ${window} AND we.referrer_domain!=regexp_replace(we.hostname,'^www.','')
             AND we.referrer_domain!='' GROUP BY 1 ORDER BY 2 DESC LIMIT 20`
          : group === 'paidAds'
            ? `SELECT * FROM (
             SELECT CASE WHEN coalesce(gclid,'')!='' THEN 'Google Ads'
               WHEN coalesce(fbclid,'')!='' THEN 'Facebook / Meta'
               WHEN coalesce(msclkid,'')!='' THEN 'Microsoft Ads'
               WHEN coalesce(ttclid,'')!='' THEN 'TikTok Ads'
               WHEN coalesce(li_fat_id,'')!='' THEN 'LinkedIn Ads'
               WHEN coalesce(twclid,'')!='' THEN 'Twitter Ads (X)' ELSE '' END AS name,
               count(DISTINCT we.session_id) AS value ${source} WHERE ${window}
             GROUP BY 1 ORDER BY 2 DESC LIMIT 20) paid WHERE name!=''`
            : `SELECT coalesce(we.${group},'') AS name,count(DISTINCT we.session_id) AS value
             ${source} WHERE ${window} AND we.${group}!='' GROUP BY 1 ORDER BY 2 DESC LIMIT 20`;
      result[group] = await prisma.rawQuery(
        `${events}${model} ${select}`,
        queryParams,
        'getAttribution',
      );
    }
    const [total] = await prisma.rawQuery(
      `SELECT count(*) AS pageviews,count(DISTINCT website_event.session_id) AS visitors,
       count(DISTINCT website_event.visit_id) AS visits FROM website_event ${joinSessionQuery} ${cohortQuery}
       WHERE website_event.website_id={{websiteId::uuid}}
       AND website_event.created_at BETWEEN {{startDate}} AND {{endDate}}
       AND website_event.${column}={{step}} ${filterQuery}`,
      queryParams,
      'getAttribution',
    );
    result.population = await readBrowserPopulation(
      websiteId,
      parameters.startDate,
      parameters.endDate,
      filters.timezone,
    );
    result.total = identityUsable(result.population)
      ? total
      : unavailableFields(total, ['visitors', 'visits']);
    return result;
  });
}

function normalized(result: any) {
  const value = JSON.parse(
    JSON.stringify(result, (_key, item) => (typeof item === 'bigint' ? Number(item) : item)),
  );
  for (const group of groups) value[group].sort((a: any, b: any) => a.name.localeCompare(b.name));
  return value;
}

type EventFixture = {
  site?: string;
  session: string;
  visit?: string;
  at: string;
  type?: number;
  path?: string;
  name?: string;
  label?: string | null;
  referrer?: string | null;
  hostname?: string | null;
  ads?: (string | null)[];
  classification?: string;
  identity?: boolean;
};
async function event(p: EventFixture) {
  const id = randomUUID(),
    website = p.site || site;
  await analysisTransaction(async tx => {
    await tx.$queryRawUnsafe(
      'SELECT website_id FROM website WHERE website_id=$1::uuid FOR UPDATE',
      website,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,event_type,url_path,event_name,
       hostname,referrer_domain,utm_source,utm_medium,utm_campaign,utm_content,utm_term,gclid,fbclid,msclkid,ttclid,li_fat_id,twclid)
       VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::timestamptz,$6,$7,$8,$9,$10,$11,$11,$11,$11,$11,$12,$13,$14,$15,$16,$17)`,
      id,
      website,
      p.session,
      p.visit || p.session,
      p.at,
      p.type || 1,
      p.path || '/landing',
      p.name || null,
      p.hostname === undefined ? 'www.attribution.invalid' : p.hostname,
      p.referrer === undefined ? (p.label ? `${p.label}.invalid` : null) : p.referrer,
      p.label === undefined ? null : p.label,
      ...Array.from({ length: 6 }, (_, index) => p.ads?.[index] ?? null),
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO liekan_event_quality(event_id,website_id,classification,source,reasons,rule_version,range_status,hostname)
       VALUES($1::uuid,$2::uuid,$3,'browser','{}','attribution-fixture','missing','attribution.invalid')`,
      id,
      website,
      p.classification || 'browser',
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO liekan_event_environment(event_id,website_id,scope,identity_version,identity_available,browser,device)
       VALUES($1::uuid,$2::uuid,'browser','attribution-fixture',$3,'Firefox','desktop')`,
      id,
      website,
      p.identity !== false,
    );
  });
}
async function session(website = site) {
  const id = randomUUID();
  await q(
    `INSERT INTO session(session_id,website_id,created_at) VALUES($1::uuid,$2::uuid,'2026-01-01')`,
    id,
    website,
  );
  return id;
}
async function compare(
  parameters: AttributionParameters,
  filters: QueryFilters = { timezone: 'UTC' },
  website = site,
) {
  return withPublishedRegistry(async () => {
    const expected = await original(website, parameters, filters);
    const actual = await getAttribution(website, parameters, filters);
    expect(normalized(actual)).toEqual(normalized(expected));
    for (const group of groups) {
      expect(actual[group].length).toBeLessThanOrEqual(20);
      const values = actual[group]
        .map(row => row.value)
        .filter(value => value != null)
        .map(Number);
      expect(values).toEqual([...values].sort((a, b) => b - a));
    }
    return normalized(actual);
  });
}

describe.skipIf(!enabled)(
  'single-statement attribution preserves the original reporting semantics',
  () => {
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL);
      if (
        url.hostname !== '127.0.0.1' ||
        url.port !== '15462' ||
        url.pathname !== '/liekan_analysis_rollups_test' ||
        !/^analysis_[a-f0-9]+$/.test(url.searchParams.get('schema') || '')
      )
        throw new Error('Owned attribution fixture database required');
      await q(
        `INSERT INTO "user"(user_id,username,password,role) VALUES($1::uuid,$2,'synthetic','user')`,
        user,
        `attribution-${user}`,
      );
      for (const website of [site, foreign, unknown, empty])
        await q(
          `INSERT INTO website(website_id,user_id,name,domain) VALUES($1::uuid,$2::uuid,'Synthetic attribution fixture','attribution.invalid')`,
          website,
          user,
        );
      const id = await session();
      await event({ session: id, at: '2025-12-31T23:59:59Z', label: 'outside' });
      for (const label of ['first-a', 'first-a', 'first-b'])
        await event({
          session: id,
          at: '2026-01-01T00:01:00.000001Z',
          label,
          ads: label === 'first-a' ? ['g', 'f'] : [null, 'f'],
        });
      await event({ session: id, at: '2026-01-01T00:01:00.000002Z', label: 'near-first' });
      for (const label of ['last-a', 'last-a', 'last-b'])
        await event({
          session: id,
          at: '2026-01-01T00:05:00.123455Z',
          label,
          ads: label === 'last-a' ? ['g', 'f'] : [null, null, 'm'],
        });
      await event({
        session: id,
        at: '2026-01-01T00:05:00.123456Z',
        path: '/checkout',
        label: 'conversion',
      });
      for (const visit of [id, id, randomUUID()])
        await event({
          session: id,
          visit,
          type: 2,
          name: 'purchase',
          at: '2026-01-01T00:05:00.123456Z',
          label: 'conversion',
        });
      await event({ session: id, at: '2026-01-01T00:06:00Z', label: 'after-conversion' });
      for (const at of ['2026-01-01T00:00:10Z', '2026-01-01T00:05:00.123455Z'])
        await event({ site: foreign, session: id, at, label: 'cross-site' });
      const automated = await session();
      await event({
        session: automated,
        at: '2026-01-01T00:01Z',
        label: 'robot',
        classification: 'automated',
      });
      await event({
        session: automated,
        at: '2026-01-01T00:05Z',
        path: '/checkout',
        classification: 'automated',
      });
      for (const [step, label, referrer, hostname] of [
        ['/blank', null, 'null-host.invalid', null],
        ['/empty', '', '', 'www.attribution.invalid'],
        ['/self', 'self', 'attribution.invalid', 'www.attribution.invalid'],
      ] as const) {
        const s = await session();
        await event({ session: s, at: '2026-01-01T00:01Z', label, referrer, hostname });
        await event({ session: s, at: '2026-01-01T00:05Z', path: step });
      }
      const unavailable = await session(unknown);
      await event({
        site: unknown,
        session: unavailable,
        at: '2026-01-01T00:01Z',
        label: 'unknown',
        identity: false,
        ads: ['g'],
      });
      await event({
        site: unknown,
        session: unavailable,
        at: '2026-01-01T00:05Z',
        path: '/checkout',
        identity: false,
      });
      const limited = [await session(), await session()];
      for (let index = 0; index < 21; index++)
        for (const s of index === 20 ? limited.slice(0, 1) : limited)
          await event({
            session: s,
            at: '2026-01-01T00:20Z',
            label: `limit-${String(index).padStart(2, '0')}`,
          });
      for (const s of limited) await event({ session: s, at: '2026-01-01T00:25Z', path: '/limit' });
    }, 30000);
    afterAll(async () => {
      for (const website of [site, foreign, unknown, empty])
        await q('DELETE FROM website WHERE website_id=$1::uuid', website);
      await q('DELETE FROM "user" WHERE user_id=$1::uuid', user);
    });

    it.each(['first-click', 'last-click'])(
      'preserves %s ties at microsecond precision and conversion multiplicity',
      async model => {
        for (const type of ['path', 'event']) {
          const result = await compare({
            ...range,
            model,
            type,
            step: type === 'path' ? '/checkout' : 'purchase',
          });
          expect(result.total).toEqual({
            pageviews: type === 'path' ? 1 : 3,
            visitors: 1,
            visits: type === 'path' ? 1 : 2,
          });
          for (const group of groups.filter(group => group.startsWith('utm_')))
            expect(result[group]).toEqual([
              { name: model === 'first-click' ? 'first-a' : 'last-a', value: 1 },
              { name: model === 'first-click' ? 'first-b' : 'last-b', value: 1 },
            ]);
          expect(result.paidAds.map((row: any) => row.name).sort()).toEqual(
            model === 'first-click'
              ? ['Facebook / Meta', 'Google Ads']
              : ['Google Ads', 'Microsoft Ads'],
          );
        }
      },
      30000,
    );
    it.each(['first-click', 'last-click'])(
      'retains %s filters/cohort scope while attributing from unfiltered source events',
      async model => {
        for (const filters of [
          { timezone: 'UTC', device: 'eq.desktop', path: 'eq./checkout' },
          {
            timezone: 'UTC',
            cohort_path: 'eq./landing',
            cohort_startDate: range.startDate,
            cohort_endDate: range.endDate,
          },
          {
            timezone: 'UTC',
            cohort_path: 'eq./missing',
            cohort_startDate: range.startDate,
            cohort_endDate: range.endDate,
          },
          { timezone: 'UTC', device: 'eq.mobile' },
        ])
          await compare({ ...range, model, type: 'path', step: '/checkout' }, filters);
      },
      30000,
    );
    it('keeps absent conversions, null/empty values and self referrers distinct', async () => {
      for (const step of ['/missing', '/blank', '/empty', '/self']) {
        const result = await compare({ ...range, model: 'first-click', type: 'path', step });
        expect(result.referrer).toEqual([]);
        if (step !== '/self') for (const group of groups) expect(result[group]).toEqual([]);
        expect(result.total.pageviews).toBe(step === '/missing' ? 0 : 1);
      }
    });
    it('retains unavailable coverage with empty qualified groups and masked total identities', async () => {
      const result = await compare(
        { ...range, model: 'first-click', type: 'path', step: '/checkout' },
        { timezone: 'UTC' },
        unknown,
      );
      expect(result.population.identity.status).toBe('unavailable');
      for (const group of groups) expect(result[group]).toEqual([]);
      expect(result.total).toEqual({ pageviews: 0, visitors: null, visits: null });
    });
    it('limits each group independently after distinct-session counting', async () => {
      const result = await compare({
        ...range,
        model: 'first-click',
        type: 'path',
        step: '/limit',
      });
      expect(result.total).toEqual({ pageviews: 2, visitors: 2, visits: 2 });
      expect(result.paidAds).toEqual([]);
      for (const group of groups.filter(group => group !== 'paidAds')) {
        expect(result[group]).toHaveLength(20);
        expect(
          result[group].every((row: any) => row.value === 2 && !row.name.includes('limit-20')),
        ).toBe(true);
      }
    }, 30000);
    it('returns zero totals and empty groups for an empty eligible population', async () => {
      const result = await compare(
        { ...range, model: 'last-click', type: 'path', step: '/checkout' },
        { timezone: 'UTC' },
        empty,
      );
      expect(result.population.identity.status).toBe('empty');
      expect(result.total).toEqual({ pageviews: 0, visitors: 0, visits: 0 });
      for (const group of groups) expect(result[group]).toEqual([]);
    });
    it('retains qualified conversion counts with explicit partial population coverage', async () => {
      const id = await session();
      await event({ session: id, at: '2026-01-01T00:10Z', identity: false });
      const result = await compare({
        ...range,
        model: 'first-click',
        type: 'event',
        step: 'purchase',
      });
      expect(result.population.identity.status).toBe('partial');
      expect(result.population.metricScope).toBe('qualified-browser');
      expect(result.referrer.length).toBeGreaterThan(0);
      for (const group of groups)
        expect(result[group].every((row: any) => typeof row.value === 'number')).toBe(true);
      expect(result.total).toEqual({ pageviews: 3, visitors: 1, visits: 2 });
    });
  },
);
