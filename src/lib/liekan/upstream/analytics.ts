import { getPostgresCountrySQL, getPostgresRegionSQL } from '@/lib/country';
import { getFunnel } from '@/queries/sql';
import { humanTotals, query } from './server';

// All knowledge of upstream storage and metric semantics is confined here.
const cte = `WITH events AS (SELECT e.*,s.country,s.region,s.city,s.browser,s.os,s.device FROM website_event e
  JOIN session s ON s.session_id=e.session_id AND s.website_id=e.website_id
  WHERE e.website_id=$1::uuid AND e.created_at BETWEEN $2::timestamptz AND $3::timestamptz AND e.event_type != 5 AND $4::text IS NOT NULL),
visits AS (SELECT visit_id,session_id,count(*) FILTER(WHERE event_type NOT IN(2,5))::int AS pv,
  bool_or(event_type=2)::int AS custom, min(created_at) FILTER(WHERE event_type NOT IN(2,5)) AS started,
  extract(epoch FROM max(created_at) FILTER(WHERE event_type NOT IN(2,5))-min(created_at) FILTER(WHERE event_type NOT IN(2,5)))::float AS duration,
  (array_agg(referrer_domain ORDER BY created_at) FILTER(WHERE event_type NOT IN(2,5)))[1] AS source,
  max(country) AS country,max(region) AS region,max(city) AS city,max(browser) AS browser,max(os) AS os,max(device) AS device
  FROM events GROUP BY visit_id,session_id HAVING count(*) FILTER(WHERE event_type NOT IN(2,5))>0),
definitions AS (SELECT report_id,name,parameters FROM report WHERE website_id=$1::uuid AND type='goal'),
matches AS (SELECT DISTINCT d.report_id,e.visit_id,e.session_id FROM definitions d JOIN events e ON
  ((d.parameters->>'type'='path' AND e.event_type=1 AND CASE WHEN (left(d.parameters->>'value',1)='*' OR right(d.parameters->>'value',1)='*') THEN e.url_path LIKE regexp_replace(regexp_replace(d.parameters->>'value','^[*]','%'),'[*]$','%') ELSE e.url_path=d.parameters->>'value' END) OR
   (d.parameters->>'type'!='path' AND e.event_type=2 AND CASE WHEN (left(d.parameters->>'value',1)='*' OR right(d.parameters->>'value',1)='*') THEN e.event_name LIKE regexp_replace(regexp_replace(d.parameters->>'value','^[*]','%'),'[*]$','%') ELSE e.event_name=d.parameters->>'value' END))),
converted AS (SELECT DISTINCT visit_id,session_id FROM matches)`;

const visitMetrics = `count(*)::int AS sessions, sum(v.pv)::int AS pv,
  avg(v.duration)::float AS duration, count(*) FILTER(WHERE v.pv=1 AND v.custom=0)::int AS bounces,
  count(*) FILTER(WHERE cv.visit_id IS NOT NULL)::int AS conversions`;
const convertedJoin =
  'LEFT JOIN converted cv ON cv.visit_id=v.visit_id AND cv.session_id=v.session_id';
