'use client';
import { getApiUrl } from '@/lib/api-url';

const versions = new Map<string, Promise<string | undefined>>();
/** A manual page read shares one immutable catalog, including concurrent and cursor reads. */
export function clientCatalogVersion(scope: string, auth: Record<string, string>) {
  const headers = new Headers(auth);
  if (headers.get('x-umami-share-token') && headers.get('x-umami-share-context'))
    headers.delete('authorization');
  const identity = [...headers.entries()]
    .filter(([name]) =>
      ['authorization', 'x-umami-share-token', 'x-umami-share-context'].includes(name),
    )
    .sort(([a], [b]) => a.localeCompare(b));
  const key = JSON.stringify([scope, identity]);
  let version = versions.get(key);
  if (!version) {
    version = (async () => {
      const response = await fetch(
        new URL(getApiUrl('/liekan/catalog-version'), window.location.origin),
        {
          headers,
          cache: 'no-store',
          signal: AbortSignal.timeout(15000),
        },
      );
      const body = await response.json();
      if (response.ok && body?.version === null) return undefined;
      if (!response.ok || !/^[a-f0-9-]{36}$/i.test(body?.version || ''))
        throw new Error('无法读取统计目录版本，请重新读取。');
      return body.version as string;
    })();
    versions.set(key, version);
    if (versions.size > 64) versions.delete(versions.keys().next().value);
    void version.catch(() => {
      if (versions.get(key) === version) versions.delete(key);
    });
  }
  return version;
}
