import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  secret: 'share-attempt-test',
  enabled: false,
  connect: vi.fn(),
  eval: vi.fn(),
}));
vi.mock('@/lib/redis', () => ({
  default: {
    get enabled() {
      return state.enabled;
    },
    client: { connect: state.connect, client: { eval: state.eval } },
  },
}));
vi.mock('@/lib/crypto', () => ({ secret: () => state.secret }));

import { createShareAttemptGuard, SHARE_PASSWORD_LIMITS } from './share-attempts';

const request = (address?: string) =>
  new Request('http://test.invalid', { headers: address ? { 'x-real-ip': address } : {} });
const admit = async (
  guard: ReturnType<typeof createShareAttemptGuard>,
  address = '192.0.2.1',
  share = 'share',
) => {
  const release = await guard(request(address), share);
  release();
};

beforeEach(() => {
  vi.useRealTimers();
  state.enabled = false;
  state.secret = 'share-attempt-test';
  state.connect.mockReset().mockResolvedValue(undefined);
  state.eval.mockReset().mockResolvedValue([1, 0]);
});

describe('public share attempt admission', () => {
  it('rejects client overflow, keeps fixed expiry and admits again after expiry', async () => {
    let time = 1000;
    const guard = createShareAttemptGuard({ now: () => time });
    for (let i = 0; i < SHARE_PASSWORD_LIMITS.client; i++) await admit(guard);
    time += 59000;
    await expect(admit(guard)).rejects.toMatchObject({ status: 429, retryAfter: 1 });
    time += 1000;
    await admit(guard);
  });

  it('normalizes equivalent addresses and collapses absent or invalid addresses', async () => {
    const guard = createShareAttemptGuard();
    for (let i = 0; i < 5; i++) await admit(guard, i % 2 ? '::ffff:192.0.2.1' : '192.0.2.1');
    await expect(admit(guard)).rejects.toMatchObject({ status: 429 });
    for (let i = 0; i < 5; i++) (await guard(request(), 'other'))();
    await expect(admit(guard, 'invented-address', 'other')).rejects.toMatchObject({ status: 429 });
  });

  it('bounds a share across addresses and the app across shares', async () => {
    const guard = createShareAttemptGuard();
    for (let i = 0; i < SHARE_PASSWORD_LIMITS.share; i++) await admit(guard, `192.0.2.${i + 1}`);
    await expect(admit(guard, '198.51.100.1')).rejects.toMatchObject({ status: 429 });
    for (let i = 0; i < SHARE_PASSWORD_LIMITS.global - SHARE_PASSWORD_LIMITS.share; i++)
      await admit(guard, '203.0.113.1', `share-${i}`);
    await expect(admit(guard, '203.0.113.2', 'fresh-share')).rejects.toMatchObject({ status: 429 });
  });

  it('rejects excess concurrency before work and releases each slot once', async () => {
    const guard = createShareAttemptGuard();
    const leases = await Promise.all(
      Array.from({ length: 4 }, (_, i) => guard(request(`192.0.2.${i + 1}`), 'share')),
    );
    await expect(guard(request('192.0.2.5'), 'share')).rejects.toMatchObject({
      status: 429,
      retryAfter: 1,
    });
    leases[0]();
    leases[0]();
    const next = await guard(request('192.0.2.5'), 'share');
    await expect(guard(request('192.0.2.6'), 'share')).rejects.toMatchObject({ status: 429 });
    next();
    leases.forEach(release => {
      release();
    });
    await admit(guard, '192.0.2.6');
  });

  it('does not evict active buckets at capacity or reset their attempt count', async () => {
    let time = 0;
    const guard = createShareAttemptGuard({ capacity: 5, now: () => time });
    for (let i = 1; i <= 3; i++) await admit(guard, `192.0.2.${i}`);
    await expect(admit(guard, '192.0.2.4')).rejects.toMatchObject({ status: 429 });
    for (let i = 1; i < 5; i++) await admit(guard);
    await expect(admit(guard)).rejects.toMatchObject({ status: 429 });
    time = 60000;
    await admit(guard, '192.0.2.4');
  });

  it('uses atomic expiring Redis counters with opaque client and share keys', async () => {
    state.enabled = true;
    const guard = createShareAttemptGuard();
    await admit(guard);
    const [script, options] = state.eval.mock.calls[0];
    expect(script).toContain("redis.call('PEXPIRE'");
    expect(options.arguments).toEqual(['60000', '120', '60', '5']);
    expect(options.keys).toHaveLength(3);
    expect(options.keys.join()).not.toContain('192.0.2.1');
    expect(options.keys.slice(1).every((key: string) => /:[a-f0-9]{64}$/.test(key))).toBe(true);
    state.eval.mockResolvedValue([0, 2500]);
    await expect(admit(guard)).rejects.toMatchObject({ status: 429, retryAfter: 3 });
  });

  it('shares Redis counters within one app and separates apps with different secrets', async () => {
    state.enabled = true;
    await admit(createShareAttemptGuard());
    await admit(createShareAttemptGuard());
    const first = state.eval.mock.calls[0][1].keys;
    expect(state.eval.mock.calls[1][1].keys).toEqual(first);
    state.secret = 'another-app-secret';
    await admit(createShareAttemptGuard());
    expect(
      state.eval.mock.calls[2][1].keys.every((key: string, i: number) => key !== first[i]),
    ).toBe(true);
  });

  it.each([new Error('offline'), null, [2, 0], [1, 'bad']])(
    'fails closed on unusable Redis response %s',
    async result => {
      state.enabled = true;
      if (result instanceof Error) state.eval.mockRejectedValue(result);
      else state.eval.mockResolvedValue(result);
      const guard = createShareAttemptGuard();
      await expect(admit(guard)).rejects.toMatchObject({ status: 503 });
      state.eval.mockResolvedValue([1, 0]);
      await admit(guard);
    },
  );

  it('bounds outstanding timed-out Redis operations and recovers when they settle', async () => {
    vi.useFakeTimers();
    state.enabled = true;
    let reconnect!: () => void;
    const connected = new Promise<void>(resolve => {
      reconnect = resolve;
    });
    state.connect.mockReturnValue(connected);
    const guard = createShareAttemptGuard();
    const calls = Array.from({ length: 4 }, (_, i) =>
      guard(request(`192.0.2.${i + 1}`), 'share').catch(error => error),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect((await Promise.all(calls)).map(error => error.status)).toEqual([503, 503, 503, 503]);
    await expect(admit(guard)).rejects.toMatchObject({ status: 503 });
    expect(state.connect).toHaveBeenCalledTimes(4);
    reconnect();
    await vi.advanceTimersByTimeAsync(0);
    await admit(guard);
  });
});
