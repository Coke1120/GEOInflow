import { getPostgresCountrySQL, getPostgresRegionSQL } from '@/lib/country';
import { getFunnel } from '@/queries/sql';
import { humanTotals, query } from './server';

export type EntrySource = {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referrer?: string | null;
};
type Channel = 'AI 搜索引荐' | '传统搜索' | '其他引荐' | '直接访问';
const aiAliases = {
  chatgpt: 'chatgpt.com',
  openai: 'chat.openai.com',
  perplexity: 'perplexity.ai',
  claude: 'claude.ai',
  gemini: 'gemini.google.com',
  copilot: 'copilot.microsoft.com',
  doubao: 'doubao.com',
  kimi: 'kimi.com',
  'kimi.moonshot.cn': 'kimi.moonshot.cn',
  yiyan: 'yiyan.baidu.com',
  deepseek: 'deepseek.com',
};
const searchAliases = {
  google: 'google.com',
  'google.com.hk': 'google.com.hk',
  'google.cn': 'google.cn',
  bing: 'bing.com',
  baidu: 'baidu.com',
  sogou: 'sogou.com',
  '360': 'so.com',
  so: 'so.com',
  duckduckgo: 'duckduckgo.com',
  yahoo: 'yahoo.com',
};
const nonSearchMedia = new Set([
  'email',
  'e-mail',
  'newsletter',
  'sms',
  'social',
  'paid_social',
  'paid-social',
  'display',
  'affiliate',
  'push',
  'banner',
]);
const domains = (host: string, values: string[]) =>
  values.some(domain => host === domain || host.endsWith(`.${domain}`));
const domainChannel = (host: string): Channel =>
  domains(host, Object.values(aiAliases))
    ? 'AI 搜索引荐'
    : domains(host, Object.values(searchAliases))
      ? '传统搜索'
      : '其他引荐';

export function classifyEntrySource(entry: EntrySource): { source: string; channel: Channel } {
  const source = entry.utmSource?.trim() || '';
  const medium = entry.utmMedium?.trim().toLowerCase() || '';
  const normalized = source.toLowerCase();
  // Only explicit aliases and approved domains identify a platform. Unknown UTM values stay visible.
  const canonical =
    (Object.hasOwn(aiAliases, normalized) ? aiAliases[normalized] : '') ||
    (Object.hasOwn(searchAliases, normalized) ? searchAliases[normalized] : '') ||
    source;
  if (source || medium)
    return {
      source: canonical || `UTM / ${medium}`,
      channel:
        nonSearchMedia.has(medium) || !source ? '其他引荐' : domainChannel(canonical.toLowerCase()),
    };
  // A campaign name alone carries no channel evidence; preserve it for inspection and use Referer.
  const referrer = entry.referrer?.trim().toLowerCase() || '';
  return referrer && referrer !== '直接访问'
    ? { source: referrer, channel: domainChannel(referrer) }
    : { source: '直接访问', channel: '直接访问' };
}

