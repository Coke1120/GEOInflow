// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '@/lib/prisma';
import { getHeatmap, type HeatmapParameters } from '@/queries/sql/heatmap/getHeatmap';
import { analysisTransaction } from './analysis-rollups-db';
import { withPublishedRegistry } from './crawler-registry-context';

const enabled = process.env.LIEKAN_ANALYSIS_ROLLUPS_TEST === '1';
const user = randomUUID(),
  site = randomUUID(),
  session = randomUUID();
const q = (sql: string, ...params: unknown[]) =>
  analysisTransaction(tx => tx.$executeRawUnsafe(sql, ...params));
const range = {
  startDate: new Date('2026-01-01T00:00Z'),
  endDate: new Date('2026-01-02T00:00Z'),
  timezone: 'UTC',
};

describe.skipIf(!enabled)('heatmap filtering against the original reporting policy', () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL);
    if (
      url.hostname !== '127.0.0.1' ||
      url.port !== '15462' ||
      url.pathname !== '/liekan_analysis_rollups_test'
    )
      throw new Error('Owned heatmap fixture database required');
    await q(
      `INSERT INTO "user"(user_id,username,password,role) VALUES($1::uuid,$2,'synthetic','user')`,
      user,
      `heatmap-${user}`,
    );
    await q(
      `INSERT INTO website(website_id,user_id,name,domain) VALUES($1::uuid,$2::uuid,'Synthetic heatmap fixture','heatmap.invalid')`,
      site,
      user,
    );
    await q(
      `INSERT INTO session(session_id,website_id,created_at) VALUES($1::uuid,$2::uuid,'2026-01-01')`,
      session,
      site,
    );
    for (const [index, device, classification] of [
      [0, 'desktop', 'browser'],
      [1, 'mobile', 'browser'],
      [2, 'desktop', 'automated'],
    ] as const) {
      const visit = randomUUID(),
        event = randomUUID();
      await analysisTransaction(async tx => {
        await tx.$executeRawUnsafe(
          'SELECT website_id FROM website WHERE website_id=$1::uuid FOR UPDATE',
          site,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO website_event(event_id,website_id,session_id,visit_id,event_type,url_path,hostname,created_at)
          VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,1,$5,'heatmap.invalid','2026-01-01T01:00Z')`,
          event,
          site,
          session,
          visit,
          `/page-${index}`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO liekan_event_quality(event_id,website_id,classification,source,reasons,rule_version,range_status,hostname)
          VALUES($1::uuid,$2::uuid,$3,'browser','{}','heatmap-fixture','missing','heatmap.invalid')`,
          event,
          site,
          classification,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO liekan_event_environment(event_id,website_id,scope,identity_version,identity_available,browser,device)
          VALUES($1::uuid,$2::uuid,'browser','heatmap-fixture',true,'Firefox',$3)`,
          event,
          site,
          device,
        );
        for (const type of [1, 2])
          await tx.$executeRawUnsafe(
            `INSERT INTO heatmap_event(heatmap_event_id,website_id,session_id,visit_id,url_path,event_type,x,y,page_x,page_y,page_w,page_h,viewport_w,viewport_h,scroll_pct,created_at)
          VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,10,20,10,20,1000,2000,1000,800,90,'2026-01-01T01:01Z')`,
            randomUUID(),
            site,
            session,
            visit,
            `/page-${index}`,
            type,
          );
      });
    }
  });
  afterAll(async () => {
    await q('DELETE FROM website WHERE website_id=$1::uuid', site);
    await q('DELETE FROM "user" WHERE user_id=$1::uuid', user);
  });

  it.each(['click', 'scroll'] as const)(
    'preserves eligible %s totals, visit isolation and arbitrary filter combinations',
    async mode => {
      for (const filters of [
        {},
        { device: 'eq.desktop' },
        { device: 'eq.mobile' },
        { device: 'neq.desktop' },
        { browser: 'eq.Firefox', device: 'eq.desktop' },
      ]) {
        const parameters: HeatmapParameters = { ...range, ...filters, mode };
        await withPublishedRegistry(async () => {
          const { filterQuery, cohortQuery, excludeBounceQuery, joinSessionQuery, queryParams } =
            prisma.parseFilters({ ...parameters, websiteId: site });
          const join =
            filterQuery || cohortQuery || excludeBounceQuery
              ? `INNER JOIN (
          SELECT DISTINCT website_event.website_id,website_event.session_id,website_event.visit_id
          FROM website_event ${joinSessionQuery} ${cohortQuery} ${excludeBounceQuery}
          WHERE website_event.website_id={{websiteId::uuid}} AND website_event.created_at BETWEEN {{startDate}} AND {{endDate}} ${filterQuery}
        ) selected_visits ON selected_visits.website_id=h.website_id AND selected_visits.session_id=h.session_id AND selected_visits.visit_id=h.visit_id`
              : '';
          const expected = await prisma.rawQuery(
            `SELECT h.url_path AS "urlPath",count(*)::int AS count,count(DISTINCT h.visit_id)::int AS sessions
          FROM heatmap_event h ${join} WHERE h.website_id={{websiteId::uuid}} AND h.created_at BETWEEN {{startDate}} AND {{endDate}} AND h.event_type={{eventType}}
          GROUP BY h.url_path ORDER BY sessions DESC,count DESC`,
            { ...queryParams, websiteId: site, ...range, eventType: mode === 'click' ? 1 : 2 },
          );
          const actual = await getHeatmap(site, parameters);
          const ordered = (rows: any[]) =>
            [...rows].sort((a, b) => a.urlPath.localeCompare(b.urlPath));
          expect(ordered(actual.pages)).toEqual(ordered(expected));
          expect(actual.pages.some(page => page.urlPath === '/page-2')).toBe(false);
          expect(actual.pages.length).toBe(Object.keys(filters).length ? 1 : 2);
        });
      }
    },
  );
});
