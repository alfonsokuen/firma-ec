import { Redis, type RedisOptions } from 'ioredis';
import { logger } from './logger.js';

/**
 * Redis client for firmar.ec stats-backend.
 *
 * DB allocation across IDK Redis HA:
 *   - DB 8:  idk-microtk
 *   - DB 9:  chatwoot
 *   - DB 10: firmar-ec-inbox
 *   - DB 11: firmar-ec-stats  ← us
 *
 * Default URL: redis://redis-ha:6379/11
 *
 * Redis here only backs the per-IP token-bucket rate limiter for the event
 * beacon — there is no durable state in Redis.
 */

let _redis: Redis | undefined;

export interface RedisHandle {
  readonly client: Redis;
  readonly close: () => Promise<void>;
}

export function buildRedis(urlOrClient?: string | Redis): RedisHandle {
  let client: Redis;
  if (urlOrClient !== undefined && typeof urlOrClient !== 'string') {
    client = urlOrClient;
  } else {
    const url = urlOrClient ?? process.env['REDIS_URL'] ?? 'redis://redis-ha:6379/11';
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
