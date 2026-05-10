/**
 * Environment configuration loader.
 *
 * IMPORTANT: This file does NOT use dotenv at runtime — secrets are injected
 * via Docker secrets / orchestration. In dev, set envs explicitly.
 */

interface Env {
  readonly NODE_ENV: 'development' | 'production' | 'test';
  readonly PORT: number;
  readonly HOST: string;
  readonly DATABASE_URL: string;
  readonly REDIS_URL: string;
  readonly R2_ACCOUNT_ID: string;
  readonly R2_ACCESS_KEY_ID: string;
  readonly R2_SECRET_ACCESS_KEY: string;
  readonly R2_BUCKET: string;
  readonly R2_ENDPOINT: string;
  readonly JWT_SECRET: string;
  readonly EVOLUTION_API_URL: string;
  readonly EVOLUTION_API_KEY: string;
  readonly EVOLUTION_INSTANCE: string;
  readonly LOG_LEVEL: string;
}

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    if (process.env['NODE_ENV'] === 'test') return `test-${name}`;
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

export function loadEnv(): Env {
  return {
    NODE_ENV: (process.env['NODE_ENV'] as Env['NODE_ENV']) ?? 'development',
    PORT: Number(process.env['PORT'] ?? 3000),
    HOST: process.env['HOST'] ?? '0.0.0.0',
    DATABASE_URL: required('DATABASE_URL', 'postgresql://localhost:5432/firmar_ec_inbox'),
    REDIS_URL: required('REDIS_URL', 'redis://localhost:6379/10'),
    R2_ACCOUNT_ID: required('R2_ACCOUNT_ID', 'test'),
    R2_ACCESS_KEY_ID: required('R2_ACCESS_KEY_ID', 'test'),
    R2_SECRET_ACCESS_KEY: required('R2_SECRET_ACCESS_KEY', 'test'),
    R2_BUCKET: process.env['R2_BUCKET'] ?? 'firmar-ec-inbox',
    R2_ENDPOINT: required('R2_ENDPOINT', 'https://test.r2.cloudflarestorage.com'),
    JWT_SECRET: required('JWT_SECRET', 'dev-only-change-me-32-chars-long-x'),
    EVOLUTION_API_URL: required('EVOLUTION_API_URL', 'http://localhost:8080'),
    EVOLUTION_API_KEY: required('EVOLUTION_API_KEY', 'test'),
    EVOLUTION_INSTANCE: process.env['EVOLUTION_INSTANCE'] ?? 'firmar-ec-inbox',
    LOG_LEVEL: process.env['LOG_LEVEL'] ?? 'info',
  };
}
