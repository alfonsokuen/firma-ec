/**
 * Unit tests for the placement-analysis WORKER (preflight.worker.ts).
 *
 * Same pattern as `sign-session.worker.test.ts`: the module talks to `self`
 * at import time and via `addEventListener`, so we boot it against a fake
 * `DedicatedWorkerGlobalScope` and drive it with real `message` events.
 *
 * `@firma-ec/signer` is NOT mocked here — the point of this suite is that
 * the worker's `analyzeNext` handler really runs `analyzeForPreflight`
 * against real PDF bytes, not that the wiring compiles.
 *
 * Contract under test:
 *   - `analyzeNext` → `analyzeResult` carrying the real placement outcome.
 *   - Two `analyzeNext` messages sent back to back (before either settles)
 *     are answered in FIFO order — same queue discipline as
 *     sign-session.worker.ts, needed because an `async` listener does not
 *     serialise events on its own.
 *   - An unknown `kind` → `protocolError` (bundle/worker version skew).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMinimalPdfBuffer } from '../workers/minimalPdf.fixture';

class FakeWorkerScope extends EventTarget {
  public readonly posted: { kind: string; [k: string]: unknown }[] = [];

  postMessage(msg: unknown): void {
    this.posted.push(msg as { kind: string });
  }

  send(data: unknown): void {
    this.dispatchEvent(Object.assign(new Event('message'), { data }));
  }

  kinds(): string[] {
    return this.posted.map((m) => m.kind);
  }
}

/** Boot a fresh copy of the worker module bound to a fresh fake scope. */
async function bootWorker(): Promise<FakeWorkerScope> {
  const scope = new FakeWorkerScope();
  vi.stubGlobal('self', scope);
  vi.resetModules();
  await import('./preflight.worker');
  return scope;
}

/** Let queued microtasks + the macrotask boundary run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A single-page, unrotated, unsigned PDF — lands on the default-footer path. */
function simplePdf(): ArrayBuffer {
  return buildMinimalPdfBuffer([{}]);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('preflight.worker — analyzeNext', () => {
  it('responds with analyzeResult carrying a real placement outcome', async () => {
    const scope = await bootWorker();

    scope.send({ kind: 'analyzeNext', requestId: 'r1', pdf: simplePdf() });
    await flush();

    expect(scope.kinds()).toEqual(['analyzeResult']);
    const result = scope.posted[0] as unknown as { requestId: string; outcome: { status: string } };
    expect(result.requestId).toBe('r1');
    expect(result.outcome.status).toBe('ready');
  });

  it('answers analyzeResult with status unreadable for garbage bytes, never hangs or throws uncaught', async () => {
    const scope = await bootWorker();

    // Garbage bytes: analyzePdfForPlacement resolves with `.failure` per its
    // own contract (documented to NEVER throw), so this exercises that
    // contract for real — the worker's own last-resort try/catch (the
    // reinstated safety net) is a separate layer for the case that contract
    // is ever violated, and is not reachable without mocking the signer.
    scope.send({
      kind: 'analyzeNext',
      requestId: 'r1',
      pdf: new Uint8Array([1, 2, 3]).buffer,
    });
    await flush();

    expect(scope.kinds()).toEqual(['analyzeResult']);
    const result = scope.posted[0] as unknown as { outcome: { status: string } };
    expect(result.outcome.status).toBe('unreadable');
  });
});

describe('preflight.worker — analyzeNext is serialised INSIDE the worker (FIFO)', () => {
  it('two analyzeNext messages arriving back to back are answered in order', async () => {
    const scope = await bootWorker();

    scope.send({ kind: 'analyzeNext', requestId: 'r1', pdf: simplePdf() });
    scope.send({ kind: 'analyzeNext', requestId: 'r2', pdf: simplePdf() });
    await flush();

    const results = scope.posted.filter((m) => m.kind === 'analyzeResult');
    expect(results.map((m) => m['requestId'])).toEqual(['r1', 'r2']);
  });
});

describe('preflight.worker — analyzeNext con hint de propagación (F2b)', () => {
  it('el hint viaja hasta analyzeForPreflight y vuelve como propagated en el outcome', async () => {
    const scope = await bootWorker();

    // Documento sin obstáculos: cae a `default-footer`, que ignora el ancla
    // del hint pero SÍ usa su boxW/boxH — igual que
    // `preflight-core.parity.test.ts`, el hint reproduce la posición que ya
    // caería ahí sin ayuda, así que la clasificación debe ser 'exact'.
    scope.send({ kind: 'analyzeNext', requestId: 'r1', pdf: simplePdf() });
    await flush();
    const baseline = scope.posted[0] as unknown as {
      outcome: { placement: { x: number; y: number; width: number; height: number } };
    };
    const { placement } = baseline.outcome;

    scope.send({
      kind: 'analyzeNext',
      requestId: 'r2',
      pdf: simplePdf(),
      hint: {
        page: 0,
        preferredU: placement.x,
        preferredV: placement.y,
        boxW: placement.width,
        boxH: placement.height,
      },
    });
    await flush();

    const result = scope.posted[1] as unknown as { outcome: { propagated?: string } };
    expect(result.outcome.propagated).toBe('exact');
  });

  it('un request sin el campo hint (skew de versiones) responde igual, sin propagated y sin colgarse', async () => {
    const scope = await bootWorker();

    scope.send({ kind: 'analyzeNext', requestId: 'r1', pdf: simplePdf() });
    await flush();

    expect(scope.kinds()).toEqual(['analyzeResult']);
    const result = scope.posted[0] as unknown as { outcome: { status: string; propagated?: string } };
    expect(result.outcome.status).toBe('ready');
    expect(result.outcome.propagated).toBeUndefined();
  });
});

describe('preflight.worker — unknown message kind', () => {
  it('responds with protocolError instead of staying silent', async () => {
    const scope = await bootWorker();

    scope.send({ kind: 'somethingElse' });
    await flush();

    expect(scope.kinds()).toEqual(['protocolError']);
    const result = scope.posted[0] as unknown as { code: string };
    expect(result.code).toBe('unknown_request_kind');
  });
});
