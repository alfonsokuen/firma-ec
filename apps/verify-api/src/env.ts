/**
 * Environment configuration loader (zod-validated).
 *
 * This service holds NO secrets by design: it never touches a private key and
 * has no database. Everything here is operational tuning, so there is no
 * `_FILE` secret indirection like stats-backend needs.
 */
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3010),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),

  /** Hard ceiling for an uploaded PDF. Mirrors inbox-backend's MAX_PDF_BYTES. */
  MAX_PDF_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(20 * 1024 * 1024),

  /**
   * Wall-clock ceiling for one verification. The PWA budgets 15s + 1ms/KB with
   * a 60s hard stop (apps/pwa/src/lib/workers/sign-bus.ts); a B-LTA parsing the
   * large ARCOTEL CRLs is the slow case. We fail with 504 rather than hang: a
   * verification that did not finish must NEVER be reported as a verdict.
   */
  VERIFY_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  /**
   * Whether to consult OCSP responders. Default OFF: `ocsp.firmar.ec` has no
   * DNS record today, and the verifier degrades to `not_checked` only after
   * burning up to 6s per call — unacceptable latency for an API. Turn on once
   * the responder resolves.
   */
  FETCH_OCSP: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /** Comma-separated allowed origins; `*` allows any (no cookies are used). */
  CORS_ORIGINS: z.string().default('*'),

  /** Requests per minute per client during the unauthenticated beta. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof envSchema>;

let _cached: Env | undefined;

export function loadEnv(): Env {
  if (_cached !== undefined && process.env['NODE_ENV'] !== 'test') return _cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  _cached = parsed.data;
  return _cached;
}

/** For tests: forget the cached env (after mutating process.env). */
export function _resetEnvCache(): void {
  _cached = undefined;
}
