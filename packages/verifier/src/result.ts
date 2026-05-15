import type { SubjectInfo } from '@firma-ec/crypto-core';

export type Status = 'valid' | 'warning' | 'invalid' | 'no_signature';

export interface VerificationWarning {
  /** i18n key for human-readable message */
  code: string;
  /** Free-text English description (fallback) */
  message: string;
}

export interface SignerSummary {
  cert: {
    subject: SubjectInfo;
    issuer: SubjectInfo;
    serialNumberHex: string;
    validFrom: string;
    validUntil: string;
    fingerprintSha256: string;
  };
  /** Slug of the matched ARCOTEL root in TSL */
  matchedRootSlug?: string | undefined;
  /** Human-readable AC name */
  matchedRootName?: string | undefined;
}

export interface TimestampSummary {
  /** True iff a TimeStampToken was attached as a CMS unsignedAttribute. */
  present: boolean;
  /** True iff every timestamp check passed (imprint + chain + signature). */
  valid: boolean;
  /** Three-state badge per F6 spec §6.2 — gold | silver | none. */
  badge: 'gold' | 'silver' | 'none';
  /** TSTInfo.genTime when parseable. */
  signingTime?: string | undefined;
  /** Subject CN of the TSA signing cert. */
  tsaIssuer?: string | undefined;
  /** Failure reason for silver state. */
  reason?:
    | 'imprint_mismatch'
    | 'sig_invalid'
    | 'chain_invalid'
    | 'expired'
    | 'malformed'
    | 'no_tsa_cert'
    | undefined;
}

/** F7 — long-term validation summary attached to SignatureMeta. */
export interface LtvSummary {
  /** Highest LTV tier reached by the inspected PDF. */
  profile: 'B-B' | 'B-T' | 'B-LT' | 'B-LTA';
  /** True iff the Catalog had a /DSS reference that parsed. */
  dssPresent: boolean;
  /** Count of OCSP responses in /DSS /OCSPs. */
  embeddedOcspCount: number;
  /** Count of CRL streams in /DSS /CRLs. */
  embeddedCrlCount: number;
  /** True iff at least one cert in the chain was retrospectively `good` from embedded material AND none were revoked. */
  retrospectiveValid: boolean;
  /** Document timestamp (/Sig /SubFilter /ETSI.RFC3161) — present in B-LTA only. */
  documentTimestamp?:
    | {
        present: boolean;
        valid: boolean;
        badge: 'gold' | 'silver' | 'none';
        signingTime?: string;
        tsaIssuer?: string;
        reason?: string;
      }
    | undefined;
  /** Diagnostic strings — never block outer signature. */
  errors: string[];
}

export interface SignatureMeta {
  /** PAdES profile detected: B-B, B-T, B-LT, B-LTA. */
  profile: 'B-B' | 'B-T' | 'B-LT' | 'B-LTA' | 'unknown';
  /** Hash algorithm used for the message digest */
  digestAlgo: string;
  /** Signature algorithm */
  signatureAlgo: string;
  /** Time the signature claims to have been made (signedAttrs.signingTime) */
  signingTime?: string | undefined;
  /** Time from the embedded TSA, if any (B-T+) */
  timestampTime?: string | undefined;
  /** Reason / location / contact name if present */
  reason?: string | undefined;
  location?: string | undefined;
  contactInfo?: string | undefined;
  /** F6 — RFC 3161 timestamp verification result (always present, may be 'none'). */
  timestamp?: TimestampSummary | undefined;
  /** F7 — long-term validation summary (always present when verifier ran). */
  ltv?: LtvSummary | undefined;
}

export interface OcspStatus {
  /** good | revoked | unknown | not_checked */
  status: 'good' | 'revoked' | 'unknown' | 'not_checked';
  checkedAt?: string | undefined;
  revokedAt?: string | undefined;
  reason?: string | undefined;
  /** Whether the response was fetched live or cached */
  source: 'live' | 'cached' | 'embedded' | 'none';
}

export interface IntegrityCheck {
  /** Whether the recomputed hash over /ByteRange matches the embedded messageDigest */
  digestMatches: boolean;
  /** Whether there are incremental updates after the signature (e.g., subsequent edits) */
  hasIncrementalUpdates: boolean;
  /** Number of bytes covered by /ByteRange */
  coveredBytes: number;
  /** Total file size */
  totalBytes: number;
}

export interface VerificationResult {
  status: Status;
  signer?: SignerSummary | undefined;
  signature?: SignatureMeta | undefined;
  ocsp?: OcspStatus | undefined;
  integrity?: IntegrityCheck | undefined;
  warnings: VerificationWarning[];
  /** Verification engine version for diagnostics */
  engineVersion: string;
  /** Time when verification ran */
  verifiedAt: string;
  /** Optional raw error message when status === 'invalid' or 'no_signature' due to internal error */
  error?: string | undefined;
}
