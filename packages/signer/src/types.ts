/**
 * Public types for @firma-ec/signer.
 * See spec §2.1 + §4 — 2026-05-09-firma-ec-F3-firma-MVP-design.md
 */

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
