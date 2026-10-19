import type pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { pageReportSchema, pageReportParts } from '../src/lib/liekan/contracts/page-report';

export const geoDownloadEvent = 'synthetic-geo-download';
export const geoContentPaths = [
  '/synthetic/geo-case',
  '/synthetic/geo-article',
  '/synthetic/geo-interactive',
] as const;
export type GeoCacheSeed = {
  geoSite: string;
  geoShareSite: string;
  geoSeedDay: string;
  geoTodayAt: number;
  geoSources: string[];
  geoIntervalVisibleRecord: string;
  geoIntervalExcludedRecords: string[];
};

/** Call once near the END of seedCacheMatrix, after its original goal/funnel and property inserts. */
export async function seedGeoCacheMatrix(
  db: pg.Client,
  end: number,
  sites: string[],
  actor: string,
): Promise<GeoCacheSeed> {
  assert.equal(sites.length, 10);
  const timezone = 'Asia/Shanghai';
  const geoSeedDay = formatInTimeZone(Date.now(), timezone, 'yyyy-MM-dd');
  assert.equal(
    formatInTimeZone(end, timezone, 'yyyy-MM-dd'),
    geoSeedDay,
    'seed crossed local midnight; rebuild this disposable dataset',
  );
  const todayStart = +fromZonedTime(`${geoSeedDay}T00:00:00`, timezone);
  // Every additional record is <= the original end, so positive endAt nonces cannot split it.
  const todayAt = Math.max(todayStart, Math.min(end - 2000, Date.now() - 2000));
  assert(todayAt <= end && todayAt <= Date.now());
  const geoSites = [sites[5], sites[4]];
  const sources: string[] = [];
  let geoIntervalVisibleRecord = '';
  const geoIntervalExcludedRecords: string[] = [];

  for (const site of geoSites) {
    const manualImport = randomUUID(),
      automaticImport = randomUUID(),
      source = randomUUID();
    sources.push(source);
    await db.query(
      `INSERT INTO liekan_log_source(id,website_id,kind,domain,created_by,owner_id,state,health)
      VALUES($1,$2,'server','analytics-benchmark.invalid',$3,$3,'paused','{"synthetic":true}'::jsonb)`,
      [source, site, actor],
    );
    // A closed historical source interval leaves current direct-log sentinels effective.
    await db.query(
      `INSERT INTO liekan_log_interval(id,website_id,source_id,starts_at,ends_at)
      VALUES($1,$2,$3,to_timestamp($4/1000.0)-interval '21 days',
        to_timestamp($4/1000.0)-interval '20 days')`,
      [randomUUID(), site, source, end],
    );
    await db.query(
      `INSERT INTO liekan_import(id,website_id,digest,accepted,rejected,kind,source_id)
      VALUES($1,$2,$3,0,0,'manual',NULL),($4,$2,$5,0,0,'automatic',$6)`,
      [
        manualImport,
        site,
        `geo-manual-${manualImport}`,
        automaticImport,
        `geo-auto-${automaticImport}`,
        source,
      ],
    );

    await db.query(
      `INSERT INTO liekan_catalog(website_id,path,title,content_type,word_count,
      published_at,structured,structure_score,content_updated_at,link_depth,evidence_source)
      SELECT $1, c.path,'验收合成内容 '||c.kind,c.kind,1500,
        to_timestamp($2/1000.0)-interval '14 days',true,80,
        to_timestamp($2/1000.0)-interval '13 days',c.depth,'验收合成元数据'
      FROM (VALUES($3::text,'case',1),($4::text,'article',2),($5::text,'interactive',3),
        ('/synthetic/geo-blind','article',4)) c(path,kind,depth)`,
      [site, end, ...geoContentPaths],
    );

    const downloadGoal = randomUUID();
    await db.query(
      `INSERT INTO report(report_id,user_id,website_id,type,name,description,parameters)
      VALUES($1,$2,$3,'goal','验收合成白皮书 download','',$4::jsonb)`,
      [downloadGoal, actor, site, JSON.stringify({ type: 'event', value: geoDownloadEvent })],
    );

    // New visit paths keep the original /synthetic/start -> /synthetic/finish 100 -> 80 unchanged.
    const visits = Array.from({ length: 80 }, (_, i) => ({
      session: randomUUID(),
      visit: randomUUID(),
      country: Math.floor(i / 4) % 2 ? 'US' : 'CN',
      region: Math.floor(i / 4) % 2 ? 'CA' : '31',
      city: Math.floor(i / 4) % 2 ? 'Synthetic US City' : '验收合成上海',
      referrer: ['chatgpt.com', 'google.com', null, 'news.benchmark.invalid'][i % 4],
      path: geoContentPaths[Math.floor(i / 8) % 3],
    }));
    await db.query(
      `INSERT INTO session(session_id,website_id,country,region,city,browser,os,device,created_at)
      SELECT x.session::uuid,$1,x.country,x.region,x.city,'chrome','mac','desktop',
        to_timestamp($2/1000.0)-interval '12 days'
      FROM jsonb_to_recordset($3::jsonb) x(session text,country text,region text,city text)`,
      [site, end, JSON.stringify(visits)],
    );
    await db.query(
      `INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,
      url_path,event_type,event_name,hostname,referrer_domain)
      SELECT gen_random_uuid(),$1,x.session::uuid,x.visit::uuid,
        to_timestamp($2/1000.0)-interval '12 days'+t.n*interval '10 seconds',
        CASE t.n WHEN 0 THEN '/synthetic/geo-entry' WHEN 1 THEN x.path ELSE '/synthetic/geo-download' END,
        CASE WHEN t.n=2 THEN 2 ELSE 1 END,CASE WHEN t.n=2 THEN $4 END,
        'analytics-benchmark.invalid',x.referrer
      FROM jsonb_to_recordset($3::jsonb) x(session text,visit text,path text,referrer text)
      CROSS JOIN (VALUES(0),(1),(2)) t(n)`,
      [site, end, JSON.stringify(visits), geoDownloadEvent],
    );
    const todayVisits = visits.slice(0, 8).map(v => ({ ...v, visit: randomUUID() }));
    await db.query(
      `INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,
      url_path,event_type,event_name,hostname,referrer_domain)
      SELECT gen_random_uuid(),$1,x.session::uuid,x.visit::uuid,to_timestamp($2/1000.0),
        CASE WHEN t.kind=1 THEN '/synthetic/geo-today' ELSE '/synthetic/geo-download' END,
        t.kind,CASE WHEN t.kind=2 THEN $4 END,'analytics-benchmark.invalid',x.referrer
      FROM jsonb_to_recordset($3::jsonb) x(session text,visit text,referrer text)
      CROSS JOIN (VALUES(1),(2)) t(kind)`,
      [site, todayAt, JSON.stringify(todayVisits), geoDownloadEvent],
    );

    const fixtures: Array<{
      id: string;
      at: number;
      path: string;
      kind: number;
      status: number;
      source: string | null;
    }> = [];
    const add = (
      at: number,
      path: string,
      kind: number,
      status = 200,
      sourceId: string | null = null,
    ) => {
      const id = createHash('sha256').update(randomUUID()).digest('hex');
      fixtures.push({ id, at, path, kind, status, source: sourceId });
      return id;
    };
    for (const path of geoContentPaths) {
      for (let i = 0; i < 70; i++) add(end - 12 * 86400000 + i * 1000, path, i % 3);
      for (let i = 0; i < 20; i++) add(end - 17 * 86400000 + i * 1000, path, i % 3);
    }
    // Controlled publication increments are exactly 70 - 20 = 50 per catalog path.
    for (let i = 0; i < 240; i++)
      add(end - 86400000 + i * 1000, `/synthetic/geo-log-flow/${i}`, i % 4, i % 8 ? 200 : 404);
    for (let kind = 0; kind < 4; kind++)
      add(todayAt, '/synthetic/geo-today-log', kind, kind === 3 ? 404 : 200);
    for (let kind = 0; kind < 3; kind++) add(end - 370 * 86400000, '/synthetic/geo-previous', kind);
    const visible = add(
      end - 21 * 86400000 + 3600000,
      '/synthetic/geo-interval-visible',
      0,
      200,
      source,
    );
    const blockedManual = add(
      end - 21 * 86400000 + 3600000,
      '/synthetic/geo-interval-manual-excluded',
      0,
    );
    const blockedAutomatic = add(
      end - 22 * 86400000,
      '/synthetic/geo-interval-auto-excluded',
      0,
      200,
      source,
    );
    if (site === sites[5]) {
      geoIntervalVisibleRecord = visible;
      geoIntervalExcludedRecords.push(blockedManual, blockedAutomatic);
    }
    await db.query(
      `INSERT INTO liekan_log(id,website_id,import_id,source_id,created_at,path,method,
      status,bytes,ip_masked,ip_hash,user_agent,location,bot,vendor,bot_type,verification)
      SELECT x.id,$1,CASE WHEN x.source IS NULL THEN $2::uuid ELSE $3::uuid END,x.source::uuid,
        to_timestamp(x.at/1000.0),x.path,'GET',x.status,1024,'synthetic',md5(x.id),
        'SyntheticGeoBenchmark','验收合成地区',
        CASE x.kind WHEN 0 THEN 'SyntheticTrainingBot' WHEN 1 THEN 'SyntheticSearchBot'
          WHEN 2 THEN 'SyntheticUserBot' ELSE '其他' END,'benchmark',
        CASE x.kind WHEN 0 THEN '训练' WHEN 1 THEN '搜索' WHEN 2 THEN '用户触发' ELSE '其他' END,'未验证'
      FROM jsonb_to_recordset($4::jsonb) x(id text,at double precision,path text,kind integer,status integer,source text)`,
      [site, manualImport, automaticImport, JSON.stringify(fixtures)],
    );
    await db.query(
      `UPDATE liekan_import i SET accepted=(SELECT count(*)::int FROM liekan_log l WHERE l.import_id=i.id),
      inserted=(SELECT count(*)::int FROM liekan_log l WHERE l.import_id=i.id) WHERE i.id=ANY($1::uuid[])`,
      [[manualImport, automaticImport]],
    );
  }
  for (const table of [
    'liekan_log',
    'liekan_catalog',
    'liekan_log_interval',
    'website_event',
    'session',
    'report',
  ])
    await db.query(`ANALYZE ${table}`);
  assert.equal(
    formatInTimeZone(Date.now(), timezone, 'yyyy-MM-dd'),
    geoSeedDay,
    'fixture construction crossed local midnight; rebuild dataset',
  );
  return {
    geoSite: sites[5],
    geoShareSite: sites[4],
    geoSeedDay,
    geoTodayAt: todayAt,
    geoSources: sources,
    geoIntervalVisibleRecord,
    geoIntervalExcludedRecords,
  };
}

