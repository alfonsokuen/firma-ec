import RedisMock from 'ioredis-mock';
import { describe, expect, test } from 'vitest';
import { checkAndConsume } from '../src/services/rate-limit.js';

/**
 * rate-limit.test.ts — token-bucket over ioredis-mock.
 *
 * Mirrors the event beacon's policy: capacity 20, refill 20/hour. With time
 * frozen at `now`, the first 20 consume succeed and the 21st in the same hour
 * is rejected (the bucket is empty and refill over a single fixed instant is 0).
 */

describe('checkAndConsume — capacity 20 / hour', () => {
  test('the 21st call in the same hour is rejected', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: ioredis-mock is API-compatible
    const redis = new RedisMock() as any;
    const spec = { key: 'rl:stats:1.2.3.4', capacity: 20, refillPerSec: 20 / 3_600 };
    const now = Date.now();

    for (let i = 0; i < 20; i++) {
      const r = await checkAndConsume(redis, spec, now);
      expect(r.ok).toBe(true);
    }
    const over = await checkAndConsume(redis, spec, now);
    expect(over.ok).toBe(false);
    expect(over.retryAfterS).toBeGreaterThan(0);
  });

  test('a different key is limited independently', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: ioredis-mock is API-compatible
    const redis = new RedisMock() as any;
    const now = Date.now();
    const a = { key: 'rl:stats:a', capacity: 20, refillPerSec: 20 / 3_600 };
    const b = { key: 'rl:stats:b', capacity: 20, refillPerSec: 20 / 3_600 };

    for (let i = 0; i < 21; i++) await checkAndConsume(redis, a, now);
    const firstOnB = await checkAndConsume(redis, b, now);
    expect(firstOnB.ok).toBe(true);
  });
});
