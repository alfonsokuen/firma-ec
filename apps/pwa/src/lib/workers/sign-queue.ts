/**
 * sign-queue.ts — batch-signing queue: N `File` handles → N signed PDFs,
 * built ON TOP of the session bus (sign-session-bus.ts). Never a chunk in
 * the single-shot `runSign` path — `sw.ts` / the SW caching strategy is
 * untouched by this module.
 *
 * Design invariants (see task spec):
 *   - Concurrency strictly 1. CPU-bound signing; only one document's bytes
 *     are ever held in memory as an ArrayBuffer at a time. The queue holds
 *     `File` handles (lazy — bytes are read from disk/blob storage only
 *     right before that item's turn), never pre-reads the whole batch.
 *   - Partial failure is explicit and non-fatal to the batch: a failed item
 *     is recorded with its error and the queue moves on to the next file.
 *   - A declared limit (MAX_BATCH_FILES / MAX_BATCH_FILE_SIZE_BYTES)
 *     rejects up-front with a clear error — no work starts, no OOM risk.
 *   - TSA throttling: a rate-limited/timeout/network/malformed/rejected
 *     timestamp is retried with backoff. If it never recovers, the SIGNED
 *     document still ships without a timestamp (B-B/B-T degrades gracefully,
 *     same contract `@firma-ec/signer` already guarantees for a single
 *     document) — the batch is never blocked on TSA availability.
 *   - Partial degradation is REPORTED, never silent: every signed item carries a
 *     `BatchItemOutcome` and the batch result separates clean successes from
 *     degraded ones. A B-B document passing for a good one is the single most
 *     expensive failure mode of a batch (see BatchItemOutcome).
 *   - A killed session is reopened (up to `MAX_SESSION_REOPENS`) instead of
 *     aborting the remaining documents — CLOSING the old one first, so no dead
 *     worker keeps the decrypted PKCS#8 alive — and per-batch circuit breakers
 *     stop paying for a leg that has already proved dead: the network ones (LTV,
 *     TSA) and the DELIVERY one, which stops a batch whose signed documents
 *     cannot be handed over (a full ZIP) before the retained lifelines exhaust
 *     the tab's memory.
 *   - The batch is CANCELLABLE (`opts.signal`), checked at the top of each turn
 *     so no document is ever abandoned half-signed. Cancelled documents get
 *     their own status, never `failed`: nothing broke, the user stopped.
 *
 * ⚠️ KNOWN DEBT — retrying the TSA re-signs the whole document.
 *   A retry here goes through `session.signNext` again, so to obtain a single
 *   RFC 3161 token the document is hashed, a fresh PKCS#7 is built and the DSS
 *   is rebuilt from scratch. In a 200-document batch with 3 attempts each that is
 *   up to 600 signatures and 600 round trips for work that could be one extra
 *   TSA request over the SAME signature.
 *   Fixing it properly means a "timestamp an existing signature" entry point in
 *   `@firma-ec/signer`, i.e. touching the green signing path — deliberately NOT
 *   done here. Mitigations in place instead: backoffs sized for a rate limit
 *   (seconds, with jitter) and the TSA circuit breaker, which caps the damage of
 *   a responder that is simply down.
 */

import type { RunSignOptions, RunSignResult, SignProgressStage } from './sign-bus';
import {
  type OpenSignSessionOptions,
  SESSION_TIMEOUT_BASE_MS,
  SignNeedsReviewError,
  type SignNextOptions,
  type SignSession,
  SignSessionError,
  type VisibleSigAuto,
  computeSignSessionTimeoutMs,
  maxPdfBytesWithinSignTimeout,
  openSignSession,
} from './sign-session-bus';

// ---------- Limits (named constants — never magic numbers) ----------

/** Maximum number of files accepted in a single batch. */
export const MAX_BATCH_FILES = 200;

/**
 * Maximum size (bytes) accepted for any single file in a batch.
 *
 * Bound by the signing TIMEOUT policy, not by taste: `computeSignSessionTimeoutMs`
 * grants 15s + 1ms/KB capped at 60s, so anything above
 * `maxPdfBytesWithinSignTimeout()` (~43.9 MB) would be declared valid here and
 * then fail on timeout by construction — worse on mobile. The previous 100 MB
 * was exactly that incoherence (100 MB needs ~117s, got 60s). 40 MB is a round
 * value comfortably inside the budget; `assertLimitFitsTimeoutBudget` below
 * keeps the two from drifting apart again.
 */
export const MAX_BATCH_FILE_SIZE_BYTES = 40 * 1024 * 1024; // 40 MB

/**
 * Fail fast at module load if the declared size limit ever exceeds what the
 * timeout policy can serve (e.g. someone bumps one constant and not the other).
 */
function assertLimitFitsTimeoutBudget(): void {
  const budget = maxPdfBytesWithinSignTimeout();
  if (MAX_BATCH_FILE_SIZE_BYTES > budget) {
    throw new Error(
      `MAX_BATCH_FILE_SIZE_BYTES (${MAX_BATCH_FILE_SIZE_BYTES}) exceeds the sign timeout budget (${budget} bytes): such a file would be accepted and then time out.`,
    );
  }
}
assertLimitFitsTimeoutBudget();

// ---------- Network budget (defect #1: network < document, provably) ----------

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
 * degradation, and one document aborted the entire batch.
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