/** Additional sources are synthetic and belong only to the disposable benchmark database. */
export async function seedCacheMatrix(
  db: pg.Client,
  rows: number,
  end: number,
  sites: string[],
  actor: string,
) {
  const extra = Math.max(1000, Math.floor(rows / 50));
  await db.query(
    `
    INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,url_path,event_type,event_name,
      hostname,referrer_domain,utm_source,utm_medium,utm_campaign,lcp,inp,cls,fcp,ttfb)
    SELECT gen_random_uuid(),s.website_id,s.session_id,s.session_id,
      to_timestamp($1/1000.0)-(((e.i*97)%2500000)+60)*interval '1 second',
      '/synthetic/purchase',t.kind,CASE WHEN t.kind=2 THEN 'synthetic-purchase' END,
      'analytics-benchmark.invalid','chatgpt.com','synthetic','benchmark','cache-acceptance',
      CASE WHEN t.kind=5 THEN 1800.5 END,CASE WHEN t.kind=5 THEN 100.5 END,
      CASE WHEN t.kind=5 THEN 0.05 END,CASE WHEN t.kind=5 THEN 900.5 END,CASE WHEN t.kind=5 THEN 120.5 END
    FROM generate_series(1,$2::int) e(i)
    JOIN benchmark_sessions s ON s.i=1+((e.i-1)%$3::int)
    CROSS JOIN (VALUES(2),(5)) t(kind)`,
    [end, extra, Math.floor(rows / 10)],
  );
  await db.query(`INSERT INTO revenue(revenue_id,website_id,session_id,event_id,event_name,currency,revenue,created_at)
    SELECT gen_random_uuid(),website_id,session_id,event_id,event_name,'CNY',19.9900,created_at
    FROM website_event WHERE event_type=2`);
  await db.query(
    'CREATE TEMP TABLE benchmark_flows AS SELECT *,gen_random_uuid() AS visit_id FROM benchmark_sessions WHERE i<=1000',
  );
  await db.query(
    `INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,url_path,event_type,hostname,referrer_domain)
    SELECT gen_random_uuid(),s.website_id,s.session_id,s.visit_id,
      to_timestamp($1/1000.0)-interval '5 minutes'+s.i*interval '1 millisecond'+t.n*interval '10 seconds',
      CASE WHEN t.n=0 THEN '/synthetic/start' ELSE '/synthetic/finish' END,1,'analytics-benchmark.invalid','chatgpt.com'
    FROM benchmark_flows s CROSS JOIN (VALUES(0),(1)) t(n) WHERE t.n=0 OR ((s.i-1)/10)%5<>0`,
    [end],
  );
  await db.query(
    `INSERT INTO heatmap_event(heatmap_event_id,website_id,session_id,visit_id,url_path,event_type,
      x,y,page_x,page_y,page_w,page_h,viewport_w,viewport_h,scroll_pct,created_at)
    SELECT gen_random_uuid(),website_id,session_id,visit_id,'/synthetic/start',t.kind,
      100,200,100,200,1440,2200,1440,1000,
      25+25*((row_number() OVER(PARTITION BY website_id,t.kind ORDER BY event_id)-1)%4),created_at
    FROM (SELECT * FROM website_event WHERE event_type=1 ORDER BY created_at DESC LIMIT $1) e
    CROSS JOIN (VALUES(1),(2)) t(kind)`,
    [extra],
  );
  await db.query(`INSERT INTO event_data(event_data_id,website_id,website_event_id,data_key,string_value,data_type,created_at)
    SELECT gen_random_uuid(),website_id,event_id,'plan','synthetic-plan',1,created_at FROM website_event WHERE event_type=2`);
  await db.query(`UPDATE website_event SET utm_source='synthetic',utm_medium='benchmark',utm_campaign='cache-acceptance'
    WHERE event_type=1 AND url_path IN('/synthetic/start','/synthetic/finish')`);
  await db.query(`INSERT INTO session_data(session_data_id,website_id,session_id,data_key,string_value,data_type)
    SELECT gen_random_uuid(),website_id,session_id,'plan','synthetic-plan',1 FROM benchmark_sessions WHERE i<=1000`);
  await db.query(
    `UPDATE website SET created_at=to_timestamp($1/1000.0)-interval '366 days' WHERE website_id=ANY($2::uuid[])`,
    [end, sites],
  );
  await db.query(
    `WITH returning_sessions AS (INSERT INTO session(session_id,website_id,country,browser,os,device)
    SELECT gen_random_uuid(),website_id,'CN','chrome','mac','desktop' FROM benchmark_sessions WHERE i<=100 RETURNING session_id,website_id)
    INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,url_path,event_type)
    SELECT gen_random_uuid(),s.website_id,s.session_id,gen_random_uuid(),
      to_timestamp($1/1000.0)-d.days*interval '1 day','/synthetic/return',1
    FROM returning_sessions s CROSS JOIN (VALUES(2),(1)) d(days)`,
    [end],
  );
  const goal = randomUUID(),
    funnel = randomUUID(),
    link = randomUUID(),
    pixel = randomUUID();
  const steps = [
    { type: 'path', value: '/synthetic/start' },
    { type: 'path', value: '/synthetic/finish' },
  ];
  await db.query(
    `INSERT INTO report(report_id,user_id,website_id,type,name,description,parameters) VALUES
    ($1,$2,$3,'goal','验收合成目标','',$4::jsonb),($5,$2,$3,'funnel','验收合成漏斗','',$6::jsonb)`,
    [
      goal,
      actor,
      sites[5],
      JSON.stringify({ type: 'path', value: '/synthetic/finish' }),
      funnel,
      JSON.stringify({ window: 24, steps }),
    ],
  );
  await db.query('INSERT INTO link(link_id,name,url,slug,user_id) VALUES($1,$2,$3,$4,$5)', [
    link,
    '验收合成链接',
    'https://analytics-benchmark.invalid/synthetic',
    `benchmark-${link}`,
    actor,
  ]);
  await db.query('INSERT INTO pixel(pixel_id,name,slug,user_id) VALUES($1,$2,$3,$4)', [
    pixel,
    '验收合成图片',
    `benchmark-${pixel}`,
    actor,
  ]);
  for (const [id, type] of [
    [link, 3],
    [pixel, 4],
  ] as const) {
    await db.query(
      `WITH resources AS (
      INSERT INTO session(session_id,website_id,country,browser,os,device) SELECT gen_random_uuid(),$1,'CN','chrome','mac','desktop' FROM generate_series(1,100) RETURNING session_id)
      INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,url_path,event_type,hostname,referrer_domain)
      SELECT gen_random_uuid(),$1,session_id,session_id,to_timestamp($2/1000.0)-interval '10 minutes','/synthetic/resource',$3,
        'analytics-benchmark.invalid','synthetic-'||(row_number() OVER()%30)||'.invalid' FROM resources`,
      [id, end, type],
    );
  }
  const knownSession = (
    await db.query(
      'SELECT session_id FROM benchmark_sessions WHERE website_id=$1 ORDER BY i LIMIT 1',
      [sites[5]],
    )
  ).rows[0].session_id;
  for (const table of ['website_event', 'revenue', 'heatmap_event', 'event_data', 'session_data'])
    await db.query(`ANALYZE ${table}`);
  const geo = await seedGeoCacheMatrix(db, end, sites, actor);
  return {
    ...geo,
    extraCustomEvents: extra,
    extraPerformanceEvents: extra,
    flowPageviews: 1800,
    revenueRows: extra,
    heatmapRows: extra * 2,
    goal,
    funnel,
    link,
    pixel,
    savedSite: sites[5],
    knownSession,
  };
}

