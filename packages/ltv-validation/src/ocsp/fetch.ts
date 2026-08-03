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
 *   - 'sig_invalid'   — response signature failed verification (chain, or a
 *                       delegate missing the id-kp-OCSPSigning EKU).
 *   - 'response_mismatch' — an AUTHENTICATED response whose CertID doesn't
 *                       answer our cert (replay/MITM shape), or whose echoed
 *                       nonce differs from the one we sent. `detail`
 *                       distinguishes 'no_matching_single_response' from
 *                       'nonce_echo_mismatch'.
 *
 * Cache: keyed by SHA-256(serialNumber || issuerKeyHash), read BEFORE the round
 * trip and written after a successful one — same shape as `crl/fetch.ts`. A hit
 * returns the cached `OcspResult` (still ok=true) without touching the network.
 *
 * Cache freshness is a SECURITY bound, not just a performance one: an entry is
 * only reusable while the response's own validity window is open
 * (`thisUpdate <= now < nextUpdate`, per RFC 6960 §4.2.2.1) — a response already
 * past `nextUpdate` is treated as a miss, never served.
 *
 * ⚠️ Caveat, because the bound above is NOT unconditional: `nextUpdate` is
 * OPTIONAL in RFC 6960 and real responders (ARCOTEL's among them) do omit it.
 * When `nextUpdate` is absent there is no upper bound in the response itself, so
 * the ONLY bound left is the cache's own LRU TTL (1h for OCSP — see
 * `../cache.ts`). `isOcspResponseFresh` returns true for such a response however
 * old its `thisUpdate` is; do not read this header as promising a validity
 * window that the responder never sent.
 */

import { ocspCacheKey } from '../cache';
import { applyProxyMap } from '../proxy';
import type { FetchOcspOpts, OcspOutcome, OcspResult, ParsedCert } from '../types';
import { extractOcspUrls } from './aia';
import { normalizeSerialHex } from './certid';
import { buildOcspRequest } from './request';
import { OcspParseError, parseOcspResponse } from './response';

/** Constant-time-ish byte comparison — good enough here: both operands are
 * public-network data (our own sent nonce vs the responder's echo), not a
 * secret, so timing leaks nothing. Fixed-length loop avoids short-circuiting
 * on the first differing byte only for tidiness, not for a security bound. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_OCSP_RESPONSE_BYTES = 64 * 1024; // 64 KB cap
const CONTENT_TYPE_REQ = 'application/ocsp-request';
const CONTENT_TYPE_RESP = 'application/ocsp-response';

/**
 * Small tolerance for responder/client clock skew when checking `thisUpdate`.
 * RFC 6960 §4.2.2.1 lets a client reject a response it considers not-yet-valid;
 * we only need enough slack to avoid discarding our own just-fetched response.
 */
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000; // 5 min

