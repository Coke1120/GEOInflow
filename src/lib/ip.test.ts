import { afterEach, describe, expect, test, vi } from 'vitest';
import { getIpAddress, stripPort, normalizeIp, normalizedCidr, resolveClientIp, hasIgnoredIp } from './ip';

function headers(init: Record<string, string>) {
  return new Headers(init);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getIpAddress', () => {
  test('returns undefined when no known headers are present', () => {
    expect(getIpAddress(headers({}))).toBeUndefined();
  });

  test('extracts the first address from an x-forwarded-for chain', () => {
    expect(getIpAddress(headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12' }))).toBe(
      '1.2.3.4',
    );
  });

  test('trims whitespace around the x-forwarded-for client address', () => {
    expect(getIpAddress(headers({ 'x-forwarded-for': '  1.2.3.4  , 5.6.7.8' }))).toBe('1.2.3.4');
  });

  test('reads the Cloudflare cf-connecting-ip header', () => {
    expect(getIpAddress(headers({ 'cf-connecting-ip': '203.0.113.5' }))).toBe('203.0.113.5');
  });

  test('reads the Fastly fastly-client-ip header', () => {
    expect(getIpAddress(headers({ 'fastly-client-ip': '198.51.100.7' }))).toBe('198.51.100.7');
  });

  test('reads the x-real-ip reverse proxy header', () => {
    expect(getIpAddress(headers({ 'x-real-ip': '192.0.2.9' }))).toBe('192.0.2.9');
  });

  test('parses the RFC 7239 forwarded header', () => {
    expect(getIpAddress(headers({ forwarded: 'for=192.0.2.60;proto=http;by=203.0.113.43' }))).toBe(
      '192.0.2.60',
    );
  });
  test('resolves quoted Forwarded IPv4 and bracketed IPv6 with ports', () => {
    vi.stubEnv('CLIENT_IP_HEADER', 'forwarded');
    expect(getIpAddress(headers({ forwarded: 'for="192.0.2.60:8080";proto=https' }))).toBe(
      '192.0.2.60',
    );
    expect(
      getIpAddress(
        headers({ forwarded: 'for="[2001:db8::1]:8080";proto=https, for=198.51.100.1' }),
      ),
    ).toBe('2001:db8::1');
  });

  test('prefers higher-priority vendor headers over x-forwarded-for', () => {
    expect(
      getIpAddress(
        headers({
          'cf-connecting-ip': '203.0.113.5',
          'x-forwarded-for': '1.2.3.4',
        }),
      ),
    ).toBe('203.0.113.5');
  });

  test('normalizes a full IPv6 address to compressed form', () => {
    expect(getIpAddress(headers({ 'x-real-ip': '2001:0db8:0000:0000:0000:0000:0000:0001' }))).toBe(
      '2001:db8::1',
    );
  });

  test('converts an IPv4-mapped IPv6 address to IPv4', () => {
    expect(getIpAddress(headers({ 'x-real-ip': '::ffff:1.2.3.4' }))).toBe('1.2.3.4');
  });

  test('strips the port from an IPv4 address with a port', () => {
    expect(getIpAddress(headers({ 'x-real-ip': '1.2.3.4:8080' }))).toBe('1.2.3.4');
  });

  test('returns no address for malformed input', () => {
    expect(getIpAddress(headers({ 'x-real-ip': 'not-an-ip' }))).toBeUndefined();
  });

  test('uses a custom CLIENT_IP_HEADER when configured', () => {
    vi.stubEnv('CLIENT_IP_HEADER', 'x-custom-ip');
    expect(
      getIpAddress(
        headers({
          'x-custom-ip': '10.0.0.1',
          'x-forwarded-for': '1.2.3.4',
        }),
      ),
    ).toBe('10.0.0.1');
  });

  test('falls back to standard headers when CLIENT_IP_HEADER is absent from the request', () => {
    vi.stubEnv('CLIENT_IP_HEADER', 'x-custom-ip');
    expect(getIpAddress(headers({ 'x-real-ip': '192.0.2.9' }))).toBe('192.0.2.9');
  });
});

describe('stripPort', () => {
  test('returns nullish input unchanged', () => {
    expect(stripPort(undefined)).toBeUndefined();
    expect(stripPort(null)).toBeNull();
    expect(stripPort('')).toBe('');
  });

  test('removes the port from an IPv4 address', () => {
    expect(stripPort('1.2.3.4:8080')).toBe('1.2.3.4');
  });

  test('leaves a plain IPv4 address unchanged', () => {
    expect(stripPort('1.2.3.4')).toBe('1.2.3.4');
  });

  test('keeps only the bracketed portion of a bracketed IPv6 address', () => {
    expect(stripPort('[::1]:8080')).toBe('::1');
  });

  test('leaves an unbracketed IPv6 address unchanged', () => {
    expect(stripPort('::1')).toBe('::1');
  });
});


test('skips invalid preferred headers and never substitutes a proxy hop', () => {
  vi.stubEnv('CLIENT_IP_HEADER', 'x-custom-ip');
  expect(resolveClientIp(headers({'x-custom-ip':'unknown', 'cf-connecting-ip':'garbage', 'x-forwarded-for':'223.5.5.5, 8.8.8.8'}))).toMatchObject({ip:'223.5.5.5', trusted:false});
  expect(getIpAddress(headers({'x-forwarded-for':'unknown, 8.8.8.8'}))).toBeUndefined();
});

test('trusted ingress takes precedence over public overrides', () => {
  vi.stubEnv('CLIENT_IP_HEADER', 'x-real-ip');
  const h = headers({'x-real-ip':'[::ffff:223.5.5.5]:443'});
  expect(resolveClientIp(h, '8.8.8.8')).toMatchObject({ip:'223.5.5.5', trusted:true});
  expect(resolveClientIp(h, '8.8.8.8', true)).toMatchObject({ip:'8.8.8.8', source:'authenticated_server'});
});

test.each(['2409:807e:2001:1107::4', '64:ff9b::808:808', '::ffff:223.5.5.5'])(
  'normalizes native and mapped address %s', value => {
    expect(normalizeIp(value)).toBe(value.startsWith('::ffff:') ? '223.5.5.5' : value);
  },
);

test.each([0,32,64,96,128])('keeps CIDR address family correct for mapped /%s', bits => {
  const cidr = normalizedCidr(`::ffff:223.5.5.5/${bits}`);
  expect(cidr[0].kind()).toBe(bits >= 96 ? 'ipv4' : 'ipv6');
  expect(cidr[1]).toBe(bits >= 96 ? bits-96 : bits);
});

test('filtering normalizes addresses and retains valid rules after a bad update', () => {
  vi.stubEnv('IGNORE_IP', '::ffff:223.5.5.0/120,2409:807e::/32');
  expect(hasIgnoredIp('[::ffff:223.5.5.5]:80')).toBe(true);
  expect(hasIgnoredIp('2409:807e:2001:1107::4')).toBe(true);
  vi.stubEnv('IGNORE_IP', 'broken');
  expect(hasIgnoredIp('223.5.5.5')).toBe(true);
  expect(hasIgnoredIp('8.8.8.8')).toBe(false);
});
