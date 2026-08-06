/**
 * @firma-ec/ltv-validation — OCSP (RFC 6960) + CRL (RFC 5280 §5) clients
 * for PAdES B-LT / B-LTA Long-Term Validation.
 *
 * Browser-compatible: uses globalThis.fetch + globalThis.crypto.subtle + asn1js + pkijs.
 * No PDF concerns — pure data layer. PDF assembly lives in @firma-ec/dss-pdf.
 *
 * Public API mirrors spec docs/superpowers/specs/2026-05-10-firma-ec-F7-LTV-design.md §3.1.
 */

// Types (T1)
export type {
  ParsedCert,
  RevocationStatus,
  OcspResult,
  OcspError,
  OcspOutcome,
  CrlResult,
  CrlError,
  CrlOutcome,
  FetchOcspOpts,
  FetchCrlOpts,
  OcspCache,
  CrlCache,
  AiaCertResult,
  AiaCertErrorReason,
  AiaCertOutcome,
  AiaCertCache,
  FetchIssuerCertViaAiaOpts,
} from './types';

// AIA / CDP URL discovery (T3)
export {
  extractOcspUrls,
  extractCaIssuersUrls,
  extractCrlDistributionPoints,
} from './ocsp/aia';

// OCSP request builder (T3)
export { buildOcspRequest } from './ocsp/request';
export type {
  BuildOcspRequestOpts,
  BuildOcspRequestResult,
} from './ocsp/request';

// OCSP response parser + verifier (T4)
export { parseOcspResponse, OcspParseError } from './ocsp/response';
export type { ParsedOcspResponse } from './ocsp/response';

// CertID normalization (shared by fetch.ts and verifier's DSS-embedded match)
export { normalizeSerialHex, certIdHashAlgoFromOid } from './ocsp/certid';
export type { CertIdHashAlgo } from './ocsp/certid';

// In-memory caches (T5/T8, F1)
export {
  createOcspCache,
  createCrlCache,
  createAiaCertCache,
  ocspCacheKey,
  crlCacheKey,
  aiaCertCacheKey,
} from './cache';

// OCSP transport + orchestration (T5/T7)
export { fetchOcsp, requestOcsp } from './ocsp/fetch';

// CRL fetcher (T8) + revocation check (T9)
export { fetchCrl } from './crl/fetch';
export { isCertRevoked } from './crl/check';
export type { CrlRevocationCheck } from './crl/check';

// F7.5 — same-origin proxy map for ARCOTEL ACE OCSP/CRL/AIA upstreams
export { ARCOTEL_PROXY_MAP, applyProxyMap, isProxied } from './proxy';
export type { ProxyMap } from './proxy';

// F1 — AIA caIssuers fallback (missing-intermediate resolution)
export { fetchIssuerCertViaAia } from './aia-certs';
