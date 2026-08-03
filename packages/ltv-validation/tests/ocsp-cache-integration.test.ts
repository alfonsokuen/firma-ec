/**
 * Integration test for the OCSP response cache — `fetchOcsp` itself, NOT a
 * mock of it.
 *
 * Why this file exists: the cache used to be write-only (`fetchOcsp` did
 * `cache.set(...)` and nobody ever called `.get(...)`), so every document in a
 * batch re-queried the responder. A test that mocks `fetchOcsp` with a
 * cache-aware fake proves nothing about `fetchOcsp` — it tests the fake. Here
 * the unit under test is the real function and the only thing faked is the
 * network (`fetchImpl`), so `networkCalls` is hard evidence of hit vs miss.
 *
 * Bidirectional corpus (both directions asserted):
 *   HIT  — 2nd call inside the TTL, response still inside its nextUpdate window
 *          ⇒ no network call.
 *   MISS — (a) TTL expired, (b) response's `nextUpdate` already passed,
 *          (c) response's `thisUpdate` in the future (clock skew)
 *          ⇒ network is queried again.
 *
 * (b) and (c) are the SECURITY direction: a cached revocation state that is no
 * longer valid must never be served, even when the 1h TTL has not elapsed.
 */

import { describe, expect, it } from 'vitest';
import { createOcspCache } from '../src/cache';
import { fetchOcsp } from '../src/ocsp/fetch';
import type { OcspCache } from '../src/types';
import { forgeToParsedCert, makeSignedOcspResponseDer, makeSynthPair } from './helpers/synthCerts';

const OCSP_URL = 'http://ocsp.example.com/';
const HOUR_MS = 60 * 60 * 1000;

interface Harness {
  leaf: ReturnType<typeof forgeToParsedCert>;
  ca: ReturnType<typeof forgeToParsedCert>;
  fetchImpl: typeof globalThis.fetch;
  networkCalls: () => number;
}

/**
 * A responder fake: parses the posted OCSPRequest and answers with a real
 * CA-signed response echoing its CertID, with caller-chosen validity window.
 */
