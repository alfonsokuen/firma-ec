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

import type { LtvMeta, SigAlg, TimestampMeta, VisibleSigSpec } from '@firma-ec/signer';

// ---------- Wire protocol (discriminated unions) ----------

/** Visible-signature placement for the worker request (mirrors PadesSignOptions.visibleSig). */
export interface SignVisibleSigInput {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  /**
   * `/Rotate` de la PÁGINA destino (0/90/180/270), igual que
   * `VisibleSigInput.rotate` del firmante: la apariencia se dibuja en su
   * orientación natural y se rota con `/Matrix` para que se vea derecha en el
   * visor. `width`/`height` siguen siendo el rect FÍSICO, así que con 90/270 el
   * llamante manda h×w del cuadro "en lectura".
   *
   * El worker ya lo propagaba por spread, pero sin declararlo aquí el camino
   * tipado no podía pedirlo — y es exactamente lo que necesita la colocación
   * automática de un lote en una página rotada.
   */
  rotate?: 0 | 90 | 180 | 270;
}

/**
 * Rebuilds a plain, non-proxied copy of a visible-signature rect.
 *
 * Callers on the main thread source this from Svelte 5 `$state` — deep
 * reactivity means any object nested inside a `$state` array/object is a
 * Proxy, not a plain object, even once it has been re-packed into a fresh
 * literal upstream (the proxy is applied where it's STORED, not where it's
 * built). A Proxy fails `structuredClone`/`postMessage`'s clone algorithm
 * even when every property it forwards is an ordinary number
 * (`DataCloneError: #<Object> could not be cloned`) — it still
 * `JSON.stringify`s fine and its own property descriptors look completely
 * ordinary, which is what made this bug so easy to miss: the object *looks*
 * plain right up until the one call that matters.  Reading each field
 * through the proxy's `get` trap and writing it into a fresh object literal
 * here strips the proxy before it reaches `postMessage`, for every caller.
 */
export function toPlainVisibleSig(v: SignVisibleSigInput): SignVisibleSigInput {
  return {
    page: v.page,
    x: v.x,
    y: v.y,
    width: v.width,
    height: v.height,
    ...(v.fontSize !== undefined ? { fontSize: v.fontSize } : {}),
    ...(v.rotate !== undefined ? { rotate: v.rotate } : {}),
  };
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
  /** F6 — RFC 3161 timestamp toggle (default true; main thread reads from settings store). */
  timestampEnabled?: boolean;
  /** F6 — TSA URL override (default https://freetsa.org/tsr). */
  tsaUrl?: string;
  /** F6 — TSA fetch timeout in ms (default 8000). */
  tsaTimeoutMs?: number;
  /** F7 — long-term validation (DSS OCSP/CRL embedding). Default true. */
  ltvEnabled?: boolean;
  /** F7 — long-term archive (document timestamp). Default true; off when ltvEnabled is false. */
  ltvArchiveEnabled?: boolean;
  /** F7 — OCSP/CRL fetch timeout per request (ms). Default 8000. */
  ltvTimeoutMs?: number;
  /** F7 — OCSP URL override (empty = AIA discovery from cert). */
  ocspUrl?: string;
  /**
   * 2026-08-05 HIGH fix — per-hop timeout for the AIA caIssuers fallback walk
   * (missing-intermediate resolution). Derived and set by `runSign` itself
   * from `deriveNetworkBudget`; not intended to be set by callers of
   * `runSign` (there is no equivalent `RunSignOptions` field — the budget is
   * derived, not requested, same as the batch path).
   */
  aiaTimeoutMs?: number;
  /**
   * 2026-08-05 HIGH fix — AGGREGATE budget (ms, relative) for the whole AIA
   * fallback walk (up to 8 hops) of this document. The worker turns it into
   * an absolute deadline the moment it starts signing (see sign.worker.ts).
   */
  aiaBudgetMs?: number;
}

export type SignWorkerRequest = SignRequest;

/** Coarse-grained progress stages emitted by the worker. */
export type SignProgressStage =
  | 'parse_p12'
  | 'parse_pdf'
  | 'compute_hash'
  | 'sign'
  | 'request_timestamp'
  | 'embed'
  // F7 — LTV stages
  | 'fetch_ocsp'
  | 'fetch_crl'
  | 'build_dss'
  | 'document_timestamp'
  | 'done';

