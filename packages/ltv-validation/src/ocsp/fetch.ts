/**
 * OCSP fetch orchestration.
 *
 *   buildOcspRequest → POST → parseOcspResponse → cache + return.
 *
 * Errors are returned as discriminated unions, never thrown:
 *   - 'no_aia'        — cert lacks an AIA OCSP URL and no override provided.
 *   - 'timeout'       — AbortSignal fired or fetch took longer than `timeoutMs`.
 *   - 'network'       — fetch threw or non-2xx (other than 429).
 *   - 'rate_limited'  — HTTP 429.
 *   - 'http_error'    — other non-2xx status.
 *   - 'malformed'     — response failed ASN.1 parse or content-type mismatch.
 *   - 'sig_invalid'   — response signature failed verification.
 *
 * Cache: keyed by SHA-256(serialNumber || issuerKeyHash). Hit returns the
 * cached `OcspResult` (still ok=true).
 */

import { buildOcspRequest } from './request';
import { parseOcspResponse, OcspParseError } from './response';
import { extractOcspUrls } from './aia';
import { ocspCacheKey } from '../cache';
import { applyProxyMap } from '../proxy';
import type {
  FetchOcspOpts,
  OcspOutcome,
  OcspResult,
  ParsedCert,
} from '../types';

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_OCSP_RESPONSE_BYTES = 64 * 1024; // 64 KB cap
const CONTENT_TYPE_REQ = 'application/ocsp-request';
const CONTENT_TYPE_RESP = 'application/ocsp-response';

function toAB(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

async function postOcsp(
  url: string,
  body: Uint8Array,
  signal: AbortSignal,
  fetchImpl: typeof globalThis.fetch,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: 'http_error' | 'rate_limited' | 'malformed' | 'network' | 'timeout'; detail?: string }> {
  let resp: Response;
  try {
    resp = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': CONTENT_TYPE_REQ, Accept: CONTENT_TYPE_RESP },
      body: toAB(body) as BodyInit,
      signal,
    });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'AbortError' || name === 'TimeoutError') {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'network', detail: (e as Error)?.message };
  }
  if (resp.status === 429) {
    return { ok: false, reason: 'rate_limited', detail: `HTTP 429` };
  }
  if (!resp.ok) {
    return { ok: false, reason: 'http_error', detail: `HTTP ${resp.status} ${resp.statusText}` };
  }
  const cl = resp.headers.get('content-length');
  if (cl !== null) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > MAX_OCSP_RESPONSE_BYTES) {
      return { ok: false, reason: 'malformed', detail: 'response too large' };
    }
  }
  let buf: ArrayBuffer;
  try {
    buf = await resp.arrayBuffer();
  } catch (e) {
    return { ok: false, reason: 'network', detail: (e as Error)?.message };
  }
  if (buf.byteLength > MAX_OCSP_RESPONSE_BYTES) {
    return { ok: false, reason: 'malformed', detail: 'response too large' };
  }
  return { ok: true, bytes: new Uint8Array(buf) };
}

/**
 * Fetch + parse + verify an OCSP response for `cert`.
 *
 * Single-shot: no retries (use `requestOcsp` for orchestration with retry).
 */