/** Network timeouts for one document, all derived from its signing budget. */
export interface NetworkBudget {
  /** Per-request timeout for the RFC 3161 timestamp. */
  tsaTimeoutMs: number;
  /** AGGREGATE ceiling for the whole LTV phase (OCSP + CRL + document TS). */
  ltvBudgetMs: number;
  /** Per-request timeout inside the LTV phase. */
  ltvTimeoutMs: number;
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
  const ltvBudgetMs = network - tsaTimeoutMs;
  const ltvTimeoutMs = Math.floor(ltvBudgetMs / LTV_EXPECTED_REQUEST_LEGS);
  return { tsaTimeoutMs, ltvBudgetMs, ltvTimeoutMs, totalMs: tsaTimeoutMs + ltvBudgetMs };
}

/**
 * Fail fast at module load if the derived network budget ever reaches the
 * document budget — checked against the SMALLEST budget the timeout policy can
 * produce, which is the worst case.
 */
function assertNetworkBudgetFitsTimeoutBudget(): void {
  const worst = deriveNetworkBudget(SESSION_TIMEOUT_BASE_MS);
  if (worst.totalMs >= SESSION_TIMEOUT_BASE_MS) {
    throw new Error(
      `Network budget (${worst.totalMs}ms) does not fit inside the smallest document budget (${SESSION_TIMEOUT_BASE_MS}ms): a network stall would surface as a document timeout.`,
    );
  }
}
assertNetworkBudgetFitsTimeoutBudget();

/**
 * Failure codes that mean the SESSION itself is gone (its worker was killed),
 * not just that one document failed. Once one of these shows up, no further
 * document can be signed with this session — the PIN travelled once and is not
 * retained, so it cannot be reopened silently.
 */
const SESSION_FATAL_CODES = new Set([
  'timeout',
  'session_closed',
  'worker_error',
  'messageerror',
  'post_failed',
]);

// ---------- TSA retry policy ----------

/** Timestamp failure reasons worth retrying (transient / rate-limit shaped). */
const RETRYABLE_TSA_REASONS = new Set([
  'timeout',
  'rate_limited',
  'malformed',
  'rejected',
  'network',
]);

/** Default number of signNext attempts for one document when TSA keeps failing. */
const DEFAULT_TSA_MAX_ATTEMPTS = 3;

/**
 * Default backoff (ms) between attempts — index 0 = wait before attempt #2, etc.
 *
 * Seconds, not the previous 500/1500 ms: the failure being retried is a
 * RATE LIMIT on a free TSA (freetsa.org), and hammering it back within half a
 * second is what earns the next 429. See {@link jitter} for why they are not
 * fixed values, and the TSA-retry note in this module's header for the debt that
 * makes each retry expensive.
 */
const DEFAULT_TSA_RETRY_BACKOFFS_MS = [2_000, 6_000];

/**
 * ±25% randomisation applied to every backoff.
 *
 * Without it, N documents that hit the rate limit at the same moment retry in
 * lockstep for the whole batch — a self-inflicted thundering herd against a
 * single free responder.
 */
const TSA_BACKOFF_JITTER_FRACTION = 0.25;

function jitter(delayMs: number): number {
  const spread = delayMs * TSA_BACKOFF_JITTER_FRACTION;
  return Math.max(0, Math.round(delayMs - spread + Math.random() * 2 * spread));
}

// ---------- Per-batch circuit breakers ----------

/**
 * LTV warning codes that mean the revocation network did not answer inside the
 * budget. The FIRST one opens the LTV breaker for the rest of the batch: a dead
 * responder must not cost the per-document LTV budget × N documents, and 200
 * pointless waits is exactly how a batch became unusable in practice.
 */
const LTV_STALL_WARNING_CODES = new Set([
  'ocsp_timeout',
  'crl_timeout',
  'ltv_deadline_exceeded',
  'lta_deadline_exceeded',
]);

/**
 * Consecutive documents whose TSA retries were exhausted before the batch stops
 * retrying the TSA at all. Two, because one document can be unlucky (a single
 * 429) while two in a row means the responder is down or is rate-limiting US —
 * and from there every extra attempt is a guaranteed loss paid N times.
 */
const TSA_BREAKER_CONSECUTIVE_EXHAUSTIONS = 2;

/** Warning added to an item that was signed with the LTV leg skipped by the breaker. */
const LTV_CIRCUIT_OPEN_WARNING = 'ltv_skipped_circuit_open';
/** Warning added to an item signed while TSA retries were disabled by the breaker. */
const TSA_CIRCUIT_OPEN_WARNING = 'tsa_retries_disabled_circuit_open';

/**
 * Maximum times one batch may REOPEN its signing session after a session-fatal
 * failure (defect #2).
 *
 * `runBatchSign` holds the .p12 and the PIN, so a killed worker is recoverable:
 * document 1 timing out must not abort documents 2..200. Two, because reopening
 * re-parses the PFX (1-3s on mid-tier mobile, per p12.worker.ts) and a third
 * consecutive death means the problem is systemic — a batch of 200 must not
 * become a retry storm.
 */
export const MAX_SESSION_REOPENS = 2;

/**
 * Códigos de entrega que significan "el destino está LLENO", no "esta escritura
 * salió mal" (defecto D6). Son los de `BatchZipCapacityError` en
 * `apps/pwa/src/lib/export/batchZip.ts`.
 *
 * Se duplican como literales en vez de importar la clase porque la dirección de
 * dependencia es `batchZip → sign-queue`, nunca al revés: importarla aquí
 * cerraría el ciclo. Si allí cambian, este set deja de disparar y sólo queda la
 * regla de {@link DELIVERY_BREAKER_CONSECUTIVE_FAILURES} — degradación, no
 * fallo mudo, pero deuda a vigilar igual que la de `autoPlacement.ts`.
 */
