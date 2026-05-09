/**
 * @firma-ec/tsl-ec — Trust List for Ecuadorian ECIs
 *
 * Provides root certificates for the 7 ARCOTEL-accredited Electronic Certification
 * Infrastructures (ECIs) that issue PAdES-compliant signing certificates in Ecuador.
 *
 * IMPORTANT: Some slots are placeholders (self-signed certs generated 2026-05-08)
 * because the ECI repositories were not publicly reachable during automated fetch.
 * Replace placeholder PEMs before declaring production-readiness for signature validation.
 * See each root's `notes` field and the PEM header comments for replacement guidance.
 */

export const PACKAGE_NAME = '@firma-ec/tsl-ec';
export const TSL_VERSION = '1.0.0';
export const TSL_SEQUENCE = 1;

/**
 * A single trust anchor (root CA) for an Ecuadorian ECI.
 * The `pemContent` field carries the raw PEM text (imported via `?raw` in Vite).
 */
export interface TrustRoot {
  /** Short machine-readable slug — matches the filename stem (e.g. 'bce') */
  slug: string;
  /** Human-readable common name of the CA */
  commonName: string;
  /** Full legal name of the ECI organisation */
  orgName: string;
  /** Two-letter ISO 3166-1 country of incorporation */
  country: 'EC' | 'ES';
  /** Raw PEM string — include the full BEGIN/END CERTIFICATE block */
  pemContent: string;
  /** SHA-256 fingerprint of the DER-encoded certificate, lowercase hex, no colons */
  fingerprintSha256: string;
  /** ISO 8601 date — notBefore of the certificate */
  validFrom: string;
  /** ISO 8601 date — notAfter of the certificate */
  validUntil: string;
  /**
   * Whether this is a genuine ECI root fetched from a public repository,
   * or a self-signed placeholder generated because the fetch failed.
   */
  isPlaceholder: boolean;
  /**
   * Optional URL where the real root certificate can be obtained.
   * Populated for placeholder slots so operators know where to look.
   */
  repositoryUrl?: string;
  /**
   * Human-readable notes — replacement guidance, fetch failure reason, etc.
   */
  notes?: string;
}

/**
 * Narrow a TrustRoot to one that is definitely not a placeholder.
 * Useful when callers need to enforce real-cert-only validation logic.
 */
export type RealTrustRoot = TrustRoot & { isPlaceholder: false };

/** Narrow to placeholder slots */
export type PlaceholderTrustRoot = TrustRoot & { isPlaceholder: true };

export function isReal(root: TrustRoot): root is RealTrustRoot {
  return !root.isPlaceholder;
}

export function isPlaceholder(root: TrustRoot): root is PlaceholderTrustRoot {
  return root.isPlaceholder;
}

/**
 * Return only production-grade trust roots (non-placeholders).
 * In the current build this returns an empty array — replace PEMs first!
 */
export function realRoots(roots: TrustRoot[]): RealTrustRoot[] {
  return roots.filter(isReal);
}
