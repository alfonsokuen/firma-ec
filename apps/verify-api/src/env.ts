/**
 * Environment configuration loader (zod-validated).
 *
 * This service holds NO secrets by design: it never touches a private key and
 * has no database. Everything here is operational tuning, so there is no
 * `_FILE` secret indirection like stats-backend needs.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * Docker-secret support: `<VAR>_FILE` points at a file whose trimmed contents
 * become `<VAR>`, so the secret never has to exist as a literal in the process
 * environment. Fails CLOSED if the file is unreadable: a mount that silently
 * degrades into "no keys configured" would look identical to a healthy boot.
 */
const FILE_BACKED_VARS = ['API_KEY_PEPPER', 'API_KEYS'] as const;

function applyFileSecrets(raw: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...raw };
  for (const name of FILE_BACKED_VARS) {
    const filePath = out[`${name}_FILE`];
    if (filePath === undefined || filePath === '') continue;
    if (out[name] !== undefined && out[name] !== '') continue;
    try {
      out[name] = readFileSync(filePath, 'utf8').trim();
    } catch (err) {
      throw new Error(
        `verify-api: cannot read ${name}_FILE (${filePath}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return out;
}

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

  /**
   * HMAC pepper for API key secrets. MUST come from the secret manager and MUST
   * NOT live beside the key records: its purpose is to be in a different blast
   * radius, so that a stolen database alone is worthless. Minimum length is
   * enforced where it is used, not here, so the error names the real problem.
   */
  API_KEY_PEPPER: z.string().default(''),

  /**
   * Seeded API keys as a JSON array (see keyStore.ts). Only public halves and
   * HMACs — never a secret. Intended to arrive via API_KEYS_FILE (Docker
   * secret) in production.
   */
  API_KEYS: z.string().default('[]'),

  /** Comma-separated allowed origins; `*` allows any (no cookies are used). */
  CORS_ORIGINS: z.string().default('*'),

  /**
   * Requests per minute per client during the unauthenticated beta.
   *
   * Measured capacity of a single process is well under one heavy verification
   * per minute, so admitting 30 was an 88x over-admission: one IP could saturate
   * the service indefinitely. Kept deliberately low until per-key quotas land.
   */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(6),

  /**
   * Hard cap on signatures accepted in one document (admission gate).
   *
   * Verification is O(signatures x document size): every signature re-scans the
   * whole PDF (covered-bytes digest, DSS extraction, LTV scan). A 19MB PDF with
   * 700 signature dictionaries measured 13GB of scanning and blocked the event
   * loop for 176s on a single anonymous request. Real documents have a handful
   * of signatures; anything past this is an attack, not a use case.
   */
  MAX_SIGNATURES: z.coerce.number().int().positive().default(10),

  /**
   * Budget for `signatures x documentBytes`. Bounds the two dimensions
   * TOGETHER, since either alone can be innocuous while the product is not.
   */
  MAX_VERIFY_WORK_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 1024 * 1024),

  /**
   * How Fastify derives the client IP. `false` (default) trusts only the socket.
   * NEVER set this to `true` behind a proxy: that trusts the whole
   * X-Forwarded-For chain and lets a caller forge its own IP, evading the
   * limiter (the bug live in inbox-backend today). Behind a known edge, set the
   * NUMBER OF HOPS (e.g. `1`) or a CIDR list — both are unforgeable. Leaving it
   * `false` behind a proxy is also wrong: every user then shares ONE bucket.
   */
  TRUST_PROXY: z.string().default('false'),

  /** Ceiling for receiving a full request. Bounds slowloris sockets. */
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  /** Ceiling for an idle connection. */
  CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
});

export type Env = z.infer<typeof envSchema>;

let _cached: Env | undefined;

export function loadEnv(): Env {
  if (_cached !== undefined && process.env['NODE_ENV'] !== 'test') return _cached;
  const parsed = envSchema.safeParse(applyFileSecrets(process.env));
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
