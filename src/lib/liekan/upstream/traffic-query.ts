export const TRAFFIC_POLICY_VERSION = 'traffic-quality-browser-population-v4';

type Token = { value: string; start: number; end: number; identifier: boolean };

// Recognize SQL structure without changing comments, quoted values or bound parameters.
function tokens(sql: string): Token[] {
  const result: Token[] = [];
  const pattern =
    /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|\$([a-zA-Z_][\w]*)?\$[\s\S]*?\$\1\$|"(?:""|[^"])*"|[a-zA-Z_][\w]*|[^\s]/g;
  for (const match of sql.matchAll(pattern)) {
    const text = match[0];
    if (
      text.startsWith('--') ||
      text.startsWith('/*') ||
      text.startsWith("'") ||
      text.startsWith('$')
    )
      continue;
    const quoted = text.startsWith('"');
    result.push({
      value: quoted ? text.slice(1, -1).replaceAll('""', '"') : text.toLowerCase(),
      start: match.index!,
      end: match.index! + text.length,
      identifier: quoted || /^[a-zA-Z_]/.test(text),
    });
  }
  return result;
}

const effectiveTables = {
  website_event: 'liekan_geographic_website_event',
  event_data: 'liekan_effective_event_data',
  revenue: 'liekan_effective_revenue',
  heatmap_event: 'liekan_effective_heatmap_event',
  session_replay: 'liekan_effective_session_replay',
  session: 'liekan_effective_session',
  session_data: 'liekan_effective_session_data',
  session_link: 'liekan_effective_session_link',
} as const;

/** Keep geography filters and event-bound visitor rows on one visit tuple. */
function withVisitGeography(sql: string) {
  const parts = tokens(sql),
    scopes: number[] = [],
    stack = [0];
  let sequence = 0;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].value === '(')
      stack.push(
        ['select', 'with'].includes(parts[i + 1]?.value) ? ++sequence : stack[stack.length - 1],
      );
    scopes[i] = stack[stack.length - 1];
    if (parts[i].value === ')') stack.pop();
  }
  const events = new Set<string>(),
    sessions = new Set<string>();
  for (let i = 0; i < parts.length; i++) {
    if (
      !['website_event', 'session'].includes(parts[i].value) ||
      !['from', 'join'].includes(parts[i - 1]?.value)
    )
      continue;
    const next = parts[i + 1]?.value === 'as' ? parts[i + 2] : parts[i + 1];
    const alias =
      next?.identifier &&
      !['join', 'on', 'where', 'left', 'inner', 'right', 'full', 'group', 'order'].includes(
        next.value,
      )
        ? next.value
        : parts[i].value;
    (parts[i].value === 'session' ? sessions : events).add(`${scopes[i]}:${alias}`);
  }
  const mapping = new Map<string, string>();
  for (let i = 0; i < parts.length - 6; i++) {
    if (
      parts[i + 1].value !== '.' ||
      parts[i + 2].value !== 'session_id' ||
      parts[i + 3].value !== '=' ||
      parts[i + 5].value !== '.' ||
      parts[i + 6].value !== 'session_id'
    )
      continue;
    const a = `${scopes[i]}:${parts[i].value}`,
      b = `${scopes[i]}:${parts[i + 4].value}`;
    if (sessions.has(a) && events.has(b)) mapping.set(a, parts[i + 4].value);
    if (sessions.has(b) && events.has(a)) mapping.set(b, parts[i].value);
  }
  const edits: { start: number; end: number; value: string }[] = [];
  for (let i = 0; i < parts.length - 2; i++) {
    const event = mapping.get(`${scopes[i]}:${parts[i].value}`),
      field = parts[i + 2]?.value;
    if (
      event &&
      parts[i + 1].value === '.' &&
      ['country', 'region', 'city', 'browser', 'os', 'device', 'screen', 'language'].includes(field)
    )
      edits.push({
        start: parts[i].start,
        end: parts[i + 2].end,
        value: `${event}.liekan_${field}`,
      });
  }
  for (const edit of edits.reverse())
    sql = sql.slice(0, edit.start) + edit.value + sql.slice(edit.end);
  return sql;
}

/** Bound placeholders for the complete property window in supported native reads. */
export type EventDataWindow = { websiteId: string; startDate: string; endDate: string };
const propertyWindowQueries = new Set([
  'getEventDataArraySeries',
  'getEventDataDateSeries',
  'getEventDataEvents',
  'getEventDataFields',
  'getEventDataNumericSeries',
  'getEventDataNumericStats',
  'getEventDataPivot',
  'getEventDataProperties',
  'getEventDataPropertySeries',
  'getEventDataStats',
  'getEventDataValues',
  'getWebsiteEvents',
]);

/** Bind only the property window; parent/cohort dates and sibling keys retain their own scope. */
export function propertyWindowForQuery(
  name: string | undefined,
  bindings: ReadonlyMap<string, string>,
): EventDataWindow | undefined {
  if (!propertyWindowQueries.has(name)) return;
  const websiteId = bindings.get('websiteId');
  const startDate = bindings.get('startDate');
  const endDate = bindings.get('endDate');
  if (websiteId && startDate && endDate) return { websiteId, startDate, endDate };
}

/** Apply one site policy to all relational analytics, including nested denominators. */
export function withTrafficPolicy(sql: string, propertyWindow?: EventDataWindow): string {
  const parts = tokens(sql);
  if (!['select', 'with'].includes(parts[0]?.value)) return sql;
  // This helper belongs only to read paths. Data-modifying CTEs retain their write semantics.
  if (parts.some(p => p.identifier && ['insert', 'update', 'delete', 'merge'].includes(p.value)))
    return sql;
  const used = Object.keys(effectiveTables).filter(table =>
    parts.some(
      (p, i) =>
        p.value === table &&
        ['from', 'join'].includes(parts[i - 1]?.value) &&
        parts[i + 1]?.value !== '.',
    ),
  ) as (keyof typeof effectiveTables)[];
  if (!used.length) return sql;
  // Caller-defined CTEs already own these names; never shadow their local semantics.
  if (
    parts.some(
      (p, i) =>
        used.includes(p.value as any) &&
        parts[i + 1]?.value === 'as' &&
        parts[i + 2]?.value === '(',
    )
  )
    throw new Error('Analytics CTE conflicts with the traffic policy source');
  if (
    propertyWindow &&
    used.includes('event_data') &&
    Object.values(propertyWindow).some(
      reference => !/^\$[1-9]\d*(?:::[a-zA-Z_][a-zA-Z0-9_]*)?$/.test(reference),
    )
  )
    throw new Error('Invalid property window binding');
  sql = withVisitGeography(sql);
  const adjustedParts = tokens(sql);
  const definitions = used
    // Repeated reads must keep the caller's website/date predicates on the base scans.
    .map(table =>
      table === 'event_data' && propertyWindow
        ? `${table} AS MATERIALIZED (SELECT * FROM ${effectiveTables[table]} WHERE website_id=${propertyWindow.websiteId} AND created_at BETWEEN ${propertyWindow.startDate} AND ${propertyWindow.endDate})`
        : `${table} AS NOT MATERIALIZED (SELECT * FROM ${effectiveTables[table]})`,
    )
    .join(', ');
  if (parts[0].value === 'with') {
    const boundary = adjustedParts[adjustedParts[1]?.value === 'recursive' ? 1 : 0].end;
    return `${sql.slice(0, boundary)} ${definitions},${sql.slice(boundary)}`;
  }
  return `WITH ${definitions} ${sql}`;
}
