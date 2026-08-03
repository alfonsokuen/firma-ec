/**
 * preflight-bus.ts — main-thread side of the placement-analysis worker.
 *
 * Simpler than `sign-session-bus.ts` on purpose: there is no `.p12` to parse
 * once and retain, so there is no `openSession` handshake to await. The
 * worker is ready for `analyzeNext` as soon as it's constructed — if the
 * module is still loading when the first message arrives, the browser
 * queues it for us (same guarantee `postMessage` always gives a Worker).
 *
 * One worker per BATCH, not per document: `preflightBatch` opens a single
 * session and reuses it for every file, so the `@firma-ec/signer` chunk is
 * fetched/parsed by the worker once instead of N times.
 *
 * Timeout policy is shared with the signing session
 * (`computeSignSessionTimeoutMs`, imported — not duplicated) because both
 * bound "how long is it reasonable to wait on this worker for a PDF of this
 * size", and drifting the two formulas apart would be an accident, not a
 * decision.
 *
 * On timeout: this worker holds no key material, so there is no wipe to
 * await like `sign-session.worker.ts`'s `closeSession`/`sessionClosed` ack —
 * `terminate()` runs immediately.
 */

import { computeSignSessionTimeoutMs } from '../workers/sign-session-bus';
import type { PreflightOutcome } from './preflight-core';
import type { PropagationHint } from './propagation';

// ---------- Wire protocol ----------

export interface AnalyzeNextRequest {
  kind: 'analyzeNext';
  requestId: string;
  pdf: ArrayBuffer;
  /**
   * Hint de propagación (F2, `propagation.ts`). Opcional y solo números — no
   * hay nada que `structuredClone` no sepa transferir. Skew de versiones: un
   * worker VIEJO que no sepa de este campo simplemente lo ignora (JS
   * estructural) y responde sin `propagated` en el `outcome` — nada cuelga,
   * nada rompe, igual que cualquier otro campo opcional del protocolo.
   */
  hint?: PropagationHint;
}

export type PreflightWorkerRequest = AnalyzeNextRequest;

export interface AnalyzeResultResponse {
  kind: 'analyzeResult';
  requestId: string;
  outcome: PreflightOutcome;
}

export interface AnalyzeErrorResponse {
  kind: 'analyzeError';
  requestId: string;
  code: string;
  message: string;
}

/**
 * The worker received a message it does not understand — in a PWA that is a
 * bundle/worker version skew after a deploy, not an exotic case. Answering
 * makes the skew visible instead of leaving the caller waiting for its own
 * timeout.
 */
export interface ProtocolErrorResponse {
  kind: 'protocolError';
  code: string;
  message: string;
}

export type PreflightWorkerResponse =
  | AnalyzeResultResponse
  | AnalyzeErrorResponse
  | ProtocolErrorResponse;

// ---------- Errors ----------

export class PreflightSessionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PreflightSessionError';
  }
}

/**
 * Distinguishable error for a `signNext`-style timeout: `analyze()` did not
 * hear back within its budget. `preflight.ts` maps this to
 * `needs_review`/`analysis_timeout` instead of `unreadable` — the document
 * was never actually determined to be unreadable, the analysis just didn't
 * finish in time.
 */
export class PreflightAnalysisTimeoutError extends PreflightSessionError {
  constructor(timeoutMs: number) {
    super('timeout', `analyzeNext did not complete within ${timeoutMs}ms`);
    this.name = 'PreflightAnalysisTimeoutError';
  }
}

// ---------- Worker factory (override in tests) ----------

export function createPreflightWorker(): Worker {
  return new Worker(new URL('./preflight.worker.ts', import.meta.url), {
    type: 'module',
    name: 'preflight-worker',
  });
}

let preflightWorkerFactory: () => Worker = createPreflightWorker;

/** Test-only: swap the worker factory. Pass `null` to restore the default. */
export function __setPreflightWorkerFactoryForTests(f: (() => Worker) | null): void {
  preflightWorkerFactory = f ?? createPreflightWorker;
}

let requestIdCounter = 0;
function nextRequestId(): string {
  requestIdCounter += 1;
  return `pf-${requestIdCounter}-${Date.now().toString(36)}`;
}

/**
 * The exact bytes the caller passed as a transferable `ArrayBuffer`.
 *
 * `pdfBytes.buffer` is only safe to transfer directly when the view spans
 * the WHOLE backing buffer — otherwise the transfer would hand over (and
 * detach) bytes outside `pdfBytes` that the caller may still own. When in
 * doubt, copy: `slice()` is the same defensive choice `sign-bus.ts` and
 * `sign-session-bus.ts` make implicitly by always owning their buffers
 * end-to-end.
 */
function toTransferableBuffer(pdfBytes: Uint8Array): ArrayBuffer {
  if (pdfBytes.byteOffset === 0 && pdfBytes.byteLength === pdfBytes.buffer.byteLength) {
    return pdfBytes.buffer as ArrayBuffer;
  }
  return pdfBytes.slice().buffer as ArrayBuffer;
}

// ---------- PreflightSession ----------

export interface AnalyzeOptions {
  /** Override the per-document timeout (ms). Defaults to {@link computeSignSessionTimeoutMs}. */
  timeoutMs?: number;
  /**
   * Propagation hint (F2, `propagation.ts`) for this one document. Threaded
   * all the way to the worker; populated by `FirmarLote.svelte` (F2c,
   * `propagateFrom`).
   */
  hint?: PropagationHint;
}

