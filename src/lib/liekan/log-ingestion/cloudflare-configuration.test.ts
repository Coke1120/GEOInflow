// @vitest-environment node
import { expect, it, vi } from 'vitest';
vi.mock('../upstream/server', () => ({
  LiekanError: class extends Error {},
  query: vi.fn(),
  transaction: vi.fn(),
}));
import { logpushConfiguration } from './cloudflare';
it('keeps existing log fields and adds only the selected available crawler evidence fields', () => {
  process.env.LIEKAN_PUBLIC_URL = 'https://analytics.example.com';
  const source = { id: 'test-source', domain: 'example.com' } as any;
  const config = { zoneId: 'zone', accessToken: 'test', receiverToken: 'test-receiver' };
  const old = logpushConfiguration(source, config, 1);
  const fields = logpushConfiguration(
    source,
    { ...config, crawlerFields: ['SecurityAction', 'SecurityRuleID'] },
    1,
  ).output_options.field_names;
  expect(fields).toEqual([...old.output_options.field_names, 'SecurityAction', 'SecurityRuleID']);
  expect(fields).not.toContain('SecurityRuleIDs');
  expect(fields).not.toContain('CacheCacheStatus');
  expect(old.filter).toContain('example.com');
  expect(old.output_options.timestamp_format).toBe('rfc3339ns');
});
