/**
 * Session-bus contract tests — defects #6, #7, #8, #9 (main-thread half).
 *
 * Same FakeSessionWorker substitution as sign-session-bus.test.ts (which pins
 * the happy path + the PIN-once invariant); this file pins what happens when
 * things go wrong:
 *
 *   #6 a `signError` whose requestId is absent/unknown must reach the caller
 *      with ITS message. Dropping it (the old `if (msg.requestId !== requestId)
 *      return`) meant the caller waited out its own timer and reported
 *      'timeout' — the code that then killed the whole batch.
 *   #7 the worker can die in the GAPS between documents (while the queue reads
 *      the next file, sleeps a TSA backoff, or awaits the caller's write). With
 *      listeners installed only for the duration of a signNext, nobody hears it.
 *   #8 a document timeout must still WIPE: closeSession has to be posted before
 *      terminate(), and closeAndWipe must tell the caller whether the wipe was
 *      acked instead of resolving identically either way.
 *   #9 an unknown response kind is warned about, not silently dropped.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SignSessionError,
  __setSignSessionWorkerFactoryForTests,
  openSignSession,
} from './sign-session-bus';
import type { SignSessionWorkerResponse } from './sign-session-bus';

class FakeSessionWorker extends EventTarget {
  public readonly postedMessages: unknown[] = [];
  public terminated = 0;
  /** Answer `closeSession` with an ack (and with this `wiped` value). */
  public ack: false | { wiped?: boolean } = { wiped: true };

  postMessage(msg: unknown): void {
    this.postedMessages.push(msg);
    if ((msg as { kind?: string }).kind === 'closeSession' && this.ack !== false) {
      const ack = this.ack;
      Promise.resolve().then(() =>
        this.emit({
          kind: 'sessionClosed',
          ...(ack.wiped !== undefined ? { wiped: ack.wiped } : {}),
        }),
      );
    }
  }

  terminate(): void {
    this.terminated += 1;
  }

  emit(data: SignSessionWorkerResponse | Record<string, unknown>): void {
    this.dispatchEvent(Object.assign(new Event('message'), { data }));
  }

  emitError(message: string): void {
    this.dispatchEvent(Object.assign(new Event('error'), { message }));
  }

  kinds(): string[] {
    return this.postedMessages.map((m) => (m as { kind: string }).kind);
  }
}

