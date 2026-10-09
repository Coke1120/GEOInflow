import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  type CrawlerPath,
  type CrawlerPolicyInput,
  crawlerPathSchema,
  crawlerPolicyInputSchema,
} from '../contracts/crawlers';
import { getCrawler } from './directory';

export const crawlerHostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i)
  .transform(value => value.toLowerCase());

export function crawlerPathMatches(path: string, selector: CrawlerPath) {
  const { value, match } = crawlerPathSchema.parse(selector);
  if (match === 'exact') return path === value;
  return path === value || path.startsWith(value.endsWith('/') ? value : `${value}/`);
}

const cfString = (value: string) => JSON.stringify(value);
const rawPath = 'raw.http.request.uri.path';
function cloudflarePath(selector: CrawlerPath) {
  const exact = `${rawPath} eq ${cfString(selector.value)}`;
  if (selector.match === 'exact') return exact;
  const prefix = selector.value.endsWith('/') ? selector.value : `${selector.value}/`;
  return `(${exact} or starts_with(${rawPath}, ${cfString(prefix)}))`;
}

export const crawlerTemplateLimitations = [
  'UA selectors identify the declared name. Official range verification is separate evidence.',
  'Cloudflare raw path fields can retain basic normalization performed by its HTTP server.',
  'Literal paths preserve encoding and case. Encoded equivalents require separate selectors.',
] as const;

/** Fixed grammar for http_request_firewall_custom; provider admission is checked by the caller. */
export function buildCloudflareExpression(host: string, input: CrawlerPolicyInput): string {
  const hostname = crawlerHostSchema.parse(host);
  const policy = crawlerPolicyInputSchema.parse(input);
  if (policy.action !== 'block') throw new Error('Observe is a local preview only');
  const selectors = policy.botIds.map(id => {
    const crawler = getCrawler(id);
    if (crawler.kind !== 'http_crawler' || !crawler.uaSelector) {
      throw new Error('Crawler has no HTTP selector');
    }
    return `lower(http.user_agent) contains ${cfString(crawler.uaSelector.toLowerCase())}`;
  });
  const expression = `(http.host eq ${cfString(hostname)}) and (${selectors.join(' or ')}) and (${policy.paths.map(cloudflarePath).join(' or ')})`;
  if (new TextEncoder().encode(expression).length > 2048) {
    throw new Error('Cloudflare expression exceeds 2 KiB');
  }
  return expression;
}

export function crawlerRuleRef(instanceId: string, websiteId: string, policyId: string): string {
  const identity = [instanceId, websiteId, policyId].map(value =>
    z.uuid().parse(value).toLowerCase(),
  );
  return `lk_${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 60)}`;
}

function nginxString(value: string) {
  // Map regex keys are static: regexLiteral escapes path dollars, while raw dollars anchor PCRE.
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
const regexLiteral = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface NginxPolicyExport {
  kind: 'configuration_fragments';
  httpContext: string;
  serverContext: string;
  limitations: readonly string[];
  rateLimit: { httpContext: string; serverContext: string; dryRun: boolean } | null;
}

/** Paste fragments into the existing http and site server contexts after reviewing them. */
export function exportNginxPolicy(
  host: string,
  input: CrawlerPolicyInput,
  options: { rateLimit?: { requestsPerSecond: number; burst: number; dryRun: boolean } } = {},
): NginxPolicyExport {
  const hostname = crawlerHostSchema.parse(host);
  const policy = crawlerPolicyInputSchema.parse(input);
  const suffix = createHash('sha256')
    .update(JSON.stringify([hostname, policy.botIds, policy.paths]))
    .digest('hex')
    .slice(0, 12);
  const variable = (name: string) => `$lk_${suffix}_${name}`;
  const uaLines = policy.botIds.map(id => {
    const crawler = getCrawler(id);
    if (!crawler.uaSelector || crawler.kind !== 'http_crawler')
      throw new Error('Crawler has no HTTP selector');
    return `  ${nginxString(`~*${regexLiteral(crawler.uaSelector)}`)} 1;`;
  });
  const pathLines = policy.paths.map(path => {
    // Nginx map string keys ignore case; fixed escaped regex keys preserve path case.
    if (path.match === 'exact') return `  ${nginxString(`~^${regexLiteral(path.value)}$`)} 1;`;
    const regex = path.value.endsWith('/')
      ? `^${regexLiteral(path.value)}`
      : `^${regexLiteral(path.value)}(?:/|$)`;
    return `  ${nginxString(`~${regex}`)} 1;`;
  });
  const httpContext = [
    '# Fragment for the existing http context.',
    `map $http_user_agent ${variable('ua')} {`,
    '  default 0;',
    ...uaLines,
    '}',
    `map $request_uri ${variable('path')} {`,
    '  default "";',
    '  ~^([^?]*) $1;',
    '}',
    `map ${variable('path')} ${variable('path_match')} {`,
    '  default 0;',
    ...pathLines,
    '}',
    `map "$host:${variable('ua')}:${variable('path_match')}" ${variable('match')} {`,
    '  default 0;',
    `  ${nginxString(`${hostname}:1:1`)} 1;`,
    '}',
    '',
  ].join('\n');
  const serverContext = [
    `# Fragment for the existing server context serving ${hostname}.`,
    policy.action === 'block'
      ? `if (${variable('match')}) { return 403; }`
      : '# Observe is local only; this fragment performs no blocking.',
    '',
  ].join('\n');
  let rateLimit: NginxPolicyExport['rateLimit'] = null;
  if (options.rateLimit) {
    const rate = z
      .strictObject({
        requestsPerSecond: z.number().int().min(1).max(1000),
        burst: z.number().int().min(1).max(1000),
        dryRun: z.boolean(),
      })
      .parse(options.rateLimit);
    if (policy.action === 'observe' && !rate.dryRun)
      throw new Error('Observe rate limits require dry run');
    const zone = `lk_${suffix}`;
    rateLimit = {
      dryRun: rate.dryRun,
      httpContext: [
        '# Optional rate-limit fragment for http context. Review existing limit_req inheritance.',
        `map ${variable('match')} ${variable('rate_key')} {`,
        '  default "";',
        '  1 $binary_remote_addr;',
        '}',
        `limit_req_zone ${variable('rate_key')} zone=${zone}:1m rate=${rate.requestsPerSecond}r/s;`,
        '',
      ].join('\n'),
      serverContext: [
        '# Optional alternative to the blocking fragment in the existing site server context.',
        '# dry_run requires Nginx 1.17.1 or newer.',
        `limit_req zone=${zone} burst=${rate.burst} nodelay;`,
        `limit_req_dry_run ${rate.dryRun ? 'on' : 'off'};`,
        'limit_req_status 429;',
        '',
      ].join('\n'),
    };
  }
  return {
    kind: 'configuration_fragments',
    httpContext,
    serverContext,
    limitations: [
      ...crawlerTemplateLimitations,
      'Nginx fragments require review alongside the original configuration and nginx -t before use.',
      'The optional IP rate key exists only in Nginx memory; historical IP data is not exported.',
    ],
    rateLimit,
  };
}
