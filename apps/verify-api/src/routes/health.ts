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
import type { VerifyRunner } from '../services/verifyRunner.js';

export default async function healthRoutes(
  app: FastifyInstance,
  opts: { runner: VerifyRunner },
): Promise<void> {
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
      // A runner that cannot execute is as fatal as missing anchors: the
      // service would answer 500 to every verification while looking alive.
      if (!opts.runner.isReady()) {
        return reply.code(503).send({ status: 'unhealthy', reason: 'verify_runner_unavailable' });
      }
      return { status: 'ok', anchorCount, latencyMs: Date.now() - started };
    } catch (err) {
      // The cause goes to the log, not to the caller: it can carry filesystem
      // paths and dependency internals.
      _req.log.error({ err }, 'trust anchors unavailable');
      return reply.code(503).send({ status: 'unhealthy', reason: 'trust_anchors_unavailable' });
    }
  });
}
