/**
 * Static manifest of TSA trust roots shipped with the package.
 *
 * SHA-256 fingerprints are embedded for guard-against-substitution checks
 * at load time (similar to tsl-ec).
 */

export interface TsaTrustManifestEntry {
  slug: string;
  commonName: string;
  /** URLs known to be served by this trust anchor (hint, not authoritative). */
  tsaUrlHints: readonly string[];
  /** SHA-256 fingerprint of the DER-encoded root cert (lowercase hex, no separators). */
  fingerprintSha256: string;
  /** True if this is a self-signed stub awaiting a real root (e.g. ARCOTEL). */
  isPlaceholder: boolean;
}

/**
 * v0.5.0 trust roots:
 *   - freetsa: real FreeTSA Root CA (cacert.pem) downloaded 2026-05-09 from
 *     https://freetsa.org/files/cacert.pem. Fingerprint pinned below.
 *   - arcotel-placeholder: self-signed RSA stub. Slot reserved for ARCOTEL
 *     Ecuador TSAs (F6.5 when endpoints are published officially). Marked
 *     `isPlaceholder: true` so the chain validator skips it.
 */
export const TSA_TRUST_MANIFEST: readonly TsaTrustManifestEntry[] = [
  {
    slug: 'freetsa',
    commonName: 'FreeTSA Root CA (cacert.pem)',
    tsaUrlHints: ['https://freetsa.org/tsr'],
    fingerprintSha256: '2151b61137ffa86bf664691ba67e7da0b19f98c758e3d228d5d8ebf27e044438',
    isPlaceholder: false,
  },
  {
    slug: 'arcotel-placeholder',
    commonName: 'ARCOTEL TSA (placeholder)',
    tsaUrlHints: [],
    // Placeholder fingerprint is regenerated per-machine; not pinned.
    fingerprintSha256: '',
    isPlaceholder: true,
  },
];
