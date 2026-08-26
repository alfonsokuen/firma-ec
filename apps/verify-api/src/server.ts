import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import pino from 'pino';
import { type Env, loadEnv } from './env.js';
import { registerErrorHandler } from './lib/errors.js';
import { InMemoryKeyStore, type KeyStore, parseKeySeed } from './lib/keyStore.js';
import { loggerOptions } from './logger.js';
import authPlugin from './plugins/auth.js';
import healthRoutes from './routes/health.js';
import verifyRoutes from './routes/verify.js';
import { InMemoryIdempotencyStore } from './services/idempotency.js';
import { InMemoryQuotaStore, type QuotaStore } from './services/quota.js';
import { InProcessRunner, type VerifyRunner, WorkerRunner } from './services/verifyRunner.js';

/**
 * Parse the TRUST_PROXY setting into what Fastify expects.
 *
 * Accepts `false`, `true` (discouraged — see the call site), a hop COUNT, or a
 * comma-separated CIDR/IP list.
 */
function parseTrustProxy(raw: string): boolean | number | string[] {
  const value = raw.trim();
  if (value === '' || value === 'false') return false;
  if (value === 'true') return true;
  const hops = Number(value);
  if (Number.isInteger(hops) && hops >= 0) return hops;
  return value.split(',').map((entry) => entry.trim());
}

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
  /** Test seam: swap the key/quota backends without standing up infrastructure. */
  overrides?: {
    keyStore?: KeyStore;
    quotaStore?: QuotaStore;
    runner?: VerifyRunner;
  };
}

export async function buildServer(opts: BuildServerOpts = {}): Promise<FastifyInstance> {
  const env = opts.env ?? loadEnv();

  const app = Fastify({
    ...(opts.logStream
      ? { loggerInstance: pino(loggerOptions, opts.logStream) as FastifyBaseLogger }
      : { logger: loggerOptions }),
    disableRequestLogging: false,
    // `true` would trust the whole X-Forwarded-For chain and let a caller forge
    // its own IP (the bug live in inbox-backend). But plain `false` behind an
    // edge is the opposite failure: every client collapses into ONE bucket and
    // a single abuser locks out everyone. So it is a deployment decision, made
    // explicit here: hop count or CIDR list — both unforgeable.
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    bodyLimit: env.MAX_PDF_BYTES,
    // Bound half-open and trickled requests: without these a slowloris client
    // holds sockets (and their buffers) open indefinitely. Measured: 20 sockets
    // still alive at 45s sending one byte every 5s.
    requestTimeout: env.REQUEST_TIMEOUT_MS,
    connectionTimeout: env.CONNECTION_TIMEOUT_MS,
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
      // Announce nothing: this limiter is a pre-auth backstop keyed on the
      // socket, while the allowance a CLIENT must obey is the per-key quota set
      // in the route. Emitting both left two different `*RateLimit-*` families
      // on the same response, and an integrator could not tell which one bound
      // them.
      // NOTE: the two options cover DIFFERENT cases — `addHeadersOnExceeding`
      // is the normal path, `addHeaders` only the 429. Setting just one leaves
      // the other family still on the wire.
      addHeadersOnExceeding: {
        'x-ratelimit-limit': false,
        'x-ratelimit-remaining': false,
        'x-ratelimit-reset': false,
      },
      addHeaders: {
        'x-ratelimit-limit': false,
        'x-ratelimit-remaining': false,
        'x-ratelimit-reset': false,
        'retry-after': false,
      },
      // The liveness/readiness probes must NEVER be rate limited. Under attack
      // the limiter would answer the orchestrator's probe with 429, the
      // container would be marked unhealthy, and the restart loop would finish
      // the job the attacker started.
      allowList: (req) => req.url === '/livez' || req.url === '/healthz',
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

  // ---- Authentication, registered BEFORE the routes so its onRequest hook
  // runs ahead of body parsing. Boot fails closed: a service that is supposed
  // to require keys but silently accepts everyone is the worst outcome here.
  const keyStore = opts.overrides?.keyStore ?? new InMemoryKeyStore(parseKeySeed(env.API_KEYS));
  if (env.API_KEY_PEPPER === '') {
    throw new Error('API_KEY_PEPPER is required: refusing to start without key verification');
  }
  await app.register(authPlugin, { store: keyStore, pepper: env.API_KEY_PEPPER });

  const quotaStore = opts.overrides?.quotaStore ?? new InMemoryQuotaStore();
  const idempotency = new InMemoryIdempotencyStore<unknown>();
  const runner =
    opts.overrides?.runner ??
    (env.VERIFY_IN_WORKER
      ? new WorkerRunner(new URL('./verify-worker.js', import.meta.url), env.VERIFY_WORKERS)
      : new InProcessRunner());
  // Releasing the pool on close keeps the process from hanging on shutdown and
  // keeps tests from leaking threads between files.
  app.addHook('onClose', async () => {
    await runner.close();
  });

  await app.register(healthRoutes, { runner });
  await app.register(verifyRoutes, { env, quotaStore, idempotency, runner });

  return app;
}
