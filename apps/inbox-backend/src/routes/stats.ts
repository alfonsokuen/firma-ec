/**
 * Public usage stats for the firmar.ec landing.
 *
 * GET  /api/stats        → { pdfsSigned, signaturesVerified, certificatesIssued }
 * POST /api/stats/event  → { type: 'sign' | 'verify' }  (anonymous beacon)
 *
 * The beacon is anonymous and best-effort: signing/verification are client-side
 * by design, so the server cannot attest them. We rate-limit per IP to resist
 * trivial inflation and silently drop (204) over-limit hits rather than count
 * them. GET is cached briefly to shield the DB from landing traffic spikes.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../env.js';
import { InboxError } from '../lib/errors.js';
import { checkAndConsume } from '../services/rate-limit.js';
import { type UsageStats, incrementUsage, readUsageStats } from '../services/usage-stats.js';

const EventBody = z.object({ type: z.enum(['sign', 'verify']) });

const CACHE_TTL_MS = 60_000;

export interface StatsRoutesOpts {
  env: Env;
}

export default async function statsRoutes(
  app: FastifyInstance,
  opts: StatsRoutesOpts,
): Promise<void> {
  const { env } = opts;
  // Disable caching under test so increment→read is deterministic.
  const useCache = env.NODE_ENV !== 'test';
  let cache: { at: number; data: UsageStats } | null = null;

  app.post('/api/stats/event', async (req, reply) => {
    const ip = req.ip || 'unknown';
    // 20 events/hour/IP — generous for a real user, hostile to scripted spam.
    const rl = await checkAndConsume(app.redis.client, {
      key: `rl:stats:${ip}`,
      capacity: 20,
      refillPerSec: 20 / 3_600,
    });
    if (!rl.ok) {
      // Accept-and-ignore: don't count it, don't leak limiter state.
      return reply.code(204).send();
    }

    // Accept the type from a query param (so navigator.sendBeacon can fire a
    // body-less, CORS-preflight-free POST) or a JSON body.
    const fromQuery = (req.query as { type?: unknown } | undefined)?.type;
    const fromBody = (req.body as { type?: unknown } | null)?.type;
    const parsed = EventBody.safeParse({ type: fromQuery ?? fromBody });
    if (!parsed.success) {
      throw new InboxError('invalid_input', "type must be 'sign' or 'verify'");
    }

    await incrementUsage(app.prisma, parsed.data.type);
    cache = null; // next GET recomputes
    return reply.code(204).send();
  });

  app.get('/api/stats', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=60');
    if (useCache && cache && Date.now() - cache.at < CACHE_TTL_MS) {
      return reply.code(200).send(cache.data);
    }
    const data = await readUsageStats(app.prisma, { includeCerts: env.FEATURE_CERT_STATS });
    if (useCache) cache = { at: Date.now(), data };
    return reply.code(200).send(data);
  });
}