export type CacheMatrixEntry = {
  label: string;
  site: string;
  target: string;
  extra: Record<string, unknown>;
  validate: (body: any) => boolean;
  preheat?: string;
  path?: string;
};
export function nativeCacheMatrix(sites: string[]): CacheMatrixEntry[] {
  const array = (body: any) => Array.isArray(body) && body.length > 0;
  const chart = (body: any) => Array.isArray(body.chart) && body.chart.length > 0;
  const funnel = {
    window: 24,
    steps: JSON.stringify([
      { type: 'path', value: '/synthetic/start' },
      { type: 'path', value: '/synthetic/finish' },
    ]),
  };
  return [
    {
      label: 'native-events',
      site: sites[0],
      target: 'events/stats',
      extra: {},
      validate: b => Number(b.data?.events) > 0,
      preheat: 'native:events/stats',
    },
    {
      label: 'native-event-expanded',
      site: sites[1],
      target: 'metrics/expanded',
      extra: { type: 'event', limit: 20, offset: 0 },
      validate: array,
    },
    {
      label: 'native-funnel',
      site: sites[2],
      target: 'funnels/stats',
      extra: funnel,
      validate: b =>
        array(b) && b.length === 2 && Number(b[0].visitors) === 100 && Number(b[1].visitors) === 80,
      preheat: 'native:funnels/stats',
    },
    {
      label: 'native-retention',
      site: sites[3],
      target: 'retention',
      extra: {},
      validate: b =>
        array(b) && b.some((r: any) => Number(r.day) === 1 && Number(r.returnVisitors) > 0),
      preheat: 'native:retention',
    },
    {
      label: 'native-journey',
      site: sites[4],
      target: 'journeys',
      extra: {
        steps: 2,
        startStep: '/synthetic/start',
        endStep: '/synthetic/finish',
        eventType: 1,
      },
      validate: b => array(b) && b.some((r: any) => Number(r.count) > 0),
      preheat: 'native:journeys',
    },
    {
      label: 'native-performance-stats',
      site: sites[5],
      target: 'performance/stats',
      extra: {},
      validate: b => Number(b.count) > 0 && Number(b.lcp?.p75) === 1800.5,
      preheat: 'native:performance/stats',
    },
    {
      label: 'native-performance-chart',
      site: sites[6],
      target: 'performance/chart',
      extra: { metric: 'lcp' },
      validate: b => chart(b) && b.chart.some((r: any) => Number(r.p75) === 1800.5),
      preheat: 'native:performance/chart',
    },
    {
      label: 'native-performance-metrics',
      site: sites[7],
      target: 'performance/metrics',
      extra: { metric: 'lcp', type: 'path', limit: 20 },
      validate: b => array(b) && b.some((r: any) => Number(r.p75) === 1800.5),
      preheat: 'native:performance/metrics',
    },
    {
      label: 'native-revenue-stats',
      site: sites[8],
      target: 'revenue/stats',
      extra: { currency: 'CNY' },
      validate: b => Number(b.sum) > 0 && Number(b.count) > 0,
      preheat: 'native:revenue/stats',
    },
    {
      label: 'native-revenue-chart',
      site: sites[9],
      target: 'revenue/chart',
      extra: { currency: 'CNY' },
      validate: b => chart(b) && b.chart.some((r: any) => Number(r.y) > 0),
      preheat: 'native:revenue/chart',
    },
    {
      label: 'native-revenue-metrics',
      site: sites[0],
      target: 'revenue/metrics',
      extra: { currency: 'CNY', type: 'country' },
      validate: b => array(b) && b.some((r: any) => Number(r.value) > 0),
      preheat: 'native:revenue/metrics',
    },
    {
      label: 'native-heatmap-click',
      site: sites[1],
      target: 'heatmaps',
      extra: { mode: 'click', urlPath: '/synthetic/start' },
      validate: b => array(b.points) && array(b.pages),
      preheat: 'native:heatmaps',
    },
    {
      label: 'native-heatmap-scroll',
      site: sites[2],
      target: 'heatmaps',
      extra: { mode: 'scroll', urlPath: '/synthetic/start' },
      validate: b => array(b.scroll?.buckets) && Number(b.scroll.totalSessions) > 0,
      preheat: 'native:heatmaps',
    },
    {
      label: 'native-utm',
      site: sites[3],
      target: 'utm/metrics',
      extra: { type: 'utm_source' },
      validate: array,
      preheat: 'native:utm/metrics',
    },
  ];
}

