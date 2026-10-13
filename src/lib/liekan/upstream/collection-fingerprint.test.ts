import { expect, it } from 'vitest';
import { collectionFingerprint } from './collection-fingerprint';

it('compares semantic JSON content independently of event ID and key ordering', () => {
  const a = collectionFingerprint('event', {
    eventId: 'a',
    website: 'site',
    data: { b: 2, a: 1 },
    url: '/',
  });
  expect(
    collectionFingerprint('event', {
      url: '/',
      data: { a: 1, b: 2 },
      website: 'site',
      eventId: 'b',
    }),
  ).toBe(a);
  expect(
    collectionFingerprint('performance', { website: 'site', data: { a: 1, b: 2 }, url: '/' }),
  ).not.toBe(a);
  expect(
    collectionFingerprint('event', { website: 'site', data: { a: 1, b: 3 }, url: '/' }),
  ).not.toBe(a);
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  expect(a).not.toContain('site');
});
