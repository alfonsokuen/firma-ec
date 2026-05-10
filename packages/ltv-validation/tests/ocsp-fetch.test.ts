import { describe, it, expect } from 'vitest';
import { fetchOcsp, requestOcsp } from '../src/ocsp/fetch';
import { makeSynthPair, forgeToParsedCert } from './helpers/synthCerts';

describe('fetchOcsp transport errors', () => {
  it('returns no_aia when cert lacks AIA OCSP and no opts.url', async () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(pair.leafCert);
    const ca = forgeToParsedCert(pair.caCert);
    const r = await fetchOcsp(leaf, ca, {
      fetchImpl: (() => {
        throw new Error('must not fetch');
      }) as unknown as typeof globalThis.fetch,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_aia');
  });

  it('returns rate_limited on HTTP 429', async () => {
    const pair = makeSynthPair({ withAia: 'http://ocsp.example.com' });
    const leaf = forgeToParsedCert(pair.leafCert);
    const ca = forgeToParsedCert(pair.caCert);
    const fakeFetch = (async () =>
      new Response(new Uint8Array(0), { status: 429, statusText: 'Too Many Requests' })) as unknown as typeof globalThis.fetch;
    const r = await fetchOcsp(leaf, ca, { fetchImpl: fakeFetch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('rate_limited');
  });

  it('returns timeout on AbortError', async () => {
    const pair = makeSynthPair({ withAia: 'http://ocsp.example.com' });
    const leaf = forgeToParsedCert(pair.leafCert);
    const ca = forgeToParsedCert(pair.caCert);
    const fakeFetch = (async () => {
      const e = new Error('aborted') as Error & { name: string };
      e.name = 'AbortError';
      throw e;
    }) as unknown as typeof globalThis.fetch;
    const r = await fetchOcsp(leaf, ca, { fetchImpl: fakeFetch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('timeout');
  });

  it('returns malformed when response body is garbage bytes', async () => {
    const pair = makeSynthPair({ withAia: 'http://ocsp.example.com' });
    const leaf = forgeToParsedCert(pair.leafCert);
    const ca = forgeToParsedCert(pair.caCert);
    const fakeFetch = (async () =>
      new Response(new Uint8Array([0x99, 0x99, 0x99, 0x99]), { status: 200 })) as unknown as typeof globalThis.fetch;
    const r = await fetchOcsp(leaf, ca, { fetchImpl: fakeFetch, hashAlgo: 'sha1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('malformed');
  });

  it('respects opts.url override', async () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(pair.leafCert);
    const ca = forgeToParsedCert(pair.caCert);
    let calledUrl: string | null = null;
    const fakeFetch = (async (input: string | URL | Request) => {
      calledUrl = typeof input === 'string' ? input : (input as URL).toString();
      return new Response(new Uint8Array(0), { status: 500 });
    }) as unknown as typeof globalThis.fetch;
    const r = await fetchOcsp(leaf, ca, {
      url: 'http://override.example.com/ocsp',
      fetchImpl: fakeFetch,
      hashAlgo: 'sha1',
    });
    expect(calledUrl).toBe('http://override.example.com/ocsp');
    expect(r.ok).toBe(false);
  });
});

describe('requestOcsp retry semantics', () => {
  it('retries once on network error (1s backoff)', async () => {
    const pair = makeSynthPair({ withAia: 'http://ocsp.example.com' });
    const leaf = forgeToParsedCert(pair.leafCert);
    const ca = forgeToParsedCert(pair.caCert);

    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      throw new Error('boom');
    }) as unknown as typeof globalThis.fetch;

    const start = Date.now();
    const r = await requestOcsp(leaf, ca, { fetchImpl: fakeFetch, hashAlgo: 'sha1' });
    const elapsed = Date.now() - start;

    expect(r.ok).toBe(false);
    // Two attempts total (one shot + one retry). hashAlgo='sha1' avoids the
    // sha256→sha1 inner fallback so each requestOcsp call hits fetch once.
    expect(calls).toBe(2);
    // ≥ 1000 ms backoff between the two attempts.
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });

  it('does NOT retry on rate_limited', async () => {
    const pair = makeSynthPair({ withAia: 'http://ocsp.example.com' });
    const leaf = forgeToParsedCert(pair.leafCert);
    const ca = forgeToParsedCert(pair.caCert);

    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      return new Response(new Uint8Array(0), { status: 429 });
    }) as unknown as typeof globalThis.fetch;

    const r = await requestOcsp(leaf, ca, { fetchImpl: fakeFetch, hashAlgo: 'sha1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('rate_limited');
    expect(calls).toBe(1);
  });
});