export function statisticsEqual(a: unknown, b: unknown) {
  const normalize = (v: any): any =>
    Array.isArray(v)
      ? v.map(normalize)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .filter(k => !['generatedAt', 'expiresAt', 'cache'].includes(k))
              .map(k => [k, normalize(v[k])]),
          )
        : v;
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

export function supplementalCacheMatrix(sites: string[], seeded: any): CacheMatrixEntry[] {
  const array = (b: any) => Array.isArray(b) && b.length > 0;
  const site = seeded.savedSite;
  const feature = (
    label: string,
    extra: Record<string, unknown>,
    validate: (b: any) => boolean,
    selected = sites[6],
  ): CacheMatrixEntry => ({
    label,
    site: selected,
    target: 'analytics',
    path: `/api/liekan/websites/${selected}/analytics`,
    extra,
    validate,
    preheat: 'feature:analytics',
  });
  const eventProperties = feature(
    'feature-event-properties',
    { kind: 'events', eventName: 'synthetic-purchase', propertyName: 'plan' },
    b => Number(b.totals?.total) > 0 && array(b.properties) && array(b.values),
  );
  delete eventProperties.preheat;
  return [
    {
      label: 'native-saved-goal',
      site,
      target: `goals/${seeded.goal}/stats`,
      extra: {},
      validate: b =>
        Number(b.num) > 0 &&
        Number(b.conversions) > 0 &&
        array(b.series) &&
        b.series.reduce((n: number, r: any) => n + Number(r.y), 0) === Number(b.conversions),
    },
    {
      label: 'native-saved-funnel',
      site,
      target: `funnels/${seeded.funnel}/stats`,
      extra: {},
      validate: b =>
        array(b) && b.length === 2 && Number(b[0].visitors) === 100 && Number(b[1].visitors) === 80,
    },
    {
      label: 'feature-saved-goal',
      site,
      target: '',
      path: `/api/liekan/websites/${site}/goals/${seeded.goal}/analytics`,
      extra: {},
      validate: b => Number(b.conversions) > 0 && array(b.series),
    },
    {
      label: 'links-charts',
      site: seeded.link,
      target: '',
      path: '/api/links/charts',
      extra: { ids: seeded.link },
      validate: b => Number(b.data?.[seeded.link]?.total) === 100,
    },
    {
      label: 'pixels-charts',
      site: seeded.pixel,
      target: '',
      path: '/api/pixels/charts',
      extra: { ids: seeded.pixel },
      validate: b => Number(b.data?.[seeded.pixel]?.total) === 100,
    },
    {
      label: 'link-sources',
      site: seeded.link,
      target: '',
      path: `/api/liekan/links/${seeded.link}/sources`,
      extra: { page: 1 },
      validate: b =>
        array(b.rows) && Number(b.count) === 30 && b.rows.every((r: any) => Number(r.clicks) > 0),
    },
    {
      label: 'link-sources-page2',
      site: seeded.link,
      target: '',
      path: `/api/liekan/links/${seeded.link}/sources`,
      extra: { page: 2 },
      validate: b =>
        array(b.rows) && b.rows.length === 5 && Number(b.count) === 30 && Number(b.page) === 2,
    },
    {
      label: 'native-retention-return-filter',
      site: sites[3],
      target: 'retention',
      extra: { path: 'eq./synthetic/return' },
      validate: b =>
        array(b) &&
        [0, 1].every(day =>
          b.some(
            (r: any) =>
              Number(r.day) === day &&
              Number(r.visitors) === 10 &&
              Number(r.returnVisitors) === 10 &&
              Number(r.percentage) === 100,
          ),
        ),
    },
    {
      label: 'website-summary',
      site: sites[0],
      target: '',
      path: '/api/liekan/websites/summary',
      extra: { ids: sites.slice(0, 2).join(',') },
      validate: b =>
        array(b) &&
        b.length === 2 &&
        b.every(
          (r: any) =>
            Number(r.pageviews) > 0 && r.received && Number(r.views) === Number(r.pageviews),
        ),
    },
    feature(
      'feature-events',
      { kind: 'events' },
      b => Number(b.totals?.total) > 0 && array(b.properties),
    ),
    eventProperties,
    feature(
      'feature-utm',
      { kind: 'utm', dimension: 'source' },
      b => array(b.rows) && Number(b.visitors) > 0,
      sites[7],
    ),
    feature(
      'feature-sources',
      { kind: 'sources' },
      b => array(b) && b.some((r: any) => Number(r.visitors) > 0),
      sites[8],
    ),
    feature(
      'feature-performance',
      { kind: 'performance' },
      b => Number(b.lcpCount) > 0 && Number(b.lcpP75) === 1800.5,
      sites[9],
    ),
    feature(
      'feature-attribution',
      { kind: 'attribution', model: 'first-click', type: 'event', step: 'synthetic-purchase' },
      b => Number(b.total?.visitors) > 0 && array(b.referrer),
      sites[0],
    ),
    feature(
      'feature-scroll',
      { kind: 'heatmap-scroll', urlPath: '/synthetic/start' },
      b => Number(b.total) > 0 && Number(b.reach100) > 0,
      sites[1],
    ),
    {
      label: 'feature-journey',
      site: sites[2],
      target: 'journeys',
      path: `/api/liekan/websites/${sites[2]}/journeys`,
      extra: {
        steps: 2,
        type: 'pages',
        startStep: '/synthetic/start',
        endStep: '/synthetic/finish',
      },
      validate: b => array(b.rows) && Number(b.visitors) > 0,
      preheat: 'feature:journeys',
    },
  ];
}

