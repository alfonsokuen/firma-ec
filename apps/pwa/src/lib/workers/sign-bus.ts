/**
 * sign-bus.ts — typed postMessage contract + `runSign` helper for PAdES-B-B signing.
 *
 * Why a single-shot worker?
 *   See ./sign.worker.ts header. Each call to `runSign` spins a fresh worker and
 *   terminates it on completion (resolve OR reject). Callers should not try to
 *   reuse instances — the helper does not expose them. This guarantees the
 *   CryptoKey + PKCS#8 buffer + PIN string in the worker heap are torn down at
 *   the boundary of every signing operation.
 *
 * Transferables: the PDF and PFX ArrayBuffers are posted as transferables. The
 * buffers the caller hands in are detached after this call returns; clone them
 * (`buf.slice(0)`) first if they are still needed.
 *
 * PIN handling: the PIN string is part of the postMessage payload. The main
 * thread does NOT retain a reference past `worker.postMessage(...)` — it lives
 * only as a function argument and gets GC'd as soon as the call frame unwinds.
 *
 * Timeout: dynamic — `15s + 1ms/KB` of input PDF, capped at 60s. Imposed by the
 * UI Pro Max addendum (large PDFs need headroom; tiny ones don't).
 *
 * @see Adendum F3 UI Pro Max — timeout dinámico
 */

import type { SigAlg, VisibleSigSpec } from '@firma-ec/signer';

// ---------- Wire protocol (discriminated unions) ----------

/** Visible-signature placement for the worker request (mirrors PadesSignOptions.visibleSig). */
export interface SignVisibleSigInput {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
}

/** Signing options that travel over the wire (Date is serialised as epoch ms). */
export interface SignRequestOptions {
  reason?: string;
  location?: string;
  contactInfo?: string;
  /** Signing time as epoch ms (Date is not structured-clone friendly across some shims). */
  signingTime?: number;
  sigAlg?: SigAlg;
  /** Visible signature widget input. Use {@link VisibleSigSpec} on the caller side. */
  visibleSig?: SignVisibleSigInput;
}

export interface SignRequest {
  kind: 'sign';
  pdf: ArrayBuffer;
  p12: ArrayBuffer;
  pin: string;
  opts?: SignRequestOptions;
}

export type SignWorkerRequest = SignRequest;

/** Coarse-grained progress stages emitted by the worker. */
export type SignProgressStage =
  | 'parse_p12'
  | 'parse_pdf'
  | 'compute_hash'
  | 'sign'
  | 'embed'
  | 'done';

export interface SignProgressResponse {
  kind: 'progress';
  stage: SignProgressStage;
}

export interface SignResultResponse {
  kind: 'result';
  signedPdf: ArrayBuffer;
}

export interface SignErrorResponse {
  kind: 'error';
  code: string;
  message: string;
}

export type SignWorkerResponse =
  | SignProgressResponse
  | SignResultResponse
  | SignErrorResponse;

// ---------- Errors ----------

export class WorkerSignerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorkerSignerError';
  }
}

// ---------- Worker factory (override in tests) ----------

/**
 * Creates a fresh worker. Exported so tests can stub it (jsdom/happy-dom do not
 * implement Vite's `new URL(..., import.meta.url)` worker resolution).
 *
 * In production this resolves to a separate chunk via Vite's worker import.
 */
export function createSignWorker(): Worker {
  return new Worker(new URL('./sign.worker.ts', import.meta.url), {
    type: 'module',
    name: 'sign-worker',
  });
}

let workerFactory: () => Worker = createSignWorker;

/** Test-only: swap the worker factory. Pass `null` to restore the default. */
export function __setSignWorkerFactoryForTests(f: (() => Worker) | null): void {
  workerFactory = f ?? createSignWorker;
}

// ---------- Timeout policy ----------

const TIMEOUT_BASE_MS = 15_000; // 15s baseline
const TIMEOUT_PER_KB_MS = 1; // +1ms per KB
const TIMEOUT_MAX_MS = 60_000; // hard cap 60s

/** Compute the dynamic timeout for a PDF of `pdfByteLength` bytes. Exported for tests. */
export function computeSignTimeoutMs(pdfByteLength: number): number {
  const kb = Math.max(0, Math.ceil(pdfByteLength / 1024));
  return Math.min(TIMEOUT_MAX_MS, TIMEOUT_BASE_MS + kb * TIMEOUT_PER_KB_MS);
}