// Exportado SOLO para que el test pueda atarlo a los códigos reales de
// `BatchZipCapacityError` sin cerrar el ciclo de dependencia en runtime (el
// test importa de los dos módulos; `sign-queue.ts` no importa de `batchZip.ts`).
export const DELIVERY_FATAL_CODES = new Set(['zip_total_too_large', 'zip_too_many_entries']);

/**
 * Fallos de entrega CONSECUTIVOS antes de parar el lote.
 *
 * Un documento puede tener mala suerte (una escritura que se cayó sola); dos
 * seguidos significan que el destino no admite más. Y aquí seguir cuesta caro de
 * verdad: cada fallo de entrega RETIENE los bytes firmados como salvavidas
 * (`item.result`), así que insistir con el ZIP lleno acumula un PDF firmado por
 * documento restante hasta matar la pestaña por memoria — el propio salvavidas
 * convertido en fuga. Dos, igual que {@link TSA_BREAKER_CONSECUTIVE_EXHAUSTIONS}.
 */
const DELIVERY_BREAKER_CONSECUTIVE_FAILURES = 2;

// ---------- Errors ----------

/** Fallback code when an unknown throwable carries no usable identity. */
const UNKNOWN_ERROR_CODE = 'unknown';

/**
 * A reportable `{ code, message }` for anything that can be thrown.
 *
 * Defect #10: `DOMException.code` is a NUMBER (8 = NOT_FOUND_ERR, 22 =
 * QUOTA_EXCEEDED_ERR…), so reading `.code` blindly put a number in a field typed
 * `string`, threw away `err.name` — the only actionable part for a human — and
 * let a numeric value flow into code comparisons. The name is the code here, and
 * the numeric one is preserved in the message rather than dropped.
 */
function describeError(e: unknown): { code: string; message: string } {
  const err = e as { code?: unknown; name?: unknown; message?: unknown };
  const rawCode = err?.code;
  const name = typeof err?.name === 'string' && err.name.length > 0 ? err.name : undefined;
  const baseMessage =
    typeof err?.message === 'string' && err.message.length > 0 ? err.message : String(e);

  if (typeof rawCode === 'string' && rawCode.length > 0) {
    return { code: rawCode, message: baseMessage };
  }
  if (typeof rawCode === 'number') {
    return {
      code: name ?? UNKNOWN_ERROR_CODE,
      message: `${baseMessage} (numeric code ${rawCode})`,
    };
  }
  return { code: name ?? UNKNOWN_ERROR_CODE, message: baseMessage };
}

/**
 * Does this failure PROVE the session is gone?
 *
 * Defect #4: this used to be a bare `SESSION_FATAL_CODES.has(err.code)`, so any
 * error that happened to carry `code: 'timeout'` — a File read, the caller's
 * persistence layer — declared a healthy session dead and aborted the rest of
 * the batch. Only the session bus mints {@link SignSessionError}; nobody else
 * gets to make that claim.
 */
function isSessionFatal(e: unknown): boolean {
  return e instanceof SignSessionError && SESSION_FATAL_CODES.has(e.code);
}

export type BatchLimitErrorCode = 'too_many_files' | 'file_too_large';

export class BatchLimitError extends Error {
  /**
   * Nombres de los documentos implicados, para que la UI pueda señalarlos.
   *
   * Van en un campo aparte y NO dentro de `message` (defecto D5b): el nombre de
   * un fichero es dato del usuario y un `Error` acaba en cualquier manejador
   * global — un `window.onerror`, una consola compartida, el informe de fallo que
   * alguien pegue en un chat. Es el mismo argumento que ya defiende
   * `batchZip.ts:230-233`, que este constructor incumplía. Sólo lo lee quien
   * decide mostrarlo.
   */
  readonly fileNames: readonly string[];

  constructor(
    public readonly code: BatchLimitErrorCode,
    message: string,
    fileNames: readonly string[] = [],
  ) {
    super(message);
    this.name = 'BatchLimitError';
    this.fileNames = fileNames;
  }
}

// ---------- Queue item model ----------

/**
 * `'cancelled'` es un estado PROPIO y no un `'failed'` (defecto D5a): el
 * documento está intacto, nadie lo intentó y no hay nada que arreglar — sólo
 * que el usuario paró el lote. Contarlo como fallo haría que un lote sano
 * pareciera roto y empujaría a reintentarlo entero.
 */
export type BatchItemStatus =
  | 'pending'
  | 'signing'
  | 'done'
  | 'failed'
  | 'needs_review'
  | 'cancelled';

export interface BatchQueueItem {
  readonly id: string;
  readonly file: File;
  status: BatchItemStatus;
  /**
   * The signed document — present ONLY when no {@link BatchSignOptions.onItemSigned}
   * callback was supplied. With the callback, the result is handed over per
   * document and this field is left `undefined` so the queue holds no signed
   * bytes (see the memory note on {@link runBatchSign}).
   */
  result?: RunSignResult;
  error?: { code: string; message: string };
  /**
   * Set when the document was SIGNED but handing it to
   * {@link BatchSignOptions.onItemSigned} failed (full disk, IndexedDB quota, a
   * caller bug). `status` stays `'done'` — the signature succeeded — and
   * {@link result} is preserved as a lifeline so the write can be retried
   * without signing again. Never implies anything about the session.
   */
  deliveryError?: { code: string; message: string };
  /**
   * Set when `status` is `'needs_review'`: the automatic placement could not
   * decide a defensible rect, so the document was NOT signed and is waiting for
   * a human to place the signature. Carries the page and the stable reason from
   * `computeAutoPlacement` so the UI can say WHY.
   */
  needsReview?: { page: number; reason: string };
  /**
   * Set for every SIGNED document (status `'done'`), independently of whether
   * {@link result} was retained. See {@link BatchItemOutcome}.
   */
  outcome?: BatchItemOutcome;
}