export async function verifyDirectCacheFreshness(
  db: pg.Client,
  base: string,
  headers: Record<string, string>,
  range: any,
  seeded: any,
) {
  const site = seeded.savedSite;
  const read = async (path: string, extra: Record<string, unknown>) => {
    const response = await fetch(
      `${base}${path}?${new URLSearchParams(Object.fromEntries(Object.entries({ ...range, ...extra }).map(([k, v]) => [k, String(v)])))}`,
      { headers },
    );
    assert(response.ok, `direct freshness source ${path}`);
    return (await response.json()) as any;
  };
  const analytics = `/api/liekan/websites/${site}/analytics`;
  await read(analytics, { kind: 'session', sessionId: seeded.knownSession });
  await db.query(
    `INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,url_path,event_type,event_name)
    VALUES(gen_random_uuid(),$1,$2,$2,to_timestamp($3/1000.0)-interval '2 seconds','/synthetic/detail-fresh',2,'synthetic-detail-fresh')`,
    [site, seeded.knownSession, range.endAt],
  );
  assert(
    (await read(analytics, { kind: 'session', sessionId: seeded.knownSession })).rows.some(
      (r: any) => r.eventName === 'synthetic-detail-fresh',
    ),
  );
  await read(analytics, { kind: 'sessions', page: 1 });
  await db.query('UPDATE session SET browser=$1 WHERE session_id=$2', [
    'synthetic-fresh',
    seeded.knownSession,
  ]);
  assert(
    (await read(analytics, { kind: 'sessions', page: 1 })).rows.some(
      (r: any) => r.id === seeded.knownSession && r.browser === 'synthetic-fresh',
    ),
  );
  const revenue = `/api/websites/${site}/revenue/sessions`;
  const revenueBefore = await read(revenue, { currency: 'CNY', page: 1, pageSize: 25 });
  const firstRevenue = revenueBefore.data[0].id;
  await db.query('UPDATE session SET browser=$1 WHERE session_id=$2', [
    'synthetic-revenue',
    firstRevenue,
  ]);
  assert(
    (await read(revenue, { currency: 'CNY', page: 1, pageSize: 25 })).data.some(
      (r: any) => r.id === firstRevenue && r.browser === 'synthetic-revenue',
    ),
  );
  const secondRevenue = (await read(revenue, { currency: 'CNY', page: 2, pageSize: 25 })).data[0]
    .id;
  await db.query('UPDATE session SET browser=$1 WHERE session_id=$2', [
    'synthetic-page2',
    secondRevenue,
  ]);
  assert(
    (await read(revenue, { currency: 'CNY', page: 2, pageSize: 25 })).data.some(
      (r: any) => r.id === secondRevenue && r.browser === 'synthetic-page2',
    ),
  );
  await read(analytics, { kind: 'session-properties' });
  await db.query('UPDATE session_data SET string_value=$1 WHERE session_id=$2 AND data_key=$3', [
    'synthetic-detail-fresh',
    seeded.knownSession,
    'plan',
  ]);
  assert(
    (await read(analytics, { kind: 'session-properties' })).rows.some(
      (r: any) => r.value === 'synthetic-detail-fresh',
    ),
  );
  const journey = `/api/liekan/websites/${site}/journeys/details`;
  const sequence = {
    type: 'pages',
    steps: 2,
    startStep: '/synthetic/start',
    endStep: '/synthetic/finish',
    sequence: JSON.stringify(['/synthetic/start', '/synthetic/finish']),
  };
  const previousJourney = await read(journey, sequence),
    last = previousJourney.sessions[0];
  await db.query(
    "UPDATE website_event SET created_at=created_at+interval '1 second' WHERE session_id=$1 AND url_path='/synthetic/finish'",
    [last.id],
  );
  const nextJourney = await read(journey, sequence);
  assert(nextJourney.sessions.some((r: any) => r.id === last.id && r.lastAt !== last.lastAt));
  const logs = `/api/liekan/websites/${site}/page-report`;
  await read(logs, { resource: 'logs' });
  await db.query(
    `INSERT INTO liekan_log(id,website_id,import_id,created_at,path,method,status,bytes,ip_masked,ip_hash,user_agent,location,bot,vendor,bot_type,verification)
    SELECT md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text),$1,id,to_timestamp($2/1000.0)-interval '1 second','/synthetic/detail-fresh-log','GET',200,64,
      'synthetic',md5('synthetic-detail'),'SyntheticBenchmarkBot','合成地区','SyntheticBenchmarkBot','benchmark','其他','未验证'
    FROM liekan_import WHERE website_id=$1 AND kind='manual' AND source_id IS NULL ORDER BY imported_at,id LIMIT 1`,
    [site, range.endAt],
  );
  assert(
    (await read(logs, { resource: 'logs' })).tables.logBody.some((r: any) =>
      JSON.stringify(r).includes('/synthetic/detail-fresh-log'),
    ),
  );
  const linkPath = `/api/liekan/links/${seeded.link}/sources`;
  const firstPage = await read(linkPath, { page: 1 }),
    secondPage = await read(linkPath, { page: 2 });
  assert.equal(firstPage.rows.length + secondPage.rows.length, 30);
  assert.equal(
    [...firstPage.rows, ...secondPage.rows].reduce((n: number, r: any) => n + Number(r.clicks), 0),
    100,
  );
  return [
    'session-events',
    'sessions-list',
    'native-revenue-sessions',
    'native-revenue-sessions-page2',
    'session-properties',
    'journey-details',
    'GEO-log-rows',
    'link-sources-two-pages',
  ].map(name => ({ name: `direct-freshness:${name}`, passed: true }));
}

