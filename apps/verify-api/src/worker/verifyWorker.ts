/**
 * Verification worker.
 *
 * Runs `verifyAllSignatures` off the main thread so that a slow or hostile
 * document cannot block the event loop — and, crucially, so that a verification
 * which blows its deadline can be TERMINATED. A `Promise.race` on the main
 * thread only stops waiting; the work keeps burning CPU. `worker.terminate()`
 * actually reclaims it.
 *
 * The protocol is deliberately tiny: one message in, one message out. The
 * worker never throws across the boundary — errors come back as a tagged
 * message, because an uncaught exception in a worker is far easier to lose.
 */
import { parentPort } from 'node:worker_threads';
import { verifyAllSignatures } from '@firma-ec/verifier';

export interface VerifyJob {
  /** Transferred, not copied: see the runner's postMessage call. */
  pdf: ArrayBuffer;
  fetchOcsp: boolean;
}

export type VerifyWorkerMessage =
  | { ok: true; result: unknown }
  | { ok: false; code: string; message: string };

if (parentPort === null) {
  throw new Error('verifyWorker must be run as a worker thread');
}

const port = parentPort;

port.on('message', (job: VerifyJob) => {
  void (async () => {
    try {
      const result = await verifyAllSignatures(new Uint8Array(job.pdf), {
        fetchOcsp: job.fetchOcsp,
      });
      port.postMessage({ ok: true, result } satisfies VerifyWorkerMessage);
    } catch (err) {
      port.postMessage({
        ok: false,
        code: 'verify_failed',
        message: err instanceof Error ? err.message : String(err),
      } satisfies VerifyWorkerMessage);
    }
  })();
});
