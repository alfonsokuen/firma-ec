/**
 * Unit tests for the batch-signing queue (sign-queue.ts).
 *
 * Built ON TOP of sign-session-bus.ts — same FakeSessionWorker substitution
 * pattern used in sign-session-bus.test.ts (`__setSignSessionWorkerFactoryForTests`).
 * The queue itself never talks to a Worker directly; it only calls
 * `openSignSession`/`session.signNext`/`session.close()`.
 *
 * Required scenarios (per plan):
 *   1. Partial failure: 1 corrupt PDF at position 3 of 5 → 4 signed + 1
 *      reported, queue continues (this test must be RED before the
 *      continue-on-error logic exists — verified below).
 *   2. Limit exceeded: more files than MAX_BATCH_FILES → clear error, no crash.
 *   3. TSA backoff: a rate-limited timestamp retries then succeeds; if it
 *      never succeeds, the item still delivers the SIGNED pdf without a
 *      timestamp (door open to "batch without timestamp").
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BatchLimitError,
  MAX_BATCH_FILES,
  MAX_BATCH_FILE_SIZE_BYTES,
  runBatchSign,
} from './sign-queue';
import { __setSignSessionWorkerFactoryForTests } from './sign-session-bus';
import type { SignSessionWorkerResponse } from './sign-session-bus';

class FakeSessionWorker extends EventTarget {
  public readonly postedMessages: unknown[] = [];
  public terminated = 0;

  postMessage(msg: unknown): void {
    this.postedMessages.push(msg);
    // Synchronous notification hook so test drivers can react to a newly
    // posted message without polling on microtask ticks (which is fragile
    // once real `setTimeout` backoffs and `file.arrayBuffer()` awaits are
    // in the mix — see driveSession below).
    this.dispatchEvent(Object.assign(new Event('posted'), { msg }));
  }

  terminate(): void {
    this.terminated += 1;
  }

  emit(data: SignSessionWorkerResponse): void {
    this.dispatchEvent(Object.assign(new Event('message'), { data }));
  }
}

function installFake(): FakeSessionWorker {
  const w = new FakeSessionWorker();
  __setSignSessionWorkerFactoryForTests(() => w as unknown as Worker);
  return w;
}

function makeFile(name: string, sizeBytes = 16): File {
  return new File([new Uint8Array(sizeBytes)], name, { type: 'application/pdf' });
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  __setSignSessionWorkerFactoryForTests(null);
  vi.useRealTimers();
});

/**
 * Drives the fake session worker: auto-opens the session and answers each
 * signNext as it's posted (event-driven — see FakeSessionWorker's 'posted'
 * event — so it survives real `setTimeout` backoffs / `file.arrayBuffer()`
 * awaits without needing to guess microtask-tick counts).
 *
 * `answerFor` is called per-file, once per attempt (retries included), and
 * decides how the fake responds to that attempt. Returns a promise that
 * resolves once `expectedTotalSignNext` signNext messages have been
 * answered (a batch of N files with retries produces > N signNext calls).
 */
function driveSession(
  w: FakeSessionWorker,
  answerFor: (
    fileName: string,
    attemptIndexForFile: number,
  ) =>
    | { kind: 'ok'; timestampOk?: boolean; timestampReason?: string }
    | { kind: 'error'; code: string; message: string },
  fileNameByRequestOrder: string[],
  expectedTotalSignNext: number,
): Promise<void> {
  const attemptCounts = new Map<string, number>();
  let answered = 0;
  let requestCursor = 0;

  return new Promise<void>((resolve) => {
    w.addEventListener('posted', (ev: Event) => {
      const msg = (ev as Event & { msg: unknown }).msg as { kind: string; requestId?: string };
      if (msg.kind === 'openSession') {
        // Reply asynchronously-but-immediately (real microtask) — matches
        // how a real Worker never resolves in the exact same tick.
        Promise.resolve().then(() => w.emit({ kind: 'sessionOpened' }));
        return;
      }
      if (msg.kind !== 'signNext' || !msg.requestId) return;

      const fileName =
        fileNameByRequestOrder[Math.min(requestCursor, fileNameByRequestOrder.length - 1)]!;
      requestCursor += 1;
      const attemptIdx = attemptCounts.get(fileName) ?? 0;
      attemptCounts.set(fileName, attemptIdx + 1);
      const requestId = msg.requestId;

      Promise.resolve().then(() => {
        const answer = answerFor(fileName, attemptIdx);
        if (answer.kind === 'ok') {
          w.emit({
            kind: 'signResult',
            requestId,
            signedPdf: new Uint8Array([1, 2, 3]).buffer,
            timestamp:
              answer.timestampOk === false
                ? {
                    ok: false,
                    reason: (answer.timestampReason as 'rate_limited') ?? 'rate_limited',
                  }
                : { ok: true, tsaUrl: 'https://freetsa.org/tsr' },
          });
        } else {
          w.emit({ kind: 'signError', requestId, code: answer.code, message: answer.message });
        }
        answered += 1;
        if (answered >= expectedTotalSignNext) resolve();
      });
    });
  });
}

