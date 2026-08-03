/**
 * Defect #1 (signer half) — AGGREGATE deadline for the LTV phase.
 *
 * `collectLtvData` walks the chain cert by cert, and each leg (OCSP, then the
 * CRL fallback) gets its own `timeoutMs`. With a 3-cert chain that is up to
 * 6 network waits, so a per-request timeout bounds NOTHING in aggregate: the
 * real ceiling is `timeoutMs × legs`, which is how the network budget of one
 * document ended up LARGER than the document's own signing timeout.
 *
 * The fix is an ADDITIVE optional `deadlineAt` (epoch ms). Default `undefined`
 * = today's behaviour byte for byte; when set, the collector stops starting new
 * network legs past the deadline and says so in a warning instead of silently
 * blowing the caller's budget.
 *
 * Network is faked at `globalThis.fetch` — nothing in the LTV path is mocked.
 */

import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as pkijs from 'pkijs';

import { forgeToParsedCert, makeSynthPair } from '../../ltv-validation/tests/helpers/synthCerts.js';
import { collectLtvData } from '../src/ltv.js';
import type { SignerCert } from '../src/types.js';

const OCSP_URL = 'http://ocsp.deadline.invalid/';

beforeAll(() => {
  pkijs.setEngine(
    'node-webcrypto',
    new pkijs.CryptoEngine({ name: 'node-webcrypto', crypto: webcrypto as unknown as Crypto }),
  );
  if (!(globalThis as { crypto?: Crypto }).crypto) {
    (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
  }
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function toSignerCert(parsed: ReturnType<typeof forgeToParsedCert>): SignerCert {
  return {
    der: parsed.der,
    subjectCN: parsed.subjectCN ?? '',
    issuerCN: parsed.issuerCN ?? '',
    notBefore: parsed.notBefore,
    notAfter: parsed.notAfter,
    serialHex: '02AB',
  };
}

function buildChain(): { signerCert: SignerCert; intermediates: SignerCert[] } {
  const pair = makeSynthPair({ withAia: OCSP_URL });
  return {
    signerCert: toSignerCert(forgeToParsedCert(pair.leafCert)),
    intermediates: [toSignerCert(forgeToParsedCert(pair.caCert))],
  };
}

describe('collectLtvData — aggregate deadline (defect #1)', () => {
  it('does not start ANY network leg when the deadline has already passed, and says so', async () => {
    const chain = buildChain();
    const fetchSpy = vi.fn(async () => new Response(new Uint8Array([0x30, 0x00]), { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    const res = await collectLtvData({
      ...chain,
      signatureContents: new Uint8Array([1, 2, 3, 4]),
      timeoutMs: 8000,
      ocspUrl: OCSP_URL,
      proxyMap: null,
      // Already expired: the caller's whole LTV budget is spent.
      deadlineAt: Date.now() - 1,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.warnings.map((w) => w.code)).toContain('ltv_deadline_exceeded');
    expect(res.data.ocsps).toHaveLength(0);
    expect(res.revoked).toBe(false);
  });

  it('clamps each leg to the time left, so the aggregate wait cannot exceed the deadline', async () => {
    const chain = buildChain();
    // A responder that never answers: every leg burns its full timeout.
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      })) as unknown as typeof globalThis.fetch;

    const AGGREGATE_BUDGET_MS = 300;
    const started = Date.now();
    const res = await collectLtvData({
      ...chain,
      signatureContents: new Uint8Array([1, 2, 3, 4]),
      // Per-leg timeout LARGER than the whole aggregate budget: without the
      // deadline this walk takes 8s × legs.
      timeoutMs: 8000,
      ocspUrl: OCSP_URL,
      proxyMap: null,
      deadlineAt: started + AGGREGATE_BUDGET_MS,
    });
    const elapsed = Date.now() - started;

    // Generous slack for CI scheduling, but nowhere near 8000ms × legs.
    expect(elapsed).toBeLessThan(AGGREGATE_BUDGET_MS + 1_500);
    expect(res.revoked).toBe(false);
  });

  it('without deadlineAt, behaviour is unchanged (every leg gets the full per-request timeout)', async () => {
    const chain = buildChain();
    const seenTimeouts: number[] = [];
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      // Record that a request was actually issued, then fail fast so the
      // cascade continues without waiting.
      seenTimeouts.push(1);
      void init;
      return Promise.reject(new Error('network down'));
    }) as unknown as typeof globalThis.fetch;

    const res = await collectLtvData({
      ...chain,
      signatureContents: new Uint8Array([1, 2, 3, 4]),
      timeoutMs: 50,
      ocspUrl: OCSP_URL,
      proxyMap: null,
    });

    expect(seenTimeouts.length).toBeGreaterThan(0);
    expect(res.warnings.map((w) => w.code)).not.toContain('ltv_deadline_exceeded');
  });
});
