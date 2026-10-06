// Website pages address sites by the short site number while data APIs key on the UUID.
// A URL segment may therefore be either identifier; compare loaded websites against it
// with these helpers instead of comparing ids directly.
export type WebsiteHandleSource = { id: string; siteNumber?: number | null };

export function websiteHandle(website: WebsiteHandleSource): string {
  return website?.siteNumber != null ? String(website.siteNumber) : website?.id;
}

export function websiteMatchesHandle(
  website: WebsiteHandleSource | null | undefined,
  handle: string | null | undefined,
): boolean {
  if (!website || !handle) return false;
  return website.id === handle || (website.siteNumber != null && String(website.siteNumber) === handle);
}
