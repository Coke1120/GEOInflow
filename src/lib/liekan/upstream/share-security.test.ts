import { describe, it, expect, vi } from 'vitest';
vi.mock('./server', () => ({
  LiekanError: class extends Error {
    constructor(
      message: string,
      public status = 400,
    ) {
      super(message);
    }
  },
}));
import {
  hasSharePassword,
  publicShareParameters,
  secureShareParameters,
  sharePasswordProof,
  verifySharePassword,
} from './share-security';
describe('live password shares', () => {
  it('hashes legacy passwords on the next write', () => {
    const migrated = secureShareParameters({ events: true }, { password: 'legacy' });
    expect(migrated.password).toBeUndefined();
    expect(migrated.passwordHash).toBeTruthy();
    expect(verifySharePassword('legacy', migrated)).toBe(true);
  });
  it('stores a hash and exposes only the presence of a password', () => {
    const saved = secureShareParameters({ password: 'example', events: true });
    expect(saved.password).toBeUndefined();
    expect(saved.passwordHash).not.toBe('example');
    expect(verifySharePassword('example', saved)).toBe(true);
    expect(verifySharePassword('wrong', saved)).toBe(false);
    expect(publicShareParameters(saved)).toEqual({ events: true, hasPassword: true });
  });
  it('preserves omitted secrets and supports explicit removal and immediate token invalidation', () => {
    const old = secureShareParameters({ password: 'old', events: true });
    expect(secureShareParameters({ events: false, password: '' }, old)).toMatchObject({
      passwordHash: old.passwordHash,
      events: false,
    });
    const changed = secureShareParameters({ password: 'new' }, old);
    expect(sharePasswordProof(old)).not.toBe(sharePasswordProof(changed));
    expect(hasSharePassword(secureShareParameters({ password: null }, old))).toBe(false);
    expect(publicShareParameters({ password: 'legacy', overview: true })).toEqual({
      overview: true,
      hasPassword: true,
    });
    expect(verifySharePassword('legacy', { password: 'legacy' })).toBe(true);
  });
  it('rejects passwords that exceed bcrypt byte limits', () => {
    expect(() => secureShareParameters({ password: '中'.repeat(25) })).toThrow('72 字节');
  });
});