async function openFakeSession(): Promise<{
  w: FakeSessionWorker;
  session: Awaited<ReturnType<typeof openSignSession>>;
}> {
  const w = new FakeSessionWorker();
  __setSignSessionWorkerFactoryForTests(() => w as unknown as Worker);
  const promise = openSignSession(new ArrayBuffer(8), 'pin');
  await Promise.resolve();
  w.emit({ kind: 'sessionOpened' });
  return { w, session: await promise };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  __setSignSessionWorkerFactoryForTests(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('defect #6 — a signError with an unknown requestId still reaches the caller', () => {
  it('rejects the in-flight signature with the WORKER’s message, not with a timeout', async () => {
    const { w, session } = await openFakeSession();
    const promise = session.signNext(new ArrayBuffer(4), { timeoutMs: 5_000 });
    await Promise.resolve();

    const started = Date.now();
    w.emit({
      kind: 'signError',
      requestId: 'unknown',
      code: 'worker_task_failed',
      message: 'RangeError: invalid typed array length',
    });

    await expect(promise).rejects.toMatchObject({
      code: 'worker_task_failed',
      message: 'RangeError: invalid typed array length',
    });
    expect(Date.now() - started).toBeLessThan(1_000); // not via the 5s timer
  });

  it('also handles a signError with NO requestId field at all', async () => {
    const { w, session } = await openFakeSession();
    const promise = session.signNext(new ArrayBuffer(4), { timeoutMs: 5_000 });
    await Promise.resolve();

    w.emit({ kind: 'signError', code: 'oom', message: 'out of memory in worker' });

    await expect(promise).rejects.toMatchObject({ code: 'oom' });
  });

  it('a signError for a DIFFERENT, known requestId is still ignored (no cross-talk)', async () => {
    const { w, session } = await openFakeSession();
    const promise = session.signNext(new ArrayBuffer(4), { timeoutMs: 80 });
    await Promise.resolve();

    w.emit({ kind: 'signError', requestId: 'sn-999-stale', code: 'invalid_pdf', message: 'old' });

    // Not settled by the stale message: the only way out is its own timeout.
    await expect(promise).rejects.toMatchObject({ code: 'timeout' });
  });
});

describe('defect #7 — a worker that dies BETWEEN documents is noticed', () => {
  it('reports worker_error on the next signNext instead of posting to a dead worker', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { w, session } = await openFakeSession();

    // Document 1 signs fine.
    const p1 = session.signNext(new ArrayBuffer(4));
    await Promise.resolve();
    const req1 = w.postedMessages[w.postedMessages.length - 1] as { requestId: string };
    w.emit({
      kind: 'signResult',
      requestId: req1.requestId,
      signedPdf: new ArrayBuffer(2),
      timestamp: { ok: false, reason: 'disabled' },
    });
    await p1;

    // The worker dies in the gap — no signature in flight, so the per-call
    // listeners are gone.
    w.emitError('worker terminated by the OS (out of memory)');
    const postedBefore = w.postedMessages.length;

    const failure = await session
      .signNext(new ArrayBuffer(4), { timeoutMs: 5_000 })
      .then(() => null)
      .catch((e: SignSessionError) => e);

    expect(failure).toBeInstanceOf(SignSessionError);
    expect(failure!.code).toBe('worker_error');
    expect(failure!.message).toContain('out of memory');
    // Nothing was handed to the dead worker.
    expect(w.postedMessages.length).toBe(postedBefore);
    expect(warn).toHaveBeenCalled();
  });

  it('settles a signature that IS in flight when the worker dies mid-document', async () => {
    const { w, session } = await openFakeSession();
    const promise = session.signNext(new ArrayBuffer(4), { timeoutMs: 5_000 });
    await Promise.resolve();
    w.emitError('crashed mid-signature');
    await expect(promise).rejects.toMatchObject({ code: 'worker_error' });
  });
});

describe('defect #8 — the timeout path wipes, and the wipe is reported', () => {
  it('posts closeSession before terminating on a signNext timeout', async () => {
    const { w, session } = await openFakeSession();

    await expect(session.signNext(new ArrayBuffer(4), { timeoutMs: 20 })).rejects.toMatchObject({
      code: 'timeout',
    });

    expect(w.kinds()).toContain('closeSession');
    expect(w.terminated).toBe(1);
  });

  it('closeAndWipe tells the caller the ack arrived and what the worker wiped', async () => {
    const { session } = await openFakeSession();
    const outcome = await session.closeAndWipe({ ackTimeoutMs: 200 });
    expect(outcome).toEqual({ acked: true, wiped: true });
  });

  it('closeAndWipe reports acked:false when the worker never answers', async () => {
    const { w, session } = await openFakeSession();
    w.ack = false;
    const outcome = await session.closeAndWipe({ ackTimeoutMs: 20 });
    expect(outcome.acked).toBe(false);
    expect(outcome.wiped).toBe(false);
    expect(w.terminated).toBe(1); // still torn down — never hangs the caller
  });

  it('closeAndWipe propagates wiped:false from the worker', async () => {
    const { w, session } = await openFakeSession();
    w.ack = { wiped: false };
    const outcome = await session.closeAndWipe({ ackTimeoutMs: 200 });
    expect(outcome).toEqual({ acked: true, wiped: false });
  });
});

describe('defect #9 — an unrecognised response kind is not swallowed', () => {
  it('warns about an unknown message kind while a signature is in flight', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { w, session } = await openFakeSession();
    const promise = session.signNext(new ArrayBuffer(4), { timeoutMs: 60 });
    await Promise.resolve();

    w.emit({ kind: 'signResultV2', requestId: 'whatever' });

    expect(warn).toHaveBeenCalled();
    await expect(promise).rejects.toMatchObject({ code: 'timeout' }); // drain
  });

  it('fails the in-flight signature when the worker answers protocolError', async () => {
    const { w, session } = await openFakeSession();
    const promise = session.signNext(new ArrayBuffer(4), { timeoutMs: 5_000 });
    await Promise.resolve();

    w.emit({
      kind: 'protocolError',
      code: 'unknown_request_kind',
      message: 'worker does not understand request kind signNext',
    });

    await expect(promise).rejects.toMatchObject({ code: 'unknown_request_kind' });
  });
});
