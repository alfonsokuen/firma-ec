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

import type { MultiVerificationResult, VerificationResult } from '@firma-ec/verifier';
import { APP_VERSION } from '../version';

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
  /**
   * Watchdog timeout in ms. If the worker posts neither a result nor an error
   * (nor a progress message) within this window, the promise rejects with code
   * `timeout`. Default {@link DEFAULT_VERIFY_TIMEOUT_MS}. The timer resets on
   * every progress message, so a slow-but-alive worker is not killed — only a
   * silently-dead one. Pass 0 to disable (not recommended).
   */
  timeoutMs?: number;
}

/**
 * Default watchdog timeout. Verification of even large PDFs completes in a few
 * seconds; this generous ceiling exists to convert a *silently dead worker*
 * into an actionable error instead of an infinite spinner.
 *
 * Root cause this guards against (v0.7.30): a stale Service Worker can serve an
 * app shell that references purged hashed chunks. When the verify module worker
 * boots, its static imports 404 and Caddy's SPA fallback returns index.html;
 * Chromium does NOT reliably fire `worker.onerror` for module-worker dependency
 * load failures, so the worker is created but its message handler never runs.
 * `postMessage` then vanishes and — without this watchdog — the UI spins
 * forever. The timeout surfaces a "reload to update" error so stale clients
 * self-heal.
 */
export const DEFAULT_VERIFY_TIMEOUT_MS = 30_000;

/**
 * Boot deadline (v0.7.34). The verify worker posts a `boot` progress beacon the
 * instant its module (and all static-imported chunks) finish loading. If we do
 * NOT receive *any* message from the worker within this window, we assume the
 * worker is dead-on-arrival — the dominant failure on mobile Chromium, where a
 * module worker whose dependency chunks fail to load never fires `onerror` and
 * never runs its message handler. In that case `runVerifyAll` terminates the
 * stillborn worker and re-runs verification on the MAIN THREAD (see
 * {@link verifyAllOnMainThread}). This is exactly the path that worked before
 * verification was moved off-thread, so it restores the feature on affected
 * devices at the cost of briefly blocking the UI.
 */
export const VERIFY_BOOT_DEADLINE_MS = 6_000;

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
export function runVerify(
  pdf: ArrayBuffer,
  opts: RunVerifyOptions = {},
): Promise<VerificationResult> {
  const worker = workerFactory();

  return new Promise<VerificationResult>((resolve, reject) => {
    let settled = false;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
    let watchdog: ReturnType<typeof setTimeout> | undefined;

    const armWatchdog = (): void => {
      if (timeoutMs <= 0) return;
      if (watchdog !== undefined) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        settle(() =>
          reject(
            new WorkerVerificationError(
              'timeout',
              `verify worker did not respond within ${timeoutMs}ms`,
            ),
          ),
        );
      }, timeoutMs);
    };

    const cleanup = (): void => {
      if (watchdog !== undefined) clearTimeout(watchdog);
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
          armWatchdog(); // worker is alive — extend the deadline
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
      settle(() =>
        reject(new WorkerVerificationError('worker_error', ev.message || 'worker crashed')),
      );
    };

    const onMessageError = (): void => {
      settle(() =>
        reject(
          new WorkerVerificationError('messageerror', 'worker postMessage deserialisation failed'),
        ),
      );
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
      armWatchdog();
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
    let booted = false;
    let lastStage = 'none';
    const timeoutMs = opts.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let bootTimer: ReturnType<typeof setTimeout> | undefined;

    // The PDF is transferred to the worker (detached here). For the main-thread
    // fallback we need our own copy, taken BEFORE the transfer.
    const fallbackBytes = new Uint8Array(pdf.slice(0));

    const armWatchdog = (): void => {
      if (timeoutMs <= 0) return;
      if (watchdog !== undefined) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        settle(() =>
          reject(
            new WorkerVerificationError(
              'timeout',
              `verify worker timed out after ${timeoutMs}ms (v${APP_VERSION}, last stage: ${lastStage})`,
            ),
          ),
        );
      }, timeoutMs);
    };

    const cleanup = (): void => {
      if (watchdog !== undefined) clearTimeout(watchdog);
      if (bootTimer !== undefined) clearTimeout(bootTimer);
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

    // Stillborn module worker (mobile Chromium): no boot beacon ⇒ run on the
    // main thread instead of failing. Resolves the SAME promise so callers are
    // oblivious to which path produced the result.
    const fallbackToMainThread = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      opts.onProgress?.('verify');
      verifyAllOnMainThread(fallbackBytes, opts)
        .then(resolve)
        .catch((e) =>
          reject(
            new WorkerVerificationError(
              'fallback_failed',
              `worker did not boot and main-thread verify failed: ${(e as Error).message}`,
            ),
          ),
        );
    };

    const onMessage = (ev: MessageEvent<WorkerResponse>): void => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      switch (msg.kind) {
        case 'progress':
          booted = true;
          lastStage = msg.stage;
          if (bootTimer !== undefined) {
            clearTimeout(bootTimer);
            bootTimer = undefined;
          }
          armWatchdog(); // worker is alive — extend the deadline
          // The `boot` beacon is internal liveness signalling; don't surface it.
          if (msg.stage !== 'boot') opts.onProgress?.(msg.stage);
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
      // Worker threw before booting → try the main thread rather than fail.
      if (!booted) {
        fallbackToMainThread();
        return;
      }
      settle(() =>
        reject(new WorkerVerificationError('worker_error', ev.message || 'worker crashed')),
      );
    };

    const onMessageError = (): void => {
      settle(() =>
        reject(
          new WorkerVerificationError('messageerror', 'worker postMessage deserialisation failed'),
        ),
      );
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
      armWatchdog();
      // Boot deadline: if the worker never even posts its `boot` beacon, it's
      // dead-on-arrival (chunk load failure on mobile Chromium) → main thread.
      bootTimer = setTimeout(() => {
        if (!booted) fallbackToMainThread();
      }, VERIFY_BOOT_DEADLINE_MS);
      worker.postMessage(req, [pdf]);
    } catch (e) {
      // postMessage itself threw (e.g. worker construction failed) → main thread.
      void e;
      fallbackToMainThread();
    }
  });
}

/**
 * Main-thread fallback for {@link runVerifyAll}. Dynamically imports the
 * verifier so its heavy chunk stays out of the entry bundle — it is only pulled
 * when the worker path is unavailable. Blocks the UI thread while running, which
 * is acceptable as a last resort to keep verification working on devices where
 * the module worker cannot load.
 */
async function verifyAllOnMainThread(
  bytes: Uint8Array,
  opts: RunVerifyOptions,
): Promise<MultiVerificationResult> {
  const { verifyAllSignatures } = await import('@firma-ec/verifier');
  const verifierOpts = opts.fetchOcsp !== undefined ? { fetchOcsp: opts.fetchOcsp } : {};
  return verifyAllSignatures(bytes, verifierOpts);
}
