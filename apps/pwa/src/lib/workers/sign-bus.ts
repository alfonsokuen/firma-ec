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
    };

    try {
      worker.postMessage(req, [pdf, p12]);
    } catch (e) {
      settle(() => reject(new WorkerSignerError('post_failed', (e as Error).message)));
    }
  });
}
