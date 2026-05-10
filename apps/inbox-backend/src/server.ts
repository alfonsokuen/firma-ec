import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { loggerOptions } from './logger.js';

export interface BuildServerOpts {
  /**
   * Disable plugins that are awkward in unit tests (e.g. real rate limiter).
   * Defaults to false.
   */
  disableRateLimit?: boolean;
}

/**
 * Factory that builds a fresh Fastify instance with sensible defaults.
 * Pure function — no side effects, no listen(). Caller is responsible for
 * starting/closing the server. This makes the factory trivially testable.
 */
export async function buildServer(opts: BuildServerOpts = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    disableRequestLogging: false,
    trustProxy: true,
    bodyLimit: 1024 * 1024, // 1MB — PDFs go via R2 presigned, not body
  });

  await app.register(helmet, {
    contentSecurityPolicy: false, // API only, no HTML rendering
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  if (!opts.disableRateLimit) {
    await app.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute',
      // Per-IP fallback. Per-phone limits are enforced separately at handler level.
    });
  }

  app.get('/healthz', async () => ({
    status: 'ok',
    service: 'inbox-backend',
    timestamp: new Date().toISOString(),
  }));

  app.get('/readyz', async (_req, reply) => {
    // TODO(F3.5 T6+): real DB/Redis pings. For now, liveness only.
    return reply.code(200).send({ status: 'ready' });
  });

  return app;
}
