/**
 * intermediates.ts — Subordinate (intermediate) CA certificates for the
 * Ecuadorian ECIs whose end-entity certs do NOT chain directly to a self-signed
 * root.
 *
 * WHY THIS EXISTS
 * ---------------
 * Some ACEs issue end-entity (leaf) certificates from a subordinate CA instead
 * of directly from their self-signed root (e.g. UANATACA: leaf → "UANATACA CA2
 * 2016" → "UANATACA ROOT 2016"). When a signer's .p12 ships ONLY the leaf (very
 * common — the issuing CA assumes verifiers fetch intermediates via AIA), the
 * resulting PAdES CMS embeds only the leaf, and a fully client-side / offline
 * verifier cannot bridge leaf → root: the chain build fails and the signature
 * is wrongly reported as "issuer not recognised in Ecuador" even though the
 * ACE's ROOT is trusted.
 *
 * These intermediates are used by:
 *   - the verifier, to complete the path leaf → intermediate → trusted root
 *     when neither the PDF nor a sibling signature carries the intermediate;
 *   - the signer, to embed the missing intermediate into the CMS so the
 *     produced PDF is self-contained (validates in firmar.ec AND Adobe).
 *
 * SECURITY: an intermediate is NOT a trust anchor. Adding one here can NEVER
 * make an untrusted certificate trusted — pkijs still requires the chain to
 * terminate at a self-signed ROOT present in `roots.ts`. Intermediates only
 * supply the missing link between a leaf and an already-trusted root.
 */

import icertEcSubcaPem from './intermediates/icert-ec-subca.pem?raw';
import securitydataSubca2Pem from './intermediates/securitydata-subca2.pem?raw';
import uanatacaCa2_2016Pem from './intermediates/uanataca-ca2-2016.pem?raw';

/**
 * A subordinate CA certificate that bridges end-entity certs to a trusted root.
 * `pemContent` carries the full BEGIN/END CERTIFICATE block (no comment lines).
 */
export interface TrustIntermediate {
  /** Short machine-readable slug. */
  slug: string;
  /** Common name of the subordinate CA (matches the leaf's issuer CN). */
  commonName: string;
  /** Slug of the root (in roots.ts) this intermediate ultimately chains to. */
  rootSlug: string;
  /** Full legal name of the ECI organisation. */
  orgName: string;
  /** Raw PEM string — full BEGIN/END CERTIFICATE block. */
  pemContent: string;
  /** SHA-256 fingerprint of the DER-encoded certificate, lowercase hex, no colons. */
  fingerprintSha256: string;
  /** ISO 8601 date — notBefore. */
  validFrom: string;
  /** ISO 8601 date — notAfter. */
  validUntil: string;
  /** Provenance / notes. */
  notes?: string;
}

export const intermediates: TrustIntermediate[] = [
  {
    slug: 'uanataca-ca2-2016',
    commonName: 'UANATACA CA2 2016',
    rootSlug: 'uanataca',
    orgName: 'UANATACA S.A.',
    pemContent: uanatacaCa2_2016Pem,
    fingerprintSha256: '00ff2ff2efba98c6b023ad1035559a606dd9fc48a39d3407cc07a678379a7909',
    validFrom: '2016-03-11',
    validUntil: '2029-03-11',
    notes:
      'Subordinate CA that issues UANATACA end-entity (natural person / legal rep) certs. ' +
      'Chains to "UANATACA ROOT 2016" (root slug "uanataca"). Fetched 2026-05-29 from ' +
      'http://www.uanataca.com/public/download/tsp_certificates/subordinate2.crt. UANATACA ' +
      '.p12 files ship leaf-only, so without this intermediate offline verification of ' +
      'UANATACA-signed PDFs fails (issuer-not-recognised). Real-world case: certs of ' +
      'natural persons (e.g. CN=… serialNumber=IDCEC-…) used to sign e-invoices.',
  },
  {
    slug: 'securitydata-subca2',
    commonName: 'AUTORIDAD DE CERTIFICACION SUBCA-2 SECURITY DATA',
    rootSlug: 'securitydata',
    orgName: 'SECURITY DATA S.A. 2',
    pemContent: securitydataSubca2Pem,
    fingerprintSha256: '6bd1035a0b907aaca0374a18c96e26665bd57cd3b9ce7413096aa5479858ebc0',
    validFrom: '2019-10-15',
    validUntil: '2039-04-07',
    notes:
      'Subordinate CA that signs Security Data end-entity certs; chains to "RAIZ ' +
      'CA-2 SECURITY DATA" (root slug "securitydata"). Extracted 2026-05-29 from the ' +
      'embedded chain of a real Security Data-signed PDF. Security Data .p12 ship ' +
      'leaf-only, so offline verification of single-signer Security Data PDFs needs ' +
      'this intermediate.',
  },
  {
    slug: 'icert-ec-subca',
    commonName: 'ENTIDAD DE CERTIFICACION ICERT-EC',
    rootSlug: 'judicatura',
    orgName: 'Consejo de la Judicatura',
    pemContent: icertEcSubcaPem,
    fingerprintSha256: '634b37f273657a024ee0ddcfdbf14728537dc37dbae705373057331ae5069637',
    validFrom: '2014-10-16',
    validUntil: '2034-10-15',
    notes:
      'Subordinate CA (iCert-EC) that signs Consejo de la Judicatura end-entity ' +
      'certs; chains to "ICERT-EC ENTIDAD DE CERTIFICACION RAIZ" (root slug ' +
      '"judicatura"). Extracted 2026-05-29 from a real multi-signer judicial PDF. ' +
      'Needed for single-signer / all-leaf-only iCert PDFs (multi-sig PDFs already ' +
      'pool it from sibling signatures).',
  },
];

// NOTE: `getIntermediates()` lives in ./index.ts (dynamic import) so that
// build-json.ts can import the index in plain Node without statically loading
// this file's Vite `?raw` PEM import. Import `{ getIntermediates }` from the
// package root, not from here.
