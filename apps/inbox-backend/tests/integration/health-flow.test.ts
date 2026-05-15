import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import RedisMock from 'ioredis-mock';
/**
 * Integration: /healthz composite probe with all four checks (db/redis/r2/evolution).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/env.js';
import { buildServer } from '../../src/server.js';
import { buildMemoryEvolution } from '../helpers/mockEvolution.js';
import { buildMemoryPrisma } from '../helpers/mockPrisma.js';
import { buildMemoryS3 } from '../helpers/mockS3.js';

describe('integration: health flow', () => {
  let app: FastifyInstance | undefined;
  const env = loadEnv();

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('all four checks ok → /healthz 200 + ok=true', async () => {
    const prisma = buildMemoryPrisma();
    const s3 = buildMemoryS3();
    const evo = buildMemoryEvolution({ connectionState: 'open' });
    app = await buildServer({
      env,
      disableRateLimit: true,
      overrides: {
        prisma: prisma.prisma,
        redis: new RedisMock() as unknown as Redis,
        r2Client: s3.client,
        evolution: evo,
        audit: { log: async () => {} },
      },
    });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      ok: boolean;
      checks: {
        db: { ok: boolean };
        redis: { ok: boolean };
        r2: { ok: boolean };
        evolution: { ok: boolean };
      };
    };
    expect(body.ok).toBe(true);
    expect(body.checks.db.ok).toBe(true);
    expect(body.checks.redis.ok).toBe(true);
    expect(body.checks.r2.ok).toBe(true);
    expect(body.checks.evolution.ok).toBe(true);
    expect(prisma.queryRawCalls).toBeGreaterThan(0);
  });

  it('R2 head failure → /healthz 503 with r2.ok=false', async () => {
    const prisma = buildMemoryPrisma();
    const s3 = buildMemoryS3();
    s3.headOk = false;
    const evo = buildMemoryEvolution({ connectionState: 'open' });
    app = await buildServer({
      env,
      disableRateLimit: true,
      overrides: {
        prisma: prisma.prisma,
        redis: new RedisMock() as unknown as Redis,
        r2Client: s3.client,
        evolution: evo,
        audit: { log: async () => {} },
      },
    });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { ok: boolean; checks: { r2: { ok: boolean } } };
    expect(body.ok).toBe(false);
    expect(body.checks.r2.ok).toBe(false);
  });

  it('Evolution state != open → /healthz 503 with evolution.error mention', async () => {
    const prisma = buildMemoryPrisma();
    const s3 = buildMemoryS3();
    const evo = buildMemoryEvolution({ connectionState: 'connecting' });
    app = await buildServer({
      env,
      disableRateLimit: true,
      overrides: {
        prisma: prisma.prisma,
        redis: new RedisMock() as unknown as Redis,
        r2Client: s3.client,
        evolution: evo,
        audit: { log: async () => {} },
      },
    });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { checks: { evolution: { ok: boolean; error?: string } } };
    expect(body.checks.evolution.ok).toBe(false);
    expect(body.checks.evolution.error).toMatch(/connecting/);
  });
});
