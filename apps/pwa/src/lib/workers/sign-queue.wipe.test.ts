/**
 * The retained .p12 copy is ZEROED when the batch ends — on every path.
 *
 * Defect #2's fix made `runBatchSign` keep its own copy of the PKCS#12 container
 * so a killed session can be reopened (`openSignSession` transfers — and thus
 * detaches — the buffer it is given). That copy is plaintext container bytes
 * living for the whole batch, so it must be overwritten on the way out, and NOT
 * only on the happy path: the abort path is exactly the one taken when things
 * went wrong and the code is least exercised.
 *
 * House doctrine: a security guard does not count as verified until it has been
 * seen firing. This file was run with the `p12Master.fill(0)` line commented out
 * first, and both cases failed on non-zero bytes.
 *
 * The copy never leaves the module, hence `__setP12CopyObserverForTests`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_SESSION_REOPENS, __setP12CopyObserverForTests, runBatchSign } from './sign-queue';
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

/** `answerSignNext: false` = stay silent, so the per-document timeout fires. */
function installFake(answerSignNext: boolean): FakeSessionWorker {
  const w = new FakeSessionWorker();
  __setSignSessionWorkerFactoryForTests(() => w as unknown as Worker);
  w.addEventListener('posted', (ev: Event) => {
    const msg = (ev as Event & { msg: unknown }).msg as { kind: string; requestId?: string };
    if (msg.kind === 'openSession') {
      Promise.resolve().then(() => w.emit({ kind: 'sessionOpened' }));
      return;
    }
    if (msg.kind !== 'signNext' || !msg.requestId || !answerSignNext) return;
    const requestId = msg.requestId;
    Promise.resolve().then(() =>
      w.emit({
        kind: 'signResult',
        requestId,
        signedPdf: new Uint8Array(8).buffer,
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
  return w;
}

/** Rejects the very first `openSession` — simulates an incorrect PIN. */
function installFakeWithBadPin(): FakeSessionWorker {
  const w = new FakeSessionWorker();
  __setSignSessionWorkerFactoryForTests(() => w as unknown as Worker);
  w.addEventListener('posted', (ev: Event) => {
    const msg = (ev as Event & { msg: unknown }).msg as { kind: string };
    if (msg.kind !== 'openSession') return;
    Promise.resolve().then(() =>
      w.emit({ kind: 'sessionOpenError', code: 'bad_p12', message: 'PIN incorrecto' }),
    );
  });
  return w;
}

/** A recognisable, definitely-not-zero container. */
const CONTAINER_FILL = 0xa7;
function makeP12(byteLength = 128): ArrayBuffer {
  const buf = new ArrayBuffer(byteLength);
  new Uint8Array(buf).fill(CONTAINER_FILL);
  return buf;
}

function makeFiles(names: string[]): File[] {
  return names.map((n) => new File([new Uint8Array(16)], n, { type: 'application/pdf' }));
}

function allZero(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) if (bytes[i] !== 0) return false;
  return true;
}

let observed: Uint8Array | null = null;

beforeEach(() => {
  vi.useRealTimers();
  observed = null;
  __setP12CopyObserverForTests((copy) => {
    observed = copy;
  });
});

afterEach(() => {
  __setP12CopyObserverForTests(null);
  __setSignSessionWorkerFactoryForTests(null);
  vi.useRealTimers();
});

describe('the retained .p12 copy is zeroed when the batch ends', () => {
  it('happy path: every document signed → the copy is all zeros afterwards', async () => {
    installFake(true);
    const result = await runBatchSign(makeFiles(['a.pdf', 'b.pdf']), makeP12(), 'pin', {
      closeAckTimeoutMs: 50,
    });

    expect(result.succeeded).toBe(2);
    expect(observed).not.toBeNull();
    // It really was the plaintext container while the batch ran...
    expect(observed!.byteLength).toBe(128);
    // ...and nothing of it is left now.
    expect(allZero(observed!)).toBe(true);
  });

  it('abort path: the batch dies after exhausting the reopens → the copy is still zeroed', async () => {
    installFake(false); // nobody ever answers: every document times out
    const result = await runBatchSign(
      makeFiles(['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf', 'e.pdf']),
      makeP12(),
      'pin',
      { signTimeoutMs: 30, closeAckTimeoutMs: 30 },
    );

    // Sanity: this really is the abort path, not a silently happy one.
    expect(result.succeeded).toBe(0);
    expect(result.items.some((i) => i.error?.code === 'session_aborted')).toBe(true);
    expect(observed).not.toBeNull();
    expect(allZero(observed!)).toBe(true);
    // And the reopen budget is what ended it (not an early return that would
    // skip the wipe for a different reason).
    expect(MAX_SESSION_REOPENS).toBeGreaterThan(0);
  });

  it('a caller failure in the middle does not skip the wipe either', async () => {
    installFake(true);
    const boom = new Error('caller blew up while persisting');
    await expect(
      runBatchSign(makeFiles(['a.pdf', 'b.pdf']), makeP12(), 'pin', {
        closeAckTimeoutMs: 50,
        onItemUpdate: (item) => {
          // A throw from a caller hook escapes runBatchSign entirely — the
          // `finally` is the only thing standing between that and a plaintext
          // container left in the heap.
          if (item.status === 'done') throw boom;
        },
      }),
    ).rejects.toBe(boom);

    expect(observed).not.toBeNull();
    expect(allZero(observed!)).toBe(true);
  });

  it('the very first openSession rejecting (wrong PIN) does not skip the wipe', async () => {
    // QA de seguridad post-merge 2026-08-02: `openSignSession` corría FUERA del
    // `try`, así que este es el camino más común de todos — el usuario se
    // equivoca de PIN en el primer intento — y era justo el que dejaba la copia
    // sin poner a cero.
    installFakeWithBadPin();
    await expect(
      runBatchSign(makeFiles(['a.pdf']), makeP12(), 'wrong-pin', { closeAckTimeoutMs: 50 }),
    ).rejects.toThrow('PIN incorrecto');

    expect(observed).not.toBeNull();
    expect(observed!.byteLength).toBe(128);
    expect(allZero(observed!)).toBe(true);
  });
});
