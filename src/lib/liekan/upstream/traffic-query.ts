export const TRAFFIC_POLICY_VERSION = 'traffic-quality-v1';

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
  website_event: 'liekan_effective_website_event',
  event_data: 'liekan_effective_event_data',
  revenue: 'liekan_effective_revenue',
  heatmap_event: 'liekan_effective_heatmap_event',
  session_replay: 'liekan_effective_session_replay',
} as const;

/** Apply one site policy to all relational analytics, including nested denominators. */
export function withTrafficPolicy(sql: string): string {
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
  const definitions = used
    .map(table => `${table} AS (SELECT * FROM ${effectiveTables[table]})`)
    .join(', ');
  if (parts[0].value === 'with') {
    const boundary = parts[parts[1]?.value === 'recursive' ? 1 : 0].end;
    return `${sql.slice(0, boundary)} ${definitions},${sql.slice(boundary)}`;
  }
  return `WITH ${definitions} ${sql}`;
}
