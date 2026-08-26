/**
 * GET /livez   — process is up.
 * GET /healthz — the trust anchors actually loaded.
 *
 * Why healthz checks anchors: this service bundles its PEM trust roots through
 * a `?raw` loader (see build.mjs). If that resolution ever breaks, the process
 * still boots and still answers — but every verdict becomes "untrusted",
 * turning good signatures into false red. An empty anchor set is a HARD failure
 * here so the deploy is caught by the probe instead of by a customer.
 */
import { getTrustRoots } from '@firma-ec/tsl-ec';
import type { FastifyInstance } from 'fastify';

export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/livez', async () => ({ status: 'ok' }));

  app.get('/healthz', async (_req, reply) => {
    const started = Date.now();
    try {
      const roots = await getTrustRoots();
      const anchorCount = roots.length;
      if (anchorCount === 0) {
        return reply
          .code(503)
          .send({ status: 'unhealthy', reason: 'no_trust_anchors', anchorCount });
      }
      return { status: 'ok', anchorCount, latencyMs: Date.now() - started };
    } catch (err) {
      return reply.code(503).send({
        status: 'unhealthy',
        reason: 'trust_anchors_unavailable',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
