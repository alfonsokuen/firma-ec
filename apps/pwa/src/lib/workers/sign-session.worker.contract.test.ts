/**
 * Session-worker contract tests — defects #6, #8, #9, #11.
 *
 * Same fake-`self` boot harness as sign-session.worker.test.ts (that file pins
 * the wipe + FIFO invariants; this one pins the DIAGNOSTIC contract):
 *
 *   #6  a failure that escapes the per-request handler still names the document
 *       it belongs to, instead of `requestId: 'unknown'` — which the bus drops
 *       on the floor, leaving the caller to time out and blame 'timeout'.
 *   #8  `closeSession` must SKIP the queue: a session given up on has to be
 *       wiped now, not after the signature we already abandoned finishes. And
 *       when the key material cannot be zeroed, the ack says `wiped: false`
 *       instead of pretending the mitigation ran.
 *   #9  an unknown message `kind` is answered, not ignored: in a PWA a stale
 *       bundle talking to a fresh worker (or the reverse) is the norm.
 *   #11 progress stages must follow the ATTEMPT, not precede it: emitting
 *       `request_timestamp`/`fetch_ocsp` unconditionally before signing made the
 *       UI claim network work that never happened.
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
  /** Message kinds whose `postMessage` should throw ONCE (simulates DataCloneError). */
  public throwOnceFor = new Set<string>();

  postMessage(msg: unknown): void {
    const kind = (msg as { kind: string }).kind;
    if (this.throwOnceFor.has(kind)) {
      this.throwOnceFor.delete(kind);
      throw new Error(`postMessage failed for ${kind}`);
    }
    this.posted.push(msg as { kind: string });
  }

  send(data: unknown): void {
    this.dispatchEvent(Object.assign(new Event('message'), { data }));
  }

  kinds(): string[] {
    return this.posted.map((m) => m.kind);
  }

  find(kind: string): { kind: string; [k: string]: unknown } | undefined {
    return this.posted.find((m) => m.kind === kind);
  }

  stages(): string[] {
    return this.posted.filter((m) => m.kind === 'signProgress').map((m) => m['stage'] as string);
  }
}

async function bootWorker(): Promise<FakeWorkerScope> {
  const scope = new FakeWorkerScope();
  vi.stubGlobal('self', scope);
  vi.resetModules();
  await import('./sign-session.worker');
  return scope;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makePkcs8(byteLength = 64, fill = 0xab): ArrayBuffer {
  return new Uint8Array(byteLength).fill(fill).buffer;
}

function allZero(buf: ArrayBufferLike): boolean {
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i++) if (u[i] !== 0) return false;
  return true;
}

async function openSession(
  scope: FakeWorkerScope,
  privateKeyPkcs8Der: unknown = makePkcs8(),
): Promise<void> {
  parsePfxMock.mockResolvedValue({
    signingCert: { subjectCN: 'TEST-LEAF', der: new Uint8Array([1]) },
    intermediates: [],
    privateKeyPkcs8Der,
  });
  scope.send({ kind: 'openSession', p12: new ArrayBuffer(8), pin: 'the-pin' });
  await flush();
}

/** A minimal successful signPdfPades outcome. */
function okSignResult(over: Record<string, unknown> = {}): Record<string, unknown> {
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
    ...over,
  };
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
  vi.restoreAllMocks();
});

describe('defect #6 — a last-resort failure names its document', () => {
  it('reports the in-flight requestId, not "unknown", when the handler itself blows up', async () => {
    const scope = await bootWorker();
    await openSession(scope);
    signPdfPadesMock.mockResolvedValue(okSignResult());
    // The error path itself fails to post (DataCloneError shape), so the failure
    // escapes handleSignNext and lands in the queue's last-resort handler.
    detectSignaturesMock.mockRejectedValue(new Error('boom inside the worker'));
    scope.throwOnceFor.add('signError');

    scope.send({ kind: 'signNext', requestId: 'r-42', pdf: new ArrayBuffer(4) });
    await flush();

    const err = scope.find('signError');
    expect(err).toBeDefined();
    expect(err!['requestId']).toBe('r-42');
    expect(String(err!['message'])).toContain('boom inside the worker');
  });
});

