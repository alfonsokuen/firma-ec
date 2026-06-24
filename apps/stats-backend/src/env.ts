/**
 * Environment configuration loader (zod-validated).
 *
 * Secrets are injected via Docker secrets / orchestration. In dev, set envs
 * explicitly. In test, `NODE_ENV=test` produces synthetic placeholders so the
 * loader never throws.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const isTest = (): boolean => process.env['NODE_ENV'] === 'test';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

// Docker-secret support: a `<VAR>_FILE` env points at a file whose (trimmed)
// contents become `<VAR>`. Applied before validation so the secret never has to
// live in the process environment as a literal. If `_FILE` is set but the file
// cannot be read, that is a genuine misconfiguration of the secret mount, so we
// FAIL CLOSED immediately with the real cause — never degrade into an opaque
// downstream zod "min(1)" error that hides which secret failed and why.
const FILE_BACKED_VARS = ['DATABASE_URL', 'REDIS_URL'] as const;

function applyFileSecrets(raw: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...raw };
  for (const name of FILE_BACKED_VARS) {
    const filePath = out[`${name}_FILE`];
    if (filePath === undefined || filePath === '') continue;
    try {
      out[name] = readFileSync(filePath, 'utf8').trim();
    } catch (err) {
      throw new Error(
        `stats-backend: cannot read ${name}_FILE (${filePath}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return out;
}

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
  };
}

let _cached: Env | undefined;

export function loadEnv(): Env {
  if (_cached !== undefined && !isTest()) return _cached;
  const parsed = envSchema.safeParse(withTestDefaults(applyFileSecrets(process.env)));
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
