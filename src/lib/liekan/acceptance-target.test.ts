import { describe, expect, it } from 'vitest';
import {
  acceptancePort,
  acceptanceSeedFile,
  isolatedAcceptanceTarget,
} from '../../../scripts/liekan-acceptance-target.mjs';

describe('isolated acceptance origins', () => {
  it('keeps the default and AI preview ports compatible', () => {
    expect(acceptancePort({})).toBe(3302);
    expect(isolatedAcceptanceTarget('http://127.0.0.1:3302', { env: {} }).port).toBe('3302');
    expect(isolatedAcceptanceTarget('http://localhost:3302', { env: {} }).hostname).toBe(
      'localhost',
    );
    expect(
      isolatedAcceptanceTarget('http://127.0.0.1:3305', { env: {}, aiPreview: true }).port,
    ).toBe('3305');
    expect(() => isolatedAcceptanceTarget('http://127.0.0.1:3305', { env: {} })).toThrow();
  });
  it('uses the configured port consistently for desktop, mobile, AI and seed files', () => {
    const env = { LIEKAN_ACCEPTANCE_PORT: '3346' };
    for (const options of [{}, { localhost: false }, { aiPreview: true }]) {
      const target = isolatedAcceptanceTarget('http://127.0.0.1:3346', { env, ...options });
      expect(target.port).toBe(String(acceptancePort(env)));
      expect(acceptanceSeedFile(target)).toBe('tests/api/.runtime/127.0.0.1-3346/seed.json');
      expect(() =>
        isolatedAcceptanceTarget('http://127.0.0.1:3302', { env, ...options }),
      ).toThrow();
    }
    expect(() => isolatedAcceptanceTarget('http://127.0.0.1:3346', { env: {} })).toThrow();
  });
  it('accepts the default HTTP port after URL normalization and derives its canonical seed directory', () => {
    const target = isolatedAcceptanceTarget('http://127.0.0.1:80', {
      env: { LIEKAN_ACCEPTANCE_PORT: '80' },
    });
    expect(target.port).toBe('');
    expect(acceptanceSeedFile(target)).toBe('tests/api/.runtime/127.0.0.1/seed.json');
  });
  it('retains the strict mobile host boundary', () => {
    expect(() =>
      isolatedAcceptanceTarget('http://localhost:3302', { env: {}, localhost: false }),
    ).toThrow();
  });
  it.each([
    'https://127.0.0.1:3302',
    'http://example.com:3302',
    'http://127.0.0.1:3002',
    'http://user:secret@127.0.0.1:3302',
    'http://127.0.0.1:3302/path',
    'http://127.0.0.1:3302?x=1',
    'http://127.0.0.1:3302#fragment',
  ])('rejects mismatched origins %s', base => {
    expect(() => isolatedAcceptanceTarget(base, { env: {} })).toThrow();
  });
});