export async function fetchOcsp(
  cert: ParsedCert,
  issuerCert: ParsedCert,
  opts: FetchOcspOpts = {},
): Promise<OcspOutcome> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const wantHash = opts.hashAlgo ?? 'auto';
  const rawUrl = opts.url ?? extractOcspUrls(cert)[0];
  if (!rawUrl) return { ok: false, reason: 'no_aia' };
  // F7.5: rewrite to same-origin proxy when allowlisted
  const url = opts.proxyMap ? applyProxyMap(rawUrl, opts.proxyMap) : rawUrl;

  const signal = opts.signal ?? AbortSignal.timeout(timeoutMs);

  // Try preferred hash; on malformed/sig_invalid retry with the alternate.
  const order: Array<'sha256' | 'sha1'> =
    wantHash === 'sha256' ? ['sha256'] : wantHash === 'sha1' ? ['sha1'] : ['sha256', 'sha1'];

  let lastError: Extract<OcspOutcome, { ok: false }> | null = null;

  for (const hashAlgo of order) {
    const built = await buildOcspRequest(cert, issuerCert, {
      hashAlgo,
      ...(opts.nonce !== undefined ? { nonce: opts.nonce } : {}),
    });

    const httpRes = await postOcsp(url, built.requestDer, signal, fetchImpl);
    if (!httpRes.ok) {
      lastError = httpRes.reason === 'rate_limited'
        ? { ok: false, reason: 'rate_limited', detail: httpRes.detail ?? '' }
        : { ok: false, reason: httpRes.reason, ...(httpRes.detail !== undefined ? { detail: httpRes.detail } : {}) };
      // No point retrying with the alternate hash for transport errors.
      if (httpRes.reason !== 'malformed') return lastError;
      continue;
    }

    let parsed;
    try {
      parsed = await parseOcspResponse(httpRes.bytes, issuerCert);
    } catch (e) {
      const detail = e instanceof OcspParseError ? (e.detail ?? e.message) : (e as Error)?.message;
      lastError = { ok: false, reason: 'malformed', detail: detail ?? '' };
      continue;
    }

    if (!parsed.signatureValid) {
      lastError = { ok: false, reason: 'sig_invalid' };
      continue;
    }

    // Cache stash
    if (opts.cache) {
      const key = await ocspCacheKey(parsed.serialHex, parsed.issuerKeyHashHex);
      const cached: OcspResult = {
        ok: true,
        responseDer: httpRes.bytes,
        status: parsed.certStatus,
        producedAt: parsed.producedAt,
        thisUpdate: parsed.thisUpdate,
        responderUrl: rawUrl,
        signatureValid: parsed.signatureValid,
        ...(parsed.nextUpdate ? { nextUpdate: parsed.nextUpdate } : {}),
        ...(parsed.revokedAt ? { revokedAt: parsed.revokedAt } : {}),
        ...(parsed.responderCert ? { responderCert: parsed.responderCert } : {}),
      };
      opts.cache.set(key, cached);
      return cached;
    }

    const result: OcspResult = {
      ok: true,
      responseDer: httpRes.bytes,
      status: parsed.certStatus,
      producedAt: parsed.producedAt,
      thisUpdate: parsed.thisUpdate,
      responderUrl: rawUrl,
      signatureValid: parsed.signatureValid,
      ...(parsed.nextUpdate ? { nextUpdate: parsed.nextUpdate } : {}),
      ...(parsed.revokedAt ? { revokedAt: parsed.revokedAt } : {}),
      ...(parsed.responderCert ? { responderCert: parsed.responderCert } : {}),
    };
    return result;
  }

  return lastError ?? { ok: false, reason: 'malformed' };
}

/**
 * Top-level orchestration: cache → fetchOcsp → 1 retry on network error.
 *
 * The retry runs after a 1s linear backoff on `network` / `timeout`. Other
 * error reasons are returned immediately.
 */
export async function requestOcsp(
  cert: ParsedCert,
  issuerCert: ParsedCert,
  opts: FetchOcspOpts = {},
): Promise<OcspOutcome> {
  // Cache lookup pre-flight (we need a cache key, which depends on the issuer key hash;
  // we approximate using a hash over (serial || issuer SPKI DER) — see cache.ocspCacheKey).
  if (opts.cache) {
    // Pre-cache key uses cert.der serial extraction via pkijs would be heavier here.
    // Instead let `fetchOcsp` populate the cache after a successful fetch; reads happen
    // via `requestOcsp` at the layer above (e.g. collectDssData) when it has the parsed certID.
  }

  const first = await fetchOcsp(cert, issuerCert, opts);
  if (first.ok) return first;
  if (first.reason !== 'network' && first.reason !== 'timeout') return first;

  // Single retry after 1s backoff
  await new Promise<void>((res) => setTimeout(res, 1000));
  return fetchOcsp(cert, issuerCert, opts);
}
