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

export interface SignatureMeta {
  /** PAdES profile detected: B-B, B-T, B-LT */
  profile: 'B-B' | 'B-T' | 'B-LT' | 'unknown';
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
