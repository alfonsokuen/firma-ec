import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { describe, expect, it } from 'vitest';
import { isCertRevoked } from '../src/crl/check';
import { fetchCrl } from '../src/crl/fetch';
import { forgeToParsedCert, makeSynthPair, makeSyntheticCrlDer } from './helpers/synthCerts';

function parseCrl(der: Uint8Array): pkijs.CertificateRevocationList {
  const ab = der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer;
  const asn = asn1js.fromBER(ab);
  if (asn.offset === -1) throw new Error('crl decode failed');
  return new pkijs.CertificateRevocationList({ schema: asn.result });
}

describe('isCertRevoked (CRL check)', () => {
  it('returns revoked: false when serial absent from CRL', () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(pair.leafCert);
    const crlDer = makeSyntheticCrlDer({
      caCert: pair.caCert,
      caKey: pair.caKey,
      revokedSerialsHex: ['ff'],
    });
    const crl = parseCrl(crlDer);
    expect(isCertRevoked(leaf, crl).revoked).toBe(false);
  });

  it('returns revoked: true when serial appears', () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(pair.leafCert);
    const crlDer = makeSyntheticCrlDer({
      caCert: pair.caCert,
      caKey: pair.caKey,
      revokedSerialsHex: ['02ab'],
    });
    const crl = parseCrl(crlDer);
    const r = isCertRevoked(leaf, crl);
    expect(r.revoked).toBe(true);
    expect(r.revokedAt).toBeInstanceOf(Date);
  });
});

describe('fetchCrl', () => {
  it('returns no_cdp when cert has no CRL distribution point and no override', async () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(pair.leafCert);
    const r = await fetchCrl(leaf, {
      fetchImpl: (() => {
        throw new Error('should not fetch');
      }) as unknown as typeof globalThis.fetch,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_cdp');
  });

  it('returns timeout on AbortError', async () => {
    const pair = makeSynthPair({ withCdp: 'http://crl.example.com/ca.crl' });
    const leaf = forgeToParsedCert(pair.leafCert);
    const r = await fetchCrl(leaf, {
      fetchImpl: (async () => {
        const e = new Error('aborted') as Error & { name: string };
        e.name = 'AbortError';
        throw e;
      }) as unknown as typeof globalThis.fetch,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('timeout');
  });

  it('parses a valid synthetic CRL when fetch returns it', async () => {
    const pair = makeSynthPair({ withCdp: 'http://crl.example.com/ca.crl' });
    const leaf = forgeToParsedCert(pair.leafCert);
    const crlDer = makeSyntheticCrlDer({
      caCert: pair.caCert,
      caKey: pair.caKey,
      revokedSerialsHex: ['02ab'],
    });
    const fakeFetch = (async () =>
      new Response(crlDer, { status: 200 })) as unknown as typeof globalThis.fetch;
    const r = await fetchCrl(leaf, { fetchImpl: fakeFetch });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(isCertRevoked(leaf, r.crl).revoked).toBe(true);
    }
  });

  it('rejects too_large CRLs via Content-Length pre-check', async () => {
    const pair = makeSynthPair({ withCdp: 'http://crl.example.com/ca.crl' });
    const leaf = forgeToParsedCert(pair.leafCert);
    const fakeFetch = (async () =>
      new Response(new Uint8Array(0), {
        status: 200,
        headers: { 'content-length': String(20 * 1024 * 1024) },
      })) as unknown as typeof globalThis.fetch;
    const r = await fetchCrl(leaf, { fetchImpl: fakeFetch, maxBytes: 8 * 1024 * 1024 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('too_large');
  });
});
