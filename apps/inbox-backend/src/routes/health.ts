/**
 * GET /healthz — composite readiness probe over DB + Redis + R2 + Evolution.
 * GET /livez   — simple liveness (process up).
 */
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';

interface CheckResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

async function timed(
  fn: () => Promise<unknown>,
  timeoutMs: number,
  label: string,
): Promise<CheckResult> {
  const started = Date.now();
  try {
    await withTimeout(fn(), timeoutMs, label);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    const e = err as { message?: string };
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: e.message ?? 'error',
    };
  }
}

export default async function healthRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/livez', async (_req, reply) => {
    return reply.code(200).send({ status: 'alive' });
  });

  app.get('/healthz', async (_req, reply) => {
    const [db, redis, r2, evolution] = await Promise.all([
      timed(
        () => app.prisma.$queryRaw`SELECT 1`,
        2_000,
        'db',
      ),
      timed(
        () =>
          app.redis.client.ping().then(() => undefined),
        1_000,
        'redis',
      ),
      timed(
        () =>
          app.r2.client.send(
            new HeadBucketCommand({ Bucket: app.r2.bucket }),
          ),
        3_000,
        'r2',
      ),
      timed(async () => {
        const { state } = await app.evolution.getConnectionState();
        if (state !== 'open') {
          throw new Error(`state=${state}`);
        }
      }, 3_000, 'evolution'),
    ]);

    const ok = db.ok && redis.ok && r2.ok && evolution.ok;
    reply.header('cache-control', 'no-store');
    return reply.code(ok ? 200 : 503).send({
      ok,
      service: 'inbox-backend',
      timestamp: new Date().toISOString(),
      checks: { db, redis, r2, evolution },
    });
  });
}
