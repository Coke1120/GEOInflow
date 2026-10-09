import { createHash } from 'node:crypto';
import { LiekanError } from '../upstream/errors';

const idPattern = /^[a-f0-9]{32}$/i;
export interface CloudflareCrawlerRule {
  id?: string;
  version?: string;
  last_updated?: string;
  ref: string;
  action: string;
  expression: string;
  description: string;
  enabled: boolean;
  [key: string]: unknown;
}
export interface CloudflareCrawlerSnapshot {
  rulesetId: string | null;
  rules: CloudflareCrawlerRule[];
  zone: { name: string; plan: string };
  quota: number;
}
export class CrawlerProviderError extends LiekanError {
  constructor(
    public code: string,
    public uncertain = false,
    public providerStatus?: number,
  ) {
    super(uncertain ? '供应商操作结果待确认' : '供应商操作暂时失败', 503);
  }
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export function crawlerRemoteHash(rule: CloudflareCrawlerRule | null) {
  if (!rule) return createHash('sha256').update('absent').digest('hex');
  const { id: _id, version: _version, last_updated: _updated, ...body } = rule;
  return createHash('sha256')
    .update(JSON.stringify(canonical(body)))
    .digest('hex');
}
export function crawlerDesiredMatches(
  actual: CloudflareCrawlerRule | null,
  target: CloudflareCrawlerRule | null,
) {
  if (!target) return !actual;
  return !!actual && crawlerRemoteHash(actual) === crawlerRemoteHash(target);
}
export function crawlerZoneQuota(plan: string) {
  const value = plan.toLowerCase();
  return value.includes('enterprise')
    ? 1000
    : value.includes('business')
      ? 100
      : value.includes('pro')
        ? 20
        : 5;
}
export async function crawlerCloudflareApi<T>(
  token: string,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  if (!/^\/zones\/[a-f0-9]{32}(\/|$)/i.test(path))
    throw new CrawlerProviderError('invalid-provider-path');
  const write = method !== 'GET';
  let response: Response;
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
  } catch {
    throw new CrawlerProviderError('provider-network', write);
  }
  let value: any;
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 2 * 1024 * 1024) throw new Error();
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new CrawlerProviderError('provider-response', write, response.status);
  }
  if (!response.ok || value?.success !== true)
    throw new CrawlerProviderError(
      response.status === 401 || response.status === 403
        ? 'provider-permission'
        : response.status === 429
          ? 'provider-rate-limit'
          : 'provider-rejected',
      write && response.status >= 500,
      response.status,
    );
  return value.result as T;
}
export async function readCrawlerCloudflare(
  token: string,
  zoneId: string,
  host: string,
): Promise<CloudflareCrawlerSnapshot> {
  if (!idPattern.test(zoneId)) throw new LiekanError('Zone 标识无效', 400);
  const zone = await crawlerCloudflareApi<{ name: string; plan?: { name?: string } }>(
    token,
    `/zones/${zoneId}`,
  );
  if (!zone?.name || !(host === zone.name || host.endsWith(`.${zone.name}`)))
    throw new LiekanError('当前域名不属于这个 Zone', 400);
  let entry: { id: string; rules?: CloudflareCrawlerRule[] } | null = null;
  try {
    entry = await crawlerCloudflareApi(
      token,
      `/zones/${zoneId}/rulesets/phases/http_request_firewall_custom/entrypoint`,
    );
  } catch (error) {
    if (!(error instanceof CrawlerProviderError && error.providerStatus === 404)) throw error;
  }
  if (
    entry &&
    (!idPattern.test(entry.id) || !Array.isArray(entry.rules) || entry.rules.length > 10000)
  )
    throw new CrawlerProviderError('provider-shape');
  const plan = zone.plan?.name || 'unknown';
  return {
    zone: { name: zone.name, plan },
    rulesetId: entry?.id || null,
    rules: entry?.rules || [],
    quota: crawlerZoneQuota(plan),
  };
}
export function ownedCrawlerRule(snapshot: CloudflareCrawlerSnapshot, ref: string) {
  const matches = snapshot.rules.filter(rule => rule.ref === ref);
  if (matches.length > 1) throw new LiekanError('远端规则身份重复，需要人工核对', 409);
  return matches[0] || null;
}
export async function writeCrawlerCloudflare(
  token: string,
  zoneId: string,
  snapshot: CloudflareCrawlerSnapshot,
  previous: CloudflareCrawlerRule | null,
  target: CloudflareCrawlerRule | null,
) {
  if (
    !idPattern.test(zoneId) ||
    (snapshot.rulesetId && !idPattern.test(snapshot.rulesetId)) ||
    (previous?.id && !idPattern.test(previous.id))
  )
    throw new CrawlerProviderError('invalid-provider-id');
  if (!target) {
    if (previous)
      await crawlerCloudflareApi(
        token,
        `/zones/${zoneId}/rulesets/${snapshot.rulesetId}/rules/${previous.id}`,
        'DELETE',
      );
    return;
  }
  const payload = {
    action: target.action,
    expression: target.expression,
    description: target.description,
    enabled: target.enabled,
    ref: target.ref,
  };
  if (previous) {
    await crawlerCloudflareApi(
      token,
      `/zones/${zoneId}/rulesets/${snapshot.rulesetId}/rules/${previous.id}`,
      'PATCH',
      payload,
    );
  } else {
    if (snapshot.rules.length >= snapshot.quota)
      throw new LiekanError('当前 Zone 的自定义规则配额不足', 409);
    if (snapshot.rulesetId)
      await crawlerCloudflareApi(
        token,
        `/zones/${zoneId}/rulesets/${snapshot.rulesetId}/rules`,
        'POST',
        payload,
      );
    else
      await crawlerCloudflareApi(token, `/zones/${zoneId}/rulesets`, 'POST', {
        name: 'Liekan custom rules',
        kind: 'zone',
        phase: 'http_request_firewall_custom',
        rules: [payload],
      });
  }
}
