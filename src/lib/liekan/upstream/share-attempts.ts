import { createHmac } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { secret } from '@/lib/crypto';
import { getIpAddress } from '@/lib/ip';
import redis from '@/lib/redis';

export const SHARE_PASSWORD_LIMITS = {
  windowMs: 60000,
  client: 5,
  share: 60,
  global: 120,
  concurrent: 4,
  capacity: 512,
  redisTimeoutMs: 1000,
} as const;

export class ShareAttemptError extends Error {
  constructor(
    public status: 429 | 503,
    public retryAfter: number,
  ) {
    super(status === 429 ? '分享密码验证过于频繁，请稍后重试' : '分享验证暂时不可用，请稍后重试');
  }
}

// Admission and expiry are atomic. Rejections leave the original window intact.
const reserveScript = `
local retry = 0
for i, key in ipairs(KEYS) do
  if tonumber(redis.call('GET', key) or '0') >= tonumber(ARGV[i + 1]) then
    local ttl = redis.call('PTTL', key)
    if ttl < 0 then
      redis.call('PEXPIRE', key, ARGV[1])
      ttl = tonumber(ARGV[1])
    end
    retry = math.max(retry, ttl)
  end
end
if retry > 0 then return {0, retry} end
for _, key in ipairs(KEYS) do
  if redis.call('INCR', key) == 1 then redis.call('PEXPIRE', key, ARGV[1]) end
end
return {1, 0}
`;

function attemptKeys(request: Request, shareId: string) {
  const candidate = getIpAddress(request.headers);
  const address = candidate && ipaddr.isValid(candidate) ? candidate : 'unknown';
  const key = (value: string) => createHmac('sha256', secret()).update(value).digest('hex');
  const prefix = 'liekan:share-password:v1:';
  return [
    prefix + key('global'),
    prefix + key(`share:${shareId}`),
    prefix + key(`client:${shareId}:${address}`),
  ];
}

export function createShareAttemptGuard({
  capacity = SHARE_PASSWORD_LIMITS.capacity,
  now = Date.now,
}: {
  capacity?: number;
  now?: () => number;
} = {}) {
  const buckets = new Map<string, { count: number; expiresAt: number }>();
  let active = 0;
  let pendingRedis = 0;

  function reserveLocal(keys: string[]) {
    const time = now();
    for (const [key, bucket] of buckets) if (bucket.expiresAt <= time) buckets.delete(key);
    const limits = [
      SHARE_PASSWORD_LIMITS.global,
      SHARE_PASSWORD_LIMITS.share,
      SHARE_PASSWORD_LIMITS.client,
    ];
    const blocked = keys.map((key, i) => {
      const bucket = buckets.get(key);
      return bucket && bucket.count >= limits[i] ? bucket.expiresAt - time : 0;
    });
    const remaining = Math.max(...blocked);
    if (remaining > 0) throw new ShareAttemptError(429, Math.max(1, Math.ceil(remaining / 1000)));
    if (buckets.size + keys.filter(key => !buckets.has(key)).length > capacity) {
      const earliest = Math.min(...[...buckets.values()].map(bucket => bucket.expiresAt));
      throw new ShareAttemptError(429, Math.max(1, Math.ceil((earliest - time) / 1000)));
    }
    for (const key of keys) {
      const bucket = buckets.get(key);
      if (bucket) bucket.count++;
      else buckets.set(key, { count: 1, expiresAt: time + SHARE_PASSWORD_LIMITS.windowMs });
    }
  }

  async function reserveRedis(keys: string[]) {
    // Timed-out operations retain their slot until the underlying operation settles.
    // An unavailable Redis connection cannot accumulate an unbounded offline queue.
    if (pendingRedis >= SHARE_PASSWORD_LIMITS.concurrent) throw new ShareAttemptError(503, 5);
    pendingRedis++;
    const work = (async () => {
      await redis.client.connect();
      return redis.client.client.eval(reserveScript, {
        keys,
        arguments: [
          SHARE_PASSWORD_LIMITS.windowMs,
          SHARE_PASSWORD_LIMITS.global,
          SHARE_PASSWORD_LIMITS.share,
          SHARE_PASSWORD_LIMITS.client,
        ].map(String),
      });
    })().finally(() => {
      pendingRedis--;
    });
    let timer: ReturnType<typeof setTimeout>;
    try {
      const result = await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new ShareAttemptError(503, 5)),
            SHARE_PASSWORD_LIMITS.redisTimeoutMs,
          );
        }),
      ]);
      if (
        !Array.isArray(result) ||
        result.length !== 2 ||
        ![0, 1].includes(Number(result[0])) ||
        !Number.isFinite(Number(result[1]))
      )
        throw new ShareAttemptError(503, 5);
      if (Number(result[0]) === 0)
        throw new ShareAttemptError(429, Math.max(1, Math.ceil(Number(result[1]) / 1000)));
    } catch (error) {
      if (error instanceof ShareAttemptError) throw error;
      throw new ShareAttemptError(503, 5);
    } finally {
      clearTimeout(timer);
    }
  }

  return async function acquire(request: Request, shareId: string) {
    if (active >= SHARE_PASSWORD_LIMITS.concurrent) throw new ShareAttemptError(429, 1);
    active++;
    try {
      const keys = attemptKeys(request, shareId);
      if (redis.enabled) await reserveRedis(keys);
      else reserveLocal(keys);
      let released = false;
      return () => {
        if (!released) {
          released = true;
          active--;
        }
      };
    } catch (error) {
      active--;
      throw error;
    }
  };
}

export const acquireSharePasswordAttempt = createShareAttemptGuard();