/**
 * What a signed document actually ACHIEVED, kept on the item whether or not its
 * bytes were retained (defect #5).
 *
 * `succeeded` alone hides the difference between a B-LTA document and a bare B-B
 * one with no timestamp. With `onItemSigned` the result is handed over and
 * released, so without this there is nothing left to tell them apart: 180 PDFs
 * without a timestamp look exactly like 180 good ones, and the problem shows up
 * months later when the receiver validates and the certificate has expired.
 */
export interface BatchItemOutcome {
  /** An RFC 3161 timestamp is embedded. */
  timestampOk: boolean;
  /** Why not, when `timestampOk` is false (`rate_limited`, `timeout`, `user_disabled`…). */
  timestampReason?: string;
  /** Profile actually achieved: 'B-B' | 'B-T' | 'B-LT' | 'B-LTA'. */
  ltvProfile: string;
  longTermAchieved: boolean;
  archiveAchieved: boolean;
  /**
   * True when the document got LESS than what was requested. Not "less than
   * perfect": a user who turned the timestamp off is NOT degraded.
   */
  degraded: boolean;
  /** LTV warnings, which is where the network cause is named (`ocsp_timeout`…). */
  warnings: Array<{ code: string; detail?: string }>;
}

/** One signed document, handed to the caller the moment it is ready. */
export interface SignedBatchItem {
  readonly id: string;
  readonly file: File;
  readonly result: RunSignResult;
}

export interface RunBatchSignResult {
  items: BatchQueueItem[];
  succeeded: number;
  failed: number;
  /**
   * Documentos apartados por la colocación automática (`visibleSig: 'auto'`):
   * el rect que salía no era defendible, así que NO se firmaron.
   *
   * Es un contador PROPIO, ni `succeeded` ni `failed`, porque no es ninguna de
   * las dos cosas: el documento está intacto y el lote siguió su curso — lo que
   * falta es que un humano coloque la firma. Sumarlo a `failed` haría que un
   * lote sano pareciera roto y empujaría a reintentarlo entero (que volvería a
   * dar el mismo resultado); sumarlo a `succeeded` mentiría diciendo que hay un
   * PDF firmado que no existe. `succeeded + failed + needsReview` = total
   * intentado.
   */
  needsReview: number;
  /**
   * How many of the `succeeded` documents got LESS than was requested (no
   * timestamp, no revocation data…). `succeeded - succeededDegraded` is the
   * clean count. A caller that shows only `succeeded` is hiding defect #5.
   */
  succeededDegraded: number;
  /**
   * Documentos que nunca se intentaron porque el lote se canceló (defecto D5a).
   * Contador propio por la misma razón que {@link needsReview}: ni éxito ni
   * fallo. `succeeded + failed + needsReview + cancelled` = total del lote.
   */
  cancelled: number;
}