export interface SignProgressResponse {
  kind: 'progress';
  stage: SignProgressStage;
}

export interface SignResultResponse {
  kind: 'result';
  signedPdf: ArrayBuffer;
  /**
   * F6 — RFC 3161 timestamp outcome. Always present (worker emits a meta
   * even when the user disabled TSA via settings or when the request failed).
   */
  timestamp: TimestampMeta;
  /**
   * F7 — long-term validation outcome. Worker emits this meta even when LT/LTA
   * didn't run (multi-firma path → `{ profile: 'B-B', warnings:
   * [{ code: 'ltv_skipped_multifirma' }] }`). Optional in the schema so older
   * bundles or test fixtures don't break the discriminant; new consumers
   * should treat absence as `ltvNotApplicable('B-T')`.
   */
  ltv?: LtvMeta;
  /**
   * F1 — true iff the intermediate chain the signer embedded reaches a
   * self-signed root (bundle and/or AIA fallback supplied every missing
   * link). Non-fatal, never blocks the download. Optional so older worker
   * bundles (pre-F1) don't break the discriminant — absence should be
   * treated as "unknown", not as a warning.
   */
  chainComplete?: boolean;
  /** Set when `chainComplete` is false: DN of the issuer that could not be
   *  resolved. UI messaging only — never a trust signal. */
  missingIssuerDn?: string;
}

export interface SignErrorResponse {
  kind: 'error';
  code: string;
  message: string;
}

export type SignWorkerResponse = SignProgressResponse | SignResultResponse | SignErrorResponse;

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

// ---------- Network budget (defect #1: network < document, provably) ----------
//
// 2026-08-05 HIGH fix (independent Fable + opus review, both, of the 2nd F1
// review's own AIA-budget fix): this used to live ONLY in sign-queue.ts (the
// batch path), so the single-document path below (`runSign`) had NO budget
// model at all — an AIA responder that stalls but never times out could
// consume the full per-request timeout on every one of the walk's up to 8
// hops, blowing past `computeSignTimeoutMs` and surfacing as a `timeout` that
// discards the whole signature instead of a reported degradation. Moved here
// — the shared layer both `sign-queue.ts` and `sign.worker.ts` build on — so
// both paths derive timeouts from the SAME function; `sign-queue.ts`
// re-exports it for backward compatibility with existing imports.

/**
 * Share of a document's signing budget the NETWORK legs may consume.
 *
 * The remaining 40% is for the CPU work that cannot be skipped: PDF parse,
 * SHA-256 over the whole file, PKCS#7 build, DSS append, incremental update.
 * 0.6 keeps the network from starving it on a mid-tier phone while still leaving
 * the TSA/OCSP legs a workable slice (9s of a 15s budget for a small PDF).
 *
 * The inequality this encodes — Σ(network timeouts) < document timeout — is the
 * whole point: before it, a hung OCSP responder blew the document budget, so the
 * failure surfaced as `timeout` (session-fatal) instead of as a reported
 * degradation, and one document aborted the entire batch (or, single-doc path,
 * discarded the whole signature).
 */
const NETWORK_BUDGET_FRACTION_OF_DOC = 0.6;

/**
 * Share of the network budget reserved for the RFC 3161 timestamp — ONE request
 * on the happy path, against the LTV phase's several (OCSP + CRL fallback per
 * cert, plus the archive document timestamp). Hence the smaller slice.
 */
const TSA_SHARE_OF_NETWORK_BUDGET = 0.25;

/**
 * Expected number of sequential requests in the LTV phase on the happy path:
 * OCSP for the signing cert, for its issuer, and for the TSA cert. Used only to
 * size the PER-REQUEST timeout; the aggregate is bounded by `ltvBudgetMs`, which
 * is what keeps a CRL-fallback cascade from multiplying the wait.
 */
const LTV_EXPECTED_REQUEST_LEGS = 3;

/**
 * Share of the network budget reserved for the AIA caIssuers fallback walk
 * (`resolveSigningIntermediates`, up to 8 hops). Smaller than the LTV share:
 * this is a missing-intermediate FALLBACK, not the primary revocation-checking
 * path, and the static bundle already covers the large majority of ACEs (F0).
 */
