export const CRAWLER_POPULATION_VERSION = 'crawler-qualification-v1';

/** Historical rows keep their recorded type until a qualification was stored at ingestion. */
export function crawlerAiSql(alias: '' | 'l' = '') {
  const prefix = alias ? `${alias}.` : '';
  return `COALESCE(${prefix}ai_eligible,${prefix}bot_type IN ('训练','搜索','用户触发'))`;
}
export function unknownCrawlerSql(alias: '' | 'l' = '') {
  const prefix = alias ? `${alias}.` : '';
  return `(COALESCE(${prefix}recognition_state IN ('unknown','ambiguous'),false) OR (${prefix}recognition_state IS NULL AND ${prefix}bot='其他'))`;
}

/** Older response fixtures can omit the aggregate; current SQL always returns it. */
export function crawlerAiRequests(row: {
  aiRequests?: number;
  requests?: number;
  count?: number;
  type: string;
}) {
  return (
    row.aiRequests ??
    (['训练', '搜索', '用户触发'].includes(row.type) ? Number(row.requests ?? row.count ?? 0) : 0)
  );
}

export function isUnknownCrawler(row: { recognitionState?: string | null; bot?: string }) {
  return row.recognitionState == null
    ? row.bot === '其他'
    : ['unknown', 'ambiguous'].includes(row.recognitionState);
}
