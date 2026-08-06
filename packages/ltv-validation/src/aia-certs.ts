/**
 * F1 — AIA caIssuers fallback (RFC 5280 §4.2.2.1).
 *
 * WHY
 * ---
 * F0 fixed the UANATACA CA2-2021 incident by bulk-importing subordinate-CA
 * intermediates into a static bundle (@firma-ec/tsl-ec). That covers ~14/17
 * ARCOTEL ACEs today, but a static bundle is inherently incomplete: an ACE
 * that isn't bundled yet, or that rotates its subordinate CA in the future,
 * reproduces the exact same bug — a leaf-only .p12 produces a PDF whose
 * embedded CMS can't be bridged to a trusted root, and the verifier rejects
 * it as "issuer not recognised".
 *
 * This module is the systemic fix: when the bundle doesn't have the missing
 * intermediate, try to fetch it live from the leaf's OWN `caIssuers` AIA URL
 * — the same mechanism Adobe (or any standard verifier) uses. It NEVER
 * throws and NEVER hangs (bounded timeout, default well under the OCSP
 * budget — see the 2026-05-20 hung-OCSP-host incident this design avoids
 * repeating, documented in `ocsp/fetch.ts`'s header): any failure degrades
 * to a discriminated-union `{ ok: false }` and the caller falls back to
 * "no intermediate found", exactly as it does today with no network at all.
 *
 * TRUST BOUNDARY — this can only ever HELP complete a chain toward a root
 * that's ALREADY trusted (see `roots.ts` / `validatePath` in the verifier
 * and crypto-core). It can never grant trust on its own:
 *   1. The returned cert's Basic Constraints MUST say CA:TRUE.
 *   2. The returned cert MUST have cryptographically signed the child cert
 *      we were resolving an issuer for (`Certificate.verify`).
 * Any cert that fails either check is rejected outright — never returned,
 * never embedded, no matter what the response body claims.
 *
 * Same-origin proxy: ARCOTEL responders/CA issuers rarely ship CORS headers,
 * so a direct browser fetch fails preflight — same rationale as `proxy.ts`
 * for OCSP/CRL. Pass `opts.proxyMap` to rewrite allowlisted URLs; unmapped
 * URLs pass through unchanged (allowlist-only, no `?url=` SSRF vector).
 */

import * as asn1js from 'asn1js';
import { Certificate, ContentInfo, SignedData } from 'pkijs';
import { aiaCertCacheKey } from './cache';
import { extractCaIssuersUrls } from './ocsp/aia';
import { applyProxyMap } from './proxy';
import type { AiaCertOutcome, FetchIssuerCertViaAiaOpts, ParsedCert } from './types';

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 256 * 1024; // a single DER cert or small p7c bundle
const OID_BASIC_CONSTRAINTS = '2.5.29.19';
const ACCEPT_HEADER = 'application/pkix-cert, application/pkcs7-mime';

function toAB(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function isBasicConstraintsCa(cert: Certificate): boolean {
  const ext = cert.extensions?.find((e) => e.extnID === OID_BASIC_CONSTRAINTS);
  if (!ext) return false;
  const bc = ext.parsedValue as { cA?: boolean } | undefined;
  return bc?.cA === true;
}

/** Try to parse `bytes` as a bare DER X.509 certificate. Returns null on any failure. */
function parseDerCert(bytes: Uint8Array): Certificate | null {
  try {
    const asn = asn1js.fromBER(toAB(bytes));
    if (asn.offset === -1) return null;
    const cert = new Certificate({ schema: asn.result });
    // Cheap sanity check that construction actually populated a real
    // Certificate (pkijs throws on most malformed input, but a defensive
    // touch of a required field catches the rest).
    void cert.serialNumber;
    return cert;
  } catch {
    return null;
  }
}

/** Parse a PKCS#7 "certs-only" degenerate SignedData and return every embedded cert. */
function parsePkcs7CertsOnly(bytes: Uint8Array): Certificate[] {
  try {
    const asn = asn1js.fromBER(toAB(bytes));
    if (asn.offset === -1) return [];
    const ci = new ContentInfo({ schema: asn.result });
    if (ci.contentType !== ContentInfo.SIGNED_DATA) return [];
    const sd = new SignedData({ schema: ci.content });
    return (sd.certificates ?? []).filter((c): c is Certificate => c instanceof Certificate);
  } catch {
    return [];
  }
}

/**
 * Parse every `-----BEGIN CERTIFICATE-----` block in a PEM-textual response.
 *
 * 2026-08-05 HIGH fix (found by an independent code-reviewer pass on F1,
 * reproduced against UANATACA's real caIssuers endpoint): RFC 5280 says the
 * caIssuers response SHOULD be DER, but real ACE responders routinely serve
 * PEM instead — `parseDerCert`/`parsePkcs7CertsOnly` both silently returned
 * nothing for that (PEM's ASCII armor isn't valid BER), so F1's fallback
 * never resolved a single real cert. This is a pure textual decode, not a
 * trust decision — every candidate it returns still goes through
 * `findVerifiedIssuer`'s CA:TRUE + signature checks below.
 */
function parsePemCerts(bytes: Uint8Array): Certificate[] {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return [];
  }
  const out: Certificate[] = [];
  const re = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/g;
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    const b64 = (m[1] ?? '').replace(/\s+/g, '');
    try {
      const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const cert = parseDerCert(der);
      if (cert) out.push(cert);
    } catch {
      /* malformed block — skip, keep scanning the rest of the response */
    }
    m = re.exec(text);
  }
  return out;
}

