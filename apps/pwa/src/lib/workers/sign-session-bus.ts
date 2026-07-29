/**
 * sign-session-bus.ts — batch-signing session: open a .p12 ONCE, sign N PDFs
 * reusing it, close explicitly.
 *
 * Why a session on top of the single-shot `sign-bus.ts`?
 *   `runSign` (see ./sign-bus.ts) is intentionally single-shot: it spins a
 *   fresh worker per call and terminates it after every attempt so the
 *   CryptoKey + PKCS#8 + PIN never survive across unrelated sign operations.
 *   That security posture does NOT change here. What changes is the unit of
 *   "operation": a batch session is ONE worker lifetime spanning N documents
 *   signed with the SAME certificate, not N worker lifetimes.
 *
 *   The expensive step `parsePfx` performs (forge's PKCS#12 ASN.1 decode +
 *   PIN/MAC verification — documented in p12.worker.ts as "1-3s on mid-tier
 *   mobile") runs exactly ONCE per session, inside `sign-session.worker.ts`,
 *   on `openSession`. Every `signNext` call reuses the already-parsed PFX.
 *
 *   The WebCrypto `CryptoKey` (extractable:false) is imported by
 *   `@firma-ec/signer`'s `signPdfPades`/`addIncrementalSignature` internally,
 *   per document — that import is a cheap native operation (unlike the forge
 *   decode), and leaving it as-is avoids reworking @firma-ec/signer's public
 *   API (which `runSign` also depends on) just to cache a CryptoKey. The
 *   invariant that matters — "CryptoKey / PKCS#8 / PIN never cross
 *   postMessage" — holds regardless: they are created and consumed entirely
 *   inside the worker in both the single-shot and the session path.
 *
 * PIN handling: the PIN travels ONCE, in the `openSession` message. It is
 * never resent for `signNext`. The worker does not echo it back in any
 * response.
 *
 * Wire protocol: see the discriminated unions below. `signNext` is
 * request/response correlated by `requestId` so progress events from a given
 * document can't be misattributed if a caller races calls (though the
 * session enforces concurrency=1 — see {@link SignSession.signNext}).
 */

import type { LtvMeta, SigAlg, TimestampMeta } from '@firma-ec/signer';
import type {
  RunSignOptions,
  RunSignResult,
  SignProgressStage,
  SignRequestOptions,
} from './sign-bus';

// ---------- Wire protocol ----------

export interface OpenSessionRequest {
  kind: 'openSession';
  p12: ArrayBuffer;
  pin: string;
}

export interface SignNextRequest {
  kind: 'signNext';
  requestId: string;
  pdf: ArrayBuffer;
  opts?: SignRequestOptions;
  timestampEnabled?: boolean;
  tsaUrl?: string;
  tsaTimeoutMs?: number;
  ltvEnabled?: boolean;
  ltvArchiveEnabled?: boolean;
  ltvTimeoutMs?: number;
  ocspUrl?: string;
}

export interface CloseSessionRequest {
  kind: 'closeSession';
}

export type SignSessionWorkerRequest = OpenSessionRequest | SignNextRequest | CloseSessionRequest;

export interface SessionOpenedResponse {
  kind: 'sessionOpened';
}

export interface SessionOpenErrorResponse {
  kind: 'sessionOpenError';
  code: string;
  message: string;
}

export interface SignNextProgressResponse {
  kind: 'signProgress';
  requestId: string;
  stage: SignProgressStage;
}

export interface SignNextResultResponse {
  kind: 'signResult';
  requestId: string;
  signedPdf: ArrayBuffer;
  timestamp: TimestampMeta;
  ltv?: LtvMeta;
}

export interface SignNextErrorResponse {
  kind: 'signError';
  requestId: string;
  code: string;
  message: string;
}

export type SignSessionWorkerResponse =
  | SessionOpenedResponse
  | SessionOpenErrorResponse
  | SignNextProgressResponse
  | SignNextResultResponse
  | SignNextErrorResponse;

// ---------- Errors ----------

export class SignSessionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SignSessionError';
  }
}

// ---------- Worker factory (override in tests) ----------

export function createSignSessionWorker(): Worker {
  return new Worker(new URL('./sign-session.worker.ts', import.meta.url), {
    type: 'module',
    name: 'sign-session-worker',
  });
}