function sourceFacts(rows: any[]) {
  const grouped = new Map<string, any>();
  for (const row of rows) {
    const attribution = classifyEntrySource(row);
    const key = JSON.stringify([row.day, attribution.source, attribution.channel]);
    let group = grouped.get(key);
    if (!group) {
      group = {
        ...attribution,
        ...(row.day ? { day: row.day } : {}),
        sessions: 0,
        pv: 0,
        bounces: 0,
        conversions: 0,
        count: 0,
        duration: 0,
        evidence: new Map<string, Set<string>>(),
      };
      grouped.set(key, group);
    }
    group.duration += (row.duration ?? 0) * (row.sessions ?? 0);
    for (const metric of ['sessions', 'pv', 'bounces', 'conversions', 'count'])
      group[metric] += row[metric] ?? 0;
    for (const field of ['utmSource', 'utmMedium', 'utmCampaign', 'referrer']) {
      if (!group.evidence.has(field)) group.evidence.set(field, new Set());
      if (row[field]) group.evidence.get(field).add(row[field]);
    }
  }
  return [...grouped.values()]
    .map(({ evidence, ...row }) => ({
      ...row,
      duration: row.sessions ? row.duration / row.sessions : 0,
      ...Object.fromEntries(
        [...evidence].map(([field, values]) => [field, [...values].sort().join(' | ') || null]),
      ),
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

// All knowledge of upstream storage and metric semantics is confined here.
const cte = `WITH events AS (SELECT e.*,s.country,s.region,s.city,s.browser,s.os,s.device FROM website_event e
  JOIN session s ON s.session_id=e.session_id AND s.website_id=e.website_id
  WHERE e.website_id=$1::uuid AND e.created_at BETWEEN $2::timestamptz AND $3::timestamptz AND e.event_type != 5 AND $4::text IS NOT NULL),
visit_totals AS (SELECT visit_id,session_id,count(*) FILTER(WHERE event_type NOT IN(2,5))::int AS pv,
  bool_or(event_type=2)::int AS custom, min(created_at) FILTER(WHERE event_type NOT IN(2,5)) AS started,
  extract(epoch FROM max(created_at) FILTER(WHERE event_type NOT IN(2,5))-min(created_at) FILTER(WHERE event_type NOT IN(2,5)))::float AS duration,
  max(country) AS country,max(region) AS region,max(city) AS city,max(browser) AS browser,max(os) AS os,max(device) AS device
  FROM events GROUP BY visit_id,session_id HAVING count(*) FILTER(WHERE event_type NOT IN(2,5))>0),
visits AS (SELECT v.*,entry.referrer_domain AS referrer,entry.utm_source AS "utmSource",entry.utm_medium AS "utmMedium",entry.utm_campaign AS "utmCampaign"
  FROM visit_totals v LEFT JOIN LATERAL (
    SELECT e.referrer_domain,e.utm_source,e.utm_medium,e.utm_campaign FROM website_event e
    WHERE e.website_id=$1::uuid AND e.visit_id=v.visit_id AND e.session_id=v.session_id
      AND e.created_at<=$3::timestamptz AND e.event_type NOT IN(2,5)
    ORDER BY e.created_at,e.event_id LIMIT 1
  ) entry ON true),
definitions AS (SELECT report_id,name,parameters FROM report WHERE website_id=$1::uuid AND type='goal'),
matches AS (SELECT DISTINCT d.report_id,e.event_id,e.created_at,e.visit_id,e.session_id FROM definitions d JOIN events e ON
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
    dailyConversions,
  ] = await Promise.all([
    humanTotals(id, start, end),
    sql(
      ` SELECT to_char(v.started AT TIME ZONE $4,'YYYY-MM-DD') AS day, count(distinct v.session_id)::int AS uv, ${visitMetrics} FROM visits v ${convertedJoin} GROUP BY 1 ORDER BY 1`,
    ),
    sql(
      ` SELECT ${getPostgresCountrySQL('v.country')} AS country,${getPostgresRegionSQL('v.country', 'v.region')} AS region,v.city,${visitMetrics} FROM visits v ${convertedJoin} GROUP BY 1,2,3 ORDER BY sessions DESC`,
    ),
    sql(
      ` SELECT v.referrer,v."utmSource",v."utmMedium",v."utmCampaign",${visitMetrics} FROM visits v ${convertedJoin} GROUP BY 1,2,3,4 ORDER BY sessions DESC`,
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
      ` SELECT d.report_id AS id,d.name,d.parameters->>'value' AS path,count(distinct m.event_id)::int AS count,count(distinct (m.visit_id,m.session_id)) FILTER(WHERE v.visit_id IS NOT NULL)::int AS "convertedSessions" FROM definitions d LEFT JOIN matches m USING(report_id) LEFT JOIN visits v ON v.visit_id=m.visit_id AND v.session_id=m.session_id GROUP BY 1,2,3`,
    ),
    sql(
      ` SELECT count(*)::int AS count,(SELECT count(distinct event_id)::int FROM matches) AS events FROM visits v JOIN converted cv USING(visit_id,session_id)`,
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
      ` SELECT to_char(started AT TIME ZONE $4,'YYYY-MM-DD') AS day,referrer,"utmSource","utmMedium","utmCampaign",count(*)::int AS count FROM visits GROUP BY 1,2,3,4,5 ORDER BY 1`,
    ),
    sql(
      ` SELECT count(distinct v.session_id)::int AS count FROM visits v JOIN session s ON s.session_id=v.session_id AND s.website_id=$1::uuid WHERE s.created_at BETWEEN $2 AND $3`,
    ),
    query(
      cte +
        ` SELECT v.referrer,v."utmSource",v."utmMedium",v."utmCampaign",count(*)::int AS sessions,count(*) FILTER(WHERE cv.visit_id IS NOT NULL)::int AS conversions FROM visits v ${convertedJoin} GROUP BY 1,2,3,4`,
      id,
      new Date(Math.max(0, start.getTime() - (end.getTime() - start.getTime() + 1))),
      new Date(start.getTime() - 1),
      timezone,
    ),
    query(
      cte +
        ` SELECT report_id AS id,count(distinct event_id)::int AS count FROM matches GROUP BY 1`,
      id,
      new Date(Math.max(0, start.getTime() - (end.getTime() - start.getTime() + 1))),
      new Date(start.getTime() - 1),
      timezone,
    ),
    sql(
      ` SELECT to_char(created_at AT TIME ZONE $4,'YYYY-MM-DD') AS day,count(distinct event_id)::int AS count FROM matches GROUP BY 1 ORDER BY 1`,
    ),
  ]);
  const allGoals = definitions
    .filter(d => d.parameters?.value && !Array.isArray(d.parameters?.steps))
    .map(d => ({
      id: d.id,
      name: d.name,
      path: d.parameters.value,
      count: goals.find(g => g.id === d.id)?.count ?? 0,
      convertedSessions: goals.find(g => g.id === d.id)?.convertedSessions ?? 0,
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
    sources: sourceFacts(sources),
    sourceEvidence: sources.map(row => ({ ...row, ...classifyEntrySource(row) })),
    environment,
    pages,
    heatmap,
    goals: allGoals,
    converted: converted[0]?.count ?? 0,
    conversionEvents: converted[0]?.events ?? 0,
    dailyConversions,
    funnel,
    journeys,
    exits,
    dailySources: sourceFacts(dailySources),
    newVisitors: newVisitors[0]?.count ?? 0,
    previousSources: sourceFacts(previousSources),
  };
}
export async function getHumanConversions(id: string, start: Date, end: Date, timezone: string) {
  return (
    (
      await query(
        `${cte} SELECT count(distinct event_id)::int AS count FROM matches`,
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