// ---------- Public API ----------

/** Visible-sig spec accepted by `runSign` (alias of {@link VisibleSigSpec}-like input). */
export type RunSignVisibleSig = SignVisibleSigInput;

export interface RunSignOptions {
  reason?: string;
  location?: string;
  contactInfo?: string;
  signingTime?: Date;
  sigAlg?: SigAlg;
  visibleSig?: RunSignVisibleSig;
  /** Optional UI hook called for each progress message. */
  onProgress?: (stage: SignProgressStage) => void;
  /** Override the dynamic timeout (ms). Mostly for tests. */
  timeoutMs?: number;
}

/** Re-export type users may need on the call site. */
export type { SigAlg, VisibleSigSpec };

/**
 * Sign a PDF with PAdES-B-B in an isolated, single-shot worker.
 *
 * Resolves with the signed PDF bytes (Uint8Array) when the worker reports
 * `'result'`. Rejects with {@link WorkerSignerError} on `'error'` messages,
 * worker `error`/`messageerror` events, or timeout. The worker is terminated
 * in either case.
 *
 * **Transferables**: both `pdf` and `p12` ArrayBuffers are posted as
 * transferables — the buffers are detached after this call. Clone them first
 * (`buf.slice(0)`) if you need them again.
 *
 * **PIN handling**: `pin` lives in the function call frame only. After
 * `postMessage` it travels to the worker; the main thread does not capture it
 * in any closure that outlives this call.
 *
 * @param pdf  PDF bytes to sign (transferable; detached after).
 * @param p12  PKCS#12 bytes (transferable; detached after).
 * @param pin  PIN for the PFX (in-memory only for the duration of this call).
 * @param opts Signing options + onProgress callback.
 */
export function runSign(
  pdf: ArrayBuffer,
  p12: ArrayBuffer,
  pin: string,
  opts: RunSignOptions = {},
): Promise<Uint8Array> {
  const worker = workerFactory();
  const timeoutMs = opts.timeoutMs ?? computeSignTimeoutMs(pdf.byteLength);

  return new Promise<Uint8Array>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onMessageError);
      // SECURITY: terminate-after-every-use. Always.
      worker.terminate();
    };

    const settle = (fn: () => void): void => {
      // Double-settle guard: late terminal messages are ignored, no unhandled rejection.
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const onMessage = (ev: MessageEvent<SignWorkerResponse>): void => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      switch (msg.kind) {
        case 'progress':
          opts.onProgress?.(msg.stage);
          return;
        case 'result':
          settle(() => resolve(new Uint8Array(msg.signedPdf)));
          return;
        case 'error':
          settle(() => reject(new WorkerSignerError(msg.code, msg.message)));
          return;
      }
    };

    const onError = (ev: ErrorEvent): void => {
      settle(() =>
        reject(new WorkerSignerError('worker_error', ev.message || 'worker crashed')),
      );
    };

    const onMessageError = (): void => {
      settle(() =>
        reject(
          new WorkerSignerError(
            'messageerror',
            'worker postMessage deserialisation failed',
          ),
        ),
      );
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);

    // Arm the timeout BEFORE posting — covers the (rare) postMessage hang case too.
    timer = setTimeout(() => {
      settle(() =>
        reject(
          new WorkerSignerError(
            'timeout',
            `Worker did not complete within ${timeoutMs}ms`,
          ),
        ),
      );
    }, timeoutMs);

    const requestOpts: SignRequestOptions = {
      ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
      ...(opts.location !== undefined ? { location: opts.location } : {}),
      ...(opts.contactInfo !== undefined ? { contactInfo: opts.contactInfo } : {}),
      ...(opts.signingTime !== undefined ? { signingTime: opts.signingTime.getTime() } : {}),
      ...(opts.sigAlg !== undefined ? { sigAlg: opts.sigAlg } : {}),
      ...(opts.visibleSig !== undefined ? { visibleSig: opts.visibleSig } : {}),
    };

    const req: SignRequest = {
      kind: 'sign',
      pdf,
      p12,
      pin,
      ...(Object.keys(requestOpts).length > 0 ? { opts: requestOpts } : {}),
    };

    try {
      worker.postMessage(req, [pdf, p12]);
    } catch (e) {
      settle(() =>
        reject(new WorkerSignerError('post_failed', (e as Error).message)),
      );
    }
  });
}
