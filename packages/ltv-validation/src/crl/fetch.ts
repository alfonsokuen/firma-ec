/**
 * CRL fetcher per RFC 5280 §5.
 *
 * Discovery: pulls URLs from cert's cRLDistributionPoints extension. Picks the
 * first http(s) URL (skips ldap://). Override via `opts.url`.
 *
 * Transport: GET with timeout (default 8s). Response body is DER-encoded
 * `CertificateList`. Caps at 8 MiB by default.
 *
 * Verification: when `opts.issuerCert` is present, the CRL signature is verified
 * against the issuer's public key via pkijs `CertificateRevocationList.verify`.
 *
 * Cache: optional. Keyed by SHA-256(distributionPointUrl). TTL 6h default.
 */

import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { extractCrlDistributionPoints } from '../ocsp/aia';
import { crlCacheKey } from '../cache';
import type { CrlOutcome, CrlResult, FetchCrlOpts, ParsedCert } from '../types';

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024; // 8 MiB

function toAB(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function pkijsCertFromDer(der: Uint8Array): pkijs.Certificate {
  const asn = asn1js.fromBER(toAB(der));
  if (asn.offset === -1) throw new Error('cert ASN.1 decode failed');
  return new pkijs.Certificate({ schema: asn.result });
}

export async function fetchCrl(cert: ParsedCert, opts: FetchCrlOpts = {}): Promise<CrlOutcome> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  const url = opts.url ?? extractCrlDistributionPoints(cert)[0];
  if (!url) return { ok: false, reason: 'no_cdp' };

  // Cache lookup
  if (opts.cache) {
    const k = await crlCacheKey(url);
    const cached = opts.cache.get(k);
    if (cached) return cached;
  }

  const signal = opts.signal ?? AbortSignal.timeout(timeoutMs);

  let resp: Response;
  try {
    resp = await fetchImpl(url, { method: 'GET', signal });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'AbortError' || name === 'TimeoutError') {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'network', detail: (e as Error)?.message };
  }

  if (!resp.ok) {
    return { ok: false, reason: 'http_error', detail: `HTTP ${resp.status} ${resp.statusText}` };
  }

  const cl = resp.headers.get('content-length');
  if (cl !== null) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > maxBytes) {
      return { ok: false, reason: 'too_large', detail: `${n} > ${maxBytes}` };
    }
  }

  let buf: ArrayBuffer;
  try {
    buf = await resp.arrayBuffer();
  } catch (e) {
    return { ok: false, reason: 'network', detail: (e as Error)?.message };
  }
  if (buf.byteLength > maxBytes) {
    return { ok: false, reason: 'too_large', detail: `${buf.byteLength} > ${maxBytes}` };
  }

  const der = new Uint8Array(buf);
  let crl: pkijs.CertificateRevocationList;
  try {
    const asn = asn1js.fromBER(toAB(der));
    if (asn.offset === -1) {
      return { ok: false, reason: 'malformed', detail: 'ASN.1 decode failed' };
    }
    crl = new pkijs.CertificateRevocationList({ schema: asn.result });
  } catch (e) {
    return { ok: false, reason: 'malformed', detail: (e as Error)?.message };
  }

  // Verify signature when issuer is present
  if (opts.issuerCert) {
    try {
      const issuerPki = pkijsCertFromDer(opts.issuerCert.der);
      const ok = await crl.verify({ issuerCertificate: issuerPki });
      if (!ok) return { ok: false, reason: 'sig_invalid' };
    } catch (e) {
      return { ok: false, reason: 'sig_invalid', detail: (e as Error)?.message };
    }
  }

  const thisUpdate = crl.thisUpdate.value as Date;
  const nextUpdate = (crl.nextUpdate?.value ?? undefined) as Date | undefined;

  const result: CrlResult = {
    ok: true,
    crlDer: der,
    crl,
    thisUpdate,
    distributionPointUrl: url,
    ...(nextUpdate ? { nextUpdate } : {}),
  };

  if (opts.cache) {
    const k = await crlCacheKey(url);
    opts.cache.set(k, result);
  }
  return result;
}
