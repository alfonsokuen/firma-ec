/**
 * Environment configuration loader (zod-validated).
 *
 * Secrets are injected via Docker secrets / orchestration. In dev, set envs
 * explicitly. In test, `NODE_ENV=test` produces synthetic placeholders so the
 * loader never throws.
 */
import { z } from 'zod';

const isTest = (): boolean => process.env['NODE_ENV'] === 'test';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().default('firmar-ec-inbox'),
  R2_ENDPOINT: z.string().url(),

  EVOLUTION_API_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(1),
  EVOLUTION_INSTANCE: z.string().default('firmar-ec-inbox'),

  INBOX_DEPLOY_SECRET: z.string().min(16),
  // 32-byte AES key, hex-encoded → 64 hex chars.
  INBOX_AUDIT_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'INBOX_AUDIT_KEY must be 64 hex chars (32 bytes)'),
  INBOX_AUDIT_KEY_VERSION: z.coerce.number().int().positive().default(1),
  INBOX_JWT_SECRET: z.string().min(32),
  WEBHOOK_HMAC_SECRET: z.string().min(16),

  BASE_URL: z.preprocess(
    (v) => (typeof v === 'string' && v !== '' ? v : 'https://app.firmar.ec'),
    z.string().url(),
  ),
});

export type Env = z.infer<typeof envSchema>;

function withTestDefaults(raw: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!isTest()) return raw;
  const orEmpty = (k: string, dflt: string) => {
    const v = raw[k];
    return v === undefined || v === '' ? dflt : v;
  };
  return {
    ...raw,
    DATABASE_URL: orEmpty('DATABASE_URL', 'postgresql://localhost:5432/test'),
    REDIS_URL: orEmpty('REDIS_URL', 'redis://localhost:6379/15'),
    R2_ACCOUNT_ID: orEmpty('R2_ACCOUNT_ID', 'test-account'),
    R2_ACCESS_KEY_ID: orEmpty('R2_ACCESS_KEY_ID', 'test-key'),
    R2_SECRET_ACCESS_KEY: orEmpty('R2_SECRET_ACCESS_KEY', 'test-secret'),
    R2_ENDPOINT: orEmpty('R2_ENDPOINT', 'https://test.r2.cloudflarestorage.com'),
    EVOLUTION_API_URL: orEmpty('EVOLUTION_API_URL', 'http://localhost:8080'),
    EVOLUTION_API_KEY: orEmpty('EVOLUTION_API_KEY', 'test-evo'),
    INBOX_DEPLOY_SECRET: orEmpty('INBOX_DEPLOY_SECRET', 'test-deploy-secret-1234567890'),
    INBOX_AUDIT_KEY: orEmpty(
      'INBOX_AUDIT_KEY',
      // 32 bytes hex (64 chars), deterministic for tests.
      'a'.repeat(64),
    ),
    INBOX_AUDIT_KEY_VERSION: orEmpty('INBOX_AUDIT_KEY_VERSION', '1'),
    INBOX_JWT_SECRET: orEmpty(
      'INBOX_JWT_SECRET',
      'test-jwt-secret-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ),
    WEBHOOK_HMAC_SECRET: orEmpty('WEBHOOK_HMAC_SECRET', 'test-webhook-hmac-secret'),
    BASE_URL: (() => {
      const v = raw['BASE_URL'];
      if (v === undefined || v === '' || !/^https?:\/\//.test(v)) {
        return 'https://app.firmar.ec';
      }
      return v;
    })(),
  };
}

let _cached: Env | undefined;

export function loadEnv(): Env {
  if (_cached !== undefined && !isTest()) return _cached;
  const parsed = envSchema.safeParse(withTestDefaults(process.env));
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
