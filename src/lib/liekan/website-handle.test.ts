import { describe, expect, it } from 'vitest';
import { shortWebsitePath, websiteHandle, websiteMatchesHandle } from './website-handle';

describe('website handle helpers', () => {
  const site = { id: '67a8e084-de35-5f1c-a2b0-8f2732f830bf', siteNumber: 101 };
  const legacy = { id: '67a8e084-de35-5f1c-a2b0-8f2732f830bf' };

  it('shortens private website paths and preserves their full suffix', () => {
    const suffix = '/geo/ai/bots?date=range%3A1%3A2&dateMode=default#risk';
    expect(shortWebsitePath(`/websites/${site.id}${suffix}`, site)).toBe(`/websites/101${suffix}`);
    expect(shortWebsitePath(`/teams/team-a/websites/${site.id}/settings`, site)).toBe(
      '/teams/team-a/websites/101/settings',
    );
    expect(shortWebsitePath(`/websites/${site.id}?section=collection`, site)).toBe(
      '/websites/101?section=collection',
    );
  });

  it.each([
    '/websites/101/geo/ai/bots',
    '/websites/another-site/geo/ai/bots',
    `/websites/${site.id}-extra/geo/ai/bots`,
    `/api/websites/${site.id}`,
    `/share/${site.id}`,
    `/settings?returnTo=/websites/${site.id}/settings`,
  ])('keeps unrelated or already short paths intact: %s', path => {
    expect(shortWebsitePath(path, site)).toBe(path);
  });

  it('keeps a legacy site path when no number has been assigned', () => {
    expect(shortWebsitePath(`/websites/${legacy.id}/settings`, legacy)).toBe(
      `/websites/${legacy.id}/settings`,
    );
  });

  it('prefers the site number for page URLs and falls back to the UUID', () => {
    expect(websiteHandle(site)).toBe('101');
    expect(websiteHandle(legacy)).toBe('67a8e084-de35-5f1c-a2b0-8f2732f830bf');
  });

  it('matches a URL handle against either website identifier', () => {
    expect(websiteMatchesHandle(site, '101')).toBe(true);
    expect(websiteMatchesHandle(site, site.id)).toBe(true);
    expect(websiteMatchesHandle(legacy, legacy.id)).toBe(true);
    expect(websiteMatchesHandle(site, '102')).toBe(false);
    expect(websiteMatchesHandle(legacy, '101')).toBe(false);
    expect(websiteMatchesHandle(null, '101')).toBe(false);
    expect(websiteMatchesHandle(site, undefined)).toBe(false);
  });
});
