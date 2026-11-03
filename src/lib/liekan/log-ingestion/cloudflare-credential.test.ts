import { expect, it } from 'vitest';
import {
  cloudflareAccessExpired,
  cloudflareProviderCredentialUnusable,
  cloudflareRefreshTokenIssued,
  publishLogSource,
} from './cloudflare-credential';

it('treats a missing or blank refresh token as not issued', () => {
  expect(cloudflareRefreshTokenIssued(undefined)).toBe(false);
  expect(cloudflareRefreshTokenIssued({ refreshToken: '  ' })).toBe(false);
  expect(cloudflareRefreshTokenIssued({ refreshToken: 'fixture-refresh-token' })).toBe(true);
});

it('expires an access token only when it cannot be refreshed', () => {
  const now = 1_000_000;
  expect(cloudflareAccessExpired({ expiresAt: now - 1 }, now)).toBe(true);
  expect(cloudflareAccessExpired({ expiresAt: now + 1 }, now)).toBe(false);
  expect(
    cloudflareAccessExpired({ expiresAt: now - 1, refreshToken: 'fixture-refresh-token' }, now),
  ).toBe(false);
});

it('reads the provider pause flag from stored health', () => {
  expect(cloudflareProviderCredentialUnusable({ providerCredentialUnusable: true })).toBe(true);
  expect(cloudflareProviderCredentialUnusable('{"providerCredentialUnusable":true}')).toBe(true);
  expect(cloudflareProviderCredentialUnusable({})).toBe(false);
  expect(cloudflareProviderCredentialUnusable('not-json')).toBe(false);
});

it('publishes whether a Cloudflare connection can refresh without the sealed credential', () => {
  const open = (sealed: string) => {
    if (sealed === 'missing')
      return JSON.stringify({
        accessToken: 'fixture-access-token',
        refreshToken: '',
        receiverToken: 'fixture-receiver-token',
      });
    if (sealed === 'issued')
      return JSON.stringify({
        accessToken: 'fixture-access-token',
        refreshToken: 'fixture-refresh-token',
        receiverToken: 'fixture-receiver-token',
      });
    throw new Error('Credential record cannot be decrypted');
  };
  const missing = publishLogSource(
    { id: 'source', kind: 'cloudflare', domain: 'example.com', provider_config: 'missing' },
    open,
  );
  expect(missing).toEqual({
    id: 'source',
    kind: 'cloudflare',
    domain: 'example.com',
    refreshTokenIssued: false,
  });
  const issued = publishLogSource(
    { id: 'source', kind: 'cloudflare', provider_config: 'issued' },
    open,
  );
  expect(issued).toMatchObject({ refreshTokenIssued: true });
  expect(JSON.stringify({ missing, issued })).not.toMatch(
    /fixture-access-token|fixture-refresh-token|fixture-receiver-token|provider_config/,
  );
  expect(
    publishLogSource({ id: 'source', kind: 'cloudflare', provider_config: 'broken' }, open),
  ).toEqual({ id: 'source', kind: 'cloudflare' });
  expect(
    publishLogSource({ id: 'server', kind: 'server', provider_config: 'missing' }, open),
  ).toEqual({ id: 'server', kind: 'server' });
});
