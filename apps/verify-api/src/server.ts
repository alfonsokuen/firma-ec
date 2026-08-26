import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import pino from 'pino';
import { type Env, loadEnv } from './env.js';
import { registerErrorHandler } from './lib/errors.js';
import { loggerOptions } from './logger.js';
import healthRoutes from './routes/health.js';
import verifyRoutes from './routes/verify.js';

export interface BuildServerOpts {
  /** Disable the global rate limiter (tests drive many requests). */
  disableRateLimit?: boolean;
  /** Override env (test only). */
  env?: Env;
  /**
   * Logger sink (test only). Exists so the privacy promise can be ASSERTED on
   * the bytes actually written, not on the config object — same rationale as
   * stats-backend: a promise you cannot read back is not verified.
   */
  logStream?: NodeJS.WritableStream;
}

export async function buildServer(opts: BuildServerOpts = {}): Promise<FastifyInstance> {
  const env = opts.env ?? loadEnv();

  const app = Fastify({
    ...(opts.logStream
      ? { loggerInstance: pino(loggerOptions, opts.logStream) as FastifyBaseLogger }
      : { logger: loggerOptions }),
    disableRequestLogging: false,
    // NOTE: no `trustProxy` here, on purpose. inbox-backend sets it to `true`,
    // which trusts the whole X-Forwarded-For chain and lets a caller forge the
    // client IP — evading any per-IP bucket. During the unauthenticated beta the
    // limiter therefore keys on the real socket address; when API keys land, the
    // quota keys on the key and the question disappears entirely.
    bodyLimit: env.MAX_PDF_BYTES,
  });

  registerErrorHandler(app);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map((o) => o.trim()),
    // No cookies, no sessions: authentication will be a bearer API key.
    credentials: false,
  });

  if (opts.disableRateLimit !== true) {
    await app.register(rateLimit, {
      max: env.RATE_LIMIT_PER_MINUTE,
      timeWindow: '1 minute',
    });
  }

  // Fastify has no built-in parser for application/pdf; take the raw bytes.
  app.addContentTypeParser(
    'application/pdf',
    { parseAs: 'buffer', bodyLimit: env.MAX_PDF_BYTES },
    (_req, body, done) => {
      done(null, body);
    },
  );

  await app.register(healthRoutes);
  await app.register(verifyRoutes, { env });

  return app;
}
