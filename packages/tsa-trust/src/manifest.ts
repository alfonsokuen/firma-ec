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
 *
 * 2026-08-06 addition — uanataca:
 *   Real signed PDF (`19562560_Contrato.pdf`, 2 firmantes) carries an RFC
 *   3161 token from "Sello de tiempo electrónico de UANATACA - TSU01",
 *   rejected as `chain_invalid` — this package had ZERO real TSA roots
 *   besides FreeTSA, so no ACE's own TSA could ever validate. The official
 *   MINTEL FirmaEC 5.1.0 desktop verifier validates both signatures (incl.
 *   the timestamp) with no warning, confirming the token is legitimate.
 *   `UANATACA ROOT 2016` is the SAME root already trusted in
 *   `@firma-ec/tsl-ec` for signing certs — deliberately duplicated here
 *   (not imported) per this package's header: TSA anchors and ACE signing
 *   anchors are reviewed and rotate independently on purpose. Fingerprint
 *   below matches `tsl-ec`'s `roots.ts` entry for the same slug byte-for-byte
 *   (`openssl x509 -outform DER | sha256sum` on both PEMs).
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
    slug: 'uanataca',
    commonName: 'UANATACA ROOT 2016',
    tsaUrlHints: [],
    fingerprintSha256: '44607b3d0ebd0d2bf181cb62f3cea9766dbb6718743f55b153a320ea99dfb5a6',
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