const aiTypes = ['训练', '搜索', '用户触发'];
const card = (b: any, label: string) => b.cards?.find((c: any) => c.label === label);
const positiveCard = (b: any, label: string) => {
  const c = card(b, label);
  return (
    c?.state === 'available' &&
    typeof c.value === 'number' &&
    Number.isFinite(c.value) &&
    c.value > 0
  );
};
const todayCard = (b: any, label: string) => {
  const c = card(b, label);
  return (
    c?.state === 'available' &&
    typeof c.value === 'number' &&
    Number.isFinite(c.value) &&
    c.value >= 0
  );
};
const positiveSeries = (b: any, id: string, name?: string) => {
  const chart = b.charts?.[id];
  // buildReport's d1 chart has no explicit state; its declared series still need actual counts.
  return (
    chart &&
    (chart.state === undefined || chart.state === 'available') &&
    chart.labels?.length > 0 &&
    chart.series?.some(
      (s: any) =>
        (!name || s.name === name) &&
        s.values?.some((n: any) => typeof n === 'number' && Number.isFinite(n) && n > 0),
    )
  );
};
const rows = (b: any, id: string, check: (r: any) => boolean) =>
  Array.isArray(b.tables?.[id]) && b.tables[id].some(check);

const validators: Record<string, (b: any) => boolean> = {
  overview: b =>
    positiveCard(b, '访客（UV）') &&
    positiveCard(b, 'AI 蜘蛛请求') &&
    todayCard(b, '今日总请求') &&
    todayCard(b, '今日转化') &&
    ['d1', 'd2', 'd3'].every(id => positiveSeries(b, id)) &&
    rows(b, 'topBody', r => Number(r.humanPv) > 0),
  'ai/overview': b =>
    b.states.logs === 'available' &&
    b.states.catalog === 'available' &&
    ['AI 蜘蛛请求（30天）', '识别 AI 蜘蛛', 'AI 抓取页面覆盖率', '单页日均最高抓取'].every(label =>
      positiveCard(b, label),
    ) &&
    ['a1', 'a2', 'a3', 'a4'].every(id => positiveSeries(b, id)),
  'ai/bots': b =>
    rows(
      b,
      'botBody',
      r =>
        aiTypes.includes(r.type) &&
        Number(r.requests) > 0 &&
        typeof r.trend === 'number' &&
        Number.isFinite(r.trend),
    ) &&
    positiveSeries(b, 'b1') &&
    aiTypes.every(type => b.charts.b1.labels.includes(type)),
  'ai/pages': b =>
    ['被 AI 抓取页面', '反复抓取页面', '从未被抓页面', '平均抓取深度'].every(label =>
      positiveCard(b, label),
    ) &&
    positiveSeries(b, 'ap1') &&
    rows(b, 'apBody', r => Number(r.requests) > 0 && Number(r.bots) > 0 && !!r.lastCrawled) &&
    rows(b, 'blindList', r => r.path === '/synthetic/geo-blind'),
  'ai/preference': b =>
    b.states.catalog === 'available' &&
    positiveSeries(b, 'pf1', 'AI 蜘蛛') &&
    positiveSeries(b, 'pf1', '浏览 PV') &&
    b.charts.pf2?.state === 'available' &&
    b.charts.pf2.rows?.some(
      (r: any) => Number(r.words) > 0 && Number(r.structureScore) > 0 && Number(r.requests) > 0,
    ) &&
    rows(b, 'prefList', r => typeof r.preference === 'string' && r.preference.length > 0) &&
    rows(
      b,
      'pathList',
      r => !!r.bot && !!r.path && !!r.time && Number.isFinite(Number(r.status)),
    ) &&
    ['案例页 AI/浏览 比值', '图文页 vs 交互页'].every(label => positiveCard(b, label)) &&
    card(b, '长文平均抓取完成率')?.state === 'unsupported' &&
    card(b, '长文平均抓取完成率')?.value === null,
  'human/geo': b =>
    positiveSeries(b, 'g1') &&
    positiveSeries(b, 'g2') &&
    rows(b, 'cityBody', r => Number(r.sessions) > 0 && r.city === '验收合成上海') &&
    rows(b, 'cityBody', r => Number(r.sessions) > 0 && r.city === 'Synthetic US City'),
  'human/sources': b =>
    ['直接访问', '传统搜索', 'AI 搜索引荐'].every(channel =>
      rows(b, 'srcBody', r => r.channel === channel && Number(r.sessions) > 0),
    ) &&
    rows(b, 'srcBody', r => r.channel === 'AI 搜索引荐' && Number(r.conversionRate) > 0) &&
    positiveSeries(b, 's1') &&
    positiveSeries(b, 's2'),
  'human/search-engines': b =>
    ['搜索总会话', '传统搜索会话', 'AI 搜索引荐会话', 'AI 搜索占比'].every(label =>
      positiveCard(b, label),
    ) &&
    positiveSeries(b, 'se1') &&
    positiveSeries(b, 'se2') &&
    ['传统搜索', 'AI 搜索引荐'].every(type =>
      rows(
        b,
        'searchEngineBody',
        r => r.type === type && Number(r.sessions) > 0 && Number(r.categoryShare) > 0,
      ),
    ),
  content: b =>
    rows(b, 'pgBody', r => Number(r.pv) > 0) &&
    rows(b, 'journeyList', r => Number(r.count) > 0) &&
    b.charts.c1?.state === 'available' &&
    positiveSeries(b, 'c1', '发布内容 PV（7天）') &&
    b.charts.c1.series
      ?.find((s: any) => s.name === 'AI 抓取增量')
      ?.values.filter((n: any) => n === 50).length === 3,
  conversions: b =>
    b.states.goals === 'available' &&
    positiveCard(b, '全站转化率') &&
    positiveCard(b, '白皮书下载') &&
    todayCard(b, '今日转化') &&
    rows(b, 'goalBody', r => r.name === '验收合成白皮书 download' && Number(r.count) > 0) &&
    ['f1', 'f2', 'f3'].every(id => positiveSeries(b, id)) &&
    b.charts.f1.series[0].values[0] === 100 &&
    b.charts.f1.series[0].values[1] === 80,
};

