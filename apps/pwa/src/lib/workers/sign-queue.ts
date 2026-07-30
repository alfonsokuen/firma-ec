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
 */

import type { RunSignOptions, RunSignResult, SignProgressStage } from './sign-bus';
import {
  type OpenSignSessionOptions,
  type SignSession,
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

/** Default backoff (ms) between attempts — index 0 = wait before attempt #2, etc. */
const DEFAULT_TSA_RETRY_BACKOFFS_MS = [500, 1500];

// ---------- Errors ----------

export type BatchLimitErrorCode = 'too_many_files' | 'file_too_large';

export class BatchLimitError extends Error {
  constructor(
    public readonly code: BatchLimitErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BatchLimitError';
  }
}

// ---------- Queue item model ----------

export type BatchItemStatus = 'pending' | 'signing' | 'done' | 'failed';

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
}

export interface BatchSignOptions extends Omit<RunSignOptions, 'onProgress' | 'timeoutMs'> {
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

async function signOneWithTsaRetry(
  session: SignSession,
  file: File,
  itemId: string,
  opts: BatchSignOptions,
): Promise<RunSignResult> {
  const maxAttempts = Math.max(1, opts.tsaMaxAttempts ?? DEFAULT_TSA_MAX_ATTEMPTS);
  const backoffs = opts.tsaRetryBackoffsMs ?? DEFAULT_TSA_RETRY_BACKOFFS_MS;
  const timestampRequested = opts.timestampEnabled !== false;

  const signOptsForRequest = (): RunSignOptions => ({
    ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
    ...(opts.location !== undefined ? { location: opts.location } : {}),
    ...(opts.contactInfo !== undefined ? { contactInfo: opts.contactInfo } : {}),
    ...(opts.signingTime !== undefined ? { signingTime: opts.signingTime } : {}),
    ...(opts.sigAlg !== undefined ? { sigAlg: opts.sigAlg } : {}),
    ...(opts.visibleSig !== undefined ? { visibleSig: opts.visibleSig } : {}),
    ...(opts.timestampEnabled !== undefined ? { timestampEnabled: opts.timestampEnabled } : {}),
    ...(opts.tsaUrl !== undefined ? { tsaUrl: opts.tsaUrl } : {}),
    ...(opts.tsaTimeoutMs !== undefined ? { tsaTimeoutMs: opts.tsaTimeoutMs } : {}),
    ...(opts.ltvEnabled !== undefined ? { ltvEnabled: opts.ltvEnabled } : {}),
    ...(opts.ltvArchiveEnabled !== undefined ? { ltvArchiveEnabled: opts.ltvArchiveEnabled } : {}),
    ...(opts.ltvTimeoutMs !== undefined ? { ltvTimeoutMs: opts.ltvTimeoutMs } : {}),
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
      await sleep(delay);
    }
  }
  // Retries exhausted: the door stays open to "batch without timestamp" —
  // the document IS signed (B-B/B-T degrades gracefully), just without the
  // RFC 3161 token. We never fail the item purely because the free TSA is
  // rate-limiting us.
  return lastResult!;
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
    const names = oversized.map((f) => f.name).join(', ');
    throw new BatchLimitError(
      'file_too_large',
      `${oversized.length} archivo(s) superan el máximo de ${MAX_BATCH_FILE_SIZE_BYTES / (1024 * 1024)} MB: ${names}.`,
    );
  }
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
    return { items, succeeded: 0, failed: 0 };
  }

  const session = await openSignSession(p12, pin, {
    ...(opts.openSessionTimeoutMs !== undefined ? { timeoutMs: opts.openSessionTimeoutMs } : {}),
  });

  try {
    let sessionDead = false;
    for (const item of items) {
      if (sessionDead) {
        // The worker is gone (see SESSION_FATAL_CODES). Don't read the file or
        // post to a dead worker: record the outcome explicitly and move on, so
        // the caller sees WHY the tail of the batch was not signed.
        item.status = 'failed';
        item.error = {
          code: 'session_aborted',
          message:
            'La sesión de firma se cerró antes de llegar a este documento; no se intentó firmarlo.',
        };
        opts.onItemUpdate?.(item);
        continue;
      }

      item.status = 'signing';
      opts.onItemUpdate?.(item);
      try {
        const result = await signOneWithTsaRetry(session, item.file, item.id, opts);
        item.status = 'done';
        if (opts.onItemSigned) {
          // Hand the bytes over and DON'T keep them: retaining every result is
          // what turns a 200-document batch into a 200-document heap.
          await opts.onItemSigned({ id: item.id, file: item.file, result });
        } else {
          item.result = result;
        }
      } catch (e) {
        const err = e as Error & { code?: string };
        const code = err.code ?? 'unknown';
        item.status = 'failed';
        item.error = { code, message: err.message ?? String(e) };
        // A per-document failure (bad PDF, revoked cert…) is non-fatal and the
        // batch continues. A session-level failure is not: the worker was
        // terminated, so every later signNext would just reject too.
        if (SESSION_FATAL_CODES.has(code)) sessionDead = true;
      }
      opts.onItemUpdate?.(item);
    }
  } finally {
    // Await the worker's wipe ack before it is terminated — `close()` races it.
    await session.closeAndWipe(
      opts.closeAckTimeoutMs !== undefined ? { ackTimeoutMs: opts.closeAckTimeoutMs } : {},
    );
  }

  const succeeded = items.filter((i) => i.status === 'done').length;
  const failed = items.filter((i) => i.status === 'failed').length;
  return { items, succeeded, failed };
}