let sessionWorkerFactory: () => Worker = createSignSessionWorker;

/** Test-only: swap the worker factory. Pass `null` to restore the default. */
export function __setSignSessionWorkerFactoryForTests(f: (() => Worker) | null): void {
  sessionWorkerFactory = f ?? createSignSessionWorker;
}

let requestIdCounter = 0;
function nextRequestId(): string {
  requestIdCounter += 1;
  return `sn-${requestIdCounter}-${Date.now().toString(36)}`;
}

// ---------- SignSession ----------

/**
 * A live batch-signing session: one worker, one parsed .p12, N documents.
 * Obtain via {@link openSignSession}. Concurrency is strictly 1 — calling
 * `signNext` again before the previous call settles rejects immediately
 * (the caller — the batch queue — is expected to await each item).
 */
export class SignSession {
  private readonly worker: Worker;
  private closed = false;
  private inFlight = false;

  /** @internal use {@link openSignSession} */
  constructor(worker: Worker) {
    this.worker = worker;
  }

  /**
   * Sign one PDF with the session's already-open .p12. The `pdf` buffer is
   * transferred (detached after the call, like `runSign`).
   */
  signNext(pdf: ArrayBuffer, opts: RunSignOptions = {}): Promise<RunSignResult> {
    if (this.closed) {
      return Promise.reject(
        new SignSessionError('session_closed', 'signNext called after close()'),
      );
    }
    if (this.inFlight) {
      return Promise.reject(
        new SignSessionError(
          'concurrency_violation',
          'signNext called while a previous call is still in flight',
        ),
      );
    }
    this.inFlight = true;

    const requestId = nextRequestId();
    const timeoutMs = opts.timeoutMs ?? computeSignSessionTimeoutMs(pdf.byteLength);

    return new Promise<RunSignResult>((resolve, reject) => {
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

      const onMessage = (ev: MessageEvent<SignSessionWorkerResponse>): void => {
        const msg = ev.data;
        if (!msg || typeof msg !== 'object') return;
        switch (msg.kind) {
          case 'signProgress':
            if (msg.requestId === requestId) opts.onProgress?.(msg.stage);
            return;
          case 'signResult':
            if (msg.requestId !== requestId) return;
            settle(() =>
              resolve({
                signedPdf: new Uint8Array(msg.signedPdf),
                timestamp: msg.timestamp,
                ltv: msg.ltv ?? {
                  profile: 'B-T',
                  longTermAchieved: false,
                  archiveAchieved: false,
                  embeddedOcspCount: 0,
                  embeddedCrlCount: 0,
                  warnings: [{ code: 'ltv_meta_missing_from_worker' }],
                },
              }),
            );
            return;
          case 'signError':
            if (msg.requestId !== requestId) return;
            settle(() => reject(new SignSessionError(msg.code, msg.message)));
            return;
        }
      };

      const onError = (ev: ErrorEvent): void => {
        settle(() =>
          reject(new SignSessionError('worker_error', ev.message || 'session worker crashed')),
        );
      };

      const onMessageError = (): void => {
        settle(() =>
          reject(
            new SignSessionError(
              'messageerror',
              'session worker postMessage deserialisation failed',
            ),
          ),
        );
      };

      this.worker.addEventListener('message', onMessage);
      this.worker.addEventListener('error', onError);
      this.worker.addEventListener('messageerror', onMessageError);

      timer = setTimeout(() => {
        settle(() =>
          reject(
            new SignSessionError('timeout', `signNext did not complete within ${timeoutMs}ms`),
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

      const req: SignNextRequest = {
        kind: 'signNext',
        requestId,
        pdf,
        ...(Object.keys(requestOpts).length > 0 ? { opts: requestOpts } : {}),
        ...(opts.timestampEnabled !== undefined ? { timestampEnabled: opts.timestampEnabled } : {}),
        ...(opts.tsaUrl !== undefined ? { tsaUrl: opts.tsaUrl } : {}),
        ...(opts.tsaTimeoutMs !== undefined ? { tsaTimeoutMs: opts.tsaTimeoutMs } : {}),
        ...(opts.ltvEnabled !== undefined ? { ltvEnabled: opts.ltvEnabled } : {}),
        ...(opts.ltvArchiveEnabled !== undefined
          ? { ltvArchiveEnabled: opts.ltvArchiveEnabled }
          : {}),
        ...(opts.ltvTimeoutMs !== undefined ? { ltvTimeoutMs: opts.ltvTimeoutMs } : {}),
        ...(opts.ocspUrl !== undefined ? { ocspUrl: opts.ocspUrl } : {}),
      };

      try {
        this.worker.postMessage(req, [pdf]);
      } catch (e) {
        settle(() => reject(new SignSessionError('post_failed', (e as Error).message)));
      }
    });
  }

  /**
   * Close the session: tells the worker to drop the parsed .p12 / cached
   * caches, then terminates it. Idempotent — safe to call more than once.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.worker.postMessage({ kind: 'closeSession' } satisfies CloseSessionRequest);
    } catch {
      /* worker may already be gone — terminate() below is what matters */
    }
    this.worker.terminate();
  }
}

// ---------- Timeout policy (session variant — same shape as sign-bus's) ----------

const SESSION_TIMEOUT_BASE_MS = 15_000;
const SESSION_TIMEOUT_PER_KB_MS = 1;
const SESSION_TIMEOUT_MAX_MS = 60_000;
/** Extra headroom for openSession — parsing a large legacy 3DES .p12 can take seconds. */
const OPEN_SESSION_TIMEOUT_MS = 20_000;

export function computeSignSessionTimeoutMs(pdfByteLength: number): number {
  const kb = Math.max(0, Math.ceil(pdfByteLength / 1024));
  return Math.min(SESSION_TIMEOUT_MAX_MS, SESSION_TIMEOUT_BASE_MS + kb * SESSION_TIMEOUT_PER_KB_MS);
}

// ---------- openSignSession ----------

export interface OpenSignSessionOptions {
  /** Override the open-session timeout (ms). Mostly for tests. */
  timeoutMs?: number;
}

/**
 * Open a batch-signing session: parses `p12` with `pin` ONCE inside a
 * dedicated worker, then returns a {@link SignSession} that can sign many
 * PDFs against it. The PIN is sent exactly once, in this call.
 *
 * **Transferables**: `p12` is posted as a transferable and detached after
 * this call, same contract as `runSign`.
 */
export function openSignSession(
  p12: ArrayBuffer,
  pin: string,
  opts: OpenSignSessionOptions = {},
): Promise<SignSession> {
  const worker = sessionWorkerFactory();
  const timeoutMs = opts.timeoutMs ?? OPEN_SESSION_TIMEOUT_MS;

  return new Promise<SignSession>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanupTimer = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const failAndTerminate = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      cleanupTimer();
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onMessageError);
      worker.terminate();
      fn();
    };