/** Regular page-report branches; keywords have dedicated snapshot acceptance. */
export function geoCacheMatrix(seeded: GeoCacheSeed): CacheMatrixEntry[] {
  const resources = Object.keys(pageReportParts).filter(
    r => !['human/overview', 'logs', 'human/keywords'].includes(r),
  );
  assert.equal(resources.length, 10);
  return resources.map(resource => ({
    label: `GEO-${resource.replaceAll('/', '-')}`,
    site: seeded.geoSite,
    target: 'page-report',
    path: `/api/liekan/websites/${seeded.geoSite}/page-report`,
    extra: { resource, chartPeriod: '30d' },
    preheat: 'feature:page-report',
    validate: b =>
      pageReportSchema.safeParse(b).success && b.resource === resource && validators[resource](b),
  }));
}

export function returnedPageRangeMatches(body: any, requestUrl: string) {
  const p = new URL(requestUrl, 'http://127.0.0.1').searchParams;
  // Object.fromEntries keeps the final duplicate value, matching the actual route.
  const parameters = Object.fromEntries(p);
  return (
    body.range?.startAt === Number(parameters.startAt) &&
    body.range?.endAt === Number(parameters.endAt) &&
    body.range?.timezone === (parameters.timezone || 'Asia/Shanghai')
  );
}

