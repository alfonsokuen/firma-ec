/**
 * Batch-queue safety tests (sign-queue.ts) — memory and session lifetime.
 *
 * Same FakeSessionWorker substitution pattern as sign-queue.test.ts; these
 * cover the properties that make a 200-document batch survivable:
 *
 *   1. Streaming results: with `onItemSigned`, the signed bytes are handed to
 *      the caller per document and the queue drops its reference — otherwise
 *      `items[].result.signedPdf` accumulates the whole batch in memory.
 *   2. A session-fatal failure (its worker was killed, e.g. after a signNext
 *      timeout) never feeds documents to a dead — or still busy — worker: the
 *      session is REOPENED and the batch continues, and only once the reopen
 *      budget is spent is the remainder abandoned as `session_aborted`.
 *   3. Teardown waits for the worker's key-material wipe ack.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BATCH_FILE_SIZE_BYTES, MAX_SESSION_REOPENS, runBatchSign } from './sign-queue';
import {
  SESSION_TIMEOUT_BASE_MS,
  SESSION_TIMEOUT_MAX_MS,
  __setSignSessionWorkerFactoryForTests,
  computeSignSessionTimeoutMs,
  maxPdfBytesWithinSignTimeout,
} from './sign-session-bus';
import type { SignSessionWorkerResponse } from './sign-session-bus';

class FakeSessionWorker extends EventTarget {
  public readonly postedMessages: unknown[] = [];
  public terminated = 0;
  /** When true, answer `closeSession` with the `sessionClosed` ack. */
  public ackClose = true;

  postMessage(msg: unknown): void {
    this.postedMessages.push(msg);
    this.dispatchEvent(Object.assign(new Event('posted'), { msg }));
    if ((msg as { kind?: string }).kind === 'closeSession' && this.ackClose) {
      Promise.resolve().then(() => this.emit({ kind: 'sessionClosed' }));
    }
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

/** Answers openSession + every signNext with a signed result of `resultBytes`. */
function driveHappySession(w: FakeSessionWorker, resultBytes = 4096): void {
  w.addEventListener('posted', (ev: Event) => {
    const msg = (ev as Event & { msg: unknown }).msg as { kind: string; requestId?: string };
    if (msg.kind === 'openSession') {
      Promise.resolve().then(() => w.emit({ kind: 'sessionOpened' }));
      return;
    }
    if (msg.kind !== 'signNext' || !msg.requestId) return;
    const requestId = msg.requestId;
    Promise.resolve().then(() =>
      w.emit({
        kind: 'signResult',
        requestId,
        signedPdf: new Uint8Array(resultBytes).buffer,
        timestamp: { ok: true, tsaUrl: 'https://freetsa.org/tsr' },
      }),
    );
  });
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  __setSignSessionWorkerFactoryForTests(null);
  vi.useRealTimers();
});

describe('batch limits are coherent with the signing timeout policy', () => {
  it('a file at the declared size limit does NOT get its timeout clamped (would fail by construction)', () => {
    const atLimit = computeSignSessionTimeoutMs(MAX_BATCH_FILE_SIZE_BYTES);
    expect(atLimit).toBeLessThanOrEqual(SESSION_TIMEOUT_MAX_MS);
    // Not clamped: the budget is the full linear value for that size.
    expect(atLimit).toBe(SESSION_TIMEOUT_BASE_MS + MAX_BATCH_FILE_SIZE_BYTES / 1024);
  });

  it('the declared size limit stays within the timeout budget', () => {
    expect(MAX_BATCH_FILE_SIZE_BYTES).toBeLessThanOrEqual(maxPdfBytesWithinSignTimeout());
  });
});

describe('runBatchSign — signed buffers are streamed out, not accumulated', () => {
  it('with onItemSigned, the queue retains NO signed pdf after delivering it', async () => {
    const w = installFake();
    driveHappySession(w);
    const files = ['a', 'b', 'c', 'd', 'e'].map((n) => makeFile(`${n}.pdf`));

    const delivered: { id: string; bytes: number }[] = [];
    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
      onItemSigned: (item) => {
        delivered.push({ id: item.id, bytes: item.result.signedPdf.byteLength });
      },
    });

    // Everything was handed over, in order...
    expect(delivered).toHaveLength(5);
    expect(delivered.every((d) => d.bytes === 4096)).toBe(true);
    // ...and nothing is still held by the queue.
    expect(result.succeeded).toBe(5);
    expect(result.items.map((i) => i.status)).toEqual(['done', 'done', 'done', 'done', 'done']);
    for (const item of result.items) {
      expect(item.result).toBeUndefined();
    }
  });

  it('without onItemSigned, results stay attached (backwards compatible)', async () => {
    const w = installFake();
    driveHappySession(w);
    const files = [makeFile('a.pdf'), makeFile('b.pdf')];

    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
    });

    for (const item of result.items) {
      expect(item.result?.signedPdf).toBeInstanceOf(Uint8Array);
    }
  });

  it('a failed item still reports its error when onItemSigned is used', async () => {
    const w = installFake();
    w.addEventListener('posted', (ev: Event) => {
      const msg = (ev as Event & { msg: unknown }).msg as { kind: string; requestId?: string };
      if (msg.kind === 'openSession') {
        Promise.resolve().then(() => w.emit({ kind: 'sessionOpened' }));
        return;
      }
      if (msg.kind !== 'signNext' || !msg.requestId) return;
      const requestId = msg.requestId;
      Promise.resolve().then(() =>
        w.emit({ kind: 'signError', requestId, code: 'invalid_pdf', message: 'not a PDF' }),
      );
    });

    const seen: string[] = [];
    const result = await runBatchSign([makeFile('bad.pdf')], new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
      onItemSigned: (item) => {
        seen.push(item.id);
      },
    });

    expect(seen).toHaveLength(0); // never called for a failure
    expect(result.failed).toBe(1);
    expect(result.items[0]?.error).toMatchObject({ code: 'invalid_pdf' });
  });
});