describe('runBatchSign — limits', () => {
  it('throws BatchLimitError with a clear message when file count exceeds MAX_BATCH_FILES', async () => {
    const files = Array.from({ length: MAX_BATCH_FILES + 1 }, (_, i) => makeFile(`f${i}.pdf`));
    await expect(runBatchSign(files, new ArrayBuffer(8), 'pin')).rejects.toBeInstanceOf(
      BatchLimitError,
    );
    await expect(runBatchSign(files, new ArrayBuffer(8), 'pin')).rejects.toMatchObject({
      code: 'too_many_files',
    });
  });

  it('throws BatchLimitError with a clear message when a file exceeds MAX_BATCH_FILE_SIZE_BYTES', async () => {
    const files = [makeFile('huge.pdf', MAX_BATCH_FILE_SIZE_BYTES + 1)];
    await expect(runBatchSign(files, new ArrayBuffer(8), 'pin')).rejects.toMatchObject({
      code: 'file_too_large',
    });
  });

  it('does not open a worker session at all when the limit is exceeded (no partial work, no OOM risk)', async () => {
    const w = installFake();
    const files = Array.from({ length: MAX_BATCH_FILES + 5 }, (_, i) => makeFile(`f${i}.pdf`));
    await expect(runBatchSign(files, new ArrayBuffer(8), 'pin')).rejects.toBeInstanceOf(
      BatchLimitError,
    );
    expect(w.postedMessages).toHaveLength(0);
  });
});

describe('runBatchSign — partial failure (continue on error)', () => {
  it('5 PDFs, #3 corrupt → 4 signed + 1 reported with error, queue continues to #4 and #5', async () => {
    const w = installFake();
    const files = [
      makeFile('a.pdf'),
      makeFile('b.pdf'),
      makeFile('CORRUPT.pdf'),
      makeFile('d.pdf'),
      makeFile('e.pdf'),
    ];

    const drivePromise = driveSession(
      w,
      (fileName) =>
        fileName === 'CORRUPT.pdf'
          ? { kind: 'error', code: 'invalid_pdf', message: 'not a PDF' }
          : { kind: 'ok' },
      files.map((f) => f.name),
      files.length,
    );

    const resultPromise = runBatchSign(files, new ArrayBuffer(8), 'pin');
    const [, result] = await Promise.all([drivePromise, resultPromise]);

    expect(result.succeeded).toBe(4);
    expect(result.failed).toBe(1);
    expect(result.items.map((i) => i.status)).toEqual(['done', 'done', 'failed', 'done', 'done']);
    const failedItem = result.items[2]!;
    expect(failedItem.error).toMatchObject({ code: 'invalid_pdf' });
    expect(failedItem.file.name).toBe('CORRUPT.pdf');
    // The other 4 carry a real result.
    for (const idx of [0, 1, 3, 4]) {
      expect(result.items[idx]!.result?.signedPdf).toBeInstanceOf(Uint8Array);
    }
  });
});

describe('runBatchSign — TSA backoff', () => {
  it('retries a rate-limited timestamp with backoff and eventually succeeds, without failing the item', async () => {
    const w = installFake();
    const files = [makeFile('a.pdf')];

    const drivePromise = driveSession(
      w,
      (_fileName, attemptIdx) =>
        attemptIdx < 2
          ? { kind: 'ok', timestampOk: false, timestampReason: 'rate_limited' }
          : { kind: 'ok', timestampOk: true },
      files.map((f) => f.name),
      3,
    );

    const resultPromise = runBatchSign(files, new ArrayBuffer(8), 'pin', {
      tsaRetryBackoffsMs: [1, 1], // near-instant for the test
    });
    const [, result] = await Promise.all([drivePromise, resultPromise]);

    expect(result.succeeded).toBe(1);
    expect(result.items[0]!.result?.timestamp.ok).toBe(true);
    // 3 signNext attempts total for this one item (2 rate-limited + 1 success).
    const signNextCount = w.postedMessages.filter(
      (m) => (m as { kind: string }).kind === 'signNext',
    ).length;
    expect(signNextCount).toBe(3);
  });

  it('exhausts retries and still delivers the SIGNED pdf without a timestamp (door open to no-timestamp batch)', async () => {
    const w = installFake();
    const files = [makeFile('a.pdf')];

    const drivePromise = driveSession(
      w,
      () => ({ kind: 'ok', timestampOk: false, timestampReason: 'rate_limited' }),
      files.map((f) => f.name),
      3,
    );

    const resultPromise = runBatchSign(files, new ArrayBuffer(8), 'pin', {
      tsaRetryBackoffsMs: [1, 1],
      tsaMaxAttempts: 3,
    });
    const [, result] = await Promise.all([drivePromise, resultPromise]);

    expect(result.succeeded).toBe(1); // NOT failed — signed PDF still delivered
    expect(result.items[0]!.status).toBe('done');
    expect(result.items[0]!.result?.timestamp.ok).toBe(false);
    expect(result.items[0]!.result?.signedPdf).toBeInstanceOf(Uint8Array);
  });
});
