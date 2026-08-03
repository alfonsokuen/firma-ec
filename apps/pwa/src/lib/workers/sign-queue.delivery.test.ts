/**
 * Batch-queue DELIVERY as a phase of its own — defect #3 (and #4 at the
 * delivery boundary).
 *
 * `await opts.onItemSigned(...)` used to sit INSIDE the try that wraps signing,
 * so a failure to persist a PDF that was already signed:
 *   - marked the item `failed` as if the SIGNATURE had failed,
 *   - dropped `item.result`, destroying the only copy of bytes that cost a
 *     PKCS#7 + TSA + OCSP round trip to produce, and
 *   - with `code: 'timeout'` (IndexedDB, a slow disk), declared the session dead
 *     and aborted every remaining document.
 *
 * Signing and delivering are different phases with different failure meanings.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runBatchSign } from './sign-queue';
import { __setSignSessionWorkerFactoryForTests } from './sign-session-bus';
import type { SignSessionWorkerResponse } from './sign-session-bus';

class FakeSessionWorker extends EventTarget {
  public readonly postedMessages: unknown[] = [];
  public terminated = 0;

  postMessage(msg: unknown): void {
    this.postedMessages.push(msg);
    this.dispatchEvent(Object.assign(new Event('posted'), { msg }));
    if ((msg as { kind?: string }).kind === 'closeSession') {
      Promise.resolve().then(() => this.emit({ kind: 'sessionClosed', wiped: true }));
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

function driveHappySession(w: FakeSessionWorker): void {
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
        signedPdf: new Uint8Array([9, 9, 9, 9]).buffer,
        timestamp: { ok: true, tsaUrl: 'https://freetsa.org/tsr' },
        ltv: {
          profile: 'B-LTA',
          longTermAchieved: true,
          archiveAchieved: true,
          embeddedOcspCount: 1,
          embeddedCrlCount: 0,
          warnings: [],
        },
      }),
    );
  });
}

function makeFile(name: string): File {
  return new File([new Uint8Array(16)], name, { type: 'application/pdf' });
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  __setSignSessionWorkerFactoryForTests(null);
  vi.useRealTimers();
});

describe('defect #3 — a delivery failure never looks like a signing failure', () => {
  it('keeps status=done, records deliveryError, PRESERVES the signed bytes and continues', async () => {
    const w = installFake();
    driveHappySession(w);
    const files = [makeFile('a.pdf'), makeFile('b.pdf'), makeFile('c.pdf')];

    const delivered: string[] = [];
    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
      onItemSigned: (item) => {
        if (item.file.name === 'b.pdf') {
          // What IndexedDB does when the quota is gone.
          return Promise.reject(
            Object.assign(new Error('QuotaExceededError: no space left'), {
              name: 'QuotaExceededError',
              code: 22,
            }),
          );
        }
        delivered.push(item.file.name);
        return Promise.resolve();
      },
    });

    const failedDelivery = result.items[1]!;
    // The document IS signed — that is the fact that matters.
    expect(failedDelivery.status).toBe('done');
    expect(failedDelivery.error).toBeUndefined();
    expect(failedDelivery.deliveryError).toMatchObject({ code: 'QuotaExceededError' });
    // Lifeline: the bytes are still there, so the caller can retry the WRITE
    // without signing again.
    expect(failedDelivery.result?.signedPdf).toBeInstanceOf(Uint8Array);
    expect(failedDelivery.result?.signedPdf.byteLength).toBe(4);

    // Delivered items drop their bytes as before.
    expect(result.items[0]?.result).toBeUndefined();
    expect(result.items[2]?.result).toBeUndefined();
    expect(delivered).toEqual(['a.pdf', 'c.pdf']);
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
  });

  it('a delivery failure with code:"timeout" does NOT kill the session (defect #4 at the delivery seam)', async () => {
    const w = installFake();
    driveHappySession(w);
    const files = [makeFile('a.pdf'), makeFile('b.pdf'), makeFile('c.pdf')];

    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
      onItemSigned: (item) =>
        item.file.name === 'a.pdf'
          ? Promise.reject(Object.assign(new Error('idb write timed out'), { code: 'timeout' }))
          : Promise.resolve(),
    });

    expect(result.items[0]?.status).toBe('done');
    expect(result.items[0]?.deliveryError).toMatchObject({ code: 'timeout' });
    expect(result.items.some((i) => i.error?.code === 'session_aborted')).toBe(false);
    expect(result.items.map((i) => i.status)).toEqual(['done', 'done', 'done']);
    // Every document was actually handed to the worker.
    const signNextCount = w.postedMessages.filter(
      (m) => (m as { kind: string }).kind === 'signNext',
    ).length;
    expect(signNextCount).toBe(3);
  });

  it('reports the delivery failure through onItemUpdate as well', async () => {
    const w = installFake();
    driveHappySession(w);
    const updates: { status: string; deliveryError?: { code: string } }[] = [];

    await runBatchSign([makeFile('a.pdf')], new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
      onItemSigned: () => Promise.reject(new Error('disk on fire')),
      onItemUpdate: (item) => {
        updates.push({
          status: item.status,
          ...(item.deliveryError ? { deliveryError: { code: item.deliveryError.code } } : {}),
        });
      },
    });

    const last = updates[updates.length - 1]!;
    expect(last.status).toBe('done');
    expect(last.deliveryError).toBeDefined();
  });
});
