/**
 * Public types for @firma-ec/signer.
 * See spec §2.1 + §4 — 2026-05-09-firma-ec-F3-firma-MVP-design.md
 */

import type { CrlCache, OcspCache } from '@firma-ec/ltv-validation';

/** Signature algorithm suite (RFC 5652 + ETSI TS 119 312). */
export type SigAlg =
  | 'RSA-PKCS1-SHA256'
  | 'RSA-PKCS1-SHA384'
  | 'RSA-PKCS1-SHA512'
  | 'RSA-PSS-SHA256'
  | 'RSA-PSS-SHA384'
  | 'RSA-PSS-SHA512'
  | 'ECDSA-P256-SHA256'
  | 'ECDSA-P384-SHA384'
  | 'ECDSA-P521-SHA512';

/** Subset of cert info we expose to UI / verifier cross-check. */
export interface SignerCert {
  /** PEM or DER bytes of the X.509 cert. */
  der: Uint8Array;
  /** Subject CN (Common Name) extracted from the cert. */
  subjectCN: string;
  /** Issuer CN. */
  issuerCN: string;
  /** notBefore / notAfter. */
  notBefore: Date;
  notAfter: Date;
  /** Serial number as hex. */
  serialHex: string;
}

/** Output of `parsePfx(bytes, pin)`. */
export interface ParsedPfx {
  /** Signing certificate (with `keyUsage.digitalSignature`). */
  signingCert: SignerCert;
  /** Intermediate / chain certs found in the PFX (may be empty). */
  intermediates: SignerCert[];
  /** Private key as JWK (zero-out after `importKey`). */
  privateKeyJwk: JsonWebKey;
  /** Inferred signature algorithm. */
  sigAlg: SigAlg;
}

/** Visible signature placement. */
export interface VisibleSigSpec {
  /** 0-based page index. */
  pageIndex: number;
  /** PDF user-space coords (origin bottom-left). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Visual size preset. */
  size: 'compact' | 'standard' | 'large';
}

/** Options passed to `signPdf`. */
export interface SignOptions {
  /** PDF to sign. */
  pdf: Uint8Array;
  /** PKCS#12 file (.p12 / .pfx). */
  pfx: Uint8Array;
  /** PIN for the PFX. */
  pin: string;
  /** Visible signature spec (CN-only stamp). */
  visibleSig: VisibleSigSpec;
  /** Optional signed-attributes (PAdES-B-B). */
  reason?: string;
  location?: string;
  /** Override signing time (default: `new Date()`). */
  signingTime?: Date;
  /** Number of pre-existing signatures detected (forces incremental update if >0). */
  previousSignaturesCount?: number;
}

/** Metadata describing the outcome of an RFC 3161 timestamp request. */
export interface TimestampMeta {
  /** True only if a TimeStampToken was successfully embedded. */
  ok: boolean;
  /** TSA-reported genTime (when ok=true). */
  signingTime?: Date;
  /** TSA URL actually used (when ok=true). */
  tsaUrl?: string;
  /** Subject CN of the TSA signing certificate (when ok=true). */
  tsaIssuerCN?: string;
  /**
   * Failure reason when ok=false.
   * - `'user_disabled'`: caller explicitly turned TSA off in settings.
   * - `'multifirma_path'`: incremental update on already-signed PDF — TSA only
   *   applies to the first signature on a document; this signature is B-B
   *   intentionally and the prior signatures keep their own timestamps.
   * - `'disabled'`: legacy alias retained for backward compat (treated as
   *   `'multifirma_path'` by the UI when surfaced from older bundles).
   * - Other values: TSA round-trip failure modes.
   */
  reason?:
    | 'timeout'
    | 'rate_limited'
    | 'malformed'
    | 'rejected'
    | 'network'
    | 'disabled'
    | 'user_disabled'
    | 'multifirma_path';
  /** Free-text detail (network error message, TSA status string, etc). */
  detail?: string;
}

/** Result of `signPdf`. */
export interface SignResult {
  /** Signed PDF bytes. */
  bytes: Uint8Array;
  /** CN of the signing cert (echoed for UI summary). */
  signerCN: string;
  /** Algorithm actually used. */
  sigAlg: SigAlg;
  /** Signing time embedded in signedAttrs. */
  signingTime: Date;
}

/**
 * Long-term validation options (F7). When `longTerm` is true (default),
 * the signer fetches OCSP/CRL data for the cert chain + TSA cert and
 * embeds it in a /DSS dict (output: B-LT). When additionally
 * `longTermArchive` is true (default), an outer document timestamp is
 * appended (output: B-LTA).
 *
 * Any non-fatal LT/LTA failure degrades the output to the highest
 * successful tier (B-T → B-LT → B-LTA) and records a warning. The only
 * fatal LTV failure is `certificate_revoked` which aborts signing.
 *
 * @see docs/superpowers/specs/2026-05-10-firma-ec-F7-LTV-design.md §5.1
 */
export interface LtvOpts {
  /** Attempt B-LT (DSS append) after B-T. Default: true. */
  longTerm?: boolean;
  /** Attempt B-LTA (document timestamp) after B-LT. Default: true. */
  longTermArchive?: boolean;
  /** OCSP/CRL fetch timeout in ms (per request). Default: 8000. */
  ocspTimeoutMs?: number;
  /** Override OCSP URL (else discovered via cert AIA extension). */
  ocspUrl?: string;
  /** Override CRL URL (else discovered via cert CRLDistributionPoints). */
  crlUrl?: string;
  /** TSA URL for the document timestamp (default: reuses signature TSA). */
  documentTsaUrl?: string;
  /** Document timestamp request timeout in ms. Default 8000. */
  ltvTimeoutMs?: number;
  /** Callback fired with the final LtvMeta — useful for progress reporting. */
  onLtvResult?: (r: LtvMeta) => void;
  /**
   * Caller-supplied OCSP response cache (per-process, in-memory, TTL-aware —
   * see `@firma-ec/ltv-validation`'s `createOcspCache`). When a batch-signing
   * session shares the SAME certificate chain across N documents, passing one
   * cache instance across all `signPdfPades` calls avoids re-hitting the OCSP
   * responder for every document. Omit for the previous single-shot behaviour
   * (each call does its own fetch).
   */
  ocspCache?: OcspCache;
  /** Caller-supplied CRL cache — same rationale as {@link ocspCache}. */
  crlCache?: CrlCache;
}

/** LT/LTA profile achieved by a sign run. */
export type LtvProfile = 'B-B' | 'B-T' | 'B-LT' | 'B-LTA';

/**
 * Outcome of the LT/LTA stage. Always present in PadesSignResult — even when
 * the caller turned LTV off, `profile` and `longTermAchieved` reflect the
 * truth.
 */
export interface LtvMeta {
  /** Highest tier achieved by the sign run. */
  profile: LtvProfile;
  /** True iff DSS appended successfully. */
  longTermAchieved: boolean;
  /** True iff outer document timestamp appended successfully. */
  archiveAchieved: boolean;
  /** Count of OCSP responses embedded in the /DSS dict. */
  embeddedOcspCount: number;
  /** Count of CRL streams embedded in the /DSS dict. */
  embeddedCrlCount: number;
  /** Non-fatal warnings collected during the LT/LTA pipeline. */
  warnings: Array<{ code: string; detail?: string }>;
  /** Set when archiveAchieved=true. */
  documentTimestampTime?: Date;
  /** Set when archiveAchieved=true. */
  documentTimestampTsaIssuer?: string;
  /** Set when the flow aborted because a cert was revoked. */
  revoked?: { cn: string };
}
