import { safeDecodeURI } from '@/lib/url';

// Imported paths stay encoded in storage. Browser events have already been decoded once by Umami.
export function humanPathFromEncoded(path: string): string {
  return safeDecodeURI(path) ?? path;
}
