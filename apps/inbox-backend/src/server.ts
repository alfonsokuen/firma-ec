import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import rawBody from 'fastify-raw-body';
import type { PrismaClient } from '@prisma/client';
import type { S3Client } from '@aws-sdk/client-s3';
import type { Redis } from 'ioredis';
import { loggerOptions } from './logger.js';
import { loadEnv, type Env } from './env.js';
import { registerErrorHandler } from './lib/errors.js';
import prismaPlugin from './plugins/prisma.js';
import r2Plugin from './plugins/r2.js';
import evolutionPlugin, { type EvolutionClient } from './plugins/evolution.js';
import redisPlugin from './plugins/redis.js';
import webhookWaRoutes from './routes/webhook-wa.js';
import inboxVerifyRoutes from './routes/inbox-verify.js';
import inboxRoutes from './routes/inbox-list.js';

export interface BuildServerOpts {
  /** Disable global ip rate limiter (per-route limits keep working). */
  disableRateLimit?: boolean;
  /** Skip mounting feature routes (used by trivial smoke tests). */
  skipRoutes?: boolean;
  /** Override env (test only). */
  env?: Env;
  /** Test overrides — pass mocks to skip real plugin construction. */
  overrides?: {
    prisma?: PrismaClient;
    redis?: Redis;
    r2Client?: S3Client;
    evolution?: EvolutionClient;
  };
}

export async function buildServer(opts: BuildServerOpts = {}): Promise<FastifyInstance> {
  const env = opts.env ?? loadEnv();
  const app = Fastify({
    logger: loggerOptions,
    disableRequestLogging: false,
    trustProxy: true,
    bodyLimit: 32 * 1024 * 1024, // 32MB header — webhook payload may include base64 PDF
  });

  registerErrorHandler(app);

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cors, {
    origin: [/\.firmar\.ec$/, 'http://localhost:5173'],
    credentials: false,
  });

  if (!opts.disableRateLimit) {
    await app.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute',
    });
  }

  // Raw body capture for HMAC verification on webhook routes.
  await app.register(rawBody, {
    field: 'rawBody',
    global: false,
    encoding: false, // Buffer
    runFirst: true,
  });

  // Infra plugins
  if (opts.overrides?.prisma) {
    await app.register(prismaPlugin, { client: opts.overrides.prisma });
  } else if (!opts.skipRoutes) {
    await app.register(prismaPlugin, {});
  }
  if (opts.overrides?.redis) {
    await app.register(redisPlugin, { client: opts.overrides.redis });
  } else if (!opts.skipRoutes) {
    await app.register(redisPlugin, { url: env.REDIS_URL });
  }
  if (opts.overrides?.r2Client) {
    await app.register(r2Plugin, {
      endpoint: env.R2_ENDPOINT,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUCKET,
      client: opts.overrides.r2Client,
    });
  } else if (!opts.skipRoutes) {
    await app.register(r2Plugin, {
      endpoint: env.R2_ENDPOINT,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUCKET,
    });
  }
  if (opts.overrides?.evolution) {
    await app.register(evolutionPlugin, {
      baseUrl: env.EVOLUTION_API_URL,
      apiKey: env.EVOLUTION_API_KEY,
      instance: env.EVOLUTION_INSTANCE,
      client: opts.overrides.evolution,
    });
  } else if (!opts.skipRoutes) {
    await app.register(evolutionPlugin, {
      baseUrl: env.EVOLUTION_API_URL,
      apiKey: env.EVOLUTION_API_KEY,
      instance: env.EVOLUTION_INSTANCE,
    });
  }

  app.get('/healthz', async () => ({
    status: 'ok',
    service: 'inbox-backend',
    timestamp: new Date().toISOString(),
  }));

  app.get('/readyz', async (_req, reply) => {
    // TODO(T20): real DB/Redis pings.
    return reply.code(200).send({ status: 'ready' });
  });

  if (!opts.skipRoutes) {
    await app.register(webhookWaRoutes, { env });
    await app.register(inboxVerifyRoutes, { env });
    await app.register(inboxRoutes, { env });
  }

  return app;
}
