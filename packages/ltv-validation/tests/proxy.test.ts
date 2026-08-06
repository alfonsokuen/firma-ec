/**
 * F7.5 — same-origin proxy map for ARCOTEL ACE OCSP/CRL upstreams.
 */
import { describe, expect, it } from 'vitest';
import { fetchCrl } from '../src/crl/fetch';
import { fetchOcsp } from '../src/ocsp/fetch';
import { ARCOTEL_PROXY_MAP, applyProxyMap, isProxied } from '../src/proxy';
import type { ParsedCert } from '../src/types';

const stubCert: ParsedCert = {
  subjectCN: 'stub',
  issuerCN: 'stub-issuer',
  der: new Uint8Array(),
  notBefore: new Date(),
  notAfter: new Date(),
};

describe('F7.5 proxy map — known ACE responders', () => {
  it('SECURITY DATA OCSP upstream → /api/ocsp/securitydata', () => {
    expect(applyProxyMap('http://ocspgw.securitydata.net.ec/ejbca/publicweb/status/ocsp')).toBe(
      '/api/ocsp/securitydata',
    );
  });

  it('SECURITY DATA CRL upstream → /api/crl/securitydata', () => {
    expect(applyProxyMap('http://crl1.securitydata.net.ec/subca2crl1/crlfile.crl')).toBe(
      '/api/crl/securitydata',
    );
  });

  it('ArgosData OCSP upstream → /api/ocsp/argosdata (with and without trailing slash)', () => {
    expect(applyProxyMap('http://ocsp.argosdata.com.ec')).toBe('/api/ocsp/argosdata');
    expect(applyProxyMap('http://ocsp.argosdata.com.ec/')).toBe('/api/ocsp/argosdata');
  });

  it('ArgosData CRL upstream → /api/crl/argosdata', () => {
    expect(
      applyProxyMap('http://crl.argosdata.com.ec/crl/0cdaea45-3374-42ca-9248-7d4797ea00a4.crl'),
    ).toBe('/api/crl/argosdata');
  });

  it('F1: UANATACA AIA caIssuers upstream → /api/aia/uanataca', () => {
    expect(
      applyProxyMap('http://www.uanataca.com/public/download/tsp_certificates/subordinate1.crt'),
    ).toBe('/api/aia/uanataca');
  });

  it('unknown upstream passes through unchanged (allowlist semantics)', () => {
    const u = 'http://ocsp.unknown-ace.example/ocsp';
    expect(applyProxyMap(u)).toBe(u);
  });

  it('isProxied reports membership correctly', () => {
    expect(isProxied('http://ocsp.argosdata.com.ec')).toBe(true);
    expect(isProxied('http://ocsp.argosdata.com.ec/')).toBe(true);
    expect(isProxied('http://example.com/ocsp')).toBe(false);
  });

  it('ARCOTEL_PROXY_MAP values all start with /api/ (same-origin invariant)', () => {
    for (const v of ARCOTEL_PROXY_MAP.values()) {
      expect(v.startsWith('/api/')).toBe(true);
    }
  });

  it('opts.proxyMap = undefined → no rewrite (back-compat)', async () => {
    let calledUrl = '';
    const mockFetch = (async (u: string) => {
      calledUrl = u;
      return new Response(new Uint8Array(), { status: 502 });
    }) as unknown as typeof globalThis.fetch;

    await fetchCrl(stubCert, {
      url: 'http://crl1.securitydata.net.ec/subca2crl1/crlfile.crl',
      fetchImpl: mockFetch,
    });
    expect(calledUrl).toBe('http://crl1.securitydata.net.ec/subca2crl1/crlfile.crl');
  });

  it('opts.proxyMap set → URL rewritten before fetch', async () => {
    let calledUrl = '';
    const mockFetch = (async (u: string) => {
      calledUrl = u;
      return new Response(new Uint8Array(), { status: 502 });
    }) as unknown as typeof globalThis.fetch;

    const r = await fetchCrl(stubCert, {
      url: 'http://crl1.securitydata.net.ec/subca2crl1/crlfile.crl',
      proxyMap: ARCOTEL_PROXY_MAP,
      fetchImpl: mockFetch,
    });
    expect(calledUrl).toBe('/api/crl/securitydata');
    // 502 → http_error, but distributionPointUrl in error path doesn't apply;
    // we just confirm the rewrite happened pre-fetch.
    expect(r.ok).toBe(false);
  });

  it('fetchCrl with proxyMap: result.distributionPointUrl reports raw upstream (audit)', async () => {
    // build a minimal valid CRL by reusing argosdata fixture if available; else skip
    const { readFileSync, existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const fxPath = resolve(__dirname, '__fixtures__/argosdata-ace-crl-2026-05-10.crl');
    if (!existsSync(fxPath)) return; // fixture-conditional
    const body = new Uint8Array(readFileSync(fxPath));

    const mockFetch = (async () => {
      const ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      return new Response(ab, {
        status: 200,
        headers: { 'content-length': String(body.byteLength) },
      });
    }) as unknown as typeof globalThis.fetch;

    const r = await fetchCrl(stubCert, {
      url: 'http://crl.argosdata.com.ec/crl/0cdaea45-3374-42ca-9248-7d4797ea00a4.crl',
      proxyMap: ARCOTEL_PROXY_MAP,
      fetchImpl: mockFetch,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Result reports raw upstream, not the same-origin proxy path
      expect(r.distributionPointUrl).toBe(
        'http://crl.argosdata.com.ec/crl/0cdaea45-3374-42ca-9248-7d4797ea00a4.crl',
      );
    }
  });

  it('fetchOcsp with proxyMap: URL rewritten before fetch', async () => {
    // Real cert DER needed because buildOcspRequest pkijs-parses the cert.
    const { makeSynthPair, forgeToParsedCert } = await import('./helpers/synthCerts');
    const pair = makeSynthPair({ withAia: 'http://ocsp.argosdata.com.ec' });
    const leaf = forgeToParsedCert(pair.leafCert);
    const ca = forgeToParsedCert(pair.caCert);

    let calledUrl = '';
    const mockFetch = (async (u: string) => {
      calledUrl = u;
      return new Response(new Uint8Array(), { status: 502 });
    }) as unknown as typeof globalThis.fetch;

    await fetchOcsp(leaf, ca, {
      url: 'http://ocsp.argosdata.com.ec',
      proxyMap: ARCOTEL_PROXY_MAP,
      fetchImpl: mockFetch,
    });
    expect(calledUrl).toBe('/api/ocsp/argosdata');
  });
});