export async function getHumanFacts(id: string, start: Date, end: Date, timezone: string) {
  const args = [id, start, end, timezone];
  const sql = (tail: string) => query(cte + tail, ...args);
  const [
    totals,
    daily,
    geo,
    sources,
    environment,
    pages,
    heatmap,
    goals,
    converted,
    definitions,
    journeys,
    exits,
    dailySources,
    newVisitors,
    previousSources,
    previousGoals,
  ] = await Promise.all([
    humanTotals(id, start, end),
    sql(
      ` SELECT to_char(v.started AT TIME ZONE $4,'YYYY-MM-DD') AS day, count(distinct v.session_id)::int AS uv, ${visitMetrics} FROM visits v ${convertedJoin} GROUP BY 1 ORDER BY 1`,
    ),
    sql(
      ` SELECT ${getPostgresCountrySQL('v.country')} AS country,${getPostgresRegionSQL('v.country', 'v.region')} AS region,v.city,${visitMetrics} FROM visits v ${convertedJoin} GROUP BY 1,2,3 ORDER BY sessions DESC`,
    ),
    sql(
      ` SELECT coalesce(nullif(v.source,''),'直接访问') AS source,${visitMetrics} FROM visits v ${convertedJoin} GROUP BY 1 ORDER BY sessions DESC`,
    ),
    sql(
      ` SELECT device,browser,os,count(*)::int AS sessions FROM visits GROUP BY 1,2,3 ORDER BY sessions DESC`,
    ),
    sql(`, ordered AS (SELECT *,row_number() OVER(PARTITION BY visit_id,session_id ORDER BY created_at,event_id) AS ordinal,extract(epoch FROM lead(created_at) OVER(PARTITION BY visit_id,session_id ORDER BY created_at,event_id)-created_at)::float AS dwell FROM events WHERE event_type NOT IN(2,5))
      SELECT e.url_path AS path,count(*)::int AS pv,count(distinct e.session_id)::int AS uv,count(*) FILTER(WHERE e.ordinal=1)::int AS entries,avg(e.dwell)::float AS duration,count(e.dwell)::int AS samples,
      count(*) FILTER(WHERE e.ordinal=1 AND v.pv=1 AND v.custom=0)::int AS bounces FROM ordered e JOIN visits v USING(visit_id,session_id) GROUP BY 1 ORDER BY pv DESC`),
    sql(
      ` SELECT extract(dow FROM started AT TIME ZONE $4)::int AS weekday,extract(hour FROM started AT TIME ZONE $4)::int AS hour,count(*)::int AS count FROM visits GROUP BY 1,2`,
    ),
    sql(
      ` SELECT d.report_id AS id,d.name,d.parameters->>'value' AS path,count(distinct m.visit_id)::int AS count FROM definitions d LEFT JOIN matches m USING(report_id) JOIN visits v ON v.visit_id=m.visit_id AND v.session_id=m.session_id GROUP BY 1,2,3`,
    ),
    sql(
      ` SELECT count(*)::int AS count FROM visits v JOIN converted cv USING(visit_id,session_id)`,
    ),
    query(
      "SELECT report_id AS id,name,parameters FROM report WHERE website_id=$1::uuid AND type IN('goal','funnel') ORDER BY created_at LIMIT 100",
      id,
    ),
    sql(
      `, paths AS (SELECT visit_id,(array_agg(url_path ORDER BY created_at,event_id))[1:6] AS path FROM events WHERE event_type=1 GROUP BY visit_id) SELECT array_to_string(path,' → ') AS path,count(*)::int AS count FROM paths GROUP BY 1 ORDER BY count DESC LIMIT 6`,
    ),
    sql(
      `, lasts AS (SELECT DISTINCT ON(visit_id,session_id) url_path AS path FROM events WHERE event_type=1 ORDER BY visit_id,session_id,created_at DESC,event_id DESC) SELECT path,count(*)::int AS count FROM lasts GROUP BY 1 ORDER BY count DESC LIMIT 1`,
    ),
    sql(
      ` SELECT to_char(started AT TIME ZONE $4,'YYYY-MM-DD') AS day,coalesce(nullif(source,''),'直接访问') AS source,count(*)::int AS count FROM visits GROUP BY 1,2 ORDER BY 1`,
    ),
    sql(
      ` SELECT count(distinct v.session_id)::int AS count FROM visits v JOIN session s ON s.session_id=v.session_id AND s.website_id=$1::uuid WHERE s.created_at BETWEEN $2 AND $3`,
    ),
    query(
      cte +
        ` SELECT coalesce(nullif(v.source,''),'直接访问') AS source,count(*)::int AS sessions,count(*) FILTER(WHERE cv.visit_id IS NOT NULL)::int AS conversions FROM visits v ${convertedJoin} GROUP BY 1`,
      id,
      new Date(Math.max(0, start.getTime() - (end.getTime() - start.getTime() + 1))),
      new Date(start.getTime() - 1),
      timezone,
    ),
    query(
      cte +
        ` SELECT report_id AS id,count(distinct (m.visit_id,m.session_id))::int AS count FROM matches m JOIN visits v USING(visit_id,session_id) GROUP BY 1`,
      id,
      new Date(Math.max(0, start.getTime() - (end.getTime() - start.getTime() + 1))),
      new Date(start.getTime() - 1),
      timezone,
    ),
  ]);
  const allGoals = definitions
    .filter(d => d.parameters?.value && !Array.isArray(d.parameters?.steps))
    .map(d => ({
      id: d.id,
      name: d.name,
      path: d.parameters.value,
      count: goals.find(g => g.id === d.id)?.count ?? 0,
      previous: previousGoals.find(g => g.id === d.id)?.count ?? 0,
    }));
  const funnelDef = definitions.find(d => Array.isArray(d.parameters?.steps));
  const funnel = funnelDef
    ? await getFunnel(
        id,
        { ...funnelDef.parameters, startDate: start, endDate: end },
        { startDate: start, endDate: end },
      )
    : [];
  return {
    totals,
    daily,
    geo,
    sources,
    environment,
    pages,
    heatmap,
    goals: allGoals,
    converted: converted[0]?.count ?? 0,
    funnel,
    journeys,
    exits,
    dailySources,
    newVisitors: newVisitors[0]?.count ?? 0,
    previousSources,
  };
}
export async function getHumanConversions(id: string, start: Date, end: Date, timezone: string) {
  return (
    (
      await query(
        cte +
          ' SELECT count(*)::int AS count FROM visits v JOIN converted cv USING(visit_id,session_id)',
        id,
        start,
        end,
        timezone,
      )
    )[0]?.count ?? 0
  );
}
export async function getHumanDays(
  id: string,
  start: Date,
  end: Date,
  timezone: string,
  hour = false,
) {
  return query(
    cte +
      ` SELECT to_char(v.started AT TIME ZONE $4,'${hour ? 'YYYY-MM-DD HH24:00' : 'YYYY-MM-DD'}') AS day,count(distinct v.session_id)::int AS uv,${visitMetrics} FROM visits v ${convertedJoin} GROUP BY 1 ORDER BY 1`,
    id,
    start,
    end,
    timezone,
  );
}
