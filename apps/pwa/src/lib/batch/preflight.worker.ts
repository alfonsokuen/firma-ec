/**
 * preflight.worker.ts — placement-analysis worker for the batch pre-flight.
 *
 * Moves `analyzeForPreflight` (preflight-core.ts) off the main thread so a
 * large or adversarial PDF can't block the UI while `preflightBatch` walks
 * the batch. No handshake to open: unlike `sign-session.worker.ts` there is
 * no key material to parse once and retain — the worker is ready to receive
 * `analyzeNext` as soon as it exists, and the first message simply queues
 * behind module load if it arrives before the listener is attached.
 *
 * Concurrency is 1, enforced HERE by the same explicit FIFO queue pattern as
 * `sign-session.worker.ts` (`enqueue`/`queueTail`): an `async` message
 * listener does NOT serialise events on its own.
 *
 * Security note — the try/catch reinstated here: `analyzePdfForPlacement`
 * (via `analyzeForPreflight`) is documented by `@firma-ec/signer` to NEVER
 * throw — every corrupt/encrypted PDF resolves with `.failure` instead. But
 * `preflight.ts` used to wrap that call in a generic try/catch as a safety
 * net before F0 fase 1 extracted the pure core; that net narrowed to just
 * `file.arrayBuffer()` and stopped covering the analysis itself. The
 * try/catch below restores the "never throws: every failure is a state"
 * invariant `preflightOne`'s doc-comment promises — now in the correct
 * place, since an uncaught exception here would otherwise kill this
 * worker's queue for every later document in the batch.
 *
 * Privacidad: no registra nada del documento — ni su nombre (no lo recibe:
 * solo bytes) ni su contenido — ni a consola, ni a un `Error`, ni a la red.
 *
 * Protocol (see ./preflight-bus.ts for typed contracts):
 *   in  : { kind: 'analyzeNext', requestId, pdf }
 *   out : { kind: 'analyzeResult', requestId, outcome }
 *       | { kind: 'analyzeError', requestId, code, message }
 *       | { kind: 'protocolError', code, message }
 */

import { analyzeForPreflight } from './preflight-core';
import type {
  AnalyzeNextRequest,
  PreflightWorkerRequest,
  PreflightWorkerResponse,
} from './preflight-bus';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: PreflightWorkerResponse): void {
  ctx.postMessage(msg);
}

async function handleAnalyzeNext(req: AnalyzeNextRequest): Promise<void> {
  const { requestId } = req;
  try {
    const outcome = await analyzeForPreflight(new Uint8Array(req.pdf));
    post({ kind: 'analyzeResult', requestId, outcome });
  } catch (e) {
    const err = e as Error & { code?: string };
    post({
      kind: 'analyzeError',
      requestId,
      code: err.code ?? 'unknown',
      message: err.message ?? String(e),
    });
  }
}

// ---------- Serial task queue (concurrency 1, real — see sign-session.worker.ts) ----------

let queueTail: Promise<void> = Promise.resolve();
let currentRequestId: string | null = null;

function enqueue(task: () => Promise<void> | void, requestIdForFailures?: string): void {
  queueTail = queueTail.then(task).catch((e) => {
    post({
      kind: 'analyzeError',
      requestId: requestIdForFailures ?? currentRequestId ?? 'unknown',
      code: 'worker_task_failed',
      message: (e as Error)?.message ?? String(e),
    });
  });
}

ctx.addEventListener('message', (ev: MessageEvent<PreflightWorkerRequest>) => {
  const req = ev.data;
  if (!req || typeof req !== 'object') return;

  switch (req.kind) {
    case 'analyzeNext':
      enqueue(async () => {
        currentRequestId = req.requestId;
        try {
          await handleAnalyzeNext(req);
        } finally {
          currentRequestId = null;
        }
      }, req.requestId);
      return;
    default: {
      // A PWA routinely runs a stale bundle against a fresh worker (or the
      // reverse) after a deploy. Silence there is indistinguishable from a hang:
      // answer, and say which kind was not understood.
      const kind = (req as { kind?: unknown }).kind;
      console.warn(`[preflight] unknown request kind: ${String(kind)}`);
      post({
        kind: 'protocolError',
        code: 'unknown_request_kind',
        message: `worker does not understand request kind ${String(kind)}`,
      });
      return;
    }
  }
});
