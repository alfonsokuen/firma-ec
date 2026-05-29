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
 * STATUS (2026-05-22, TSL v1.11.0): 28 of 29 entries hold REAL self-signed
 * roots. The remaining placeholder is registro-civil (DIGERCIC has no public
 * PKI root). Several ACEs ship multiple root vintages as parallel anchors
 * (isParallelAnchor) so certs chaining to either an old or new root validate.
 * The 8 formerly-placeholder ECIs were sourced from the official MINTEL
 * FirmaEC library. See each root's `notes` field for provenance.
 */

export const PACKAGE_NAME = '@firma-ec/tsl-ec';
export const TSL_VERSION = '1.11.0';
export const TSL_SEQUENCE = 12;

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

export type { TrustIntermediate } from './intermediates';

/**
 * Return all bundled intermediate (subordinate) CA certificates.
 *
 * Mirrors {@link getTrustRoots}: the dynamic import keeps `intermediates.ts`
 * (and its Vite `?raw` PEM imports) OUT of the module graph at index load time.
 * This matters because `build-json.ts` imports this index in plain Node
 * (`--experimental-strip-types`), where a static load of `./intermediates`
 * would fail — both on the `?raw` suffix and on the name collision with the
 * `intermediates/` directory (ERR_UNSUPPORTED_DIR_IMPORT).
 */
export async function getIntermediates(): Promise<
  import('./intermediates').TrustIntermediate[]
> {
  const { intermediates } = await import('./intermediates');
  return intermediates;
}
