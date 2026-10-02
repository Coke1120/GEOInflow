import { formatInTimeZone } from 'date-fns-tz';
import { decodeCursor, encodeCursor } from '../cursor';
import { humanPathFromEncoded } from './paths';
import { LiekanError, query } from './server';

// This boundary only applies to the today content-request card. Raw logs remain complete.
export const staticRequestExtensionPattern =
  '[.](js|mjs|cjs|css|map|avif|webp|png|jpg|jpeg|gif|svg|ico|bmp|tif|tiff|woff|woff2|ttf|otf|eot|mp3|m4a|wav|ogg|mp4|webm|mov|avi)([?#]|$)';
export const isStaticRequestPath = (path: string) =>
  new RegExp(staticRequestExtensionPattern, 'i').test(path);
export async function getLogFacts(
  id: string,
  start: Date,
  end: Date,
  timezone: string,
  page = 1,
  filter = '',
  search = '',
  cursor = '',
  seek: 'after' | 'before' = 'after',
) {
  const base =
    'FROM liekan_log WHERE website_id=$1::uuid AND created_at BETWEEN $2::timestamptz AND $3::timestamptz AND $4::text IS NOT NULL';
  const ai = " AND bot_type IN('训练','搜索','用户触发')";
  const args = [id, start, end, timezone];
  const q = (sql: string) => query(sql, ...args);
  const filterSql =
    filter === 'ai'
      ? ai
      : filter === 'abnormal'
        ? ' AND status>=400'
        : filter === 'other'
          ? " AND bot='其他'"
          : '';
  let boundary: [Date, string];
  if (cursor) {
    try {
      boundary = decodeCursor(cursor);
    } catch {
      throw new LiekanError('日志游标无效');
    }
  }
  const seekSql = cursor
    ? ` AND (created_at,id) ${seek === 'before' ? '>' : '<'} ($6::timestamptz,$7)`
    : '';
  const paginationSql = cursor ? '' : ' OFFSET $6';
  const direction = cursor && seek === 'before' ? 'ASC' : 'DESC';
  const [summary, daily, bots, pages, statuses, hours, catalog, latest, recent, count] =
    await Promise.all([
      q(
        `SELECT count(*)::int AS requests,count(*) FILTER(WHERE bot_type IN('训练','搜索','用户触发'))::int AS ai,count(distinct path) FILTER(WHERE bot_type IN('训练','搜索','用户触发'))::int AS pages,count(*) FILTER(WHERE status>=400)::int AS abnormal ${base}`,
      ),
      q(
        `SELECT to_char(created_at AT TIME ZONE $4,'YYYY-MM-DD') AS day,bot,count(*)::int AS count ${base} AND bot!='其他' GROUP BY 1,2 ORDER BY 1`,
      ),
      q(
        `SELECT bot AS name,vendor,bot_type AS type,count(*)::int AS requests,count(distinct path)::int AS pages,max(created_at) AS "lastVisit" ${base} AND bot!='其他' GROUP BY 1,2,3 ORDER BY requests DESC`,
      ),
      q(
        `SELECT path,bot,count(*)::int AS requests,max(created_at) AS "lastCrawled" ${base}${ai} GROUP BY 1,2 ORDER BY requests DESC`,
      ),
      q(
        `SELECT (status/100)*100 AS status,count(*)::int AS count ${base}${ai} GROUP BY 1 ORDER BY 1`,
      ),
      q(
        `SELECT extract(hour FROM created_at AT TIME ZONE $4)::int AS hour,count(*)::int AS count ${base}${ai} GROUP BY 1 ORDER BY 1`,
      ),
      query(
        'SELECT path,title,content_type AS type,word_count AS "wordCount",published_at AS "publishedAt",content_updated_at AS "updatedAt",link_depth AS "linkDepth",evidence_source AS source,structured,structure_score AS "structureScore" FROM liekan_catalog WHERE website_id=$1::uuid ORDER BY path',
        id,
      ),
      query(
        'SELECT imported_at AS time FROM liekan_import WHERE website_id=$1::uuid ORDER BY imported_at DESC LIMIT 1',
        id,
      ),
      query(
        `SELECT id AS "recordId",created_at AS time,ip_masked AS "ipMasked",location,method,path,status,user_agent AS "userAgent",bot,bot_type AS "botType",verification ${base}${filterSql} AND strpos(lower(concat_ws(' ',path,user_agent,method,status::text,ip_masked,location,bot,bot_type,CASE verification WHEN 'verified_range' THEN '官方 IP 范围匹配' WHEN 'range_mismatch' THEN '官方范围未匹配' ELSE '身份未核验' END)) ,lower($5))>0 ${seekSql} ORDER BY created_at ${direction},id ${direction} LIMIT 100${paginationSql}`,
        ...args,
        search,
        ...(cursor ? boundary : [(page - 1) * 100]),
      ),
      query(
        `SELECT count(*)::int AS count ${base}${filterSql} AND strpos(lower(concat_ws(' ',path,user_agent,method,status::text,ip_masked,location,bot,bot_type,CASE verification WHEN 'verified_range' THEN '官方 IP 范围匹配' WHEN 'range_mismatch' THEN '官方范围未匹配' ELSE '身份未核验' END)) ,lower($5))>0`,
        ...args,
        search,
      ),
    ]);
  return {
    summary: summary[0],
    daily,
    bots,
    pages,
    statuses,
    hours,
    catalog,
    latest: latest[0]?.time ?? null,
    recent: cursor && seek === 'before' ? recent.reverse() : recent,
    nextCursor: recent.length ? encodeCursor(recent.at(-1)) : '',
    previousCursor: page > 1 && recent.length ? encodeCursor(recent[0]) : '',
    totalLogs: count[0].count,
    previousBots: await query(
      'SELECT bot AS name,vendor,bot_type AS type,count(*)::int AS requests FROM liekan_log WHERE website_id=$1::uuid AND created_at BETWEEN $2 AND $3 GROUP BY 1,2,3',
      id,
      new Date(Math.max(0, start.getTime() - (end.getTime() - start.getTime() + 1))),
      new Date(start.getTime() - 1),
    ),
  };
}
export async function getLogToday(id: string, start: Date, end: Date) {
  const [rows, imports] = await Promise.all([
    query(
      `SELECT count(*) FILTER(WHERE path !~* '${staticRequestExtensionPattern}')::int AS requests,count(*) FILTER(WHERE status>=400)::int AS abnormal FROM liekan_log WHERE website_id=$1::uuid AND created_at BETWEEN $2 AND $3`,
      id,
      start,
      end,
    ),
    query(
      'SELECT coalesce(sum(accepted),0)::int AS accepted FROM liekan_import WHERE website_id=$1::uuid AND imported_at BETWEEN $2 AND $3',
      id,
      start,
      end,
    ),
  ]);
  return { ...rows[0], accepted: imports[0].accepted };
}
export async function getContentImpact(id: string, start: Date, end: Date) {
  const targets = await query<{ path: string; publishedAt: Date | string }>(
    `SELECT path,published_at AS "publishedAt" FROM liekan_catalog WHERE website_id=$1::uuid AND published_at BETWEEN $2 AND $3 AND published_at+interval '7 days'<=now() ORDER BY published_at DESC LIMIT 20`,
    id,
    start,
    end,
  );
  if (!targets.length) return [];
  return query(
    `WITH targets AS (SELECT * FROM jsonb_to_recordset($2::jsonb) AS c(path text,"humanPath" text,"publishedAt" timestamptz))
    SELECT c.path,
    (SELECT count(*)::int FROM website_event e WHERE e.website_id=$1::uuid AND e.url_path=c."humanPath" AND e.event_type=1 AND e.created_at>=c."publishedAt" AND e.created_at<c."publishedAt"+interval '7 days') AS pv,
    (SELECT count(*)::int FROM liekan_log l WHERE l.website_id=$1::uuid AND l.path=c.path AND l.bot_type IN('训练','搜索','用户触发') AND l.created_at>=c."publishedAt" AND l.created_at<c."publishedAt"+interval '7 days')-
    (SELECT count(*)::int FROM liekan_log l WHERE l.website_id=$1::uuid AND l.path=c.path AND l.bot_type IN('训练','搜索','用户触发') AND l.created_at>=c."publishedAt"-interval '7 days' AND l.created_at<c."publishedAt") AS increment
    FROM targets c ORDER BY c."publishedAt" DESC`,
    id,
    JSON.stringify(
      targets.map(target => ({ ...target, humanPath: humanPathFromEncoded(target.path) })),
    ),
  );
}
export async function getMonthlyAiShare(id: string, end: Date, timezone: string) {
  const rows = await query<{ month: string; total: number; ai: number }>(
    `SELECT to_char(created_at AT TIME ZONE $3,'YYYY-MM') AS month,count(*)::int AS total,count(*) FILTER(WHERE bot_type IN('训练','搜索','用户触发'))::int AS ai FROM liekan_log WHERE website_id=$1::uuid AND created_at<=$2 AND created_at>=((date_trunc('month',$2::timestamptz AT TIME ZONE $3)-interval '5 months') AT TIME ZONE $3) GROUP BY 1 ORDER BY 1`,
    id,
    end,
    timezone,
  );
  const [year, month] = formatInTimeZone(end, timezone, 'yyyy-MM').split('-').map(Number);
  return Array.from({ length: 6 }, (_, index) => {
    const label = new Date(Date.UTC(year, month - 6 + index, 1)).toISOString().slice(0, 7);
    return rows.find(row => row.month === label) ?? { month: label, total: 0, ai: 0 };
  });
}
export async function getPlotLogs(
  id: string,
  start: Date,
  end: Date,
  timezone: string,
  hour = false,
) {
  return query(
    `SELECT to_char(created_at AT TIME ZONE $4,'${hour ? 'YYYY-MM-DD HH24:00' : 'YYYY-MM-DD'}') AS day,bot,bot_type AS type,count(*)::int AS count FROM liekan_log WHERE website_id=$1::uuid AND created_at BETWEEN $2 AND $3 GROUP BY 1,2,3 ORDER BY 1`,
    id,
    start,
    end,
    timezone,
  );
}
