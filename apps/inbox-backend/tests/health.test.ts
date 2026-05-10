import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { S3Client } from '@aws-sdk/client-s3';
import type { EvolutionClient } from '../src/plugins/evolution.js';
import { buildServer } from '../src/server.js';
import { loadEnv } from '../src/env.js';

function fakePrisma(opts: { ok: boolean } = { ok: true }): PrismaClient {
  return {
    $queryRaw: async () => {
      if (!opts.ok) throw new Error('db down');
      return [{ '?column?': 1 }];
    },
    $disconnect: async () => {},
  } as unknown as PrismaClient;
}

function fakeS3(opts: { ok: boolean } = { ok: true }): S3Client {
  return {
    send: async (cmd: { constructor: { name: string } }) => {
      if (cmd.constructor.name === 'HeadBucketCommand') {
        if (!opts.ok) throw new Error('r2 down');
        return {};
      }
      throw new Error('unsupported');
    },
    destroy: () => {},
  } as unknown as S3Client;
}

function fakeEvo(state: string): EvolutionClient {
  return {
    axios: {} as never,
    sendText: async () => {},
    getBase64FromMediaMessage: async () => '',
    sendDocument: async () => ({ messageId: 'x' }),
    findMessageJid: async () => null,
    getConnectionState: async () => ({ state }),
  };
}

describe('health routes', () => {
  let app: FastifyInstance | undefined;
  const env = loadEnv();

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('GET /livez always returns 200', async () => {
    app = await buildServer({
      env,
      disableRateLimit: true,
      overrides: {
        prisma: fakePrisma(),
        redis: new RedisMock() as unknown as Redis,
        r2Client: fakeS3(),
        evolution: fakeEvo('open'),
        audit: { log: async () => {} },
      },
    });
    const res = await app.inject({ method: 'GET', url: '/livez' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe('alive');
  });

  it('GET /healthz returns 200 + ok=true when all checks pass', async () => {
    app = await buildServer({
      env,
      disableRateLimit: true,
      overrides: {
        prisma: fakePrisma(),
        redis: new RedisMock() as unknown as Redis,
        r2Client: fakeS3(),
        evolution: fakeEvo('open'),
        audit: { log: async () => {} },
      },
    });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json() as {
      ok: boolean;
      checks: { db: { ok: boolean }; redis: { ok: boolean }; r2: { ok: boolean }; evolution: { ok: boolean } };
    };
    expect(body.ok).toBe(true);
    expect(body.checks.db.ok).toBe(true);
    expect(body.checks.redis.ok).toBe(true);
    expect(body.checks.r2.ok).toBe(true);
    expect(body.checks.evolution.ok).toBe(true);
  });

  it('GET /healthz returns 503 when DB fails', async () => {
    app = await buildServer({
      env,
      disableRateLimit: true,
      overrides: {
        prisma: fakePrisma({ ok: false }),
        redis: new RedisMock() as unknown as Redis,
        r2Client: fakeS3(),
        evolution: fakeEvo('open'),
        audit: { log: async () => {} },
      },
    });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { ok: boolean; checks: { db: { ok: boolean; error?: string } } };
    expect(body.ok).toBe(false);
    expect(body.checks.db.ok).toBe(false);
    expect(body.checks.db.error).toMatch(/db down/);
  });

  it('GET /healthz returns 503 when Evolution state != open', async () => {
    app = await buildServer({
      env,
      disableRateLimit: true,
      overrides: {
        prisma: fakePrisma(),
        redis: new RedisMock() as unknown as Redis,
        r2Client: fakeS3(),
        evolution: fakeEvo('connecting'),
        audit: { log: async () => {} },
      },
    });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { checks: { evolution: { ok: boolean; error?: string } } };
    expect(body.checks.evolution.ok).toBe(false);
    expect(body.checks.evolution.error).toMatch(/connecting/);
  });

  it('GET /healthz returns 503 when R2 fails', async () => {
    app = await buildServer({
      env,
      disableRateLimit: true,
      overrides: {
        prisma: fakePrisma(),
        redis: new RedisMock() as unknown as Redis,
        r2Client: fakeS3({ ok: false }),
        evolution: fakeEvo('open'),
        audit: { log: async () => {} },
      },
    });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { checks: { r2: { ok: boolean; error?: string } } };
    expect(body.checks.r2.ok).toBe(false);
  });
});