const AIA_SHARE_OF_NETWORK_BUDGET = 0.15;

/**
 * Expected sequential AIA hops on the happy path: usually one missing
 * intermediate resolves in a single caIssuers fetch; occasionally two when a
 * root cross-cert also needs resolving. Used only to size the PER-REQUEST
 * timeout — the aggregate is bounded by `aiaBudgetMs`, which is what keeps
 * the walk's up-to-8-hop loop from multiplying the wait past the budget.
 */
const AIA_EXPECTED_REQUEST_LEGS = 2;

/** Network timeouts for one document, all derived from its signing budget. */
export interface NetworkBudget {
  /** Per-request timeout for the RFC 3161 timestamp. */
  tsaTimeoutMs: number;
  /** AGGREGATE ceiling for the whole LTV phase (OCSP + CRL + document TS). */
  ltvBudgetMs: number;
  /** Per-request timeout inside the LTV phase. */
  ltvTimeoutMs: number;
  /** AGGREGATE ceiling for the AIA caIssuers fallback walk. */
  aiaBudgetMs: number;
  /** Per-hop timeout inside the AIA fallback walk. */
  aiaTimeoutMs: number;
  /** Σ of the independent phases — must stay below the document budget. */
  totalMs: number;
}

/**
 * Split `docTimeoutMs` (a document's signing budget) into network timeouts whose
 * SUM is strictly smaller than it. Pure function of the budget, so the caller
 * cannot accidentally hand the worker a bigger network allowance than the
 * document has time for.
 *
 * No lower clamp on purpose: for an absurdly small budget (tests pass
 * `signTimeoutMs: 30`) the shares stay proportional and the signer simply skips
 * legs it cannot serve — see its MIN_LEG_TIMEOUT_MS. Clamping up here would be
 * the very inversion this function exists to prevent.
 */
export function deriveNetworkBudget(docTimeoutMs: number): NetworkBudget {
  const network = Math.floor(Math.max(0, docTimeoutMs) * NETWORK_BUDGET_FRACTION_OF_DOC);
  const tsaTimeoutMs = Math.floor(network * TSA_SHARE_OF_NETWORK_BUDGET);
  const aiaBudgetMs = Math.floor(network * AIA_SHARE_OF_NETWORK_BUDGET);
  const aiaTimeoutMs = Math.floor(aiaBudgetMs / AIA_EXPECTED_REQUEST_LEGS);
  const ltvBudgetMs = network - tsaTimeoutMs - aiaBudgetMs;
  const ltvTimeoutMs = Math.floor(ltvBudgetMs / LTV_EXPECTED_REQUEST_LEGS);
  return {
    tsaTimeoutMs,
    ltvBudgetMs,
    ltvTimeoutMs,
    aiaBudgetMs,
    aiaTimeoutMs,
    totalMs: tsaTimeoutMs + ltvBudgetMs + aiaBudgetMs,
  };
}

/**
 * Fail fast at module load if the derived network budget ever reaches the
 * document budget — checked against the SMALLEST budget the single-document
 * timeout policy can produce (`TIMEOUT_BASE_MS`), which is the worst case.
 * Mirrors `sign-queue.ts`'s own assert for the session/batch path's smallest
 * budget (`SESSION_TIMEOUT_BASE_MS`) — the two policies differ, so each layer
 * checks its own floor.
 */
function assertNetworkBudgetFitsTimeoutBudget(): void {
  const worst = deriveNetworkBudget(TIMEOUT_BASE_MS);
  if (worst.totalMs >= TIMEOUT_BASE_MS) {
    throw new Error(
      `Network budget (${worst.totalMs}ms) does not fit inside the smallest document budget (${TIMEOUT_BASE_MS}ms): a network stall would surface as a document timeout.`,
    );
  }
}
assertNetworkBudgetFitsTimeoutBudget();

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
  /**
   * F6 — request an RFC 3161 timestamp for the signature. Default `true` when
   * undefined (caller is expected to forward the persisted user setting). When
   * `false`, the worker skips TSA exchange and the returned `timestamp` meta is
   * `{ ok: false, reason: 'disabled' }`.
   */
  timestampEnabled?: boolean;
  /** F6 — override the TSA endpoint URL (default https://freetsa.org/tsr). */
  tsaUrl?: string;
  /** F6 — override the TSA fetch timeout (default 8000 ms). */
  tsaTimeoutMs?: number;
  /** F7 — request DSS (B-LT). Default true. */
  ltvEnabled?: boolean;
  /** F7 — request document timestamp (B-LTA). Default true; ignored when ltvEnabled is false. */
  ltvArchiveEnabled?: boolean;
  /** F7 — override OCSP/CRL fetch timeout (ms). Default 8000. */
  ltvTimeoutMs?: number;
  /** F7 — OCSP URL override (empty / undefined = AIA discovery). */
  ocspUrl?: string;
}

