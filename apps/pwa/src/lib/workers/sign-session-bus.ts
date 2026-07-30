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
  /**
   * AGGREGATE budget (ms, relative) for the whole LTV phase of THIS document.
   * The worker turns it into an absolute deadline the moment it starts signing.
   *
   * `ltvTimeoutMs` bounds one request; the phase issues several (OCSP + CRL
   * fallback per cert, then the archive timestamp), so only an aggregate keeps
   * the document's network budget below its signing budget. Optional: absent =
   * previous behaviour (per-request timeouts only).
   */
  ltvBudgetMs?: number;
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

/**
 * Ack for `closeSession`: the worker has zeroed the retained key material and
 * dropped the session. Waiting for this before `terminate()` is what makes the
 * wipe actually happen (see {@link SignSession.closeAndWipe}).
 */
export interface SessionClosedResponse {
  kind: 'sessionClosed';
}

export type SignSessionWorkerResponse =
  | SessionOpenedResponse
  | SessionOpenErrorResponse
  | SignNextProgressResponse
  | SignNextResultResponse
  | SignNextErrorResponse
  | SessionClosedResponse;

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
 * Options for one {@link SignSession.signNext} call: everything `runSign`
 * accepts, plus the session-only aggregate LTV budget (see
 * {@link SignNextRequest.ltvBudgetMs}). Kept as a separate type so the
 * single-shot `RunSignOptions` — shared with `sign.worker.ts`, which would
 * silently ignore the field — stays untouched.
 */
export interface SignNextOptions extends RunSignOptions {
  /** Aggregate LTV network budget (ms) for this document. */
  ltvBudgetMs?: number;
}

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
  /**
   * Rejecter for the signature currently in flight, so the session can settle
   * it deterministically (close, or a timeout that kills the worker) instead of
   * leaving the caller's promise pending until its own timer fires.
   */
  private failInFlight: ((err: SignSessionError) => void) | null = null;

  /** @internal use {@link openSignSession} */
  constructor(worker: Worker) {
    this.worker = worker;
  }

  /** Settle the in-flight signature (if any) with an explicit session error. */
  private rejectInFlight(code: string, message: string): void {
    const fail = this.failInFlight;
    this.failInFlight = null;
    fail?.(new SignSessionError(code, message));
  }

  /**
   * Sign one PDF with the session's already-open .p12. The `pdf` buffer is
   * transferred (detached after the call, like `runSign`).
   */
  signNext(pdf: ArrayBuffer, opts: SignNextOptions = {}): Promise<RunSignResult> {
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
        this.failInFlight = null;
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
      this.failInFlight = (err: SignSessionError): void => settle(() => reject(err));

      timer = setTimeout(() => {
        // A timeout does NOT mean the worker stopped: it is still signing this
        // document, with a decrypted buffer alive and its own TSA/OCSP requests
        // outstanding. Releasing `inFlight` and handing the next document to
        // that same worker is exactly how two signatures ended up concurrent
        // inside it ("one live buffer" broken, duplicated TSA/OCSP traffic).
        // Killing the worker is the only way to actually stop the orphan; the
        // session cannot be transparently recycled because the PIN travels once
        // and is never retained, so the session dies with it — loudly, via the
        // `session_closed` code every later `signNext` gets.
        this.destroy();
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
        ...(opts.ltvBudgetMs !== undefined ? { ltvBudgetMs: opts.ltvBudgetMs } : {}),
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
   * Hard stop: mark the session closed and kill the worker immediately, without
   * waiting for anything. Used when the worker is presumed unresponsive (a
   * `signNext` timeout), where the goal is precisely to stop work in progress.
   */
  private destroy(): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
  }

  /**
   * Close the session: tells the worker to drop + zero the parsed .p12, then
   * terminates it. Idempotent — safe to call more than once.
   *
   * ⚠️ Synchronous, so `terminate()` may kill the worker before it processes
   * `closeSession` — i.e. the zero-out is best effort here. Prefer
   * {@link closeAndWipe} when the wipe must be guaranteed (that is what the
   * batch queue uses). This variant remains for callers that need a
   * fire-and-forget teardown (e.g. inside a `finally` that cannot await).
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    // A signature in flight must fail with the real reason instead of hanging
    // until its own timeout only to report a misleading 'timeout'.
    this.rejectInFlight('session_closed', 'session closed while a signature was in flight');
    try {
      this.worker.postMessage({ kind: 'closeSession' } satisfies CloseSessionRequest);
    } catch {
      /* worker may already be gone — terminate() below is what matters */
    }
    this.worker.terminate();
  }

  /**
   * Close the session and WAIT for the worker to confirm it zeroed the retained
   * key material (`sessionClosed`) before terminating it.
   *
   * `close()` posts `closeSession` and calls `terminate()` in the same tick, so
   * the worker can die before ever running the wipe. Awaiting the ack is what
   * makes the mitigation real. Bounded by `ackTimeoutMs`: a wedged worker gets
   * terminated anyway rather than hanging the caller.
   */
  async closeAndWipe(opts: { ackTimeoutMs?: number } = {}): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.rejectInFlight('session_closed', 'session closed while a signature was in flight');
    const ackTimeoutMs = opts.ackTimeoutMs ?? WIPE_ACK_TIMEOUT_MS;

    try {
      await new Promise<void>((resolve) => {
        let done = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const finish = (): void => {
          if (done) return;
          done = true;
          if (timer !== null) clearTimeout(timer);
          this.worker.removeEventListener('message', onAck);
          resolve();
        };
        const onAck = (ev: MessageEvent<SignSessionWorkerResponse>): void => {
          if (ev.data && typeof ev.data === 'object' && ev.data.kind === 'sessionClosed') finish();
        };
        this.worker.addEventListener('message', onAck);
        timer = setTimeout(finish, ackTimeoutMs);
        try {
          this.worker.postMessage({ kind: 'closeSession' } satisfies CloseSessionRequest);
        } catch {
          finish(); // worker already gone — nothing to wait for
        }
      });
    } finally {
      this.worker.terminate();
    }
  }
}

