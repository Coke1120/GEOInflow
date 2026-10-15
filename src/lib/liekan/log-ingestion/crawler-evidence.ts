import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { BotRule } from '../rules/bots';
import { classifyBot, MATCHER_VERSION } from '../rules/bots';
import { crawlerIdForRule } from '../crawlers/directory';

const ruleId = z.string().regex(/^[a-f0-9]{32}$/i);
const evidenceSchema = z.object({
  securityAction: z
    .string()
    .max(64)
    .regex(/^[a-z_]+$/)
    .nullable(),
  terminatingRuleId: ruleId.nullable(),
  matchedRuleIds: z.array(ruleId).max(100).nullable(),
  cacheStatus: z
    .string()
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .nullable(),
  durationMs: z.number().min(0).max(600000).nullable(),
});
export type CrawlerLogEvidence = z.infer<typeof evidenceSchema>;
export function crawlerClassificationVersion(rules: BotRule[]) {
  const ordered = rules.map(rule => ({
    name: rule.name,
    vendor: rule.vendor,
    type: rule.type,
    pattern: rule.pattern,
    matchMode: rule.matchMode ?? 'literal',
    crawlerId: crawlerIdForRule(rule),
    aiEligible: rule.aiEligible ?? ['训练', '搜索', '用户触发'].includes(rule.type),
  }));
  return createHash('sha256')
    .update(JSON.stringify({ matcher: MATCHER_VERSION, rules: ordered }))
    .digest('hex');
}
export async function archiveCrawlerRules(tx: any, websiteId: string, rules: BotRule[]) {
  const version = crawlerClassificationVersion(rules);
  await tx.$executeRawUnsafe(
    `INSERT INTO liekan_crawler_rule_version(website_id,version,matcher_version,rules)
     VALUES($1::uuid,$2,$3,$4::jsonb) ON CONFLICT(website_id,version) DO NOTHING`,
    websiteId,
    version,
    MATCHER_VERSION,
    JSON.stringify(rules),
  );
  return version;
}
export function crawlerIdentityId(userAgent: string, rules: BotRule[]) {
  return crawlerIdForRule(classifyBot(userAgent, rules));
}
export function cloudflareCrawlerEvidence(raw: Record<string, unknown>): CrawlerLogEvidence | null {
  const start =
    typeof raw.EdgeStartTimestamp === 'string' ? Date.parse(raw.EdgeStartTimestamp) : NaN;
  const end = typeof raw.EdgeEndTimestamp === 'string' ? Date.parse(raw.EdgeEndTimestamp) : NaN;
  const result = evidenceSchema.safeParse({
    securityAction: raw.SecurityAction ?? null,
    terminatingRuleId: raw.SecurityRuleID || null,
    matchedRuleIds: raw.SecurityRuleIDs ?? null,
    cacheStatus: raw.CacheCacheStatus ?? null,
    durationMs: Number.isFinite(start) && Number.isFinite(end) ? end - start : null,
  });
  return result.success ? result.data : null;
}
export async function persistCrawlerEvidence(
  tx: any,
  websiteId: string,
  importId: string,
  records: Array<{
    id: string;
    classificationVersion?: string;
    crawlerId?: string | null;
    crawlerEvidence?: CrawlerLogEvidence | null;
  }>,
) {
  if (!records.length) return;
  const evidence = records.map(row => ({
    id: row.id,
    classificationVersion: row.classificationVersion ?? null,
    crawlerId: row.crawlerId ?? null,
    ...(row.crawlerEvidence ?? {}),
  }));
  // Keep the indexed event lookup batch-bounded while enforcing import ownership.
  await tx.$executeRawUnsafe(
    `INSERT INTO liekan_crawler_evidence(website_id,log_id,classification_version,crawler_id,security_action,terminating_rule_id,matched_rule_ids,cache_status,duration_ms)
     SELECT $1::uuid,r.id,r."classificationVersion",r."crawlerId",r."securityAction",r."terminatingRuleId",r."matchedRuleIds",r."cacheStatus",r."durationMs"
     FROM jsonb_to_recordset($3::jsonb) AS r(id text,"classificationVersion" text,"crawlerId" text,"securityAction" text,"terminatingRuleId" text,"matchedRuleIds" jsonb,"cacheStatus" text,"durationMs" double precision)
     JOIN LATERAL (SELECT 1 FROM liekan_log l
       WHERE l.website_id=$1::uuid AND l.id=r.id AND l.import_id=$2::uuid OFFSET 0) l ON true
     ON CONFLICT(website_id,log_id) DO NOTHING`,
    websiteId,
    importId,
    JSON.stringify(evidence),
  );
}
