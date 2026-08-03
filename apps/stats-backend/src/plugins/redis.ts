import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';
import { type RedisHandle, buildRedis } from '../redis.js';

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

export default fp<RedisPluginOpts>(
  async function redisPlugin(app: FastifyInstance, opts) {
    const handle = opts.client ? buildRedis(opts.client) : buildRedis(opts.url);
    app.decorate('redis', handle);
    app.addHook('onClose', async () => {
      try {
        await handle.close();
      } catch (err) {
        app.log.warn({ err }, 'redis: error during quit (connection may already be closed)');
      }
    });
  },
  { name: 'redis' },
);
