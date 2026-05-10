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
