/**
 * Unit tests for the batch-signing session WORKER (sign-session.worker.ts).
 *
 * The module talks to `self` at import time and via `addEventListener`, so we
 * boot it against a fake `DedicatedWorkerGlobalScope` (an EventTarget with a
 * recording `postMessage`) and drive it with real `message` events. The signer
 * itself is mocked — what's under test here is the worker's session lifecycle,
 * not PAdES.
 *
 * Contract under test:
 *   - `closeSession` ZEROES the retained PKCS#8 (F3-7 / ASVS 8.2) instead of
 *     just dropping the reference, and acknowledges with `sessionClosed` so the
 *     caller can wait before `terminate()` (otherwise the wipe never runs).
 *   - `signNext` messages are serialised INSIDE the worker by a real queue.
 *     An `async` listener does NOT serialise events — two messages that arrive
 *     back to back both enter the handler and interleave at the first `await`,
 *     which would put two decrypted document buffers in flight at once.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const parsePfxMock = vi.fn();
const signPdfPadesMock = vi.fn();
const detectSignaturesMock = vi.fn();

vi.mock('@firma-ec/signer', async () => {
  const actual = await vi.importActual<typeof import('@firma-ec/signer')>('@firma-ec/signer');
  return {
    ...actual,
    parsePfx: (...args: unknown[]) => parsePfxMock(...args),
    signPdfPades: (...args: unknown[]) => signPdfPadesMock(...args),
    detectSignatures: (...args: unknown[]) => detectSignaturesMock(...args),
  };
});

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
  await import('./sign-session.worker');
  return scope;
}

/** Let queued microtasks + the macrotask boundary run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makePkcs8(byteLength = 64, fill = 0xab): ArrayBuffer {
  const buf = new ArrayBuffer(byteLength);
  new Uint8Array(buf).fill(fill);
  return buf;
}

function allZero(buf: ArrayBuffer): boolean {
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i++) if (u[i] !== 0) return false;
  return true;
}

beforeEach(() => {
  parsePfxMock.mockReset();
  signPdfPadesMock.mockReset();
  detectSignaturesMock.mockReset();
  detectSignaturesMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function openSession(scope: FakeWorkerScope, pkcs8: ArrayBuffer): Promise<void> {
  parsePfxMock.mockResolvedValue({
    signingCert: { subjectCN: 'TEST-LEAF', der: new Uint8Array([1]) },
    intermediates: [],
    privateKeyPkcs8Der: pkcs8,
  });
  scope.send({ kind: 'openSession', p12: new ArrayBuffer(8), pin: 'the-pin' });
  await flush();
}

describe('sign-session.worker — closeSession wipes key material', () => {
  it('zeroes the retained PKCS#8 DER (not just drops the reference)', async () => {
    const scope = await bootWorker();
    const pkcs8 = makePkcs8();
    await openSession(scope, pkcs8);
    expect(scope.kinds()).toEqual(['sessionOpened']);
    expect(allZero(pkcs8)).toBe(false); // still live while the session is open

    scope.send({ kind: 'closeSession' });
    await flush();

    expect(allZero(pkcs8)).toBe(true);
  });

  it('acknowledges the wipe with `sessionClosed` so the caller can wait before terminate()', async () => {
    const scope = await bootWorker();
    await openSession(scope, makePkcs8());

    scope.send({ kind: 'closeSession' });
    await flush();

    expect(scope.kinds()).toContain('sessionClosed');
  });

  it('acknowledges even with no session open (close is idempotent from the caller side)', async () => {
    const scope = await bootWorker();
    scope.send({ kind: 'closeSession' });
    await flush();
    expect(scope.kinds()).toEqual(['sessionClosed']);
  });

  it('after closeSession, signNext reports session_not_open (state really gone)', async () => {
    const scope = await bootWorker();
    await openSession(scope, makePkcs8());
    scope.send({ kind: 'closeSession' });
    await flush();

    scope.send({ kind: 'signNext', requestId: 'r1', pdf: new ArrayBuffer(4) });
    await flush();

    const err = scope.posted.find((m) => m.kind === 'signError');
    expect(err).toMatchObject({ requestId: 'r1', code: 'session_not_open' });
  });
});

describe('sign-session.worker — signNext is serialised INSIDE the worker', () => {
  it('two signNext messages arriving back to back never sign concurrently', async () => {
    const scope = await bootWorker();
    await openSession(scope, makePkcs8());

    let inFlight = 0;
    let maxInFlight = 0;
    const releases: (() => void)[] = [];

    signPdfPadesMock.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => releases.push(resolve));
      inFlight -= 1;
      return {
        signedPdf: new Uint8Array([1, 2, 3]),
        timestamp: { ok: false, reason: 'disabled' },
        ltv: {
          profile: 'B-B',
          longTermAchieved: false,
          archiveAchieved: false,
          embeddedOcspCount: 0,
          embeddedCrlCount: 0,
          warnings: [],
        },
      };
    });

    // Both messages are dispatched before either signature completes.
    scope.send({ kind: 'signNext', requestId: 'r1', pdf: new ArrayBuffer(4) });
    scope.send({ kind: 'signNext', requestId: 'r2', pdf: new ArrayBuffer(4) });
    await flush();

    expect(maxInFlight).toBe(1);
    expect(signPdfPadesMock).toHaveBeenCalledTimes(1); // #2 is still queued

    releases.shift()?.();
    await flush();
    expect(signPdfPadesMock).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);

    releases.shift()?.();
    await flush();

    const results = scope.posted.filter((m) => m.kind === 'signResult');
    expect(results.map((m) => m['requestId'])).toEqual(['r1', 'r2']); // FIFO order
    expect(inFlight).toBe(0);
  });
});
