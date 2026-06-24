/**
 * GET /healthz — composite readiness probe over DB + Redis.
 * GET /livez   — simple liveness (process up).
 */
import type { FastifyInstance } from 'fastify';

interface CheckResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
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

export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/livez', async (_req, reply) => {
    return reply.code(200).send({ status: 'alive' });
  });

  app.get('/healthz', async (_req, reply) => {
    const [db, redis] = await Promise.all([
      timed(() => app.prisma.$queryRaw`SELECT 1`, 2_000, 'db'),
      timed(() => app.redis.client.ping().then(() => undefined), 1_000, 'redis'),
    ]);

    const ok = db.ok && redis.ok;
    reply.header('cache-control', 'no-store');
    return reply.code(ok ? 200 : 503).send({
      ok,
      service: 'stats-backend',
      timestamp: new Date().toISOString(),
      checks: { db, redis },
    });
  });
}
