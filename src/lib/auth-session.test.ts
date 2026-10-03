import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { checkAuth, saveAuth } from './auth';
import { hash, secret } from './crypto';
import { createSecureToken, parseSecureToken } from './jwt';
import redis from './redis';
import { getUser } from '@/queries/prisma/user';

vi.mock('@/queries/prisma/user', () => ({ getUser: vi.fn() }));
vi.mock('@/queries/prisma/apiKey', () => ({
  getApiKeyByHash: vi.fn(),
  updateApiKeyLastUsed: vi.fn(),
}));
vi.mock('@/lib/redis', () => ({
  default: { enabled: true, client: { set: vi.fn(), get: vi.fn() } },
}));
const lifetime = 7776000;
const started = new Date('2026-10-03T00:00:00Z');
const account = { id: 'user-1', role: 'user', password: 'current-hash' };
const data = { userId: account.id, role: account.role, pwd: hash(account.password) };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(started);
  vi.stubEnv('APP_SECRET', 'test-session-secret');
  vi.clearAllMocks();
  redis.enabled = true;
  vi.mocked(getUser).mockImplementation(async () => ({ ...account }) as any);
  vi.mocked(redis.client.get).mockResolvedValue(data);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test('Redis storage gets a 90-day TTL atomically and the opaque token has the same expiry', async () => {
  const token = await saveAuth(data, lifetime);
  const payload = parseSecureToken(token, secret()) as any;
  expect(payload.exp - payload.iat).toBe(lifetime);
  expect(redis.client.set).toHaveBeenCalledWith(payload.authKey, data, lifetime);
});
test('the default session lifetime is also 90 days', async () => {
  const payload = parseSecureToken(await saveAuth(data), secret()) as any;
  expect(payload.exp - payload.iat).toBe(lifetime);
  expect(redis.client.set).toHaveBeenCalledWith(payload.authKey, data, lifetime);
});
test.each([false, true])(
  'previously issued sessions without exp are limited by their original issue time (Redis=%s)',
  async enabled => {
    redis.enabled = enabled;
    const token = createSecureToken(enabled ? { authKey: 'auth:legacy' } : data, secret());
    const request = new Request('http://localhost/api/auth/verify', {
      headers: { authorization: `Bearer ${token}` },
    });
    vi.setSystemTime(started.getTime() + (lifetime - 1) * 1000);
    expect((await checkAuth(request))?.user.id).toBe(account.id);
    vi.setSystemTime(started.getTime() + lifetime * 1000);
    expect(await checkAuth(request)).toBeNull();
  },
);

test.each([false, true])(
  'full session expiry is enforced at the 90-day boundary (Redis=%s)',
  async enabled => {
    redis.enabled = enabled;
    const token = enabled
      ? await saveAuth(data, lifetime)
      : createSecureToken(data, secret(), { expiresIn: lifetime });
    const request = new Request('http://localhost/api/auth/verify', {
      headers: { authorization: `Bearer ${token}` },
    });
    vi.setSystemTime(started.getTime() + (lifetime - 1) * 1000);
    expect((await checkAuth(request))?.user.id).toBe(account.id);
    vi.setSystemTime(started.getTime() + lifetime * 1000);
    expect(await checkAuth(request)).toBeNull();
  },
);

test.each([false, true])(
  'long sessions still reject changed passwords and deleted accounts (Redis=%s)',
  async enabled => {
    redis.enabled = enabled;
    const token = enabled
      ? await saveAuth(data, lifetime)
      : createSecureToken(data, secret(), { expiresIn: lifetime });
    const request = new Request('http://localhost/api/auth/verify', {
      headers: { authorization: `Bearer ${token}` },
    });
    vi.mocked(getUser).mockResolvedValue({ ...account, password: 'changed-hash' } as any);
    expect(await checkAuth(request)).toBeNull();
    vi.mocked(getUser).mockResolvedValue(null);
    expect(await checkAuth(request)).toBeNull();
  },
);
