/**
 * GET /livez   — process is up.
 * GET /healthz — the service could actually produce a correct verdict.
 *
 * Readiness here is not "did we boot". This service answers questions about the
 * validity of electronic signatures, so the failure that matters is not a crash
 * — it is answering CONFIDENTLY AND WRONGLY. Two dependencies can rot without
 * anything else noticing:
 *
 *  - **Trust anchors.** If they stop being usable, every legitimate signature
 *    comes back "untrusted", which looks exactly like a genuinely bad document.
 *    Counting the array's length does not detect this (it is a structural
 *    constant); see `lib/trustAnchors.ts`.
 *  - **The verification runner.** If it cannot execute, every request 500s
 *    while the process looks perfectly alive.
 *
 * Both are checked here, and a degradation is reported as 503 so an orchestrator
 * pulls the instance instead of serving wrong answers.
 */
import type { FastifyInstance } from 'fastify';
import { type AnchorReport, inspectTrustAnchors } from '../lib/trustAnchors.js';
import type { VerifyRunner } from '../services/verifyRunner.js';

export interface HealthRoutesOpts {
  runner: VerifyRunner;
  /** Test seam: inject an anchor report instead of reading the real TSL. */
  inspectAnchors?: () => Promise<AnchorReport>;
}

export default async function healthRoutes(
  app: FastifyInstance,
  opts: HealthRoutesOpts,
): Promise<void> {
  const inspect = opts.inspectAnchors ?? (() => inspectTrustAnchors());

  app.get('/livez', async () => ({ status: 'ok' }));

  app.get('/healthz', async (req, reply) => {
    const started = Date.now();

    let anchors: AnchorReport;
    try {
      anchors = await inspect();
    } catch (err) {
      // The cause goes to the log, not to the caller: it can carry filesystem
      // paths and dependency internals.
      req.log.error({ err }, 'trust anchors unavailable');
      return reply.code(503).send({ status: 'unhealthy', reason: 'trust_anchors_unavailable' });
    }

    if (anchors.problems.length > 0) {
      // Never silent: an operator must be able to see WHICH anchor rotted.
      req.log.error({ problems: anchors.problems }, 'unusable trust anchors');
    }

    if (anchors.usable === 0) {
      return reply.code(503).send({ status: 'unhealthy', reason: 'no_trust_anchors' });
    }
    if (anchors.usable < anchors.declared) {
      // Partial load is the scenario that scares us most: valid signatures from
      // the affected CA would be rejected, and nothing else would complain.
      return reply.code(503).send({
        status: 'unhealthy',
        reason: 'trust_anchors_degraded',
        usableAnchors: anchors.usable,
        declaredAnchors: anchors.declared,
      });
    }

    if (!opts.runner.isReady()) {
      return reply.code(503).send({ status: 'unhealthy', reason: 'verify_runner_unavailable' });
    }

    return {
      status: 'ok',
      usableAnchors: anchors.usable,
      declaredAnchors: anchors.declared,
      latencyMs: Date.now() - started,
    };
  });
}