/**
 * Among `candidates`, find one that is CA:TRUE, whose subject matches
 * `child`'s issuer when possible, AND that cryptographically signed `child`.
 * Returns null when nothing qualifies — caller treats this the same as "AIA
 * gave us nothing usable".
 */
async function findVerifiedIssuer(
  child: Certificate,
  candidates: Certificate[],
): Promise<Certificate | null> {
  const bySubject = candidates.filter((c) => c.subject.isEqual(child.issuer));
  const ordered = bySubject.length > 0 ? bySubject : candidates;
  for (const candidate of ordered) {
    if (!isBasicConstraintsCa(candidate)) continue;
    try {
      if (await child.verify(candidate)) return candidate;
    } catch {
      /* signature didn't validate against this candidate — try the next one */
    }
  }
  return null;
}

/**
 * Resolve the issuer of `cert` via its own `caIssuers` AIA URL.
 *
 * Discovery: `extractCaIssuersUrls(cert)[0]` (first URL only, mirroring
 * `fetchOcsp`/`fetchCrl`'s `[0]` convention).
 * Transport: single GET, default 5s timeout, 256 KB response cap.
 * Parsing: tries bare DER X.509 first, then PKCS#7 certs-only.
 * Verification: CA:TRUE + actually signed `cert` — see module header.
 * Cache: optional, in-memory only (see `createAiaCertCache` in `cache.ts`).
 */
export async function fetchIssuerCertViaAia(
  cert: ParsedCert,
  opts: FetchIssuerCertViaAiaOpts = {},
): Promise<AiaCertOutcome> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const childCert = parseDerCert(cert.der);
  if (!childCert) {
    return { ok: false, reason: 'malformed', detail: 'child cert DER decode failed' };
  }

  const rawUrl = extractCaIssuersUrls(cert)[0];
  if (!rawUrl) return { ok: false, reason: 'no_aia' };
  const url = opts.proxyMap ? applyProxyMap(rawUrl, opts.proxyMap) : rawUrl;

  // Cache lookup BEFORE the round trip, keyed by the ORIGINAL upstream URL
  // (so a proxied and a direct fetch share the same entry — mirrors
  // fetchCrl's rawUrl-keyed cache in crl/fetch.ts).
  //
  // 2026-08-05 HIGH fix (independent code-reviewer pass on F1): the cache key
  // is the URL alone, but a single caIssuers URL can legitimately serve
  // DIFFERENT certs to different children over its lifetime — the same URL
  // shared by two subCA generations (a rotation), or a bundle response whose
  // FIRST verified match differs per caller. A cache hit used to skip
  // verification entirely, which breaks the module's own unconditional
  // guarantee ("the returned cert MUST have cryptographically signed the
  // child") for every caller after the first. Re-running the same CA:TRUE +
  // signature check on a hit keeps that guarantee true regardless of cache
  // state — a cert that doesn't verify THIS child is treated as a miss.
  let cacheKey: string | null = null;
  if (opts.cache) {
    cacheKey = await aiaCertCacheKey(rawUrl);
    const cached = opts.cache.get(cacheKey);
    if (cached) {
      const cachedCert = parseDerCert(cached.certDer);
      if (cachedCert) {
        try {
          if (isBasicConstraintsCa(cachedCert) && (await childCert.verify(cachedCert))) {
            return { ok: true, certDer: cached.certDer };
          }
        } catch {
          /* verify() threw (e.g. unsupported alg) — fall through to a live fetch */
        }
      }
    }
  }

  const signal = opts.signal ?? AbortSignal.timeout(timeoutMs);
  let resp: Response;
  try {
    resp = await fetchImpl(url, { method: 'GET', headers: { Accept: ACCEPT_HEADER }, signal });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'AbortError' || name === 'TimeoutError') return { ok: false, reason: 'timeout' };
    return { ok: false, reason: 'network', detail: (e as Error)?.message };
  }
  if (!resp.ok) {
    return { ok: false, reason: 'http_error', detail: `HTTP ${resp.status} ${resp.statusText}` };
  }
  const cl = resp.headers.get('content-length');
  if (cl !== null) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > MAX_RESPONSE_BYTES) {
      return { ok: false, reason: 'malformed', detail: 'response too large' };
    }
  }
  let buf: ArrayBuffer;
  try {
    buf = await resp.arrayBuffer();
  } catch (e) {
    return { ok: false, reason: 'network', detail: (e as Error)?.message };
  }
  if (buf.byteLength > MAX_RESPONSE_BYTES) {
    return { ok: false, reason: 'malformed', detail: 'response too large' };
  }
  const bytes = new Uint8Array(buf);

  const single = parseDerCert(bytes);
  let candidates: Certificate[];
  if (single) {
    candidates = [single];
  } else {
    const p7 = parsePkcs7CertsOnly(bytes);
    candidates = p7.length > 0 ? p7 : parsePemCerts(bytes);
  }
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: 'malformed',
      detail: 'response is neither a DER X.509 cert, a PKCS#7 certs-only bundle, nor PEM',
    };
  }

  const verified = await findVerifiedIssuer(childCert, candidates);
  if (!verified) {
    const anyCa = candidates.some((c) => isBasicConstraintsCa(c));
    return anyCa ? { ok: false, reason: 'signature_invalid' } : { ok: false, reason: 'not_a_ca' };
  }

  const certDer = new Uint8Array(verified.toSchema().toBER(false));
  if (opts.cache && cacheKey !== null) {
    opts.cache.set(cacheKey, { certDer });
  }
  return { ok: true, certDer };
}