function makeHarness(window: { thisUpdate: Date; nextUpdate?: Date }): Harness {
  const pair = makeSynthPair({ withAia: OCSP_URL });
  const leaf = forgeToParsedCert(pair.leafCert);
  const ca = forgeToParsedCert(pair.caCert);
  let calls = 0;

  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    calls += 1;
    const body = init?.body as ArrayBuffer;
    const der = makeSignedOcspResponseDer({
      requestDer: new Uint8Array(body),
      caCert: pair.caCert,
      caKey: pair.caKey,
      thisUpdate: window.thisUpdate,
      ...(window.nextUpdate ? { nextUpdate: window.nextUpdate } : {}),
    });
    return new Response(der, {
      status: 200,
      headers: { 'Content-Type': 'application/ocsp-response' },
    });
  }) as unknown as typeof globalThis.fetch;

  return { leaf, ca, fetchImpl, networkCalls: () => calls };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('fetchOcsp — cache is READ, not only written', () => {
  it('sanity: the synthetic responder produces a response fetchOcsp accepts (ok + signature valid)', async () => {
    const now = new Date();
    const h = makeHarness({
      thisUpdate: new Date(now.getTime() - 60_000),
      nextUpdate: new Date(now.getTime() + HOUR_MS),
    });
    const r = await fetchOcsp(h.leaf, h.ca, { fetchImpl: h.fetchImpl, hashAlgo: 'sha1' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe('good');
      expect(r.signatureValid).toBe(true);
    }
  });

  it('HIT: second call within the TTL and inside nextUpdate does NOT hit the network', async () => {
    const now = new Date();
    const h = makeHarness({
      thisUpdate: new Date(now.getTime() - 60_000),
      nextUpdate: new Date(now.getTime() + HOUR_MS),
    });
    const cache: OcspCache = createOcspCache();

    const first = await fetchOcsp(h.leaf, h.ca, {
      fetchImpl: h.fetchImpl,
      hashAlgo: 'sha1',
      cache,
    });
    expect(first.ok).toBe(true);
    expect(h.networkCalls()).toBe(1);
    expect(cache.size).toBe(1);

    const second = await fetchOcsp(h.leaf, h.ca, {
      fetchImpl: h.fetchImpl,
      hashAlgo: 'sha1',
      cache,
    });
    expect(second.ok).toBe(true);
    // THE point of the whole feature: no second round trip to the responder.
    expect(h.networkCalls()).toBe(1);
    if (second.ok && first.ok) {
      expect(second.responseDer).toEqual(first.responseDer);
    }
  });

  it('MISS: once the TTL expires the responder is queried again', async () => {
    const now = new Date();
    const h = makeHarness({
      thisUpdate: new Date(now.getTime() - 60_000),
      nextUpdate: new Date(now.getTime() + HOUR_MS),
    });
    const cache: OcspCache = createOcspCache(10); // 10 ms TTL

    await fetchOcsp(h.leaf, h.ca, { fetchImpl: h.fetchImpl, hashAlgo: 'sha1', cache });
    expect(h.networkCalls()).toBe(1);

    await sleep(30);

    await fetchOcsp(h.leaf, h.ca, { fetchImpl: h.fetchImpl, hashAlgo: 'sha1', cache });
    expect(h.networkCalls()).toBe(2);
  });

  it('MISS (security): a response whose nextUpdate already passed is never served from cache', async () => {
    const now = new Date();
    const h = makeHarness({
      thisUpdate: new Date(now.getTime() - 3 * HOUR_MS),
      nextUpdate: new Date(now.getTime() - HOUR_MS), // expired an hour ago
    });
    const cache: OcspCache = createOcspCache(); // TTL 1h — NOT expired

    const first = await fetchOcsp(h.leaf, h.ca, {
      fetchImpl: h.fetchImpl,
      hashAlgo: 'sha1',
      cache,
    });
    expect(first.ok).toBe(true);
    expect(h.networkCalls()).toBe(1);

    const second = await fetchOcsp(h.leaf, h.ca, {
      fetchImpl: h.fetchImpl,
      hashAlgo: 'sha1',
      cache,
    });
    expect(second.ok).toBe(true);
    // Stale revocation state must NOT be reused even though the TTL is alive.
    expect(h.networkCalls()).toBe(2);
  });

  it('MISS (clock skew): a response whose thisUpdate is in the future is not served from cache', async () => {
    const now = new Date();
    const h = makeHarness({
      thisUpdate: new Date(now.getTime() + 2 * HOUR_MS),
      nextUpdate: new Date(now.getTime() + 4 * HOUR_MS),
    });
    const cache: OcspCache = createOcspCache();

    await fetchOcsp(h.leaf, h.ca, { fetchImpl: h.fetchImpl, hashAlgo: 'sha1', cache });
    expect(h.networkCalls()).toBe(1);

    await fetchOcsp(h.leaf, h.ca, { fetchImpl: h.fetchImpl, hashAlgo: 'sha1', cache });
    expect(h.networkCalls()).toBe(2);
  });

  it('a response with NO nextUpdate is cacheable and served within the TTL', async () => {
    const now = new Date();
    const h = makeHarness({ thisUpdate: new Date(now.getTime() - 60_000) });
    const cache: OcspCache = createOcspCache();

    await fetchOcsp(h.leaf, h.ca, { fetchImpl: h.fetchImpl, hashAlgo: 'sha1', cache });
    await fetchOcsp(h.leaf, h.ca, { fetchImpl: h.fetchImpl, hashAlgo: 'sha1', cache });
    // Absent nextUpdate, the TTL is the only bound — and it has not elapsed.
    expect(h.networkCalls()).toBe(1);
  });

  it('two different certs do not share a cache entry', async () => {
    const now = new Date();
    const a = makeHarness({
      thisUpdate: new Date(now.getTime() - 60_000),
      nextUpdate: new Date(now.getTime() + HOUR_MS),
    });
    const b = makeHarness({
      thisUpdate: new Date(now.getTime() - 60_000),
      nextUpdate: new Date(now.getTime() + HOUR_MS),
    });
    const cache: OcspCache = createOcspCache();

    await fetchOcsp(a.leaf, a.ca, { fetchImpl: a.fetchImpl, hashAlgo: 'sha1', cache });
    await fetchOcsp(b.leaf, b.ca, { fetchImpl: b.fetchImpl, hashAlgo: 'sha1', cache });
    expect(a.networkCalls()).toBe(1);
    expect(b.networkCalls()).toBe(1);
    expect(cache.size).toBe(2);
  });
});
