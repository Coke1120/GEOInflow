import bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';

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
  verifySharePasswordAsync,
} from './share-security';

describe('live password shares', () => {
  it('preserves the exact existing share calendar across metadata and password edits', () => {
    const calendar = { timezone: 'US/Eastern', range: 'range:123:456', startAt: 123, endAt: 456 };
    const previous = { ...calendar, password: 'legacy' };
    expect(secureShareParameters({ timezone: 'Asia/Tokyo', range: '0day', password: null }, previous)).toEqual(calendar);
    expect(secureShareParameters({ events: true }, previous)).toMatchObject(calendar);
    expect(secureShareParameters({ events: true }, { overview: true })).not.toHaveProperty('timezone');
  });
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
  it('uses asynchronous bcrypt for public checks and preserves legacy password behavior', async () => {
    const saved = secureShareParameters({ password: 'public-password' });
    const sync = vi.spyOn(bcrypt, 'compareSync');
    expect(await verifySharePasswordAsync('public-password', saved)).toBe(true);
    expect(await verifySharePasswordAsync('wrong', saved)).toBe(false);
    expect(sync).not.toHaveBeenCalled();
    expect(await verifySharePasswordAsync('legacy', { password: 'legacy' })).toBe(true);
    expect(await verifySharePasswordAsync('wrong', { password: 'legacy' })).toBe(false);
    expect(await verifySharePasswordAsync('x'.repeat(73), saved)).toBe(false);
    expect(await verifySharePasswordAsync('wrong', { passwordHash: 'invalid-hash' })).toBe(false);
  });
});
