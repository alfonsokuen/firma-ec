/**
 * Unit tests for the placement-analysis bus (preflight-bus.ts).
 *
 * Mirrors the FakeWorker approach used by sign-session-bus.test.ts: no real
 * DOM Worker, we substitute a `FakeAnalysisWorker` via
 * `__setPreflightWorkerFactoryForTests`.
 *
 * Contract under test:
 *   - analyze() posts exactly one 'analyzeNext' with a fresh requestId, and
 *     resolves/rejects correlated by that id.
 *   - No handshake to open: the session is usable immediately, unlike
 *     SignSession (which waits for `sessionOpened`).
 *   - Timeout: a mute worker rejects with the distinguishable
 *     PreflightAnalysisTimeoutError within the configured budget, and the
 *     worker is terminated (no ack to wait for — nothing sensitive retained).
 *   - analyzeError from the worker rejects with that code/message.
 *   - protocolError rejects (bundle-skew case).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PreflightAnalysisTimeoutError,
  PreflightSessionError,
  __setPreflightWorkerFactoryForTests,
  openPreflightSession,
} from './preflight-bus';
import type { PreflightWorkerResponse } from './preflight-bus';

class FakeAnalysisWorker extends EventTarget {
  public readonly postedMessages: unknown[] = [];
  public readonly transferLists: (readonly Transferable[] | undefined)[] = [];
  public terminated = 0;

  postMessage(msg: unknown, transfer?: readonly Transferable[]): void {
    structuredClone(msg);
    this.postedMessages.push(msg);
    this.transferLists.push(transfer);
  }

  terminate(): void {
    this.terminated += 1;
  }

  emit(data: PreflightWorkerResponse): void {
    this.dispatchEvent(Object.assign(new Event('message'), { data }));
  }

  emitError(message: string): void {
    this.dispatchEvent(Object.assign(new Event('error'), { message }));
  }

  emitMessageError(): void {
    this.dispatchEvent(new Event('messageerror'));
  }
}

function installFake(): FakeAnalysisWorker {
  const w = new FakeAnalysisWorker();
  __setPreflightWorkerFactoryForTests(() => w as unknown as Worker);
  return w;
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  __setPreflightWorkerFactoryForTests(null);
  vi.useRealTimers();
});

function outcome(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ready' as const,
    page: 0,
    pageCount: 1,
    source: 'default-footer' as const,
    placement: { page: 0, x: 300, y: 40, width: 240, height: 72, rotate: 0 as const },
    ...overrides,
  };
}

describe('openPreflightSession — no handshake', () => {
  it('is usable immediately: analyze() posts analyzeNext without waiting for an "opened" ack', async () => {
    const w = installFake();
    const session = openPreflightSession();

    const promise = session.analyze(new Uint8Array([1, 2, 3]));
    await Promise.resolve();

    expect(w.postedMessages).toHaveLength(1);
    const msg = w.postedMessages[0] as { kind: string; requestId: string };
    expect(msg.kind).toBe('analyzeNext');

    w.emit({ kind: 'analyzeResult', requestId: msg.requestId, outcome: outcome() });
    await expect(promise).resolves.toMatchObject({ status: 'ready' });
    expect(w.terminated).toBe(0);
  });
});

describe('PreflightSession.analyze — success', () => {
  it('resolves with the outcome from analyzeResult, correlated by requestId', async () => {
    const w = installFake();
    const session = openPreflightSession();

    const promise = session.analyze(new Uint8Array([9, 9]));
    await Promise.resolve();
    const msg = w.postedMessages[0] as { requestId: string };

    w.emit({ kind: 'analyzeResult', requestId: msg.requestId, outcome: outcome({ page: 2 }) });
    await expect(promise).resolves.toMatchObject({ page: 2 });
  });

  it('rejects a concurrent analyze() call while one is already in flight', async () => {
    installFake();
    const session = openPreflightSession();
    const first = session.analyze(new Uint8Array([1]));
    const second = session.analyze(new Uint8Array([2]));
    await expect(second).rejects.toMatchObject({ code: 'concurrency_violation' });
    first.catch(() => {});
  });
});

describe('PreflightSession.analyze — analyzeError', () => {
  it('rejects with the code/message the worker reported', async () => {
    const w = installFake();
    const session = openPreflightSession();

    const promise = session.analyze(new Uint8Array([1]));
    await Promise.resolve();
    const msg = w.postedMessages[0] as { requestId: string };

    w.emit({
      kind: 'analyzeError',
      requestId: msg.requestId,
      code: 'worker_task_failed',
      message: 'boom',
    });

    await expect(promise).rejects.toBeInstanceOf(PreflightSessionError);
    await expect(promise).rejects.toMatchObject({ code: 'worker_task_failed', message: 'boom' });
  });
});

describe('PreflightSession.analyze — protocolError', () => {
  it('rejects on protocolError (bundle/worker version skew)', async () => {
    const w = installFake();
    const session = openPreflightSession();

    const promise = session.analyze(new Uint8Array([1]));
    await Promise.resolve();

    w.emit({
      kind: 'protocolError',
      code: 'unknown_request_kind',
      message: 'worker does not understand request kind analyzeNext',
    });

    await expect(promise).rejects.toMatchObject({ code: 'unknown_request_kind' });
  });
});

describe('PreflightSession.analyze — worker crash', () => {
  it('rejects with worker_error AND terminates the session — QA post-merge 2026-08-03: a dead worker left "open" got the NEXT document posted to it and hung until timeout', async () => {
    const w = installFake();
    const session = openPreflightSession();

    const promise = session.analyze(new Uint8Array([1]));
    await Promise.resolve();
    w.emitError('preflight worker crashed');

    await expect(promise).rejects.toMatchObject({ code: 'worker_error' });
    expect(w.terminated).toBe(1);
    expect(session.isClosed).toBe(true);
  });
});

describe('PreflightSession.analyze — messageerror', () => {
  it('rejects with messageerror AND terminates the session (same reasoning as worker crash)', async () => {
    const w = installFake();
    const session = openPreflightSession();

    const promise = session.analyze(new Uint8Array([1]));
    await Promise.resolve();
    w.emitMessageError();

    await expect(promise).rejects.toMatchObject({ code: 'messageerror' });
    expect(w.terminated).toBe(1);
    expect(session.isClosed).toBe(true);
  });
});

describe('PreflightSession.analyze — timeout', () => {
  it('rejects with PreflightAnalysisTimeoutError within the configured budget and terminates the worker', async () => {
    const w = installFake();
    const session = openPreflightSession();

    // Worker never answers — the DEATH-TEST-worthy path: without the
    // setTimeout below, this would hang the test process indefinitely
    // instead of rejecting.
    const promise = session.analyze(new Uint8Array([1]), { timeoutMs: 20 });

    await expect(promise).rejects.toBeInstanceOf(PreflightAnalysisTimeoutError);
    await expect(promise).rejects.toMatchObject({ code: 'timeout' });
    expect(w.terminated).toBe(1);
  });

  it('a terminated (timed-out) session refuses further analyze() calls', async () => {
    installFake();
    const session = openPreflightSession();

    await expect(session.analyze(new Uint8Array([1]), { timeoutMs: 10 })).rejects.toBeInstanceOf(
      PreflightAnalysisTimeoutError,
    );

    await expect(session.analyze(new Uint8Array([1]))).rejects.toMatchObject({
      code: 'session_closed',
    });
  });
});

describe('PreflightSession.analyze — hint de propagación (F2b)', () => {
  it('posts analyzeNext with the hint, and the outcome carries propagated back', async () => {
    const w = installFake();
    const session = openPreflightSession();
    const hint = { page: 0, preferredU: 100, preferredV: 40, boxW: 240, boxH: 72 };

    const promise = session.analyze(new Uint8Array([1, 2, 3]), { hint });
    await Promise.resolve();

    const msg = w.postedMessages[0] as { kind: string; requestId: string; hint?: typeof hint };
    expect(msg.hint).toEqual(hint);

    w.emit({
      kind: 'analyzeResult',
      requestId: msg.requestId,
      outcome: outcome({ propagated: 'exact' }),
    });
    await expect(promise).resolves.toMatchObject({ propagated: 'exact' });
  });

  it('sin hint, analyzeNext no lleva el campo — comportamiento idéntico al de hoy', async () => {
    const w = installFake();
    const session = openPreflightSession();

    const promise = session.analyze(new Uint8Array([1]));
    await Promise.resolve();

    const msg = w.postedMessages[0] as { hint?: unknown };
    expect(msg.hint).toBeUndefined();

    w.emit({ kind: 'analyzeResult', requestId: (w.postedMessages[0] as { requestId: string }).requestId, outcome: outcome() });
    await expect(promise).resolves.toMatchObject({ status: 'ready' });
  });
});

describe('PreflightSession.terminate', () => {
  it('is idempotent and marks the session closed', async () => {
    const w = installFake();
    const session = openPreflightSession();
    session.terminate();
    session.terminate();
    expect(w.terminated).toBe(1);
    expect(session.isClosed).toBe(true);
  });
});
