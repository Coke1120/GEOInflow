import { describe, expect, it } from 'vitest';
import { normalizeCollectionOrigin, conflictsWithCollectionHosts } from './collection-admission';

describe('optional Origin evidence', () => {
  it.each([
    null,
    '',
    'null',
    'not-an-origin',
    'ftp://example.com',
    'https://example.com/path',
    'https://user@example.com',
  ])('leaves missing or invalid origin unknown: %s', value => {
    expect(normalizeCollectionOrigin(value)).toBeNull();
  });
  it('normalizes a valid HTTP origin without treating absent evidence as human proof', () => {
    expect(normalizeCollectionOrigin('https://EXAMPLE.com:443')).toBe('example.com');
    const policy = { revision: '1', mode: 'standard', allowedHostnames: ['example.com'] };
    expect(conflictsWithCollectionHosts(policy, 'example.com', null)).toBe(false);
    expect(conflictsWithCollectionHosts(policy, 'example.com', 'other.test')).toBe(true);
    expect(conflictsWithCollectionHosts(policy, null, null)).toBe(true);
  });
});
