import { Redis, type RedisOptions } from 'ioredis';
import { logger } from './logger.js';

/**
 * Redis client for firmar.ec inbox-backend.
 *
 * DB allocation across IDK Redis HA (per F3.5 spec):
 *   - DB 8: idk-microtk
 *   - DB 9: chatwoot
 *   - DB 10: firmar-ec-inbox  ← us
 *
 * Default URL: redis://redis-ha:6379/10
 */

let _redis: Redis | undefined;

export interface RedisHandle {
  readonly client: Redis;
  readonly setOtp: (otpHash: string, pdfId: string, ttlSeconds?: number) => Promise<void>;
  readonly getOtp: (otpHash: string) => Promise<string | null>;
  readonly delOtp: (otpHash: string) => Promise<void>;
  readonly incrRate: (
    phoneHash: string,
    windowSeconds: number,
  ) => Promise<{ count: number; ttl: number }>;
  readonly close: () => Promise<void>;
}

const OTP_DEFAULT_TTL_SECONDS = 600; // 10 min per spec

export function buildRedis(urlOrClient?: string | Redis): RedisHandle {
  let client: Redis;
  if (urlOrClient !== undefined && typeof urlOrClient !== 'string') {
    client = urlOrClient;
  } else {
    const url = urlOrClient ?? process.env['REDIS_URL'] ?? 'redis://localhost:6379/10';
    const opts: RedisOptions = {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    };
    client = new Redis(url, opts);
  }

  client.on('error', (err) => {
    logger.error({ err }, 'redis error');
  });

  return {
    client,

    async setOtp(otpHash, pdfId, ttlSeconds = OTP_DEFAULT_TTL_SECONDS) {
      await client.set(`otp:${otpHash}`, pdfId, 'EX', ttlSeconds);
    },

    async getOtp(otpHash) {
      return client.get(`otp:${otpHash}`);
    },

    async delOtp(otpHash) {
      await client.del(`otp:${otpHash}`);
    },

    /**
     * Atomic INCR + EXPIRE (only on first hit) for sliding window rate limiting.
     * Returns current count + remaining TTL.
     */
    async incrRate(phoneHash, windowSeconds) {
      const window = Math.floor(Date.now() / 1000 / windowSeconds);
      const key = `rate:${phoneHash}:${window}`;
      const pipeline = client.multi();
      pipeline.incr(key);
      pipeline.expire(key, windowSeconds);
      pipeline.ttl(key);
      const res = await pipeline.exec();
      if (res === null) {
        throw new Error('redis pipeline failed');
      }
      const count = Number(res[0]?.[1] ?? 0);
      const ttl = Number(res[2]?.[1] ?? windowSeconds);
      return { count, ttl };
    },

    async close() {
      await client.quit();
    },
  };
}

export function getRedis(): RedisHandle {
  if (_redis === undefined) {
    const handle = buildRedis();
    _redis = handle.client;
    return handle;
  }
  return buildRedis(_redis);
}