export interface BatchSignOptions
  extends Omit<RunSignOptions, 'onProgress' | 'timeoutMs' | 'visibleSig'> {
  /**
   * Firma visible del lote: un rect fijo para TODOS los documentos, o
   * `'auto'` ({@link VisibleSigAuto}) para calcularlo POR DOCUMENTO.
   *
   * Un solo rect no puede ser correcto en un lote heterogéneo (páginas de
   * distinto tamaño, rotadas, con `CropBox` menor que el `MediaBox`, o con un
   * campo de firma ya declarado), y la firma visible automática es el default de
   * producto — antes no era expresable. Con `'auto'`, el worker analiza cada
   * documento y coloca según su propia geometría; el que no admita una
   * colocación defendible se aparta con estado `'needs_review'` (ver
   * {@link RunBatchSignResult.needsReview}) y el lote continúa.
   */
  visibleSig?: RunSignOptions['visibleSig'] | VisibleSigAuto;
  /**
   * Rect confirmado para UN documento concreto, con la clave puesta en su
   * posición dentro de `files`. Lo que hay en el mapa gana sobre
   * {@link visibleSig} — y solo para ese documento; los demás siguen con lo que
   * pida el lote.
   *
   * Sin esto, «estos 47 en automático y estos 3 donde una persona los puso» no
   * se puede decir: `visibleSig` es del lote entero. La vista previa se puede
   * pintar sin este canal, pero su resultado no tendría por dónde llegar al
   * firmante.
   *
   * La clave es el ÍNDICE, no el nombre del fichero: el nombre de un documento
   * es dato del usuario, y además dos ficheros pueden llamarse igual — colisión
   * que estamparía en un documento el sitio confirmado para otro.
   *
   * Un índice que no exista en el lote se ignora en silencio, que es el
   * comportamiento seguro: el documento cae a la colocación automática, no al
   * rect de un vecino.
   */
  visibleSigByIndex?: ReadonlyMap<number, NonNullable<RunSignOptions['visibleSig']>>;
  /** Fired whenever an item's status/result/error changes. */
  onItemUpdate?: (item: Readonly<BatchQueueItem>) => void;
  /**
   * Fired once per SUCCESSFULLY signed document, with its bytes. Supplying this
   * turns the queue into a streaming pipeline: the result is transferred to the
   * caller (persist it, download it, hand it to the UI) and the queue then drops
   * its reference, so a 200-document batch never holds more than one signed PDF
   * at a time. Awaited, so a caller that writes to disk/IDB can apply
   * backpressure before the next document starts.
   */
  onItemSigned?: (item: SignedBatchItem) => void | Promise<void>;
  /**
   * Per-document signing timeout (ms). Defaults to the size-derived budget of
   * `computeSignSessionTimeoutMs` — override only with good reason (tests).
   */
  signTimeoutMs?: number;
  /** Fired for coarse per-document progress stages (parse_pdf, sign, ...). */
  onItemProgress?: (itemId: string, stage: SignProgressStage) => void;
  /** Override how many signNext attempts a TSA-retry sequence gets. Default 3. */
  tsaMaxAttempts?: number;
  /** Override the backoff delays (ms) between TSA retry attempts. */
  tsaRetryBackoffsMs?: number[];
  /** Passed through to openSignSession (mostly for tests). */
  openSessionTimeoutMs?: OpenSignSessionOptions['timeoutMs'];
  /** How long to wait for the worker's wipe ack on teardown (mostly for tests). */
  closeAckTimeoutMs?: number;
  /**
   * Señal de parada del lote (defecto D5a). Se consulta al PRINCIPIO de cada
   * vuelta, nunca a mitad de un documento: abortar un `signNext` en curso
   * dejaría el worker firmando con el búfer descifrado vivo, que es justo lo que
   * el resto de este módulo evita. Los documentos restantes quedan
   * `'cancelled'` y el teardown (wipe + borrado de la copia del .p12) corre
   * igual, porque vive en el `finally`.
   */
  signal?: AbortSignal;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableTsaFailure(result: RunSignResult, timestampRequested: boolean): boolean {
  if (!timestampRequested) return false;
  if (result.timestamp.ok) return false;
  const reason = result.timestamp.reason;
  return reason !== undefined && RETRYABLE_TSA_REASONS.has(reason);
}

/**
 * Per-batch overrides imposed by the circuit breakers. Kept apart from
 * {@link BatchSignOptions} on purpose: these are decisions the RUN made after
 * watching the network fail, not something the caller asked for.
 */
interface BreakerOverrides {
  /** Skip the revocation leg entirely (LTV breaker open). */
  ltvEnabled?: false;
  /** Cap the attempts for this document (TSA breaker open ⇒ 1, no retries). */
  tsaMaxAttempts?: number;
}

async function signOneWithTsaRetry(
  session: SignSession,
  file: File,
  itemId: string,
  /** Posición del documento en el lote: la clave de {@link BatchSignOptions.visibleSigByIndex}. */
  itemIndex: number,
  opts: BatchSignOptions,
  breakers: BreakerOverrides = {},
): Promise<RunSignResult> {
  const maxAttempts = Math.max(
    1,
    breakers.tsaMaxAttempts ?? opts.tsaMaxAttempts ?? DEFAULT_TSA_MAX_ATTEMPTS,
  );
  const backoffs = opts.tsaRetryBackoffsMs ?? DEFAULT_TSA_RETRY_BACKOFFS_MS;
  const timestampRequested = opts.timestampEnabled !== false;

  // Defect #1: the network allowance is DERIVED from this document's own signing
  // budget, and a caller-supplied timeout can only ever lower it (Math.min).
  // Honouring an 8s TSA timeout from the settings store against a 15s document
  // budget is exactly how a stalled responder became a `timeout` that killed the
  // batch instead of a reported degradation.
  const docTimeoutMs = opts.signTimeoutMs ?? computeSignSessionTimeoutMs(file.size);
  const budget = deriveNetworkBudget(docTimeoutMs);
  const tsaTimeoutMs = Math.min(opts.tsaTimeoutMs ?? budget.tsaTimeoutMs, budget.tsaTimeoutMs);
  const ltvTimeoutMs = Math.min(opts.ltvTimeoutMs ?? budget.ltvTimeoutMs, budget.ltvTimeoutMs);

  // El rect que una persona confirmó para ESTE documento sustituye al del lote.
  // Se resuelve una vez, fuera del closure de reintentos: los reintentos de TSA
  // repiten el MISMO documento, y que la colocación pudiera moverse entre
  // intentos sería un fallo imposible de reproducir.
  const visibleSigForThisDoc = opts.visibleSigByIndex?.get(itemIndex) ?? opts.visibleSig;

  const signOptsForRequest = (): SignNextOptions => ({
    ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
    ...(opts.location !== undefined ? { location: opts.location } : {}),
    ...(opts.contactInfo !== undefined ? { contactInfo: opts.contactInfo } : {}),
    ...(opts.signingTime !== undefined ? { signingTime: opts.signingTime } : {}),
    ...(opts.sigAlg !== undefined ? { sigAlg: opts.sigAlg } : {}),
    ...(visibleSigForThisDoc !== undefined ? { visibleSig: visibleSigForThisDoc } : {}),
    ...(opts.timestampEnabled !== undefined ? { timestampEnabled: opts.timestampEnabled } : {}),
    ...(opts.tsaUrl !== undefined ? { tsaUrl: opts.tsaUrl } : {}),
    tsaTimeoutMs,
    ...(breakers.ltvEnabled === false
      ? { ltvEnabled: false }
      : opts.ltvEnabled !== undefined
        ? { ltvEnabled: opts.ltvEnabled }
        : {}),
    ...(opts.ltvArchiveEnabled !== undefined ? { ltvArchiveEnabled: opts.ltvArchiveEnabled } : {}),
    ltvTimeoutMs,
    ltvBudgetMs: budget.ltvBudgetMs,
    ...(opts.ocspUrl !== undefined ? { ocspUrl: opts.ocspUrl } : {}),
    ...(opts.signTimeoutMs !== undefined ? { timeoutMs: opts.signTimeoutMs } : {}),
    onProgress: (stage) => opts.onItemProgress?.(itemId, stage),
  });

  let lastResult: RunSignResult | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Re-read the file fresh each attempt: ArrayBuffers are transferred (and
    // thus detached) by signNext, so a retry needs a brand-new buffer — this
    // is also why the queue holds `File` handles rather than pre-read bytes.
    const pdfBuf = await file.arrayBuffer();
    const result = await session.signNext(pdfBuf, signOptsForRequest());
    lastResult = result;
    if (!isRetryableTsaFailure(result, timestampRequested)) {
      return result;
    }
    if (attempt < maxAttempts - 1) {
      const delay = backoffs[Math.min(attempt, backoffs.length - 1)] ?? 0;
      await sleep(jitter(delay));
    }
  }
  // Retries exhausted: the door stays open to "batch without timestamp" —
  // the document IS signed (B-B/B-T degrades gracefully), just without the
  // RFC 3161 token. We never fail the item purely because the free TSA is
  // rate-limiting us.
  return lastResult!;
}

/**
 * Summarise what a signed document achieved, and whether that is LESS than the
 * caller asked for. Requested-vs-achieved, not achieved-vs-ideal: with the
 * timestamp disabled by the user, a B-B document is exactly what was ordered.
 */
function describeOutcome(
  result: RunSignResult,
  opts: BatchSignOptions,
  extraWarnings: Array<{ code: string; detail?: string }> = [],
): BatchItemOutcome {
  const timestampRequested = opts.timestampEnabled !== false;
  const ltRequested = opts.ltvEnabled !== false;
  const ltaRequested = ltRequested && opts.ltvArchiveEnabled !== false;

  const ltv = result.ltv;
  const timestampOk = result.timestamp.ok === true;
  const degraded =
    (timestampRequested && !timestampOk) ||
    (ltRequested && !ltv.longTermAchieved) ||
    (ltaRequested && !ltv.archiveAchieved);

  return {
    timestampOk,
    ...(result.timestamp.ok ? {} : { timestampReason: result.timestamp.reason }),
    ltvProfile: ltv.profile,
    longTermAchieved: ltv.longTermAchieved,
    archiveAchieved: ltv.archiveAchieved,
    degraded,
    warnings: [...ltv.warnings, ...extraWarnings],
  };
}

function validateBatch(files: File[]): void {
  if (files.length > MAX_BATCH_FILES) {
    throw new BatchLimitError(
      'too_many_files',
      `El lote tiene ${files.length} archivos; el máximo permitido es ${MAX_BATCH_FILES}.`,
    );
  }
  const oversized = files.filter((f) => f.size > MAX_BATCH_FILE_SIZE_BYTES);
  if (oversized.length > 0) {
    throw new BatchLimitError(
      'file_too_large',
      `${oversized.length} archivo(s) superan el máximo de ${MAX_BATCH_FILE_SIZE_BYTES / (1024 * 1024)} MB.`,
      oversized.map((f) => f.name),
    );
  }
}

/**
 * Test-only observer for the retained container copy (see the `p12Master` note
 * inside {@link runBatchSign}). The copy never leaves this module, so without a
 * seam there is no way to ASSERT that it is zeroed on the way out — and an
 * unverified security mitigation is an unverified claim, whatever the code says.
 * Same pattern as `__setSignSessionWorkerFactoryForTests`.
 */
let p12CopyObserverForTests: ((copy: Uint8Array) => void) | null = null;

/** Test-only: observe the retained .p12 copy. Pass `null` to detach. */
export function __setP12CopyObserverForTests(f: ((copy: Uint8Array) => void) | null): void {
  p12CopyObserverForTests = f;
}

let itemIdCounter = 0;
function nextItemId(): string {
  itemIdCounter += 1;
  return `batch-item-${itemIdCounter}`;
}

/**
 * Sign a batch of PDFs against ONE .p12/pin, reusing a single worker session
 * (see sign-session-bus.ts) so the PFX is only parsed once. Concurrency 1:
 * files are signed strictly in order, one buffer alive at a time.
 *
 * Never throws for an individual file's signing failure — see `result.items`
 * for per-file outcome. DOES throw `BatchLimitError` synchronously-ish
 * (before any worker session opens) when the batch itself is invalid.
 *
 * **Memory**: the INPUT is lazy (only `File` handles are held; bytes are read
 * one document before its turn). The OUTPUT is not, unless you ask for it:
 *   - with `opts.onItemSigned` — each signed PDF is delivered and released, so
 *     at most ONE signed document is alive at a time. Use this for real batches.
 *   - without it — every `items[].result.signedPdf` is retained until this
 *     function returns, i.e. up to `MAX_BATCH_FILES` signed documents in memory
 *     at once (200 × up to `MAX_BATCH_FILE_SIZE_BYTES`, plus the growth a
 *     signature adds). Kept for compatibility and small batches; it is a real
 *     aggregate bound, not a theoretical one.
 */
export async function runBatchSign(
  files: File[],
  p12: ArrayBuffer,
  pin: string,
  opts: BatchSignOptions = {},
): Promise<RunBatchSignResult> {
  validateBatch(files);

  const items: BatchQueueItem[] = files.map((file) => ({
    id: nextItemId(),
    file,
    status: 'pending',
  }));

  if (items.length === 0) {
    return { items, succeeded: 0, failed: 0, needsReview: 0, succeededDegraded: 0, cancelled: 0 };
  }

  // Defect #2: keep our OWN copy of the container so a killed session can be
  // reopened. `openSignSession` transfers the buffer (detaching the caller's), so
  // a copy has to be taken BEFORE the first open, and each open gets a fresh
  // slice of it. It is the PKCS#12 — encrypted, useless without the PIN — and the
  // PIN is already a parameter of this function; the copy is zeroed on the way
  // out regardless.
  const p12Master = new Uint8Array(p12.byteLength);
  p12Master.set(new Uint8Array(p12));
  p12CopyObserverForTests?.(p12Master);
  const freshP12 = (): ArrayBuffer => p12Master.slice().buffer as ArrayBuffer;

  const openOpts: OpenSignSessionOptions =
    opts.openSessionTimeoutMs !== undefined ? { timeoutMs: opts.openSessionTimeoutMs } : {};
  const closeOpts: { ackTimeoutMs?: number } =
    opts.closeAckTimeoutMs !== undefined ? { ackTimeoutMs: opts.closeAckTimeoutMs } : {};
  let session: SignSession;
  try {
    session = await openSignSession(freshP12(), pin, openOpts);
  } catch (err) {
    // Same guarantee as the `finally` below: la copia retenida no debe
    // sobrevivir a un intento fallido de PIN, que es la salida MÁS común
    // de esta función (QA de seguridad post-merge 2026-08-02).
    p12Master.fill(0);
    throw err;
  }

  try {
    let sessionDead = false;
    /** Why the tail of the batch was abandoned, appended to `session_aborted`. */
    let abortReason = '';
    let reopensUsed = 0;

    /**
     * Reopen the session after a session-fatal failure. Returns false when the
     * reopen budget is spent or the reopen itself failed — then, and only then,
     * the rest of the batch is abandoned.
     */
    const reopenSession = async (): Promise<boolean> => {
      if (reopensUsed >= MAX_SESSION_REOPENS) {
        abortReason = `se agotaron las ${MAX_SESSION_REOPENS} reaperturas de sesión permitidas`;
        return false;
      }
      reopensUsed += 1;
      // Defecto D2: cerrar la sesión VIEJA antes de abrir la nueva. De los
      // códigos session-fatal sólo `timeout` y `session_closed` dejan el worker
      // ya terminado; con `worker_error`, `messageerror` o `post_failed` el hilo
      // sigue vivo reteniendo el PKCS#8 DESCIFRADO, y como abajo se reasigna
      // `session`, el `finally` sólo limpiaba la última — el resto se quedaba con
      // la clave hasta que muriera la pestaña. Un fallo al cerrar no puede
      // impedir la reapertura: se reporta y se sigue.
      const previous = session;
      if (!previous.isClosed) {
        try {
          const wipe = await previous.closeAndWipe(closeOpts);
          if (!wipe.wiped) {
            console.warn(
              `[sign-queue] previous session key material may not have been wiped on reopen (acked=${wipe.acked})`,
            );
          }
        } catch (e) {
          console.warn(`[sign-queue] closing the dead session failed: ${describeError(e).code}`);
        }
      }
      try {
        session = await openSignSession(freshP12(), pin, openOpts);
        return true;
      } catch (e) {
        const described = describeError(e);
        abortReason = `no se pudo reabrir la sesión (${described.code})`;
        return false;
      }
    };

    // Circuit-breaker state for THIS batch (see the constants above).
    let ltvBreakerOpen = false;
    let tsaBreakerOpen = false;
    let tsaExhaustedStreak = 0;
    // Delivery breaker (defect D6). `deliveryDead` stops the batch; the reason
    // is recorded so the tail says WHY it was never signed.
    let deliveryDead = false;
    let deliveryReason = '';
    let deliveryFailureStreak = 0;
    // Con índice: es la clave de `visibleSigByIndex`, y `items` conserva el
    // orden de `files`, que es lo que el llamante numeró al confirmar un rect.
    for (const [itemIndex, item] of items.entries()) {
      // Parada del usuario: se consulta ANTES de leer el fichero o de postear
      // nada, así que el documento queda intacto y el worker, ocioso.
      if (opts.signal?.aborted) {
        item.status = 'cancelled';
        opts.onItemUpdate?.(item);
        continue;
      }

      if (deliveryDead) {
        item.status = 'failed';
        item.error = {
          code: 'delivery_aborted',
          message: `El lote se detuvo porque no se pudieron entregar los documentos firmados${
            deliveryReason ? ` (${deliveryReason})` : ''
          }; este documento no se intentó firmar.`,
        };
        opts.onItemUpdate?.(item);
        continue;
      }

      if (sessionDead) {
        // The worker is gone (see SESSION_FATAL_CODES). Don't read the file or
        // post to a dead worker: record the outcome explicitly and move on, so
        // the caller sees WHY the tail of the batch was not signed.
        item.status = 'failed';
        item.error = {
          code: 'session_aborted',
          message: `La sesión de firma se cerró antes de llegar a este documento; no se intentó firmarlo${
            abortReason ? ` (${abortReason})` : ''
          }.`,
        };
        opts.onItemUpdate?.(item);
        continue;
      }

      item.status = 'signing';
      opts.onItemUpdate?.(item);

      // ---- Phase 1: SIGN ----
      const breakers: BreakerOverrides = {
        ...(ltvBreakerOpen ? { ltvEnabled: false as const } : {}),
        ...(tsaBreakerOpen ? { tsaMaxAttempts: 1 } : {}),
      };
      const breakerWarnings: Array<{ code: string; detail?: string }> = [
        ...(ltvBreakerOpen
          ? [{ code: LTV_CIRCUIT_OPEN_WARNING, detail: 'revocation leg skipped for this batch' }]
          : []),
        ...(tsaBreakerOpen
          ? [{ code: TSA_CIRCUIT_OPEN_WARNING, detail: 'TSA retries disabled for this batch' }]
          : []),
      ];

      let signed: RunSignResult | null = null;
      try {
        signed = await signOneWithTsaRetry(session, item.file, item.id, itemIndex, opts, breakers);
      } catch (e) {
        if (e instanceof SignNeedsReviewError) {
          // No es un fallo: la colocación automática no pudo ubicar la firma en
          // ESTE documento, así que se aparta con su motivo y el lote sigue.
          // Ojo con el orden: este `if` va ANTES de tocar `item.error`, porque un
          // needs_review no debe aparecer como error en la UI.
          item.status = 'needs_review';
          item.needsReview = { page: e.page, reason: e.reason };
          opts.onItemUpdate?.(item);
          continue;
        }
        item.status = 'failed';
        item.error = describeError(e);
        // A per-document failure (bad PDF, revoked cert…) is non-fatal and the
        // batch continues. A session-level failure means the WORKER is gone —
        // but the batch need not be: this function holds the .p12 and the PIN, so
        // it reopens the session and carries on with the NEXT document (defect
        // #2). Only when the reopen budget is spent is the tail abandoned.
        if (isSessionFatal(e) && !(await reopenSession())) sessionDead = true;
      }

      // ---- Circuit breakers: learn from what the network just did ----
      if (signed !== null) {
        const stalled = signed.ltv.warnings.some((wn) => LTV_STALL_WARNING_CODES.has(wn.code));
        if (stalled && !ltvBreakerOpen) {
          ltvBreakerOpen = true;
          // Diagnostic only — no document data, no user data.
          console.warn(
            '[sign-queue] revocation network stalled; skipping the LTV leg for the rest of the batch',
          );
        }
        if (isRetryableTsaFailure(signed, opts.timestampEnabled !== false)) {
          tsaExhaustedStreak += 1;
          if (tsaExhaustedStreak >= TSA_BREAKER_CONSECUTIVE_EXHAUSTIONS && !tsaBreakerOpen) {
            tsaBreakerOpen = true;
            console.warn(
              '[sign-queue] TSA exhausted on consecutive documents; no more retries this batch',
            );
          }
        } else {
          tsaExhaustedStreak = 0;
        }
      }

      // ---- Phase 2: DELIVER (a different phase, with a different meaning) ----
      // Defect #3: this used to live inside the try above, so failing to WRITE a
      // document that was already signed reported it as a signing failure, threw
      // the bytes away, and — with `code:'timeout'` from IndexedDB — killed the
      // session. Nothing here may touch `sessionDead`.
      if (signed !== null) {
        item.status = 'done';
        // Recorded BEFORE any hand-over: the degradation must survive releasing
        // the bytes (defect #5).
        item.outcome = describeOutcome(signed, opts, breakerWarnings);
        if (opts.onItemSigned) {
          try {
            // Hand the bytes over and DON'T keep them: retaining every result is
            // what turns a 200-document batch into a 200-document heap.
            await opts.onItemSigned({ id: item.id, file: item.file, result: signed });
            deliveryFailureStreak = 0;
          } catch (e) {
            const described = describeError(e);
            item.deliveryError = described;
            // Lifeline: keep the signed bytes so the caller can retry the write
            // WITHOUT signing again (a signature costs a PKCS#7 + TSA + OCSP
            // round trip). Bounded by the same aggregate memory note as the
            // no-callback mode, and only for the items that failed to land.
            item.result = signed;
            // ---- Delivery circuit breaker (defect D6) ----
            // Nothing here may touch `sessionDead`: the session is healthy, it
            // is the DESTINATION that is full. But carrying on is not free —
            // every further failure retains another signed PDF (see the lifeline
            // above), so a full ZIP would kill the tab by memory while the log
            // showed a batch signing along nicely.
            deliveryFailureStreak += 1;
            if (DELIVERY_FATAL_CODES.has(described.code)) {
              deliveryDead = true;
              deliveryReason = described.code;
            } else if (deliveryFailureStreak >= DELIVERY_BREAKER_CONSECUTIVE_FAILURES) {
              deliveryDead = true;
              deliveryReason = `${deliveryFailureStreak} entregas consecutivas fallidas (${described.code})`;
            }
            if (deliveryDead) {
              // Diagnostic only — no document data, no user data.
              console.warn(
                `[sign-queue] delivery is failing (${deliveryReason}); stopping the batch instead of signing documents that cannot be delivered`,
              );
            }
          }
        } else {
          item.result = signed;
        }
      }
      opts.onItemUpdate?.(item);
    }
  } finally {
    // Await the worker's wipe ack before it is terminated — `close()` races it.
    // Se salta si la sesión YA está cerrada (un `signNext` que expiró la mató, o
    // la mató `reopenSession` y la reapertura falló): `closeAndWipe` sobre una
    // sesión cerrada devuelve `wiped:false` sin haber intentado nada, y avisar
    // ahí sería una falsa alarma sobre una mitigación de seguridad — la vía más
    // corta para que el aviso deje de mirarse cuando sea de verdad.
    if (!session.isClosed) {
      const wipe = await session.closeAndWipe(closeOpts);
      if (!wipe.wiped) {
        console.warn(
          `[sign-queue] session key material may not have been wiped (acked=${wipe.acked})`,
        );
      }
    }
    // Our retained container copy goes too: it outlived its purpose the moment
    // the last document was attempted.
    p12Master.fill(0);
  }

  const succeeded = items.filter((i) => i.status === 'done').length;
  const failed = items.filter((i) => i.status === 'failed').length;
  const needsReview = items.filter((i) => i.status === 'needs_review').length;
  const cancelled = items.filter((i) => i.status === 'cancelled').length;
  const succeededDegraded = items.filter(
    (i) => i.status === 'done' && i.outcome?.degraded === true,
  ).length;
  return { items, succeeded, failed, needsReview, succeededDegraded, cancelled };
}