/** F6 — runSign now resolves with the signed PDF plus the timestamp metadata. F7 — adds ltv. */
export interface RunSignResult {
  signedPdf: Uint8Array;
  timestamp: TimestampMeta;
  /** F7 — long-term validation outcome (profile, warnings, embedded counts). */
  ltv: LtvMeta;
  /**
   * F1 — true iff the embedded intermediate chain reaches a self-signed
   * root. `null` when the worker didn't report it (older cached bundle) —
   * treat as "unknown", not as a warning.
   */
  chainComplete: boolean | null;
  /** Set when `chainComplete` is `false`: DN of the unresolved issuer. */
  missingIssuerDn?: string;
}

/** Re-export type users may need on the call site. */
export type { LtvMeta, SigAlg, TimestampMeta, VisibleSigSpec };

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
): Promise<RunSignResult> {
  const worker = workerFactory();
  const timeoutMs = opts.timeoutMs ?? computeSignTimeoutMs(pdf.byteLength);
  // 2026-08-05 HIGH fix — derive the AIA fallback's share of this document's
  // network budget the same way the batch path does (deriveNetworkBudget),
  // so a hung AIA responder degrades to "chain incomplete" instead of
  // consuming the full per-hop timeout on all 8 possible hops and blowing
  // past `timeoutMs` (the external timer armed below, which discards the
  // whole signature — see `onError`/`timer`).
  const networkBudget = deriveNetworkBudget(timeoutMs);

  return new Promise<RunSignResult>((resolve, reject) => {
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
              chainComplete: msg.chainComplete ?? null,
              ...(msg.missingIssuerDn !== undefined
                ? { missingIssuerDn: msg.missingIssuerDn }
                : {}),
            }),
          );
          return;
        case 'error':
          settle(() => reject(new WorkerSignerError(msg.code, msg.message)));
          return;
      }
    };

    const onError = (ev: ErrorEvent): void => {
      settle(() => reject(new WorkerSignerError('worker_error', ev.message || 'worker crashed')));
    };

    const onMessageError = (): void => {
      settle(() =>
        reject(new WorkerSignerError('messageerror', 'worker postMessage deserialisation failed')),
      );
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);

    // Arm the timeout BEFORE posting — covers the (rare) postMessage hang case too.
    timer = setTimeout(() => {
      settle(() =>
        reject(new WorkerSignerError('timeout', `Worker did not complete within ${timeoutMs}ms`)),
      );
    }, timeoutMs);

    const requestOpts: SignRequestOptions = {
      ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
      ...(opts.location !== undefined ? { location: opts.location } : {}),
      ...(opts.contactInfo !== undefined ? { contactInfo: opts.contactInfo } : {}),
      ...(opts.signingTime !== undefined ? { signingTime: opts.signingTime.getTime() } : {}),
      ...(opts.sigAlg !== undefined ? { sigAlg: opts.sigAlg } : {}),
      ...(opts.visibleSig !== undefined ? { visibleSig: toPlainVisibleSig(opts.visibleSig) } : {}),
    };

    const req: SignRequest = {
      kind: 'sign',
      pdf,
      p12,
      pin,
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
      aiaTimeoutMs: networkBudget.aiaTimeoutMs,
      aiaBudgetMs: networkBudget.aiaBudgetMs,
    };

    try {
      worker.postMessage(req, [pdf, p12]);
    } catch (e) {
      settle(() => reject(new WorkerSignerError('post_failed', (e as Error).message)));
    }
  });
}