/** Only declared request metadata changes; every statistical field is still compared. */
export function sameGeoRangeStatistics(body: any, reference: any) {
  return statisticsEqual(
    { ...body, range: { ...body.range, endAt: reference.range.endAt } },
    reference,
  );
}

export function geoScenarioValidator(entry: CacheMatrixEntry, reference: any) {
  return (body: any, requestUrl: string) =>
    returnedPageRangeMatches(body, requestUrl) &&
    entry.validate(body) &&
    sameGeoRangeStatistics(body, reference);
}

/** Require positive TODAY sources once immediately after seed, before timing can cross midnight. */
export function assertInitialGeoTodaySources(body: any) {
  if (body.resource === 'overview') assert(positiveCard(body, '今日总请求'));
  if (['overview', 'conversions'].includes(body.resource)) assert(positiveCard(body, '今日转化'));
}

/** No database mutation: exercises actual log rows, filters, pagination and effective-source rules. */
export async function verifyGeoLogsDirect(
  base: string,
  headers: Record<string, string>,
  range: { startAt: number; endAt: number; timezone: string },
  seeded: GeoCacheSeed,
) {
  const path = `/api/liekan/websites/${seeded.geoSite}/page-report`;
  const read = async (extra: Record<string, unknown>) => {
    const url = `${base}${path}?${new URLSearchParams(
      Object.fromEntries(
        Object.entries({ ...range, resource: 'logs', ...extra }).map(([k, v]) => [k, String(v)]),
      ),
    )}`;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(65000) });
    assert(response.ok, `logs direct status ${response.status}: ${JSON.stringify(extra)}`);
    const body = await response.json();
    assert(pageReportSchema.safeParse(body).success && body.resource === 'logs');
    assert(returnedPageRangeMatches(body, url));
    assert.notEqual(response.headers.get('x-liekan-cache'), 'hit');
    const serverTime = Number(response.headers.get('x-liekan-server-time'));
    assert(Number.isFinite(serverTime) && serverTime > 0);
    if (response.headers.has('x-liekan-expires-at'))
      assert(Number(response.headers.get('x-liekan-expires-at')) <= serverTime);
    assert(body.meta.expiresAt <= serverTime);
    assert(body.tables.logBody.length > 0 && Number(body.meta.totalLogs) > 0);
    return body;
  };
  for (const filter of ['ai', 'abnormal', 'other']) {
    const body = await read({ filter, page: 1 });
    assert(
      body.tables.logBody.every((r: any) =>
        filter === 'ai'
          ? ['训练', '搜索', '用户触发'].includes(r.botType)
          : filter === 'abnormal'
            ? Number(r.status) >= 400
            : r.bot === '其他',
      ),
    );
  }
  const search = '/synthetic/geo-log-flow/';
  const first = await read({ search, page: 1 });
  const second = await read({ search, page: 2 });
  const ids = (b: any) => b.tables.logBody.map((r: any) => r.recordId);
  assert.equal(first.meta.totalLogs, 240);
  assert.equal(first.meta.pageSize, 100);
  assert.equal(second.meta.page, 2);
  assert.equal(first.tables.logBody.length, 100);
  assert.equal(second.tables.logBody.length, 100);
  assert(second.tables.logBody.every((r: any) => !ids(first).includes(r.recordId)));
  assert(first.meta.nextCursor);
  const after = await read({ search, page: 2, cursor: first.meta.nextCursor, seek: 'after' });
  assert.equal(after.meta.page, 2);
  assert.deepEqual(ids(after), ids(second));
  const third = await read({ search, page: 3 });
  assert.equal(third.tables.logBody.length, 40);
  assert.equal(new Set([...ids(first), ...ids(second), ...ids(third)]).size, 240);
  const before = await read({
    search,
    page: 1,
    cursor: second.meta.previousCursor,
    seek: 'before',
  });
  assert.deepEqual(ids(before), ids(first));

  const interval = await read({ search: '/synthetic/geo-interval-' });
  assert.equal(interval.meta.totalLogs, 1);
  assert.deepEqual(ids(interval), [seeded.geoIntervalVisibleRecord]);
  assert(
    interval.tables.logBody.every(
      (r: any) => !seeded.geoIntervalExcludedRecords.includes(r.recordId),
    ),
  );
  return { name: 'GEO-logs-direct-filters-pages-cursors-and-source-interval', passed: true };
}