    const onMessage = (ev: MessageEvent<SignSessionWorkerResponse>): void => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.kind === 'sessionOpened') {
        if (settled) return;
        settled = true;
        cleanupTimer();
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        worker.removeEventListener('messageerror', onMessageError);
        resolve(new SignSession(worker));
        return;
      }
      if (msg.kind === 'sessionOpenError') {
        failAndTerminate(() => reject(new SignSessionError(msg.code, msg.message)));
      }
    };

    const onError = (ev: ErrorEvent): void => {
      failAndTerminate(() =>
        reject(new SignSessionError('worker_error', ev.message || 'session worker crashed')),
      );
    };

    const onMessageError = (): void => {
      failAndTerminate(() =>
        reject(
          new SignSessionError('messageerror', 'session worker postMessage deserialisation failed'),
        ),
      );
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);

    timer = setTimeout(() => {
      failAndTerminate(() =>
        reject(
          new SignSessionError('timeout', `openSession did not complete within ${timeoutMs}ms`),
        ),
      );
    }, timeoutMs);

    try {
      worker.postMessage({ kind: 'openSession', p12, pin } satisfies OpenSessionRequest, [p12]);
    } catch (e) {
      failAndTerminate(() => reject(new SignSessionError('post_failed', (e as Error).message)));
    }
  });
}

/** Re-export type users may need on the call site. */
export type { RunSignOptions, RunSignResult, SigAlg };
