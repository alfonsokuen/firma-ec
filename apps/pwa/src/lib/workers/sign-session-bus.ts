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
  /**
   * Colocación automática de la firma visible para ESTE documento: el worker
   * analiza el PDF (geometría, firmas previas, campos `/FT /Sig` vacíos) y
   * calcula el rect + `rotate` él mismo.
   *
   * Vive en la petición de SESIÓN y no en `SignRequestOptions` a propósito:
   * `sign.worker.ts` (camino de un solo documento) comparte ese tipo y
   * ignoraría el campo en silencio. Cuando es `true`, `opts.visibleSig` se
   * ignora — pedir 'auto' es justamente decir que no hay un rect por documento.
   */
  visibleSigAuto?: boolean;
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
 * La colocación automática no pudo decidir un rect defendible para este
 * documento, así que NO se firmó.
 *
 * Es una respuesta propia y no un `signError` porque no es un fallo: el
 * documento está intacto y lo que falta es una decisión humana sobre dónde va
 * la firma. Mezclarla con los errores la contaría como documento fallido del
 * lote y perdería el motivo.
 */
export interface SignNeedsReviewResponse {
  kind: 'signNeedsReview';
  requestId: string;
  /** Página (0-based) sobre la que se intentó colocar. */
  page: number;
  /** Motivo estable de `computeAutoPlacement` (`default_footer_rect_out_of_media_box`…). */
  reason: string;
}

/**
 * Ack for `closeSession`: the worker has zeroed the retained key material and
 * dropped the session. Waiting for this before `terminate()` is what makes the
 * wipe actually happen (see {@link SignSession.closeAndWipe}).
 */
export interface SessionClosedResponse {
  kind: 'sessionClosed';
  /**
   * Whether the retained PKCS#8 was actually overwritten. `false` means the
   * mitigation could not run (key material in a non-zeroable shape) — reported
   * rather than assumed, because a security mitigation that fails silently is
   * worse than none. Optional so an older worker bundle still parses.
   */
  wiped?: boolean;
}

/**
 * The worker received a message it does not understand — in a PWA that is a
 * bundle/worker version skew after a deploy, not an exotic case. Answering makes
 * the skew visible instead of leaving the caller waiting for its own timeout.
 */
export interface ProtocolErrorResponse {
  kind: 'protocolError';
  code: string;
  message: string;
}

export type SignSessionWorkerResponse =
  | SessionOpenedResponse
  | SessionOpenErrorResponse
  | SignNextProgressResponse
  | SignNextResultResponse
  | SignNextErrorResponse
  | SignNeedsReviewResponse
  | SessionClosedResponse
  | ProtocolErrorResponse;

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

/**
 * Valor centinela de `visibleSig` que pide colocación automática por documento.
 *
 * Constante con nombre (y no el literal suelto por ahí) porque viaja del
 * llamante del lote al worker atravesando tres módulos: un typo silencioso se
 * traduciría en "firma sin apariencia visible", que es el peor fallo posible
 * aquí — el documento queda firmado pero sin nada que se vea.
 */
export const VISIBLE_SIG_AUTO = 'auto';

/** Tipo del centinela {@link VISIBLE_SIG_AUTO}, para las opciones que lo aceptan. */
export type VisibleSigAuto = typeof VISIBLE_SIG_AUTO;

/** Código de {@link SignNeedsReviewError}. NO está en los códigos session-fatal: la sesión sigue sana. */
export const NEEDS_REVIEW_CODE = 'needs_review';

/**
 * El documento necesita colocación manual de la firma visible, así que no se
 * firmó. Se propaga como rechazo de `signNext` (el llamante no recibe un PDF)
 * pero es distinguible por su `instanceof`, de modo que el lote no lo confunda
 * con un fallo y pueda reportar el motivo.
 */
