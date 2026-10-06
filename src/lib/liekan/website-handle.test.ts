import { describe, expect, it } from 'vitest';
import { websiteHandle, websiteMatchesHandle } from './website-handle';

describe('website handle helpers', () => {
  const site = { id: '67a8e084-de35-5f1c-a2b0-8f2732f830bf', siteNumber: 101 };
  const legacy = { id: '67a8e084-de35-5f1c-a2b0-8f2732f830bf' };

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