/**
 * A live analysis session: one worker, N documents. Obtain via
 * {@link openPreflightSession}. Concurrency is strictly 1 — the batch loop
 * awaits each `analyze()` before calling the next, same discipline as
 * `SignSession.signNext`.
 */
export class PreflightSession {
  private readonly worker: Worker;
  private closed = false;
  private inFlight = false;

  /** @internal use {@link openPreflightSession} */
  constructor(worker: Worker) {
    this.worker = worker;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Analyze one PDF's placement. The `pdfBytes` buffer is TRANSFERRED to the
   * worker via `postMessage(..., [transferBuffer])` — the caller's
   * `Uint8Array` is left DETACHED (byteLength 0) once this call settles. In
   * the common case (the view spans the whole backing buffer — see
   * {@link toTransferableBuffer}) no copy happens at all; it is the same
   * buffer, just handed over. The only current caller (`preflightOne`,
   * `preflight.ts`) allocates fresh bytes per document and never reuses
   * them, so this is safe today — but do not read `pdfBytes` again after
   * calling `analyze()`.
   */
  analyze(pdfBytes: Uint8Array, opts: AnalyzeOptions = {}): Promise<PreflightOutcome> {
    if (this.closed) {
      return Promise.reject(
        new PreflightSessionError('session_closed', 'analyze() called after terminate()'),
      );
    }
    if (this.inFlight) {
      return Promise.reject(
        new PreflightSessionError(
          'concurrency_violation',
          'analyze() called while a previous call is still in flight',
        ),
      );
    }
    this.inFlight = true;

    const requestId = nextRequestId();
    const timeoutMs = opts.timeoutMs ?? computeSignSessionTimeoutMs(pdfBytes.byteLength);
    const transferBuffer = toTransferableBuffer(pdfBytes);

    return new Promise<PreflightOutcome>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = (): void => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        this.worker.removeEventListener('message', onMessage);
        this.worker.removeEventListener('error', onError);
        this.worker.removeEventListener('messageerror', onMessageError);
        this.inFlight = false;
      };

      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };

      const onMessage = (ev: MessageEvent<PreflightWorkerResponse>): void => {
        const msg = ev.data;
        if (!msg || typeof msg !== 'object') return;
        switch (msg.kind) {
          case 'analyzeResult':
            if (msg.requestId !== requestId) return;
            settle(() => resolve(msg.outcome));
            return;
          case 'analyzeError':
            if (msg.requestId !== requestId) return;
            settle(() => reject(new PreflightSessionError(msg.code, msg.message)));
            return;
          case 'protocolError':
            // The worker does not understand what we sent it (bundle skew).
            // Failing now beats waiting for a timeout that explains nothing.
            settle(() => reject(new PreflightSessionError(msg.code, msg.message)));
            return;
          default:
            console.warn(
              `[preflight] unknown response kind: ${String((msg as { kind?: unknown }).kind)}`,
            );
            return;
        }
      };

      // QA post-merge 2026-08-03 (silent-failure-hunter): un worker que
      // crashea o falla al deserializar un mensaje queda a medio morir —
      // `onError`/`onMessageError` rechazan esta llamada, pero sin
      // `terminate()` la sesión sigue sin `closed`, y `preflightBatch` solo
      // abre una fresca `if (session.isClosed)`. El SIGUIENTE documento se
      // postea al mismo worker muerto y se queda colgado hasta agotar el
      // timeout completo (decenas de segundos con un PDF grande) para salir
      // con una razón igual de falsa (`analysis_timeout`). Mismo
      // razonamiento que ya justifica el `terminate()` del timeout: este
      // worker no retiene material de clave, no hay ack que esperar.
      const onError = (ev: ErrorEvent): void => {
        this.terminate();
        settle(() =>
          reject(new PreflightSessionError('worker_error', ev.message || 'preflight worker crashed')),
        );
      };

      const onMessageError = (): void => {
        this.terminate();
        settle(() =>
          reject(
            new PreflightSessionError(
              'messageerror',
              'preflight worker postMessage deserialisation failed',
            ),
          ),
        );
      };

      this.worker.addEventListener('message', onMessage);
      this.worker.addEventListener('error', onError);
      this.worker.addEventListener('messageerror', onMessageError);

      timer = setTimeout(() => {
        // Unlike sign-session's key material, this worker retains nothing
        // sensitive between documents — kill it immediately, no ack to wait for.
        this.terminate();
        settle(() => reject(new PreflightAnalysisTimeoutError(timeoutMs)));
      }, timeoutMs);

      const req: AnalyzeNextRequest = {
        kind: 'analyzeNext',
        requestId,
        pdf: transferBuffer,
        ...(opts.hint ? { hint: opts.hint } : {}),
      };
      try {
        this.worker.postMessage(req, [transferBuffer]);
      } catch (e) {
        settle(() => reject(new PreflightSessionError('post_failed', (e as Error).message)));
      }
    });
  }

  /**
   * Stop the worker. Idempotent. Public so `preflight.ts` can cut a session
   * short on `signal.aborted` without waiting for a timeout, and so the
   * timeout path above can reuse it.
   */
  terminate(): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
  }
}

/**
 * Open a placement-analysis session: creates a dedicated worker ready to
 * receive `analyzeNext` immediately (no handshake — see module doc-comment).
 */
export function openPreflightSession(): PreflightSession {
  const worker = preflightWorkerFactory();
  return new PreflightSession(worker);
}

/** Re-exported so callers only need to import from this module. */
export { computeSignSessionTimeoutMs };