export class SignNeedsReviewError extends SignSessionError {
  constructor(
    public readonly page: number,
    public readonly reason: string,
  ) {
    super(
      NEEDS_REVIEW_CODE,
      `la colocación automática no pudo ubicar la firma en la página ${page + 1} (${reason})`,
    );
    this.name = 'SignNeedsReviewError';
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

/**
 * requestId the worker uses when it cannot attribute a failure to a document
 * (its last-resort handler). Must match `UNKNOWN_REQUEST_ID` in
 * sign-session.worker.ts; duplicated as a literal on purpose so the bus does not
 * import the worker module (which would pull the signer into the main bundle).
 */
const UNATTRIBUTED_REQUEST_ID = 'unknown';

/** Is this a `signError` the worker could not attribute to a document? */
function isUnattributedRequestId(requestId: string | undefined): boolean {
  return (
    requestId === undefined ||
    requestId === null ||
    requestId === '' ||
    requestId === UNATTRIBUTED_REQUEST_ID
  );
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
export interface SignNextOptions extends Omit<RunSignOptions, 'visibleSig'> {
  /** Aggregate LTV network budget (ms) for this document. */
  ltvBudgetMs?: number;
  /**
   * Rect explícito, o {@link VISIBLE_SIG_AUTO} para que el worker calcule la
   * colocación de ESTE documento (ver {@link SignNextRequest.visibleSigAuto}).
   * `RunSignOptions.visibleSig` se sustituye en vez de ampliarse para que el
   * camino de un solo documento — que no sabe resolver 'auto' — no lo acepte.
   */
  visibleSig?: RunSignOptions['visibleSig'] | VisibleSigAuto;
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
  /**
   * Set when the worker died on its own (an `error` / `messageerror` event).
   *
   * Defect #7: the worker can die in the GAPS between documents — while the
   * batch queue reads the next file, sleeps a TSA backoff, or awaits the
   * caller's persistence. Listeners installed only for the duration of a
   * `signNext` are absent exactly then, so nobody heard it: the next document
   * was posted into the void and the caller learnt 'timeout' much later, with
   * the real cause gone. These listeners live for the session's whole lifetime.
   */
  private workerFailure: SignSessionError | null = null;

  /** @internal use {@link openSignSession} */
  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.addEventListener('error', this.onWorkerDied);
    this.worker.addEventListener('messageerror', this.onWorkerMessageError);
  }

  /** Session-lifetime handler: the worker crashed, whether or not we were mid-document. */
  private readonly onWorkerDied = (ev: Event): void => {
    const message = (ev as ErrorEvent).message || 'session worker crashed';
    this.recordWorkerFailure('worker_error', message);
  };

  private readonly onWorkerMessageError = (): void => {
    this.recordWorkerFailure('messageerror', 'session worker postMessage deserialisation failed');
  };

  private recordWorkerFailure(code: string, message: string): void {
    if (this.workerFailure) return; // first cause wins — it explains the rest
    this.workerFailure = new SignSessionError(code, message);
    // Diagnostic only: no document data, no user data. firmar.ec has no
    // analytics and this must not become any.
    console.warn(`[sign-session] worker died (${code}): ${message}`);
    // A signature in flight is settled by its own per-call listener; if the
    // death happened in a gap there is nothing to settle here.
  }

  /** True while the worker is believed alive and the session usable. */
  get isUsable(): boolean {
    return !this.closed && this.workerFailure === null;
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
    if (this.workerFailure) {
      // Don't read the file, don't post into the void: hand back the ACTUAL
      // cause (see {@link workerFailure}). The caller can then reopen a session.
      return Promise.reject(this.workerFailure);
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
            // Defect #6: a failure the worker could not attribute (its
            // last-resort handler, or a message from a mismatched bundle) used to
            // be dropped here without a trace — the caller then waited out its
            // own timer and reported 'timeout', which killed the whole batch and
            // hid the real cause. An unattributed error belongs to whatever IS in
            // flight; a DIFFERENT, known requestId is still ignored (no
            // cross-talk between documents).
            if (msg.requestId !== requestId && !isUnattributedRequestId(msg.requestId)) return;
            settle(() => reject(new SignSessionError(msg.code, msg.message)));
            return;
          case 'signNeedsReview':
            // El documento no se firmó y la sesión sigue sana: se rechaza con un
            // error DISTINGUIBLE para que el lote lo aparte sin contarlo como
            // fallo ni matar la sesión.
            if (msg.requestId !== requestId) return;
            settle(() => reject(new SignNeedsReviewError(msg.page, msg.reason)));
            return;
          case 'protocolError':
            // The worker does not understand what we sent it (bundle skew).
            // Failing now beats waiting for a timeout that explains nothing.
            settle(() => reject(new SignSessionError(msg.code, msg.message)));
            return;
          case 'sessionOpened':
          case 'sessionOpenError':
          case 'sessionClosed':
            return; // handled by openSignSession / closeAndWipe
          default:
            // Unknown kind: in a PWA this is a stale worker chunk against a fresh
            // bundle. Diagnostic warn only — no document data.
            console.warn(
              `[sign-session] unknown response kind: ${String((msg as { kind?: unknown }).kind)}`,
            );
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

      timer = setTimeout(async () => {
        // A timeout does NOT mean the worker stopped: it is still signing this
        // document, with a decrypted buffer alive and its own TSA/OCSP requests
        // outstanding. Releasing `inFlight` and handing the next document to
        // that same worker is exactly how two signatures ended up concurrent
        // inside it ("one live buffer" broken, duplicated TSA/OCSP traffic).
        // Killing the worker is the only way to actually stop the orphan; the
        // session cannot be transparently recycled because the PIN travels once
        // and is never retained, so the session dies with it — loudly, via the
        // `session_closed` code every later `signNext` gets.
        //
        // Defect #8: killing it is not enough — `terminate()` alone leaves the
        // decrypted PKCS#8 in the worker heap until the process reclaims it, so
        // the wipe this repo commits to never ran on the timeout path. `destroy`
        // posts `closeSession` (which the worker handles OUT of its queue, so it
        // does not wait behind the abandoned signature) and only then terminates.
        // The caller's rejection is delayed by that bounded wait on purpose: the
        // batch queue must not start the next document while the old worker is
        // still alive.
        await this.destroy();
        settle(() =>
          reject(
            new SignSessionError('timeout', `signNext did not complete within ${timeoutMs}ms`),
          ),
        );
      }, timeoutMs);

      const visibleSigAuto = opts.visibleSig === VISIBLE_SIG_AUTO;
      const explicitVisibleSig = opts.visibleSig === VISIBLE_SIG_AUTO ? undefined : opts.visibleSig;
      const requestOpts: SignRequestOptions = {
        ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
        ...(opts.location !== undefined ? { location: opts.location } : {}),
        ...(opts.contactInfo !== undefined ? { contactInfo: opts.contactInfo } : {}),
        ...(opts.signingTime !== undefined ? { signingTime: opts.signingTime.getTime() } : {}),
        ...(opts.sigAlg !== undefined ? { sigAlg: opts.sigAlg } : {}),
        // 'auto' NO viaja dentro de `opts`: ese tipo lo comparte el worker de un
        // solo documento, que no sabría resolverlo.
        ...(explicitVisibleSig !== undefined ? { visibleSig: explicitVisibleSig } : {}),
      };

      const req: SignNextRequest = {
        kind: 'signNext',
        requestId,
        pdf,
        ...(visibleSigAuto ? { visibleSigAuto: true } : {}),
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
   * Hard stop for a worker presumed unresponsive (a `signNext` timeout): ask it
   * to zero the retained key material, wait a bounded moment for the ack, then
   * kill it. Used where the goal is to STOP work in progress — the wipe is not
   * best-effort here, it is the reason the message is posted at all.
   */
  private async destroy(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const outcome = await this.postCloseAndTerminate(WIPE_ACK_TIMEOUT_MS);
    if (!outcome.wiped) {
      console.warn(
        `[sign-session] key material may NOT have been wiped on timeout (acked=${outcome.acked})`,
      );
    }
  }

  /**
   * Post `closeSession`, wait up to `ackTimeoutMs` for the `sessionClosed` ack,
   * then terminate the worker no matter what. Shared by {@link destroy} and
   * {@link closeAndWipe}; does NOT touch `failInFlight`, so each caller decides
   * how the pending signature is settled.
   */
  private postCloseAndTerminate(ackTimeoutMs: number): Promise<SessionWipeOutcome> {
    return new Promise<SessionWipeOutcome>((resolve) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (outcome: SessionWipeOutcome): void => {
        if (done) return;
        done = true;
        if (timer !== null) clearTimeout(timer);
        this.worker.removeEventListener('message', onAck);
        this.worker.terminate();
        resolve(outcome);
      };
      const onAck = (ev: MessageEvent<SignSessionWorkerResponse>): void => {
        const msg = ev.data;
        if (!msg || typeof msg !== 'object' || msg.kind !== 'sessionClosed') return;
        // `wiped` is optional on the wire (an older worker bundle omits it).
        // Absent = the worker acked, so the wipe ran as far as it knows.
        finish({ acked: true, wiped: msg.wiped !== false });
      };
      this.worker.addEventListener('message', onAck);
      timer = setTimeout(() => finish({ acked: false, wiped: false }), ackTimeoutMs);
      try {
        this.worker.postMessage({ kind: 'closeSession' } satisfies CloseSessionRequest);
      } catch {
        finish({ acked: false, wiped: false }); // worker already gone
      }
    });
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
  async closeAndWipe(opts: { ackTimeoutMs?: number } = {}): Promise<SessionWipeOutcome> {
    if (this.closed) return { acked: false, wiped: false };
    this.closed = true;
    this.rejectInFlight('session_closed', 'session closed while a signature was in flight');
    return this.postCloseAndTerminate(opts.ackTimeoutMs ?? WIPE_ACK_TIMEOUT_MS);
  }
}

/**
 * What teardown actually achieved. Reported instead of resolving identically in
 * both cases: "the worker never acked" and "the worker wiped" are very different
 * facts for a mitigation the app promises its users.
 */
export interface SessionWipeOutcome {
  /** The worker answered `sessionClosed` before the deadline. */
  acked: boolean;
  /** The worker reported having zeroed the retained key material. */
  wiped: boolean;
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
