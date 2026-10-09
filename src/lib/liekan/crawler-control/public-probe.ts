import { Resolver } from 'node:dns/promises';
import { request } from 'node:https';
import ipaddr from 'ipaddr.js';
import { LiekanError } from '../upstream/errors';

export function isPublicProbeAddress(address: string) {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}
export function probeUrl(hostname: string, path: string) {
  const url = new URL(path, `https://${hostname}`);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== hostname ||
    (url.port && url.port !== '443') ||
    url.username ||
    url.password
  )
    throw new LiekanError('检查地址必须属于已验证的 HTTPS 域名', 400);
  url.hash = '';
  return url;
}
export interface PublicProbeResult {
  path: string;
  status: number;
  headers: Record<string, string>;
  body: string | null;
  redirects: number;
}
export async function publicCrawlerProbe(
  hostname: string,
  path: string,
  checkId: string,
  readRobots = false,
): Promise<PublicProbeResult> {
  let url = probeUrl(hostname, path);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const resolver = new Resolver({ timeout: 2000, tries: 1 });
    const addresses = (
      await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)])
    ).flatMap(result => (result.status === 'fulfilled' ? result.value : []));
    if (!addresses.length || addresses.some(address => !isPublicProbeAddress(address)))
      throw new LiekanError('域名解析结果不适合公共页面检查', 400);
    const address = ipaddr.process(addresses[0]).toString();
    const result = await new Promise<PublicProbeResult & { location?: string }>(
      (resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const req = request(
          url,
          {
            method: 'GET',
            agent: false,
            maxHeaderSize: 65536,
            servername: hostname,
            family: ipaddr.process(address).kind() === 'ipv4' ? 4 : 6,
            lookup: (_host, options, callback) => {
              const family = ipaddr.process(address).kind() === 'ipv4' ? 4 : 6;
              if (options.all) (callback as any)(null, [{ address, family }]);
              else callback(null, address, family);
            },
            headers: {
              'user-agent': `Liekan-Crawler-Check/${checkId}`,
              accept: readRobots ? 'text/plain' : '*/*',
            },
          },
          response => {
            const headers: Record<string, string> = {};
            for (const name of ['x-robots-tag', 'content-type', 'cache-control', 'cf-ray']) {
              const value = response.headers[name];
              if (value) headers[name] = String(value).slice(0, 2048);
            }
            const status = response.statusCode || 0;
            const location = response.headers.location;
            const complete = () =>
              resolve({
                path: url.pathname,
                status,
                headers,
                body: readRobots ? Buffer.concat(chunks).toString('utf8') : null,
                redirects,
                location,
              });
            if (!readRobots || (status >= 300 && status < 400)) {
              complete();
              response.destroy();
              return;
            }
            response.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > 262144) {
                response.destroy();
                reject(new LiekanError('robots 文件超过检查上限', 413));
              } else chunks.push(chunk);
            });
            response.on('end', complete);
            response.on('error', () => reject(new LiekanError('公共页面响应未完成', 503)));
            response.on('aborted', () => reject(new LiekanError('公共页面响应未完成', 503)));
          },
        );
        const timer = setTimeout(() => req.destroy(new Error('timeout')), 10000);
        req.on('close', () => clearTimeout(timer));
        req.on('error', () => reject(new LiekanError('公共页面检查暂时失败', 503)));
        req.end();
      },
    );
    if (result.status >= 300 && result.status < 400 && result.location) {
      if (redirects === 3) throw new LiekanError('公共页面重定向超过检查上限', 400);
      const next = new URL(result.location, url);
      url = probeUrl(hostname, next.toString());
      continue;
    }
    const { location: _location, ...safe } = result;
    return safe;
  }
  throw new LiekanError('公共页面重定向无效', 400);
}