describe('defect #8 — closeSession skips the queue and reports whether it wiped', () => {
  it('wipes and acks immediately, without waiting for the signature already given up on', async () => {
    const scope = await bootWorker();
    const pkcs8 = makePkcs8();
    await openSession(scope, pkcs8);

    // A signature that never finishes: exactly the case where the caller's
    // per-document timeout fired and it decided to kill the session.
    let release = (): void => {};
    signPdfPadesMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(okSignResult());
        }),
    );

    scope.send({ kind: 'signNext', requestId: 'r1', pdf: new ArrayBuffer(4) });
    await flush();
    expect(signPdfPadesMock).toHaveBeenCalledTimes(1);

    scope.send({ kind: 'closeSession' });
    await flush();

    expect(scope.kinds()).toContain('sessionClosed');
    expect(allZero(pkcs8)).toBe(true);
    release();
    await flush();
  });

  it('acks with wiped:true on the normal path', async () => {
    const scope = await bootWorker();
    await openSession(scope, makePkcs8());
    scope.send({ kind: 'closeSession' });
    await flush();
    expect(scope.find('sessionClosed')).toMatchObject({ wiped: true });
  });

  it('zeroes a PKCS#8 handed over as a VIEW (Uint8Array), not only as an ArrayBuffer', async () => {
    const scope = await bootWorker();
    const backing = new ArrayBuffer(64);
    const view = new Uint8Array(backing).fill(0xcd);
    await openSession(scope, view);

    scope.send({ kind: 'closeSession' });
    await flush();

    expect(allZero(backing)).toBe(true);
    expect(scope.find('sessionClosed')).toMatchObject({ wiped: true });
  });

  it('says wiped:false (and warns) when the key material is NOT zeroable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scope = await bootWorker();
    // A string PKCS#8: JS strings are immutable, so the mitigation cannot run.
    await openSession(scope, 'MIIEvQIBADANBg...' as unknown);

    scope.send({ kind: 'closeSession' });
    await flush();

    expect(scope.find('sessionClosed')).toMatchObject({ wiped: false });
    expect(warn).toHaveBeenCalled();
  });
});

describe('defect #9 — an unknown message kind is answered, not ignored', () => {
  it('replies with a protocol error naming the kind it does not understand', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scope = await bootWorker();

    scope.send({ kind: 'signNextV2', requestId: 'r1', pdf: new ArrayBuffer(4) });
    await flush();

    const err = scope.find('protocolError');
    expect(err).toBeDefined();
    expect(err!['code']).toBe('unknown_request_kind');
    expect(String(err!['message'])).toContain('signNextV2');
    expect(warn).toHaveBeenCalled();
  });
});

describe('defect #11 — progress follows the attempt, never precedes it', () => {
  it('does NOT claim request_timestamp when the signer never attempted a timestamp', async () => {
    const scope = await bootWorker();
    await openSession(scope);
    signPdfPadesMock.mockResolvedValue(okSignResult());

    scope.send({
      kind: 'signNext',
      requestId: 'r1',
      pdf: new ArrayBuffer(4),
      timestampEnabled: true,
      ltvEnabled: true,
    });
    await flush();

    expect(scope.stages()).not.toContain('request_timestamp');
    expect(scope.stages()).not.toContain('fetch_ocsp');
    expect(scope.kinds()).toContain('signResult');
  });

  it('emits request_timestamp only when the signer actually asked the TSA', async () => {
    const scope = await bootWorker();
    await openSession(scope);
    signPdfPadesMock.mockImplementation(
      async (
        _pdf: unknown,
        _pfx: unknown,
        opts: {
          onTimestampResult?: (r: unknown) => void;
        },
      ) => {
        opts.onTimestampResult?.({ error: 'timeout' });
        return okSignResult({ timestamp: { ok: false, reason: 'timeout' } });
      },
    );

    scope.send({ kind: 'signNext', requestId: 'r1', pdf: new ArrayBuffer(4) });
    await flush();

    expect(scope.stages()).toContain('request_timestamp');
  });

  it('emits fetch_ocsp only when a revocation lookup really happened', async () => {
    const scope = await bootWorker();
    await openSession(scope);
    signPdfPadesMock.mockImplementation(
      async (
        _pdf: unknown,
        _pfx: unknown,
        opts: {
          ltv?: { onLtvResult?: (m: unknown) => void };
        },
      ) => {
        const meta = {
          profile: 'B-T',
          longTermAchieved: false,
          archiveAchieved: false,
          embeddedOcspCount: 0,
          embeddedCrlCount: 0,
          warnings: [{ code: 'ocsp_timeout' }],
        };
        opts.ltv?.onLtvResult?.(meta);
        return okSignResult({ ltv: meta });
      },
    );

    scope.send({ kind: 'signNext', requestId: 'r1', pdf: new ArrayBuffer(4) });
    await flush();

    expect(scope.stages()).toContain('fetch_ocsp');
  });
});
