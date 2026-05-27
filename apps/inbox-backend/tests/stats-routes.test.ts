import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import RedisMock from 'ioredis-mock';
import { afterEach, describe, expect, it } from 'vitest';
import { type Env, loadEnv } from '../src/env.js';
import type { EvolutionClient } from '../src/plugins/evolution.js';
import { buildServer } from '../src/server.js';

/**
 * Fake Prisma that models exactly the two raw queries the stats service issues:
 * an upsert-increment into usage_counters and reads of usage_counters /
 * cert_orders. `certTable: false` simulates a deploy without the certificate
 * subsystem (the raw query throws → certificatesIssued must be null).
 */
function fakeStatsPrisma(opts: { certTable?: boolean; certCount?: number } = {}): {
  prisma: PrismaClient;
  counts: Map<string, number>;
} {
  const counts = new Map<string, number>();
  const certTable = opts.certTable ?? false;
  const certCount = opts.certCount ?? 0;
  const prisma = {
    $executeRaw: async (_s: TemplateStringsArray, ...values: unknown[]) => {
      const key = String(values[0]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return 1;
    },
    $queryRaw: async (s: TemplateStringsArray, ..._v: unknown[]) => {
      const sql = s.join(' ? ');
      if (sql.includes('usage_counters')) {
        const out: Array<{ key: string; count: bigint }> = [];
        for (const k of ['sign', 'verify']) {
          const c = counts.get(k);
          if (c !== undefined) out.push({ key: k, count: BigInt(c) });
        }
        return out;
      }
      if (sql.includes('cert_orders')) {
        if (!certTable) throw new Error('relation "cert_orders" does not exist');
        return [{ n: BigInt(certCount) }];
      }
      return [];
    },
    $disconnect: async () => {},
  } as unknown as PrismaClient;
  return { prisma, counts };
}

function fakeS3(): S3Client {
  return {
    send: async () => ({}),
    destroy: () => {},
  } as unknown as S3Client;
}

function fakeEvo(): EvolutionClient {
  return {
    axios: {} as never,
    sendText: async () => {},
    getBase64FromMediaMessage: async () => '',
    sendDocument: async () => ({ messageId: 'x' }),
    findMessageJid: async () => null,
    getConnectionState: async () => ({ state: 'open' }),
  };
}

async function build(env: Env, prisma: PrismaClient): Promise<FastifyInstance> {
  // ioredis-mock shares one in-memory store across instances; flush so a prior
  // test's beacons don't pre-drain this test's per-IP rate-limit bucket.
  const redis = new RedisMock() as unknown as Redis;
  await redis.flushall();
  return buildServer({
    env,
    disableRateLimit: true,
    overrides: {
      prisma,
      redis,
      r2Client: fakeS3(),
      evolution: fakeEvo(),
      audit: { log: async () => {} },
    },
  });
}

describe('stats routes', () => {
  let app: FastifyInstance | undefined;
  const baseEnv = loadEnv();

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('GET /api/stats starts at zero', async () => {
    const { prisma } = fakeStatsPrisma();
    app = await build(baseEnv, prisma);
    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      pdfsSigned: 0,
      signaturesVerified: 0,
      certificatesIssued: null,
    });
  });

  it('counts sign and verify beacons', async () => {
    const { prisma } = fakeStatsPrisma();
    app = await build(baseEnv, prisma);
    await app.inject({ method: 'POST', url: '/api/stats/event', payload: { type: 'sign' } });
    await app.inject({ method: 'POST', url: '/api/stats/event', payload: { type: 'verify' } });
    await app.inject({ method: 'POST', url: '/api/stats/event', payload: { type: 'verify' } });
    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    const body = res.json() as { pdfsSigned: number; signaturesVerified: number };
    expect(body.pdfsSigned).toBe(1);
    expect(body.signaturesVerified).toBe(2);
  });

  it('accepts the type from a query param (sendBeacon path, no body)', async () => {
    const { prisma, counts } = fakeStatsPrisma();
    app = await build(baseEnv, prisma);
    const res = await app.inject({ method: 'POST', url: '/api/stats/event?type=verify' });
    expect(res.statusCode).toBe(204);
    expect(counts.get('verify')).toBe(1);
  });

  it('POST event returns 204 and sets no body', async () => {
    const { prisma } = fakeStatsPrisma();
    app = await build(baseEnv, prisma);
    const res = await app.inject({
      method: 'POST',
      url: '/api/stats/event',
      payload: { type: 'sign' },
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  it('rejects an invalid event type with 422', async () => {
    const { prisma } = fakeStatsPrisma();
    app = await build(baseEnv, prisma);
    const res = await app.inject({
      method: 'POST',
      url: '/api/stats/event',
      payload: { type: 'hack' },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: string }).error).toBe('invalid_input');
  });

  it('rate-limits the beacon: counts at most the bucket capacity (20)', async () => {
    const { prisma, counts } = fakeStatsPrisma();
    app = await build(baseEnv, prisma);
    for (let i = 0; i < 25; i++) {
      await app.inject({ method: 'POST', url: '/api/stats/event', payload: { type: 'sign' } });
    }
    // 20 allowed within the hour window; the rest are accepted-and-ignored.
    expect(counts.get('sign')).toBe(20);
  });

  it('omits certificatesIssued (null) when the flag is off', async () => {
    const { prisma } = fakeStatsPrisma({ certTable: true, certCount: 7 });
    app = await build(baseEnv, prisma); // FEATURE_CERT_STATS defaults false
    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    expect((res.json() as { certificatesIssued: number | null }).certificatesIssued).toBeNull();
  });

  it('reports certificatesIssued when the flag is on and the table exists', async () => {
    const { prisma } = fakeStatsPrisma({ certTable: true, certCount: 7 });
    app = await build({ ...baseEnv, FEATURE_CERT_STATS: true }, prisma);
    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    expect((res.json() as { certificatesIssued: number }).certificatesIssued).toBe(7);
  });

  it('falls back to null when the flag is on but cert_orders is absent', async () => {
    const { prisma } = fakeStatsPrisma({ certTable: false });
    app = await build({ ...baseEnv, FEATURE_CERT_STATS: true }, prisma);
    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    expect((res.json() as { certificatesIssued: number | null }).certificatesIssued).toBeNull();
  });
});