// ---------- Timeout policy (session variant — same shape as sign-bus's) ----------

export const SESSION_TIMEOUT_BASE_MS = 15_000;
export const SESSION_TIMEOUT_PER_KB_MS = 1;
export const SESSION_TIMEOUT_MAX_MS = 60_000;
/** Extra headroom for openSession — parsing a large legacy 3DES .p12 can take seconds. */
const OPEN_SESSION_TIMEOUT_MS = 20_000;
/**
 * How long {@link SignSession.closeAndWipe} waits for the worker's
 * `sessionClosed` ack before terminating it regardless.
 *
 * Short on purpose: on the normal path the worker's queue is empty and the wipe
 * is a synchronous memset, so the ack comes back within a task. A longer wait
 * only helps when the worker is busy finishing a signature we have already
 * given up on — and there terminating is the desired outcome. Missing the ack
 * degrades to the old best-effort behaviour; it never blocks teardown.
 */
const WIPE_ACK_TIMEOUT_MS = 300;

export function computeSignSessionTimeoutMs(pdfByteLength: number): number {
  const kb = Math.max(0, Math.ceil(pdfByteLength / 1024));
  return Math.min(SESSION_TIMEOUT_MAX_MS, SESSION_TIMEOUT_BASE_MS + kb * SESSION_TIMEOUT_PER_KB_MS);
}

/**
 * Largest PDF (bytes) whose timeout budget is NOT clamped by
 * {@link SESSION_TIMEOUT_MAX_MS} — i.e. the biggest file this policy can
 * actually serve. Any declared batch file-size limit above this would accept
 * files that are guaranteed to fail on timeout; `sign-queue.ts` derives its
 * limit from here so the two cannot drift apart.
 */
export function maxPdfBytesWithinSignTimeout(): number {
  return ((SESSION_TIMEOUT_MAX_MS - SESSION_TIMEOUT_BASE_MS) / SESSION_TIMEOUT_PER_KB_MS) * 1024;
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
