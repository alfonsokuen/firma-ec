/**
 * Brute-force backstop, running ahead of everything else.
 *
 * Why this is hand-rolled instead of `@fastify/rate-limit`: that plugin, even
 * in "global" mode, attaches its hook through `onRoute`, and route-level hooks
 * run AFTER instance-level ones. Our authentication is an instance-level
 * `onRequest` hook, so the limiter never saw a single unauthenticated request —
 * measured, 10 anonymous calls against a limit of 3 produced ten 401s and zero
 * 429s. Meanwhile authenticated clients WERE limited by it, squeezing their
 * real allowance to min(quota, backstop). Both halves were backwards.
 *
 * Registering our own `onRequest` hook before the auth hook makes the ordering
 * explicit rather than emergent from another plugin's internals.
 *
 * This is NOT the client's allowance — that is the per-key quota enforced in
 * the route, alongside the concurrency semaphore. This only stops someone
 * hammering the key space, so it can be generous.
 *
 * Traffic is grouped by API key when one is presented, and by socket otherwise,
 * so one client can never eat another's headroom. The key is parsed but NOT
 * verified: grouping is all we need, and an invalid token falling back to the
 * socket bucket is the desired behaviour.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { parseApiKey } from '../lib/apiKey.js';

export interface BackstopOpts {
  maxPerMinute: number;
  /** Paths served without any limiting (probes). Compared exactly. */
  publicPaths?: string[];
}

const DEFAULT_PUBLIC_PATHS = ['/livez', '/healthz'];

interface Window {
  startedAt: number;
  count: number;
}

async function backstopPlugin(app: FastifyInstance, opts: BackstopOpts): Promise<void> {
  const publicPaths = new Set(opts.publicPaths ?? DEFAULT_PUBLIC_PATHS);
  const windows = new Map<string, Window>();

  const bucketFor = (req: FastifyRequest): string => {
    const header = req.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      const parsed = parseApiKey(header.slice('Bearer '.length).trim());
      if (parsed !== null) return `key:${parsed.keyId}`;
    }
    return `ip:${req.ip}`;
  };

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // The probes must NEVER be limited: under attack the orchestrator's health
    // check would get a 429, the container would be marked unhealthy, and the
    // restart loop would finish what the attacker started.
    const path = req.url.split('?')[0] ?? req.url;
    if (publicPaths.has(path)) return;

    const now = Date.now();
    const windowStart = Math.floor(now / 60_000) * 60_000;
    const bucket = bucketFor(req);

    const existing = windows.get(bucket);
    const window =
      existing === undefined || existing.startedAt !== windowStart
        ? { startedAt: windowStart, count: 0 }
        : existing;
    window.count += 1;
    windows.set(bucket, window);

    // Drop stale buckets so an attacker rotating identifiers cannot grow this
    // map without bound.
    if (windows.size > 10_000) {
      for (const [k, v] of windows) {
        if (v.startedAt !== windowStart) windows.delete(k);
      }
    }

    if (window.count > opts.maxPerMinute) {
      const retryAfter = Math.max(1, Math.ceil((windowStart + 60_000 - now) / 1000));
      req.log.warn({ bucket: bucket.startsWith('key:') ? bucket : 'ip' }, 'backstop limit hit');
      return reply
        .code(429)
        .header('Retry-After', String(retryAfter))
        .send({ error: 'rate_limited' });
    }
  });
}

export default fp(backstopPlugin, { name: 'backstop' });
