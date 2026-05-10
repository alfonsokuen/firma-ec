/**
 * Public type surface for @firma-ec/ltv-validation.
 * Mirrors spec docs/superpowers/specs/2026-05-10-firma-ec-F7-LTV-design.md §3.1.
 */

/** Minimal parsed-cert shape used by the LTV layer (subset of verifier ParsedCert). */
export interface ParsedCert {
  /** Subject Common Name (or null if absent). */
  subjectCN: string | null;
  /** Issuer Common Name (or null if absent). */
  issuerCN: string | null;
  /** DER bytes of the cert. */
  der: Uint8Array;
  /** notBefore / notAfter from validity. */
  notBefore: Date;
  notAfter: Date;
}

export type RevocationStatus = 'good' | 'revoked' | 'unknown';

export interface OcspResult {
  ok: true;
  /** RFC 6960 BasicOCSPResponse DER bytes — embed in DSS as-is. */
  responseDer: Uint8Array;
  status: RevocationStatus;
  /** OCSP producedAt timestamp. */
  producedAt: Date;
  /** thisUpdate of the matching SingleResponse. */
  thisUpdate: Date;
  /** nextUpdate when present. */
  nextUpdate?: Date;
  /** Revocation date when status === 'revoked'. */
  revokedAt?: Date;
  /** Responder URL actually queried. */
  responderUrl: string;
  /** Responder cert (if delegate; else === issuer). */
  responderCert?: ParsedCert;
  /** Whether the response signature verified against responder cert. */
  signatureValid: boolean;
}

export interface OcspError {
  ok: false;
  reason:
    | 'no_aia'
    | 'timeout'
    | 'network'
    | 'malformed'
    | 'http_error'
    | 'sig_invalid'
    | 'rate_limited';
  detail?: string;
}

export type OcspOutcome = OcspResult | OcspError;

export interface CrlResult {
  ok: true;
  crlDer: Uint8Array;
  /** Parsed CRL — caller may inspect revokedCertificates. */
  crl: import('pkijs').CertificateRevocationList;
  thisUpdate: Date;
  nextUpdate?: Date;
  distributionPointUrl: string;
}

export interface CrlError {
  ok: false;
  reason:
    | 'no_cdp'
    | 'timeout'
    | 'network'
    | 'malformed'
    | 'http_error'
    | 'sig_invalid'
    | 'too_large';
  detail?: string;
}

export type CrlOutcome = CrlResult | CrlError;

export interface FetchOcspOpts {
  /** Override URL (else discovered from cert AIA). */
  url?: string;
  /** Timeout ms (default 8000). */
  timeoutMs?: number;
  /** CertID hash algorithm. Default 'auto' tries SHA-256 then falls back to SHA-1. */
  hashAlgo?: 'sha1' | 'sha256' | 'auto';
  /** Include nonce extension (default false — many ARCOTEL responders reject nonces). */
  nonce?: boolean;
  /** AbortSignal for cancellation (overrides timeoutMs). */
  signal?: AbortSignal;
  /** OCSP response cache (per-process, in-memory). */
  cache?: OcspCache;
  /** fetch implementation override (testing). */
  fetchImpl?: typeof globalThis.fetch;
}

export interface FetchCrlOpts {
  url?: string;
  timeoutMs?: number;
  /** Maximum CRL size in bytes (default 8 MiB). */
  maxBytes?: number;
  /** Maximum asn1js node count (default 1_000_000). Large ARCOTEL CRLs exceed asn1js's default 10k. */
  maxNodes?: number;
  /** Issuer cert for signature verification (optional — skip verify when absent). */
  issuerCert?: ParsedCert;
  signal?: AbortSignal;
  /** CRL cache (per-process, in-memory). */
  cache?: CrlCache;
  /** fetch implementation override (testing). */
  fetchImpl?: typeof globalThis.fetch;
}

/** OCSP response cache (per-process, in-memory, TTL 1h default). */
export interface OcspCache {
  get(key: string): OcspResult | undefined;
  set(key: string, value: OcspResult): void;
  clear(): void;
  readonly size: number;
}

/** CRL cache (per-process, in-memory, TTL 6h default since CRLs update less often). */
export interface CrlCache {
  get(key: string): CrlResult | undefined;
  set(key: string, value: CrlResult): void;
  clear(): void;
  readonly size: number;
}
