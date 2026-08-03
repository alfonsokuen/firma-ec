import type { Redis } from 'ioredis';

/**
 * Atomic token-bucket rate limiter backed by Redis.
 *
 * Each bucket key holds two HASH fields: `tokens` (float) and `ts` (ms).
 * On each call we refill linearly since `ts`, then attempt to consume 1.
 * Lua script ensures atomicity — no race between concurrent clients.
 */

const BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_per_sec = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then tokens = capacity end
if ts == nil then ts = now_ms end

local elapsed = (now_ms - ts) / 1000.0
if elapsed < 0 then elapsed = 0 end
tokens = math.min(capacity, tokens + elapsed * refill_per_sec)

local ok = 0
local retry_ms = 0
if tokens >= 1 then
  tokens = tokens - 1
  ok = 1
else
  local needed = 1 - tokens
  retry_ms = math.ceil((needed / refill_per_sec) * 1000)
end

redis.call('HMSET', key, 'tokens', tokens, 'ts', now_ms)
redis.call('PEXPIRE', key, ttl)
return {ok, retry_ms}
`;

export interface BucketSpec {
  key: string;
  capacity: number;
  refillPerSec: number;
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterS: number;
}

/**
 * Try to consume a token from the named bucket.
 * Returns ok=true on success, ok=false + retryAfterS when empty.
 */
export async function checkAndConsume(
  redis: Redis,
  spec: BucketSpec,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  // TTL = 2× the time it takes to refill to full capacity, in ms.
  const ttl = Math.max(60_000, Math.ceil((spec.capacity / spec.refillPerSec) * 2_000));
  const res = (await redis.eval(
    BUCKET_LUA,
    1,
    spec.key,
    String(spec.capacity),
    String(spec.refillPerSec),
    String(now),
    String(ttl),
  )) as [number, number];
  return {
    ok: res[0] === 1,
    retryAfterS: Math.ceil(res[1] / 1000),
  };
}
