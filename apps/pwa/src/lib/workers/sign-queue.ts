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
import { type OpenSignSessionOptions, type SignSession, openSignSession } from './sign-session-bus';

// ---------- Limits (named constants — never magic numbers) ----------

/** Maximum number of files accepted in a single batch. */
export const MAX_BATCH_FILES = 200;

/** Maximum size (bytes) accepted for any single file in a batch. */
export const MAX_BATCH_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

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
  result?: RunSignResult;
  error?: { code: string; message: string };
}

export interface RunBatchSignResult {
  items: BatchQueueItem[];
  succeeded: number;
  failed: number;
}

export interface BatchSignOptions extends Omit<RunSignOptions, 'onProgress' | 'timeoutMs'> {
  /** Fired whenever an item's status/result/error changes. */
  onItemUpdate?: (item: Readonly<BatchQueueItem>) => void;
  /** Fired for coarse per-document progress stages (parse_pdf, sign, ...). */
  onItemProgress?: (itemId: string, stage: SignProgressStage) => void;
  /** Override how many signNext attempts a TSA-retry sequence gets. Default 3. */
  tsaMaxAttempts?: number;
  /** Override the backoff delays (ms) between TSA retry attempts. */
  tsaRetryBackoffsMs?: number[];
  /** Passed through to openSignSession (mostly for tests). */
  openSessionTimeoutMs?: OpenSignSessionOptions['timeoutMs'];
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
    for (const item of items) {
      item.status = 'signing';
      opts.onItemUpdate?.(item);
      try {
        const result = await signOneWithTsaRetry(session, item.file, item.id, opts);
        item.result = result;
        item.status = 'done';
      } catch (e) {
        const err = e as Error & { code?: string };
        item.status = 'failed';
        item.error = { code: err.code ?? 'unknown', message: err.message ?? String(e) };
      }
      opts.onItemUpdate?.(item);
    }
  } finally {
    session.close();
  }

  const succeeded = items.filter((i) => i.status === 'done').length;
  const failed = items.filter((i) => i.status === 'failed').length;
  return { items, succeeded, failed };
}
