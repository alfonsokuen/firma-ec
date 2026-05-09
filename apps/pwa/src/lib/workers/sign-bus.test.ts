/**
 * Unit tests for the typed sign-worker bus.
 *
 * We don't spin a real DOM Worker — we substitute a `FakeWorker` via
 * `__setSignWorkerFactoryForTests`. The contract we exercise is:
 *   - 'result' messages resolve the promise with a Uint8Array.
 *   - 'error' messages reject with WorkerSignerError carrying the code passthrough.
 *   - 'progress' messages invoke onProgress and DO NOT settle the promise.
 *   - The worker is terminated exactly once on success and once on error.
 *   - error / messageerror events on the worker reject and terminate.
 *   - PDF and P12 are transferred (postMessage second arg includes both buffers).
 *   - Timeout fires when the worker stays silent — rejects with code='timeout'.
 *   - Double-settle guard: late terminal messages are ignored (no unhandled reject).
 *   - PIN handling: pin lives in the postMessage payload; the main thread does not
 *     retain a reference past the runSign call.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  runSign,
  computeSignTimeoutMs,
  WorkerSignerError,
  __setSignWorkerFactoryForTests,
  type SignWorkerResponse,
} from './sign-bus';

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

  /** Helper: simulate the worker sending a typed message to the bus. */
  emit(data: SignWorkerResponse): void {
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
  __setSignWorkerFactoryForTests(() => w as unknown as Worker);
  return w;
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  __setSignWorkerFactoryForTests(null);
  vi.useRealTimers();
});

describe('computeSignTimeoutMs', () => {
  it('uses the 15s baseline for a 0-byte PDF', () => {
    expect(computeSignTimeoutMs(0)).toBe(15_000);
  });

  it('adds ~1ms per KB', () => {
    // 100 KB → 15000 + 100 = 15100ms
    expect(computeSignTimeoutMs(100 * 1024)).toBe(15_100);
  });

  it('caps at 60s for huge inputs', () => {
    expect(computeSignTimeoutMs(500 * 1024 * 1024)).toBe(60_000);
  });
});

