/**
 * Unit tests for the batch-signing session bus (sign-session-bus.ts).
 *
 * Mirrors the FakeWorker approach used by sign-bus.test.ts: no real DOM
 * Worker, we substitute a `FakeSessionWorker` via
 * `__setSignSessionWorkerFactoryForTests`.
 *
 * Contract under test:
 *   - openSignSession posts exactly one 'openSession' message with p12+pin,
 *     resolves a SignSession on 'sessionOpened'.
 *   - session.signNext posts 'signNext' with a fresh requestId per call and
 *     resolves/rejects correlated by that id.
 *   - ONE p12+pin round trip for N signNext calls (PIN sent once).
 *   - session.close() posts 'closeSession' then terminates the worker.
 *   - No postMessage payload — from openSession OR any signNext — ever
 *     contains a 'p12' after the first call, a CryptoKey, PKCS#8 bytes, or a
 *     JWK-shaped private key field. Only the PIN travels, exactly once.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SignSessionError,
  __setSignSessionWorkerFactoryForTests,
  computeSignSessionTimeoutMs,
  openSignSession,
} from './sign-session-bus';
import type { SignSessionWorkerResponse } from './sign-session-bus';

class FakeSessionWorker extends EventTarget {
  public readonly postedMessages: unknown[] = [];
  public readonly transferLists: (readonly Transferable[] | undefined)[] = [];
  public terminated = 0;

  postMessage(msg: unknown, transfer?: readonly Transferable[]): void {
    this.postedMessages.push(msg);
    this.transferLists.push(transfer);
  }

  terminate(): void {
    this.terminated += 1;
  }

  emit(data: SignSessionWorkerResponse): void {
    this.dispatchEvent(Object.assign(new Event('message'), { data }));
  }

  emitError(message: string): void {
    this.dispatchEvent(Object.assign(new Event('error'), { message }));
  }
}

function installFake(): FakeSessionWorker {
  const w = new FakeSessionWorker();
  __setSignSessionWorkerFactoryForTests(() => w as unknown as Worker);
  return w;
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  __setSignSessionWorkerFactoryForTests(null);
  vi.useRealTimers();
});

describe('computeSignSessionTimeoutMs', () => {
  it('uses the 15s baseline for a 0-byte PDF', () => {
    expect(computeSignSessionTimeoutMs(0)).toBe(15_000);
  });
  it('caps at 60s for huge inputs', () => {
    expect(computeSignSessionTimeoutMs(500 * 1024 * 1024)).toBe(60_000);
  });
});

describe('openSignSession', () => {
  it('posts exactly one openSession message with p12+pin, resolves on sessionOpened', async () => {
    const w = installFake();
    const p12 = new ArrayBuffer(16);
    const promise = openSignSession(p12, 'my-pin');

    await Promise.resolve();
    expect(w.postedMessages).toHaveLength(1);
    const msg = w.postedMessages[0] as { kind: string; p12: ArrayBuffer; pin: string };
    expect(msg.kind).toBe('openSession');
    expect(msg.p12).toBe(p12);
    expect(msg.pin).toBe('my-pin');
    expect(w.transferLists[0]).toEqual([p12]);

    w.emit({ kind: 'sessionOpened' });
    const session = await promise;
    expect(session).toBeDefined();
    expect(w.terminated).toBe(0); // still open — must not be terminated on success
  });

  it('rejects with SignSessionError and terminates the worker on sessionOpenError (e.g. bad PIN)', async () => {
    const w = installFake();
    const promise = openSignSession(new ArrayBuffer(4), 'wrong-pin');

    await Promise.resolve();
    w.emit({ kind: 'sessionOpenError', code: 'pin_invalid', message: 'PIN incorrect' });

    await expect(promise).rejects.toBeInstanceOf(SignSessionError);
    await expect(promise).rejects.toMatchObject({ code: 'pin_invalid' });
    expect(w.terminated).toBe(1);
  });

  it('times out and terminates when the worker stays silent', async () => {
    vi.useFakeTimers();
    const w = installFake();
    const promise = openSignSession(new ArrayBuffer(4), 'pin', { timeoutMs: 50 });
    const expectation = expect(promise).rejects.toMatchObject({ code: 'timeout' });
    vi.advanceTimersByTime(60);
    await expectation;
    expect(w.terminated).toBe(1);
  });
});

describe('SignSession — one PIN, N signatures', () => {
  async function openFakeSession(): Promise<{
    w: FakeSessionWorker;
    session: Awaited<ReturnType<typeof openSignSession>>;
  }> {
    const w = installFake();
    const promise = openSignSession(new ArrayBuffer(8), 'one-shot-pin');
    await Promise.resolve();
    w.emit({ kind: 'sessionOpened' });
    const session = await promise;
    return { w, session };
  }

  it('signing 3 PDFs sends exactly ONE openSession (PIN once) + 3 signNext requests, each resolving independently', async () => {
    const { w, session } = await openFakeSession();

    const results: Uint8Array[] = [];
    for (let i = 0; i < 3; i++) {
      const pdf = new ArrayBuffer(8);
      const promise = session.signNext(pdf);
      await Promise.resolve();
      const last = w.postedMessages[w.postedMessages.length - 1] as {
        kind: string;
        requestId: string;
      };
      expect(last.kind).toBe('signNext');
      w.emit({
        kind: 'signResult',
        requestId: last.requestId,
        signedPdf: new Uint8Array([i, i, i]).buffer,
        timestamp: { ok: false, reason: 'disabled' },
      });
      const out = await promise;
      results.push(out.signedPdf);
    }

    expect(results).toHaveLength(3);
    // Exactly 1 openSession + 3 signNext = 4 total messages. PIN only in message 0.
    const kinds = w.postedMessages.map((m) => (m as { kind: string }).kind);
    expect(kinds).toEqual(['openSession', 'signNext', 'signNext', 'signNext']);
    const pinOccurrences = w.postedMessages.filter(
      (m) => typeof (m as Record<string, unknown>)['pin'] === 'string',
    );
    expect(pinOccurrences).toHaveLength(1);
  });

  it('requestIds are unique per signNext call and correlate responses correctly', async () => {
    const { w, session } = await openFakeSession();

    const p1 = session.signNext(new ArrayBuffer(4));
    await Promise.resolve();
    const req1 = w.postedMessages[1] as { requestId: string };

    w.emit({
      kind: 'signResult',
      requestId: req1.requestId,
      signedPdf: new ArrayBuffer(2),
      timestamp: { ok: false, reason: 'disabled' },
    });
    await p1;

    const p2 = session.signNext(new ArrayBuffer(4));
    await Promise.resolve();
    const req2 = w.postedMessages[2] as { requestId: string };
    expect(req2.requestId).not.toBe(req1.requestId);

    w.emit({
      kind: 'signResult',
      requestId: req2.requestId,
      signedPdf: new ArrayBuffer(2),
      timestamp: { ok: false, reason: 'disabled' },
    });
    await p2;
  });

  it('rejects a concurrent signNext call while one is already in flight', async () => {
    const { session } = await openFakeSession();
    const first = session.signNext(new ArrayBuffer(4));
    const second = session.signNext(new ArrayBuffer(4));
    await expect(second).rejects.toMatchObject({ code: 'concurrency_violation' });
    // Clean up the first call so it doesn't hang the test process.
    first.catch(() => {});
  });

  it('close() posts closeSession and terminates the worker; signNext after close() rejects', async () => {
    const { w, session } = await openFakeSession();
    session.close();
    expect(w.postedMessages[w.postedMessages.length - 1]).toEqual({ kind: 'closeSession' });
    expect(w.terminated).toBe(1);

    await expect(session.signNext(new ArrayBuffer(4))).rejects.toMatchObject({
      code: 'session_closed',
    });
  });

  it('close() is idempotent (safe to call twice)', async () => {
    const { w, session } = await openFakeSession();
    session.close();
    session.close();
    expect(w.terminated).toBe(1);
  });
});

describe('SignSession — key material never crosses postMessage', () => {
  it('no message posted by the session (open, N signs, close) contains key material or repeats the PIN', async () => {
    const w = installFake();
    const p12 = new ArrayBuffer(8);
    const promise = openSignSession(p12, 'super-secret-pin');
    await Promise.resolve();
    w.emit({ kind: 'sessionOpened' });
    const session = await promise;

    for (let i = 0; i < 3; i++) {
      const signPromise = session.signNext(new ArrayBuffer(4));
      await Promise.resolve();
      const last = w.postedMessages[w.postedMessages.length - 1] as { requestId: string };
      w.emit({
        kind: 'signResult',
        requestId: last.requestId,
        signedPdf: new ArrayBuffer(2),
        timestamp: { ok: false, reason: 'disabled' },
      });
      await signPromise;
    }
    session.close();

    const FORBIDDEN_KEYS = ['privateKeyJwk', 'privateKeyPkcs8Der', 'cryptoKey', 'd', 'signingCert'];
    let pinCount = 0;
    for (const raw of w.postedMessages) {
      const msg = raw as Record<string, unknown>;
      for (const key of FORBIDDEN_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(msg, key)).toBe(false);
      }
      if (typeof msg['pin'] === 'string') pinCount += 1;
    }
    expect(pinCount).toBe(1); // PIN traveled exactly once (openSession)
  });
});