describe('runBatchSign — a dead session is REOPENED, and only then abandoned', () => {
  /**
   * Answers `openSession` always; answers every `signNext` except the ones whose
   * 1-based index is in `silentFor` (staying silent = the worker is still busy
   * signing, which is what makes the caller's per-document timeout fire).
   */
  function driveWithSilentDocuments(w: FakeSessionWorker, silentFor: Set<number>): void {
    let signNextSeen = 0;
    w.addEventListener('posted', (ev: Event) => {
      const msg = (ev as Event & { msg: unknown }).msg as { kind: string; requestId?: string };
      if (msg.kind === 'openSession') {
        Promise.resolve().then(() => w.emit({ kind: 'sessionOpened' }));
        return;
      }
      if (msg.kind !== 'signNext' || !msg.requestId) return;
      const requestId = msg.requestId;
      signNextSeen += 1;
      if (silentFor.has(signNextSeen)) return;
      Promise.resolve().then(() =>
        w.emit({
          kind: 'signResult',
          requestId,
          signedPdf: new Uint8Array(8).buffer,
          timestamp: { ok: true, tsaUrl: 'https://freetsa.org/tsr' },
        }),
      );
    });
  }

  it('a document timeout kills its worker but the batch continues on a fresh session', async () => {
    const w = installFake();
    driveWithSilentDocuments(w, new Set([1]));

    const files = [makeFile('a.pdf'), makeFile('b.pdf'), makeFile('c.pdf')];
    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      signTimeoutMs: 30, // per-document budget, tiny for the test
      closeAckTimeoutMs: 50,
    });

    // Only the document that timed out failed.
    expect(result.items[0]?.error).toMatchObject({ code: 'timeout' });
    expect(result.items.slice(1).map((i) => i.status)).toEqual(['done', 'done']);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    // Nobody was abandoned by association.
    expect(result.items.some((i) => i.error?.code === 'session_aborted')).toBe(false);

    // And the invariant that mattered all along still holds: no document was
    // handed to a worker that might still be signing the previous one. The
    // sequence shows the old session being closed and a NEW one opened before
    // document #2 is posted.
    expect(w.postedMessages.map((m) => (m as { kind: string }).kind)).toEqual([
      'openSession',
      'signNext', // a.pdf — never answered, times out
      'closeSession', // its worker is told to wipe, then terminated
      'openSession', // reopened: runBatchSign holds the .p12 and the PIN
      'signNext', // b.pdf
      'signNext', // c.pdf
      'closeSession', // teardown
    ]);
  });

  it('once the reopen budget is spent, the remainder IS session_aborted, with the reason', async () => {
    const w = installFake();
    driveWithSilentDocuments(w, new Set([1, 2, 3, 4, 5])); // nobody ever answers

    const files = ['a', 'b', 'c', 'd', 'e'].map((n) => makeFile(`${n}.pdf`));
    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      signTimeoutMs: 30,
      closeAckTimeoutMs: 30,
    });

    // One attempt with the original session + one per allowed reopen. Not more:
    // a batch of 200 must not turn into a retry storm.
    const attempted = MAX_SESSION_REOPENS + 1;
    const signNextCount = w.postedMessages.filter(
      (m) => (m as { kind: string }).kind === 'signNext',
    ).length;
    expect(signNextCount).toBe(attempted);
    for (let i = 0; i < attempted; i++) {
      expect(result.items[i]?.error).toMatchObject({ code: 'timeout' });
    }
    // The tail is explicit about WHY it was never attempted.
    for (let i = attempted; i < files.length; i++) {
      expect(result.items[i]?.error).toMatchObject({ code: 'session_aborted' });
      expect(result.items[i]?.error?.message).toContain('reaperturas');
    }
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(files.length);
  });
});

describe('runBatchSign — teardown waits for the key-material wipe', () => {
  it('posts closeSession and terminates only after the worker acks', async () => {
    const w = installFake();
    driveHappySession(w);

    await runBatchSign([makeFile('a.pdf')], new ArrayBuffer(8), 'pin', { closeAckTimeoutMs: 500 });

    expect(w.postedMessages.some((m) => (m as { kind: string }).kind === 'closeSession')).toBe(
      true,
    );
    expect(w.terminated).toBe(1);
  });
});
