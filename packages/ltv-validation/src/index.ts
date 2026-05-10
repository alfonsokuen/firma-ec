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
