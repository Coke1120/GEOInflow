import { describe, expect, it } from 'vitest';
import { cloudflareCrawlerEvidence, crawlerClassificationVersion } from './crawler-evidence';
import { normalizeAutomatic } from './protocol';
import { BOT_RULES, LEGACY_BOT_RULES } from '../rules/bots';

const source = 'efc986b6-4e64-43f8-86c8-6d7cc0bda883';
const raw = {
  ClientIP: '192.0.2.9',
  ClientRequestHost: 'example.com',
  ClientRequestMethod: 'GET',
  ClientRequestURI: '/a?private=value',
  ClientRequestUserAgent: 'GPTBot',
  EdgeResponseStatus: 403,
  EdgeResponseBodyBytes: 20,
  EdgeStartTimestamp: '2026-10-09T01:00:00.000000001Z',
  EdgeEndTimestamp: '2026-10-09T01:00:00.100000001Z',
  ClientRequestSource: 'eyeball',
  RayID: 'ray',
};
describe('crawler log evidence compatibility', () => {
  it('keeps original identity and digest when optional evidence changes', () => {
    const plain = normalizeAutomatic('cloudflare', source, [raw], 'example.com', 'fixture');
    const extended = normalizeAutomatic(
      'cloudflare',
      source,
      [
        {
          ...raw,
          SecurityAction: 'block',
          SecurityRuleID: 'a'.repeat(32),
          SecurityRuleIDs: ['a'.repeat(32)],
        },
      ],
      'example.com',
      'fixture',
    );
    expect(extended.records[0].id).toBe(plain.records[0].id);
    expect(extended.records[0].eventDigest).toBe(plain.records[0].eventDigest);
    expect(extended.records[0].crawlerEvidence).toMatchObject({
      securityAction: 'block',
      terminatingRuleId: 'a'.repeat(32),
      durationMs: 100,
    });
    expect(JSON.stringify(extended.records)).not.toContain('192.0.2.9');
    expect(JSON.stringify(extended.records)).not.toContain('private=value');
  });
  it('does not invent absent evidence and discards malformed optional metadata', () => {
    expect(cloudflareCrawlerEvidence(raw)).toMatchObject({
      securityAction: null,
      terminatingRuleId: null,
    });
    expect(
      cloudflareCrawlerEvidence({ ...raw, SecurityRuleIDs: Array(101).fill('a'.repeat(32)) }),
    ).toBeNull();
    expect(cloudflareCrawlerEvidence({ ...raw, SecurityRuleID: 'untrusted\ninput' })).toBeNull();
  });
  it('versions historical identity separately from a newly saved literal rule', () => {
    const old = [LEGACY_BOT_RULES[0]];
    expect(crawlerClassificationVersion(old)).not.toBe(
      crawlerClassificationVersion(old.map(rule => ({ ...rule, matchMode: 'literal' }))),
    );
  });
  it('versions classification independently of range evidence', () => {
    const version = crawlerClassificationVersion(BOT_RULES);
    expect(version).toMatch(/^[a-f0-9]{64}$/);
    expect(
      crawlerClassificationVersion(
        BOT_RULES.map(({ pattern, type, name, vendor, ...rest }) => ({
          ...rest,
          pattern,
          type,
          name,
          vendor,
        })),
      ),
    ).toBe(version);
    expect(
      crawlerClassificationVersion(
        BOT_RULES.map(({ pattern, type, name, vendor }) => ({ pattern, type, name, vendor })),
      ),
    ).not.toBe(version);
    expect(crawlerClassificationVersion([...BOT_RULES].reverse())).not.toBe(version);
    expect(
      crawlerClassificationVersion(
        BOT_RULES.map((rule, i) => (i ? rule : { ...rule, pattern: 'Changed' })),
      ),
    ).not.toBe(version);
  });
});
