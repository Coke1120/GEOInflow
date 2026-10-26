import { describe, expect, it } from 'vitest';
import { uuid } from '@/lib/crypto';
import { collectionIdentity } from './collection-identity';
import type { CollectionQuality } from './collection-quality';

const input = {
  websiteId: '2c2cc355-5c67-4aa8-8705-9ab3acfb1533',
  ip: '192.0.2.1',
  userAgent: 'browser-identity-fixture',
  salt: 'fixed-test-salt',
  ipEvidence: { trusted: true, source: 'trusted_ingress' as const },
  quality: {
    source: 'browser',
    classification: 'browser',
    reasons: [],
    ruleVersion: 'traffic-quality-v4',
    rangeVersion: null,
    rangeStatus: 'missing',
    hostname: 'human.invalid',
  } as CollectionQuality,
};
describe('collection identity qualification', () => {
  it('preserves the Umami cookieless identifier for a qualified browser', () => {
    expect(collectionIdentity(input)).toMatchObject({
      available: true,
      scope: 'browser',
      sessionId: uuid(input.websiteId, input.ip, input.userAgent, input.salt, ''),
    });
  });
  it.each(['unknown', 'suspected', 'automated'] as const)(
    'withholds a browser identity for classification %s even with trusted network input',
    classification => {
      expect(
        collectionIdentity({ ...input, quality: { ...input.quality, classification } }).available,
      ).toBe(false);
    },
  );
  it.each(['unverified', 'legacy_override', 'missing'] as const)(
    'keeps %s input outside qualified identities',
    source => {
      const identity = collectionIdentity({ ...input, ipEvidence: { source, trusted: false } });
      expect(identity).toMatchObject({ scope: 'browser_unresolved', available: false });
      expect(identity.sessionId).not.toBe(collectionIdentity(input).sessionId);
    },
  );
  it('keeps server and legacy namespaces separate from the browser', () => {
    for (const source of ['authenticated_server', 'legacy_override'] as const) {
      const identity = collectionIdentity({ ...input, quality: { ...input.quality, source } });
      expect(identity).toMatchObject({ scope: source, available: false });
      expect(identity.sessionId).not.toBe(collectionIdentity(input).sessionId);
    }
  });
});
