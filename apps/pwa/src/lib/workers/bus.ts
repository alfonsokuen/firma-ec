/**
 * bus.ts — typed postMessage contract + `runVerify` helper.
 *
 * Why a single-shot worker?
 *   See ./verify.worker.ts header. Each call to `runVerify` spins a fresh worker
 *   and terminates it on completion (resolve OR reject). Callers should not try
 *   to reuse instances — the helper does not expose them.
 *
 * Transferable: the PDF ArrayBuffer is posted as a transferable. The buffer the
 * caller hands in is detached after this call returns; clone it first if you need
 * to keep it.
 */

import type { VerificationResult, MultiVerificationResult } from '@firma-ec/verifier';

// ---------- Wire protocol (discriminated unions) ----------

export interface VerifyRequest {
  kind: 'verify';
  pdf: ArrayBuffer;
  opts?: {
    fetchOcsp?: boolean;
  };
}

/** Multi-firma branch: enumerates every signature in the PDF. */
export interface VerifyAllRequest {
  kind: 'verifyAll';
  pdf: ArrayBuffer;
  opts?: {
    fetchOcsp?: boolean;
  };
}

export type WorkerRequest = VerifyRequest | VerifyAllRequest;

export interface ProgressResponse {
  kind: 'progress';
  /** Coarse-grained stage label for UI: 'parse' | 'verify' | future stages. */
  stage: string;
}

export interface ResultResponse {
  kind: 'result';
  result: VerificationResult;
}

/** Multi-firma response: aggregate result with per-sig array + overallStatus. */
export interface ResultAllResponse {
  kind: 'resultAll';
  result: MultiVerificationResult;
}

export interface ErrorResponse {
  kind: 'error';
  code: string;
  message: string;
}

export type WorkerResponse = ProgressResponse | ResultResponse | ResultAllResponse | ErrorResponse;

// ---------- Errors ----------

export class WorkerVerificationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorkerVerificationError';
  }
}

// ---------- Worker factory (override in tests) ----------

/**
 * Creates a fresh worker. Exported so tests can stub it (jsdom/happy-dom do not
 * implement Vite's `new URL(..., import.meta.url)` worker resolution).
 *
 * In production this resolves to a separate chunk via Vite's worker import.
 */
export function createVerifyWorker(): Worker {
  return new Worker(new URL('./verify.worker.ts', import.meta.url), {
    type: 'module',
    name: 'verify-worker',
  });
}

// Indirection layer so tests can swap the factory without touching the call site.
let workerFactory: () => Worker = createVerifyWorker;

/** Test-only: swap the worker factory. Pass `null` to restore the default. */
export function __setWorkerFactoryForTests(f: (() => Worker) | null): void {
  workerFactory = f ?? createVerifyWorker;
}

// ---------- Public API ----------

export interface RunVerifyOptions {
  /** Skip live OCSP queries — pass-through to verifier. */
  fetchOcsp?: boolean;
  /** Optional UI hook called for each progress message. */
  onProgress?: (stage: string) => void;
}

/**
 * Verify a PDF in an isolated, single-shot worker.
 *
 * Resolves with the {@link VerificationResult} when the worker reports `'result'`.
 * Rejects with {@link WorkerVerificationError} on `'error'` messages or worker
 * `error`/`messageerror` events. The worker is terminated in either case.
 *
 * @param pdf PDF bytes. Posted as transferable — the buffer is detached after.
 *            Clone it (`pdf.slice(0)`) if the caller needs it again.
 */
export function runVerify(pdf: ArrayBuffer, opts: RunVerifyOptions = {}): Promise<VerificationResult> {
  const worker = workerFactory();

  return new Promise<VerificationResult>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onMessageError);
      // SECURITY: terminate-after-every-use. Always.
      worker.terminate();
    };

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const onMessage = (ev: MessageEvent<WorkerResponse>): void => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      switch (msg.kind) {
        case 'progress':
          opts.onProgress?.(msg.stage);
          return;
        case 'result':
          settle(() => resolve(msg.result));
          return;
        case 'error':
          settle(() => reject(new WorkerVerificationError(msg.code, msg.message)));
          return;
      }
    };

    const onError = (ev: ErrorEvent): void => {
      settle(() => reject(new WorkerVerificationError('worker_error', ev.message || 'worker crashed')));
    };

    const onMessageError = (): void => {
      settle(() => reject(new WorkerVerificationError('messageerror', 'worker postMessage deserialisation failed')));
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);

    const req: VerifyRequest = {
      kind: 'verify',
      pdf,
      ...(opts.fetchOcsp !== undefined ? { opts: { fetchOcsp: opts.fetchOcsp } } : {}),
    };

    try {
      worker.postMessage(req, [pdf]);
    } catch (e) {
      settle(() => reject(new WorkerVerificationError('post_failed', (e as Error).message)));
    }
  });
}

/**
 * Multi-firma verifier: enumerates every PAdES signature in the PDF and
 * resolves with a {@link MultiVerificationResult}. Same single-shot worker
 * security model as {@link runVerify}.
 *
 * UI should call this in place of `runVerify` when it needs to render N
 * signers (real PAdES use cases often have signer + counter-signer pairs).
 * For single-sig PDFs the returned `signatures` array has length 1 and
 * `overallStatus === signatures[0].status`.
 */
export function runVerifyAll(
  pdf: ArrayBuffer,
  opts: RunVerifyOptions = {},
): Promise<MultiVerificationResult> {
  const worker = workerFactory();

  return new Promise<MultiVerificationResult>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onMessageError);
      worker.terminate();
    };

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const onMessage = (ev: MessageEvent<WorkerResponse>): void => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      switch (msg.kind) {
        case 'progress':
          opts.onProgress?.(msg.stage);
          return;
        case 'resultAll':
          settle(() => resolve(msg.result));
          return;
        case 'error':
          settle(() => reject(new WorkerVerificationError(msg.code, msg.message)));
          return;
      }
    };

    const onError = (ev: ErrorEvent): void => {
      settle(() => reject(new WorkerVerificationError('worker_error', ev.message || 'worker crashed')));
    };

    const onMessageError = (): void => {
      settle(() => reject(new WorkerVerificationError('messageerror', 'worker postMessage deserialisation failed')));
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);

    const req: VerifyAllRequest = {
      kind: 'verifyAll',
      pdf,
      ...(opts.fetchOcsp !== undefined ? { opts: { fetchOcsp: opts.fetchOcsp } } : {}),
    };

    try {
      worker.postMessage(req, [pdf]);
    } catch (e) {
      settle(() => reject(new WorkerVerificationError('post_failed', (e as Error).message)));
    }
  });
}
