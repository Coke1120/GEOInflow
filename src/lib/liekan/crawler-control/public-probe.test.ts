import { describe, expect, it } from 'vitest';
import { isPublicProbeAddress, probeUrl } from './public-probe';

describe('public crawler probe boundary', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '0.0.0.0',
    '224.0.0.1',
  ])('refuses non-public destination %s', address => {
    expect(isPublicProbeAddress(address)).toBe(false);
  });
  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])(
    'permits public routing address %s',
    address => {
      expect(isPublicProbeAddress(address)).toBe(true);
    },
  );
  it.each([
    'http://example.com/a',
    'https://other.example/a',
    'https://example.com:8443/a',
    'https://name:pass@example.com/a',
    '//other.example/a',
  ])('refuses invalid probe URL %s', path => {
    expect(() => probeUrl('example.com', path)).toThrow();
  });
  it('retains the authorized HTTPS host through an exact path', () => {
    expect(probeUrl('example.com', '/docs/%2Fpage').href).toBe('https://example.com/docs/%2Fpage');
  });
});