function toAB(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

/**
 * Is `res` still inside its OWN validity window?
 *
 * Independent of the cache's TTL: a responder may hand out a response that is
 * already past `nextUpdate` (or produced by a skewed clock). Such a response is
 * fine to return to the caller who asked for it right now — it is NOT fine to
 * keep serving from cache, because that would pin a revocation state the CA has
 * already superseded.
 */
export function isOcspResponseFresh(res: OcspResult, now: number = Date.now()): boolean {
  if (res.nextUpdate !== undefined && res.nextUpdate.getTime() <= now) return false;
  if (res.thisUpdate.getTime() - CLOCK_SKEW_TOLERANCE_MS > now) return false;
  return true;
}

async function postOcsp(
  url: string,
  body: Uint8Array,
  signal: AbortSignal,
  fetchImpl: typeof globalThis.fetch,
): Promise<
  | { ok: true; bytes: Uint8Array }
  | {
      ok: false;
      reason: 'http_error' | 'rate_limited' | 'malformed' | 'network' | 'timeout';
      detail?: string;
    }
> {
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

    // Cache lookup, BEFORE the round trip (mirrors crl/fetch.ts). The key comes
    // from the CertID we just built, which is byte-identical to the one the
    // responder echoes — so it matches whatever a previous successful fetch
    // stored. Keyed per hashAlgo, hence inside the loop. Normalized serial so
    // a verbatim-echo responder and a minimal-re-encode responder share a key.
    let cacheKey: string | null = null;
    if (opts.cache) {
      cacheKey = await ocspCacheKey(normalizeSerialHex(built.serialHex), built.issuerKeyHashHex);
      const cached = opts.cache.get(cacheKey);
      // A cached entry that outlived its own nextUpdate is a MISS, on purpose —
      // never serve a revocation state the CA has already superseded.
      if (cached && isOcspResponseFresh(cached)) return cached;
    }

    const httpRes = await postOcsp(url, built.requestDer, signal, fetchImpl);
    if (!httpRes.ok) {
      lastError =
        httpRes.reason === 'rate_limited'
          ? { ok: false, reason: 'rate_limited', detail: httpRes.detail ?? '' }
          : {
              ok: false,
              reason: httpRes.reason,
              ...(httpRes.detail !== undefined ? { detail: httpRes.detail } : {}),
            };
      // No point retrying with the alternate hash for transport errors.
      if (httpRes.reason !== 'malformed') return lastError;
      continue;
    }

    let parsed;
    try {
      parsed = await parseOcspResponse(httpRes.bytes, issuerCert, {
        serialHex: built.serialHex,
        issuerKeyHashHex: built.issuerKeyHashHex,
      });
    } catch (e) {
      if (e instanceof OcspParseError && e.code === 'no_matching_single_response') {
        // Authenticated response (parseOcspResponse only throws this code
        // when signatureValid was true), just answering a DIFFERENT cert —
        // the replay/MITM shape. Retrying with the alternate hash is
        // harmless: it's just another request, and an active MITM can
        // always force the CRL fallback path by dropping packets anyway.
        lastError = { ok: false, reason: 'response_mismatch', detail: e.code };
        continue;
      }
      const detail = e instanceof OcspParseError ? (e.detail ?? e.message) : (e as Error)?.message;
      lastError = { ok: false, reason: 'malformed', detail: detail ?? '' };
      continue;
    }

    // Order matters: authenticate FIRST. A CertID that already failed to
    // match would have thrown above; what's left to reason about only
    // applies to data we've now verified came from the trusted responder.
    if (!parsed.signatureValid) {
      lastError = {
        ok: false,
        reason: 'sig_invalid',
        ...(parsed.signatureDetail ? { detail: parsed.signatureDetail } : {}),
      };
      continue;
    }

    // Nonce is verify-if-present (RFC 6960/8954 permit a responder to omit
    // it even when the request carried one — ARCOTEL's ACEs do, and requiring
    // it would break every one of them). When BOTH sides have it, the bytes
    // must match; a responder that echoes a different nonce is exhibiting
    // exactly the replay shape the nonce exists to catch.
    if (built.nonce && parsed.responseNonce) {
      if (!bytesEqual(built.nonce, parsed.responseNonce)) {
        lastError = { ok: false, reason: 'response_mismatch', detail: 'nonce_echo_mismatch' };
        continue;
      }
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

    // Cache stash — under the key we READ with (derived from the request's
    // CertID), so a hit is possible at all. Only responses that are actually
    // reusable are stored: caching an already-expired one would just add a
    // guaranteed miss on every later read.
    if (opts.cache && cacheKey !== null && isOcspResponseFresh(result)) {
      opts.cache.set(cacheKey, result);
    }
    return result;
  }

  return lastError ?? { ok: false, reason: 'malformed' };
}

/**
 * Top-level orchestration: fetchOcsp (which itself reads/writes `opts.cache`)
 * → 1 retry on network error.
 *
 * The retry runs after a 1s linear backoff on `network` / `timeout`. Other
 * error reasons are returned immediately. The cache pre-flight lives inside
 * `fetchOcsp`, where the CertID is available — nothing to do here.
 */
export async function requestOcsp(
  cert: ParsedCert,
  issuerCert: ParsedCert,
  opts: FetchOcspOpts = {},
): Promise<OcspOutcome> {
  const first = await fetchOcsp(cert, issuerCert, opts);
  if (first.ok) return first;
  if (first.reason !== 'network' && first.reason !== 'timeout') return first;

  // Single retry after 1s backoff
  await new Promise<void>((res) => setTimeout(res, 1000));
  return fetchOcsp(cert, issuerCert, opts);
}
