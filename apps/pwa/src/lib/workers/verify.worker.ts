/**
 * verify.worker.ts — isolated Web Worker that runs `verifyPdf` off the main thread.
 *
 * Security model: this worker is single-shot. The `bus.runVerify` helper terminates
 * the worker after every verification (success OR failure). Rationale:
 *   - Mitigates side-channel leakage between unrelated PDFs (separate WASM/JS heaps).
 *   - Prevents long-lived buffers carrying parsed certificates / private state across
 *     verifications (defense in depth — the verifier itself does not persist secrets,
 *     but a fresh heap is the strongest guarantee available in-browser).
 *   - Keeps memory bounded for crypto buffers (pkijs ASN.1 trees can be large).
 *
 * Protocol (see ./bus.ts for typed contracts):
 *   in  : { kind: 'verify', pdf: ArrayBuffer, opts?: { fetchOcsp?: boolean } }
 *   out : { kind: 'progress', stage: string }
 *       | { kind: 'result', result: VerificationResult }
 *       | { kind: 'error', code: string, message: string }
 *
 * The PDF is transferred (not copied) — caller MUST treat the input ArrayBuffer as
 * detached after posting. See `bus.runVerify` which handles this correctly.
 */

import {
  type MultiVerificationResult,
  type VerificationResult,
  verifyAllSignatures,
  verifyPdf,
} from '@firma-ec/verifier';
import type { WorkerRequest, WorkerResponse } from './bus';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: WorkerResponse): void {
  ctx.postMessage(msg);
}

ctx.addEventListener('message', async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;

  if (!req || typeof req !== 'object') {
    post({
      kind: 'error',
      code: 'bad_request',
      message: 'verify.worker received an unrecognised message',
    });
    return;
  }

  try {
    post({ kind: 'progress', stage: 'parse' });

    const bytes = new Uint8Array(req.pdf);
    const opts = req.opts ?? {};

    post({ kind: 'progress', stage: 'verify' });

    // Multi-firma branch: caller can request `verifyAll: true` to receive
    // a {@link MultiVerificationResult} that enumerates every signature in
    // the PDF. Default (false) preserves the legacy single-result shape
    // returned by `verifyPdf` for existing UI callers.
    if (req.kind === 'verifyAll') {
      const multi: MultiVerificationResult = await verifyAllSignatures(bytes, opts);
      post({ kind: 'resultAll', result: multi });
      return;
    }

    if (req.kind === 'verify') {
      const result: VerificationResult = await verifyPdf(bytes, opts);
      post({ kind: 'result', result });
      return;
    }

    post({
      kind: 'error',
      code: 'bad_request',
      message: `verify.worker received unknown kind: ${(req as { kind?: string }).kind ?? '?'}`,
    });
  } catch (e) {
    const err = e as Error & { code?: string };
    post({
      kind: 'error',
      code: err.code ?? 'unknown',
      message: err.message ?? String(e),
    });
  }
});
