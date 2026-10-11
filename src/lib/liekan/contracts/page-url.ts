/** Resolve observed page paths against a single website origin. */
export function pageUrl(
  value: unknown,
  domain?: string,
  { query, hostname }: { query?: string; hostname?: string } = {},
): string | null {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (!path || /[\u0000-\u001f\u007f\\]/.test(path)) return null;
  try {
    let url: URL;
    if (/^https?:\/\//i.test(path)) {
      url = new URL(path);
    } else {
      // A relative page needs a known origin. Event names and host lists stay as text.
      if (!path.startsWith('/') || path.startsWith('//') || !(domain || hostname)?.trim())
        return null;
      const host = (domain || hostname).trim();
      if (/[\s\\*?#]/.test(host)) return null;
      const origin = new URL(/^https?:\/\//i.test(host) ? host : `https://${host}`);
      if (origin.pathname !== '/' || origin.username || origin.password) return null;
      if (hostname) {
        if (!/^[a-z0-9.\-\[\]:]+$/i.test(hostname)) return null;
        const observed = new URL(`https://${hostname}`);
        // The tracker records hostname without its port or protocol.
        if (observed.hostname !== origin.hostname) {
          origin.hostname = observed.hostname;
          origin.port = observed.port;
        }
      }
      url = new URL(path, origin.origin);
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      (!url.hostname.startsWith('[') &&
        !url.hostname
          .replace(/\.$/, '')
          .split('.')
          .every(label => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) ||
      url.username ||
      url.password
    )
      return null;
    if (query && !url.search) {
      if (/[\u0000-\u001f\u007f]/.test(query)) return null;
      url.search = query;
    }
    return url.href;
  } catch {
    return null;
  }
}

/** Keep server log searches aligned with the displayed address and stored path. */
export function pageSearch(search: string, domain?: string): string {
  const root = pageUrl('/', domain);
  if (!root || !search || search === '/') return search;
  const origin = new URL(root).origin.toLowerCase();
  const term = search.toLowerCase();
  // Every imported log path is rooted at this origin. Preserve substring search semantics.
  if (origin.includes(term)) return '';
  for (let i = 0; i < origin.length; i++) {
    const suffix = origin.slice(i);
    if (term.startsWith(`${suffix}/`)) return search.slice(suffix.length);
  }
  return search;
}
