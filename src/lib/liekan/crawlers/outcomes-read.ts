import { humanPathFromEncoded } from '../upstream/paths';
import type { AiTx } from '../upstream/ai-db';
import { crawlerReferralRows } from '../upstream/analytics';
import { classifyEntrySource } from '../contracts/sources';
import type { EvidenceQuery } from '../contracts/traffic-evidence';
import { evidenceValue } from '../contracts/crawler-metrics';
import { knownCrawlerDirectory } from './directory';
import {
  evidenceScope,
  evidenceMeta,
  pathMappings,
  enforceEvidenceBudget,
  type EvidenceInputs,
} from './evidence-read';
import { normalizeCollectionHostname } from '../upstream/collection-quality';

export const OUTCOME_MAPPING_VERSION = 'crawler-outcomes-v1';
const products = [
  { id: 'openai', hosts: ['chatgpt.com', 'chat.openai.com'], ratio: true },
  { id: 'anthropic', hosts: ['claude.ai'], ratio: true },
  { id: 'perplexity', hosts: ['perplexity.ai'], ratio: true },
  { id: 'bytedance', hosts: ['doubao.com'], ratio: true },
  { id: 'google', hosts: ['google.com', 'google.com.hk', 'google.cn'], ratio: false },
  { id: 'gemini', hosts: ['gemini.google.com'], ratio: false },
  { id: 'microsoft', hosts: ['bing.com'], ratio: false },
  { id: 'copilot', hosts: ['copilot.microsoft.com'], ratio: false },
  { id: 'baidu', hosts: ['baidu.com'], ratio: false },
  { id: 'wenxin', hosts: ['yiyan.baidu.com'], ratio: false },
] as const;
export async function readOutcomes(
  tx: AiTx,
  websiteId: string,
  p: EvidenceQuery,
  input: EvidenceInputs,
) {
  const scope = evidenceScope(websiteId, p);
  const logs = await tx.query(
    `SELECT e.crawler_id,l.bot,l.path,count(*)::float8 AS requests,
    count(*) FILTER(WHERE method='GET' AND status BETWEEN 200 AND 299)::float8 AS "get2xx",
    bool_and(coalesce(e.measurement->>'samplingRate'='1' AND e.measurement->>'samplingBasis'='observed_provider_config',false)) AS unsampled,
    bool_and(coalesce(e.measurement->>'hostBasis'='request_host',false)) AS "hostObserved",
    min(e.measurement->>'host') AS host,count(distinct e.measurement->>'host')::int AS hosts,
    count(distinct e.measurement->>'sourceConfigVersion')::int AS configs
    ${scope.sql} GROUP BY 1,2,3 ORDER BY 1,2,3 LIMIT 100001`,
    ...scope.args,
  );
  const referrals = await crawlerReferralRows(
    tx,
    websiteId,
    new Date(p.startAt),
    new Date(p.endAt),
    p.timezone,
    { halfOpen: true, hostEvidence: true },
  );
  enforceEvidenceBudget(logs, logs.length);
  enforceEvidenceBudget(referrals, referrals.length);
  const hostname = normalizeCollectionHostname(
    p.sourceId === 'manual'
      ? input.access.domain
      : (input.sources.find(row => row.id === p.sourceId)?.domain ?? input.access.domain),
  );
  const selectedPlatform = p.botId
    ? knownCrawlerDirectory.find(row => row.id === p.botId)?.platformId
    : undefined;
  const mappings = pathMappings([
    ...new Set([...input.catalog.map(row => row.path), ...logs.map(row => row.path)]),
  ]);
  const mappingByEncoded = new Map(
    mappings.flatMap(row => row.encodedPaths.map(path => [path, row] as const)),
  );
  const mappingByHuman = new Map(mappings.map(row => [row.humanPath, row]));
  const chosenPath = p.path ? humanPathFromEncoded(p.path) : undefined;
  const [goals] = await tx.query(
    "SELECT EXISTS(SELECT 1 FROM report WHERE website_id=$1::uuid AND type='goal') AS configured",
    websiteId,
  );
  const [presence] = await tx.query(
    'SELECT EXISTS(SELECT 1 FROM liekan_raw_website_event WHERE website_id=$1::uuid LIMIT 1) AS connected',
    websiteId,
  );
  const grouped = new Map<string, any>();
  const get = (platformId: string, path: string) => {
    const key = JSON.stringify([platformId, path]);
    if (!grouped.has(key))
      grouped.set(key, {
        platformId,
        path,
        requests: 0,
        get2xx: 0,
        visits: 0,
        conversions: goals.configured ? 0 : null,
        goalEvents: goals.configured ? 0 : null,
        catalogPaths: new Set<string>(),
        ambiguous: !!mappingByHuman.get(path)?.ambiguous,
        unsampled: true,
        hostObserved: true,
        unknownBrowserHost: 0,
        configKnown: true,
      });
    return grouped.get(key);
  };
  const catalogPaths = new Set(input.catalog.map(row => row.path));
  const crawlerPlatforms = new Map(knownCrawlerDirectory.map(row => [row.id, row.platformId]));
  for (const log of logs) {
    const platform = crawlerPlatforms.get(log.crawler_id) ?? `custom:${log.bot}`;
    const mapping = mappingByEncoded.get(log.path)!;
    const row = get(platform, mapping.humanPath);
    row.requests += log.requests;
    row.get2xx += log.get2xx;
    row.unsampled &&= log.unsampled;
    row.hostObserved &&=
      log.hostObserved && log.hosts === 1 && normalizeCollectionHostname(log.host) === hostname;
    row.configKnown &&= log.configs === 1;
    if (log.get2xx && catalogPaths.has(log.path)) row.catalogPaths.add(log.path);
  }
  for (const referral of referrals) {
    const source = classifyEntrySource(referral);
    if (!['AI 搜索引荐', '传统搜索'].includes(source.channel)) continue;
    const sourceHost = source.source.toLowerCase();
    // Check specific AI hosts before parent search domains.
    const product = [...products]
      .sort(
        (a, b) => Math.max(...b.hosts.map(h => h.length)) - Math.max(...a.hosts.map(h => h.length)),
      )
      .find(product =>
        product.hosts.some(host => sourceHost === host || sourceHost.endsWith(`.${host}`)),
      );
    if (
      !product ||
      (selectedPlatform && product.id !== selectedPlatform) ||
      (p.botName && !selectedPlatform) ||
      (chosenPath && referral.path !== chosenPath)
    )
      continue;
    if (referral.hostname && normalizeCollectionHostname(referral.hostname) !== hostname) continue;
    const row = get(product.id, referral.path);
    if (!referral.hostname) {
      row.unknownBrowserHost += referral.visits;
      continue;
    }
    row.visits += referral.visits;
    if (goals.configured) {
      row.conversions += referral.conversions;
      row.goalEvents += referral.goalEvents;
    }
  }
  const rows = [...grouped.values()].map(row => {
    const supported = products.find(product => product.id === row.platformId)?.ratio ?? false;
    const reason = !supported
      ? 'mapping_unsupported'
      : row.ambiguous
        ? 'ambiguous_path'
        : !presence.connected
          ? 'browser_missing'
          : row.unknownBrowserHost
            ? 'browser_host_unknown'
            : !p.sourceId || input.quality.state !== 'complete'
              ? 'source_coverage'
              : !row.requests
                ? 'measurement_missing'
                : !row.configKnown ||
                    input.measurement.intervals !== 1 ||
                    input.measurement.interval !== input.quality.sourceVersion ||
                    input.measurement.intervalSamples !== input.measurement.requests ||
                    input.measurement.versions !== 1 ||
                    input.measurement.samples !== input.measurement.requests
                  ? 'source_config_unknown'
                  : !row.hostObserved
                    ? 'host_evidence'
                    : !row.unsampled
                      ? 'sampling_unknown'
                      : !row.visits
                        ? 'zero_referrals'
                        : null;
    const browserKnown = presence.connected && !row.unknownBrowserHost;
    return {
      ...row,
      catalogPaths: row.catalogPaths.size,
      observedVisits: presence.connected ? row.visits : null,
      visits: browserKnown ? row.visits : null,
      conversions: browserKnown ? row.conversions : null,
      goalEvents: browserKnown ? row.goalEvents : null,
      conversionRate:
        browserKnown && goals.configured && row.visits ? row.conversions / row.visits : null,
      ratioDenominator: browserKnown ? row.visits : null,
      ratio: evidenceValue(
        reason ? null : row.requests / row.visits,
        reason ? 0 : row.requests,
        row.requests,
        reason === 'mapping_unsupported' ? 'unsupported' : reason ? 'not_comparable' : 'available',
        reason,
      ),
    };
  });
  const platforms = [...new Set(rows.map(row => row.platformId))].map(platformId => {
    const items = rows.filter(row => row.platformId === platformId);
    const sum = (key: string) => items.reduce((n, row) => n + (row[key] ?? 0), 0);
    const browserKnown = presence.connected && items.every(row => !row.unknownBrowserHost);
    const visits = browserKnown ? sum('visits') : null,
      conversions = browserKnown && goals.configured ? sum('conversions') : null;
    return {
      platformId,
      requests: sum('requests'),
      get2xx: sum('get2xx'),
      catalogPaths: sum('catalogPaths'),
      visits,
      conversions,
      goalEvents: browserKnown && goals.configured ? sum('goalEvents') : null,
      conversionRate: visits && goals.configured ? conversions / visits : null,
    };
  });
  return {
    meta: {
      ...evidenceMeta(p, input),
      hostname,
      mappingVersion: OUTCOME_MAPPING_VERSION,
      goalsConfigured: goals.configured,
      browserScope: 'platform_referrals',
      logScope: p.botId || p.botName || 'platform',
    },
    rows,
    reasons: platforms,
    totals: {
      requests: rows.reduce((n, row) => n + row.requests, 0),
      get2xx: rows.reduce((n, row) => n + row.get2xx, 0),
      visits:
        presence.connected && rows.every(row => !row.unknownBrowserHost)
          ? rows.reduce((n, row) => n + (row.visits ?? 0), 0)
          : null,
    },
  };
}
