import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { buildRedis, type RedisHandle } from '../redis.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: RedisHandle;
  }
}

export interface RedisPluginOpts {
  url?: string;
  /** Override the underlying client (e.g. ioredis-mock) for tests. */
  client?: Redis;
}

export default fp<RedisPluginOpts>(async function redisPlugin(
  app: FastifyInstance,
  opts,
) {
  const handle = opts.client ? buildRedis(opts.client) : buildRedis(opts.url);
  app.decorate('redis', handle);
  app.addHook('onClose', async () => {
    try {
      await handle.close();
    } catch {
      /* already closed */
    }
  });
}, { name: 'redis' });
