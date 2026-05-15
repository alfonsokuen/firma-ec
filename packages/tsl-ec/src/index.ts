/**
 * @firma-ec/tsl-ec — Trust List for Ecuadorian ECIs
 *
 * Provides root certificates for the 17 ARCOTEL-accredited Electronic Certification
 * Infrastructures (ECIs) that issue PAdES-compliant signing certificates in Ecuador.
 *
 * Accreditation source (17 entities, official ARCOTEL list):
 *   https://www.arcotel.gob.ec/listado-de-las-entidades-de-certificacion-de-informacion-y-servicios-relacionados-acreditados-y-terceros-vinculados-debidamente-acreditadas/
 *
 * Subset accepted by SRI on gob.ec (8 entities for 13 SRI procedures):
 *   https://www.sri.gob.ec/tramites-en-gob-ec
 *
 * IMPORTANT (2026-05-10, F6.7): 2 of 17 slots now hold REAL roots (Eclipsoft,
 * Uanataca) fetched from public repositories. The remaining 15 are still
 * self-signed placeholders awaiting fetch from CAs that don't publish their
 * roots at standard URLs (BCE, Argosdata, Datil, Security Data, registro civil,
 * judicatura, and the smaller ECIs). See each root's `notes` field for the
 * source URL tried and the failure mode.
 */

export const PACKAGE_NAME = '@firma-ec/tsl-ec';
export const TSL_VERSION = '1.9.0';
export const TSL_SEQUENCE = 10;

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
  /**
   * Whether this ECI is part of the 8-entity subset that the SRI lists as
   * accepted for the 13 procedures published on https://www.sri.gob.ec/tramites-en-gob-ec
   *
   * The other 9 ARCOTEL-accredited entities are valid for any document signed
   * with PAdES under Ley de Comercio Electrónico, but are not in the curated
   * SRI gob.ec dropdown.
   */
  acceptedInGobEc?: boolean;
  /**
   * Whether this ECI is currently inactive / has no operational public
   * presence (domain dead, no public PKI repository, no commercial activity
   * detectable). Still listed by ARCOTEL but treated as out-of-scope by the
   * verifier banner so the demo state reflects only actively-issuing CAs.
   */
  isDefunct?: boolean;
  /**
   * Whether this trust root is a parallel/additional anchor for an ECI
   * organisation that is already represented by another slug. Counted by
   * `validatePath` for chain validation, but excluded from the
   * "X de N ACEs activas" banner counter so adding a legacy root doesn't
   * inflate the active-ACE total.
   */
  isParallelAnchor?: boolean;
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

/**
 * Return all trust roots from the embedded ARCOTEL TSL.
 *
 * NOTE: All current entries are placeholders (isPlaceholder: true) because
 * automated fetching of real ECI root certs failed at build time.
 * Replace PEM files in packages/tsl-ec/src/roots/ before production use.
 */
export async function getTrustRoots(): Promise<TrustRoot[]> {
  const { roots } = await import('./roots');
  return roots;
}