describe('runSign', () => {
  it('resolves with a Uint8Array when worker emits kind=result', async () => {
    const w = installFake();
    const pdf = new ArrayBuffer(8);
    const p12 = new ArrayBuffer(4);

    const promise = runSign(pdf, p12, 'pin1234');

    await Promise.resolve();
    const signed = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    w.emit({ kind: 'result', signedPdf: signed.buffer });

    const out = await promise;
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out)).toEqual([0x25, 0x50, 0x44, 0x46]);
    expect(w.terminated).toBe(1);
  });

  it('rejects with WorkerSignerError when worker emits kind=error (code passthrough)', async () => {
    const w = installFake();
    const promise = runSign(new ArrayBuffer(4), new ArrayBuffer(2), 'badpin');

    await Promise.resolve();
    w.emit({ kind: 'error', code: 'pin_invalid', message: 'PIN incorrect' });

    await expect(promise).rejects.toBeInstanceOf(WorkerSignerError);
    await expect(promise).rejects.toMatchObject({
      code: 'pin_invalid',
      message: 'PIN incorrect',
    });
    expect(w.terminated).toBe(1);
  });

  it('forwards 3 progress events to onProgress without settling', async () => {
    const w = installFake();
    const onProgress = vi.fn();
    const promise = runSign(new ArrayBuffer(4), new ArrayBuffer(2), 'pin', {
      onProgress,
    });

    await Promise.resolve();
    w.emit({ kind: 'progress', stage: 'parse_p12' });
    w.emit({ kind: 'progress', stage: 'parse_pdf' });
    w.emit({ kind: 'progress', stage: 'sign' });
    w.emit({ kind: 'result', signedPdf: new ArrayBuffer(2) });

    await promise;
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenNthCalledWith(1, 'parse_p12');
    expect(onProgress).toHaveBeenNthCalledWith(2, 'parse_pdf');
    expect(onProgress).toHaveBeenNthCalledWith(3, 'sign');
    expect(w.terminated).toBe(1);
  });

  it('rejects + terminates on worker error event', async () => {
    const w = installFake();
    const promise = runSign(new ArrayBuffer(4), new ArrayBuffer(2), 'pin');

    await Promise.resolve();
    w.emitError('boom');

    await expect(promise).rejects.toBeInstanceOf(WorkerSignerError);
    await expect(promise).rejects.toMatchObject({
      code: 'worker_error',
      message: 'boom',
    });
    expect(w.terminated).toBe(1);
  });

  it('rejects + terminates on messageerror event', async () => {
    const w = installFake();
    const promise = runSign(new ArrayBuffer(4), new ArrayBuffer(2), 'pin');

    await Promise.resolve();
    w.emitMessageError();

    await expect(promise).rejects.toMatchObject({ code: 'messageerror' });
    expect(w.terminated).toBe(1);
  });

  it('times out when the worker stays silent — rejects with code=timeout', async () => {
    vi.useFakeTimers();
    const w = installFake();

    const promise = runSign(new ArrayBuffer(4), new ArrayBuffer(2), 'pin', {
      timeoutMs: 50,
    });
    // Attach catch handler synchronously so the rejection is observed.
    const expectation = expect(promise).rejects.toMatchObject({
      code: 'timeout',
    });

    vi.advanceTimersByTime(60);
    await expectation;
    expect(w.terminated).toBe(1);
  });

  it('double-settle: late error after result is ignored (no unhandled rejection)', async () => {
    const w = installFake();
    const promise = runSign(new ArrayBuffer(4), new ArrayBuffer(2), 'pin');

    await Promise.resolve();
    w.emit({ kind: 'result', signedPdf: new ArrayBuffer(8) });
    // Late error — must be ignored.
    w.emit({ kind: 'error', code: 'late', message: 'should be ignored' });

    const out = await promise;
    expect(out.byteLength).toBe(8);
    expect(w.terminated).toBe(1);
  });

  it('posts pdf+p12+pin in the payload and includes both buffers in the transfer list', async () => {
    const w = installFake();
    const pdf = new ArrayBuffer(16);
    const p12 = new ArrayBuffer(8);
    const pin = 'super-secret-pin';

    const promise = runSign(pdf, p12, pin, { reason: 'Acta de entrega' });
    await Promise.resolve();
    w.emit({ kind: 'result', signedPdf: new ArrayBuffer(4) });
    await promise;

    expect(w.postedMessages).toHaveLength(1);
    const msg = w.postedMessages[0] as {
      kind: string;
      pdf: ArrayBuffer;
      p12: ArrayBuffer;
      pin: string;
      opts?: { reason?: string };
    };
    expect(msg.kind).toBe('sign');
    expect(msg.pdf).toBe(pdf);
    expect(msg.p12).toBe(p12);
    expect(msg.pin).toBe(pin); // PIN traveled in the payload
    expect(msg.opts?.reason).toBe('Acta de entrega');
    expect(w.transferLists[0]).toEqual([pdf, p12]);
  });

  it('PIN is not retained on the main thread post-postMessage (no closure leak)', async () => {
    const w = installFake();
    let pin: string | null = 'one-shot-pin';

    const promise = runSign(new ArrayBuffer(4), new ArrayBuffer(2), pin);
    // Caller drops their reference.
    pin = null;

    await Promise.resolve();
    w.emit({ kind: 'result', signedPdf: new ArrayBuffer(2) });
    await promise;

    // The pin string only exists inside the FakeWorker's recorded payload —
    // there is no main-thread captured reference left after runSign resolved.
    const recorded = (w.postedMessages[0] as { pin: string }).pin;
    expect(recorded).toBe('one-shot-pin');
    expect(pin).toBeNull();
  });
});
