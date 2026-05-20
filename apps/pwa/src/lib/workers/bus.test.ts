/**
 * Unit tests for the typed worker bus.
 *
 * We don't spin a real DOM Worker here — we substitute a `FakeWorker` via
 * `__setWorkerFactoryForTests`. The contract we exercise is:
 *   - 'result' messages resolve the promise.
 *   - 'error' messages reject with WorkerVerificationError carrying the code.
 *   - 'progress' messages invoke onProgress and DO NOT settle the promise.
 *   - The worker is terminated exactly once on success and once on error.
 *   - error / messageerror events on the worker reject and terminate.
 *   - PDF is transferred (postMessage second arg includes the buffer).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type WorkerResponse,
  WorkerVerificationError,
  __setWorkerFactoryForTests,
  runVerify,
} from './bus';

class FakeWorker extends EventTarget {
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

  /** Helper: simulate the worker sending a message to the bus. */
  emit(data: WorkerResponse): void {
    // bus.ts uses `ev.data` — synthesise a minimal MessageEvent-like object.
    this.dispatchEvent(Object.assign(new Event('message'), { data }));
  }

  emitError(message: string): void {
    this.dispatchEvent(Object.assign(new Event('error'), { message }));
  }

  emitMessageError(): void {
    this.dispatchEvent(new Event('messageerror'));
  }
}

function installFake(): FakeWorker {
  const w = new FakeWorker();
  __setWorkerFactoryForTests(() => w as unknown as Worker);
  return w;
}

afterEach(() => {
  __setWorkerFactoryForTests(null);
});

describe('runVerify', () => {
  it('resolves with the result when worker emits kind=result', async () => {
    const w = installFake();
    const pdf = new ArrayBuffer(8);

    const promise = runVerify(pdf);

    // Let the postMessage microtask settle, then emit.
    await Promise.resolve();
    w.emit({
      kind: 'result',
      result: {
        status: 'no_signature',
        warnings: [],
        engineVersion: 'test',
        verifiedAt: new Date().toISOString(),
      },
    });

    const result = await promise;
    expect(result.status).toBe('no_signature');
    expect(w.terminated).toBe(1);
  });

  it('rejects with WorkerVerificationError when worker emits kind=error', async () => {
    const w = installFake();
    const promise = runVerify(new ArrayBuffer(4));

    await Promise.resolve();
    w.emit({ kind: 'error', code: 'bad_pdf', message: 'invalid header' });

    await expect(promise).rejects.toBeInstanceOf(WorkerVerificationError);
    await expect(promise).rejects.toMatchObject({ code: 'bad_pdf', message: 'invalid header' });
    expect(w.terminated).toBe(1);
  });

  it('forwards progress messages to onProgress without settling', async () => {
    const w = installFake();
    const onProgress = vi.fn();
    const promise = runVerify(new ArrayBuffer(4), { onProgress });

    await Promise.resolve();
    w.emit({ kind: 'progress', stage: 'parse' });
    w.emit({ kind: 'progress', stage: 'verify' });
    w.emit({
      kind: 'result',
      result: {
        status: 'valid',
        warnings: [],
        engineVersion: 'test',
        verifiedAt: new Date().toISOString(),
      },
    });

    await promise;
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, 'parse');
    expect(onProgress).toHaveBeenNthCalledWith(2, 'verify');
  });

  it('rejects on worker error event', async () => {
    const w = installFake();
    const promise = runVerify(new ArrayBuffer(4));

    await Promise.resolve();
    w.emitError('boom');

    await expect(promise).rejects.toMatchObject({
      code: 'worker_error',
      message: 'boom',
    });
    expect(w.terminated).toBe(1);
  });

  it('rejects on messageerror event', async () => {
    const w = installFake();
    const promise = runVerify(new ArrayBuffer(4));

    await Promise.resolve();
    w.emitMessageError();

    await expect(promise).rejects.toMatchObject({ code: 'messageerror' });
    expect(w.terminated).toBe(1);
  });

  it('posts the PDF as a transferable', async () => {
    const w = installFake();
    const pdf = new ArrayBuffer(16);

    const promise = runVerify(pdf, { fetchOcsp: false });
    await Promise.resolve();
    w.emit({
      kind: 'result',
      result: {
        status: 'no_signature',
        warnings: [],
        engineVersion: 'test',
        verifiedAt: new Date().toISOString(),
      },
    });
    await promise;

    expect(w.postedMessages).toHaveLength(1);
    const msg = w.postedMessages[0] as {
      kind: string;
      pdf: ArrayBuffer;
      opts?: { fetchOcsp?: boolean };
    };
    expect(msg.kind).toBe('verify');
    expect(msg.pdf).toBe(pdf);
    expect(msg.opts?.fetchOcsp).toBe(false);
    expect(w.transferLists[0]).toEqual([pdf]);
  });

  it('only settles once even if multiple terminal messages arrive', async () => {
    const w = installFake();
    const promise = runVerify(new ArrayBuffer(4));

    await Promise.resolve();
    w.emit({
      kind: 'result',
      result: {
        status: 'valid',
        warnings: [],
        engineVersion: 'test',
        verifiedAt: new Date().toISOString(),
      },
    });
    // Late error — should be ignored, no unhandled rejection.
    w.emit({ kind: 'error', code: 'late', message: 'should be ignored' });

    await promise;
    expect(w.terminated).toBe(1);
  });

  // v0.7.30 — watchdog: a silently-dead worker (stale SW serving purged chunks,
  // module-worker dependency load failure not firing onerror) must not hang the
  // UI forever. The promise rejects with code 'timeout' after the deadline.
  it('rejects with code=timeout if the worker never responds', async () => {
    vi.useFakeTimers();
    try {
      const w = installFake();
      const promise = runVerify(new ArrayBuffer(4), { timeoutMs: 5000 });
      const assertion = expect(promise).rejects.toMatchObject({ code: 'timeout' });
      await vi.advanceTimersByTimeAsync(5001);
      await assertion;
      expect(w.terminated).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('progress messages reset the watchdog (slow-but-alive worker is not killed)', async () => {
    vi.useFakeTimers();
    try {
      const w = installFake();
      const promise = runVerify(new ArrayBuffer(4), { timeoutMs: 5000 });
      // Just before each deadline, the worker emits progress → deadline extends.
      await vi.advanceTimersByTimeAsync(4000);
      w.emit({ kind: 'progress', stage: 'parse' });
      await vi.advanceTimersByTimeAsync(4000);
      w.emit({ kind: 'progress', stage: 'verify' });
      await vi.advanceTimersByTimeAsync(4000);
      // Still alive — now deliver the result before the (reset) deadline.
      w.emit({
        kind: 'result',
        result: {
          status: 'valid',
          warnings: [],
          engineVersion: 'test',
          verifiedAt: new Date().toISOString(),
        },
      });
      const r = await promise;
      expect(r.status).toBe('valid');
      expect(w.terminated).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('timeoutMs=0 disables the watchdog', async () => {
    vi.useFakeTimers();
    try {
      const w = installFake();
      const promise = runVerify(new ArrayBuffer(4), { timeoutMs: 0 });
      await vi.advanceTimersByTimeAsync(120_000);
      // No rejection — worker still pending. Deliver result to settle cleanly.
      w.emit({
        kind: 'result',
        result: {
          status: 'valid',
          warnings: [],
          engineVersion: 'test',
          verifiedAt: new Date().toISOString(),
        },
      });
      const r = await promise;
      expect(r.status).toBe('valid');
    } finally {
      vi.useRealTimers();
    }
  });
});
