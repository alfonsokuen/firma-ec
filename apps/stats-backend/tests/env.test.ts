import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetEnvCache, loadEnv } from '../src/env.js';

// Regression for the prod incident: the service booted but every DB query failed
// with "Environment variable not found: DATABASE_URL" because the *_FILE secret
// was only injected into the validated Env object, never into process.env — and
// Prisma reads env("DATABASE_URL") straight from process.env.
describe('env *_FILE secrets', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    _resetEnvCache();
  });

  it('DATABASE_URL_FILE also populates process.env.DATABASE_URL (Prisma reads it directly)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stats-env-'));
    const file = join(dir, 'db');
    const dsn = 'postgresql://u:p@h:5432/d?schema=public';
    writeFileSync(file, `${dsn}\n`);
    vi.stubEnv('DATABASE_URL', undefined);
    vi.stubEnv('DATABASE_URL_FILE', file);
    _resetEnvCache();

    const env = loadEnv();
    expect(env.DATABASE_URL).toBe(dsn);
    // The part that actually broke prod: Prisma / the CLI read process.env.
    expect(process.env['DATABASE_URL']).toBe(dsn);

    rmSync(dir, { recursive: true, force: true });
  });

  it('throws a clear error (fail-closed) when _FILE points at an unreadable path', () => {
    vi.stubEnv('DATABASE_URL', undefined);
    vi.stubEnv('DATABASE_URL_FILE', '/no/such/secret/file');
    _resetEnvCache();
    expect(() => loadEnv()).toThrow(/cannot read DATABASE_URL_FILE/);
  });
});
