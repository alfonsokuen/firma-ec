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

import alphaTechnologies2023SubcaPem from './intermediates/alpha-technologies-2023-subca.pem?raw';
import alphaTechnologiesSubcaPem from './intermediates/alpha-technologies-subca.pem?raw';
import anfac2016SubcaPem from './intermediates/anfac-2016-subca.pem?raw';
import anfacSubcaPem from './intermediates/anfac-subca.pem?raw';
import appfirmas2025SubcaPem from './intermediates/appfirmas-2025-subca.pem?raw';
import appfirmasSubcaPem from './intermediates/appfirmas-subca.pem?raw';
import argosdata2026SubcaPem from './intermediates/argosdata-2026-subca.pem?raw';
import argosdataSubcaPem from './intermediates/argosdata-subca.pem?raw';
import bceSubca2011Pem from './intermediates/bce-subca-2011.pem?raw';
import bceSubca2019Pem from './intermediates/bce-subca-2019.pem?raw';
import darkcamSubcaPem from './intermediates/darkcam-subca.pem?raw';
import datil2025SubcaCortaDuracionPem from './intermediates/datil-2025-subca-corta-duracion.pem?raw';
import datil2025SubcaPem from './intermediates/datil-2025-subca.pem?raw';
import datilSubca2021Pem from './intermediates/datil-subca-2021.pem?raw';
import firmaseguraSubcaPem from './intermediates/firmasegura-subca.pem?raw';
import icertEcSubcaPem from './intermediates/icert-ec-subca.pem?raw';
import lazzateSubcaPem from './intermediates/lazzate-subca.pem?raw';
import letmiSubcaPem from './intermediates/letmi-subca.pem?raw';
import securitydataLegacySubca2011Pem from './intermediates/securitydata-legacy-subca-2011.pem?raw';
import securitydataLegacySubca2019Pem from './intermediates/securitydata-legacy-subca-2019.pem?raw';
import securitydataSubca2Pem from './intermediates/securitydata-subca2.pem?raw';
import uanatacaCa1_2016Pem from './intermediates/uanataca-ca1-2016.pem?raw';
import uanatacaCa2_2016Pem from './intermediates/uanataca-ca2-2016.pem?raw';
import uanatacaCa2_2021Pem from './intermediates/uanataca-ca2-2021.pem?raw';

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

const FIRMAEC_JAR_NOTE =
  'Extraído 2026-08-05 de la instalación oficial MINTEL FirmaEC, librería ' +
  'ec.gob.firmadigital.libreria (instalación oficial MINTEL FirmaEC), clase Sub CA embebida ' +
  'como PEM en el constant pool. Misma fuente que las 28 raíces reales de roots.ts (ver ' +
  'FIRMAEC_REAL_NOTE ahí).';

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
    slug: 'uanataca-ca2-2021',
    commonName: 'UANATACA CA2 2021',
    rootSlug: 'uanataca',
    orgName: 'UANATACA S.A.',
    pemContent: uanatacaCa2_2021Pem,
    fingerprintSha256: '15ceab339144d48d352eef1c227f4d2ef4fc1756dead602c22be32d52100e69a',
    validFrom: '2021-06-03',
    validUntil: '2034-06-03',
    notes:
      'Second subordinate CA that issues UANATACA end-entity certs in parallel with ' +
      '"UANATACA CA2 2016" (slug "uanataca-ca2-2016") — UANATACA runs both issuing CAs ' +
      'concurrently, so this one does NOT replace the 2016 intermediate; both must stay ' +
      'listed. Chains to "UANATACA ROOT 2016" (root slug "uanataca"). Fetched 2026-08-05 ' +
      'from https://web.uanataca.com/common/project/pdf/autoridad-certificacion/' +
      '08_subordinada-ca2-2021.cer. Real-world case: a genuine UANATACA-signed PDF (legal ' +
      'rep cert for IDKMANAGER S.A.S.) was flagged "issuer not recognised" because this ' +
      'intermediate was missing — same failure mode as the 2016 case, new subordinate.',
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
  {
    slug: 'alpha-technologies-2023-subca',
    commonName: 'Alpha Technologies Atlas Signing CA 2023',
    rootSlug: 'alpha-technologies-2023',
    orgName: 'Alpha Technologies Cia. Ltda.',
    pemContent: alphaTechnologies2023SubcaPem,
    fingerprintSha256: '54aa1faf8d268fe2da81dda8e3ff6344621beb2af34219f00b0e74072545b498',
    validFrom: '2023-03-22',
    validUntil: '2026-03-22',
    notes: `${FIRMAEC_JAR_NOTE} Class SubCaCertAlphaTechnologies20232026.`,
  },
  {
    slug: 'alpha-technologies-subca',
    commonName: 'Alpha Technologies Atlas Signing CA 2024',
    rootSlug: 'alpha-technologies',
    orgName: 'Alpha Technologies Cia. Ltda.',
    pemContent: alphaTechnologiesSubcaPem,
    fingerprintSha256: '798bd49172c696bcb545b575a6d34b7546836b566621df326374cccbf1bb8f8d',
    validFrom: '2024-11-20',
    validUntil: '2032-11-20',
    notes: `${FIRMAEC_JAR_NOTE} Class SubCaCertAlphaTechnologies20242032.`,
  },
  {
    slug: 'anfac-2016-subca',
    commonName: 'ANF Ecuador CA1',
    rootSlug: 'anfac-2016',
    orgName: 'ANFAC Autoridad de Certificacion Ecuador CA',
    pemContent: anfac2016SubcaPem,
    fingerprintSha256: '32799f49629c53ed290983be2178cee100a13915235eae5f1165da6fa8c93b8b',
    validFrom: '2016-07-21',
    validUntil: '2032-12-24',
    notes: `${FIRMAEC_JAR_NOTE} Class SubCaCertAnfAc20162032_18332. Chains to the Spanish "ANF Global Root CA" (rootSlug "anfac-2016"), a parallel anchor to the Ecuadorian "anfac" root — ANFAC issues from both roots.`,
  },
  {
    slug: 'anfac-subca',
    commonName: 'ANF High Assurance Ecuador Intermediate CA',
    rootSlug: 'anfac',
    orgName: 'ANFAC Autoridad de Certificacion Ecuador CA',
    pemContent: anfacSubcaPem,
    fingerprintSha256: '7d0a3123ce51a38333ed75b0d2d20c877f29671f7b38ac453e0c730b86a8cc9b',
    validFrom: '2019-10-17',
    validUntil: '2029-10-14',
    notes: `${FIRMAEC_JAR_NOTE} Class SubCaCertAnfAc20192029_37442.`,
  },
  {
    slug: 'appfirmas-2025-subca',
    commonName: 'APPFIRMAS S.A. Sub CA',
    rootSlug: 'appfirmas-2025',
    orgName: 'APPFIRMAS S.A.',
    pemContent: appfirmas2025SubcaPem,
    fingerprintSha256: 'cb8e78c9324dc5e2d000374524ad26938d773b07765863991021591a669ec655',
    validFrom: '2025-05-01',
    validUntil: '2050-04-30',
    notes: `${FIRMAEC_JAR_NOTE} Class SubCaCertAppFirmas20252050.`,
  },
  {
    slug: 'appfirmas-subca',
    commonName: 'APPFIRMAS SUB C1',
    rootSlug: 'appfirmas',
    orgName: 'APPFIRMAS S.A.',
    pemContent: appfirmasSubcaPem,
    fingerprintSha256: '6d45a87fa878c97d1a281d454ba6543967336eacc9c73eed4f1e650d91a3e8d6',
    validFrom: '2026-02-12',
    validUntil: '2036-02-10',
    notes: `${FIRMAEC_JAR_NOTE} Class SubCaCertAppFirmas20262036.`,
  },
  {
    slug: 'argosdata-subca',
    commonName: 'ArgosData CA 1 - SHA256',
    rootSlug: 'argosdata',
    orgName: 'ArgosData',
    pemContent: argosdataSubcaPem,
    fingerprintSha256: 'd91166c25d2e4a820e60a4687a77ceab6920a01ff79eb48fce75678d570e6867',
    validFrom: '2022-06-24',
    validUntil: '2032-04-24',
    notes: `${FIRMAEC_JAR_NOTE} Class SubCaCertArgosData20242032.`,
  },
  {
    slug: 'argosdata-2026-subca',
    commonName: 'ArgosData Sub CA',
    rootSlug: 'argosdata-2026',
    orgName: 'ARGOSDATA CERTIFICACION DE INFORMACION Y SERVICIOS RELACIONADOS',
    pemContent: argosdata2026SubcaPem,
    fingerprintSha256: 'df3f8b9caf20d447fd0859e21df8fdb9b00cacb70027f4797888dfb603817a05',
    validFrom: '2026-03-10',
    validUntil: '2031-03-09',
    notes: `${FIRMAEC_JAR_NOTE} Class SubCaCertArgosData20262036.`,
  },
  {
    slug: 'bce-subca-2011',
    // 2026-08-05: corrected to match the certificate's real subject CN
    // (verified with `openssl x509 -in bce-subca-2011.pem -noout -subject`).
    // It is IDENTICAL to bce-subca-2019's CN — see the DN-collision note
    // below and resolveIssuerCert (crypto-core) for how the selectors now
    // disambiguate the two by AKI/SKI instead of subject DN.
    commonName: 'AC BANCO CENTRAL DEL ECUADOR',
    rootSlug: 'bce',
    orgName: 'Banco Central del Ecuador',
    pemContent: bceSubca2011Pem,
    fingerprintSha256: '40a3239eea754090f996d7e5bf0690f2880b6f44bd531854f0a3fdb9d1564f77',
    validFrom: '2011-08-08',
    validUntil: '2021-08-08',
    notes: `${FIRMAEC_JAR_NOTE} Class SubCaCertBce20112021. EXPIRED (notAfter 2021-08-08) — kept for historical/LTV verification of BCE-signed documents dated within its validity window; the verifier evaluates cert validity at signing time, not at verification time. SAME subject DN as bce-subca-2019 (BCE renewed the same intermediate CN with a new key/serial) — the two are disambiguated by AKI/SKI (falling back to real signature verification), never by array order; see resolveIssuerCert in @firma-ec/crypto-core.`,
  },
  {
    slug: 'bce-subca-2019',
    commonName: 'AC BANCO CENTRAL DEL ECUADOR',
    rootSlug: 'bce',
    orgName: 'Banco Central del Ecuador',
    pemContent: bceSubca2019Pem,
    fingerprintSha256: 'fae2441b470fed69cce8629848941cd7930a86f35f6ad9a68d7fa717a26ee2d1',
    validFrom: '2019-07-27',
    validUntil: '2029-07-27',
    notes: `${FIRMAEC_JAR_NOTE} Class SubCaCertBce20192029.`,
  },
  {
    slug: 'darkcam-subca',
    commonName: 'DARKCAM S.A. - CA Subordinada',
    rootSlug: 'darkcam',
    orgName: 'DARKCAM S.A.',
    pemContent: darkcamSubcaPem,
    fingerprintSha256: '50f86c4eccab9f18b2e474dc269581aca104ae06cbe17c4c92fc3acaf1ec4c43',
    validFrom: '2026-01-29',
    validUntil: '2036-01-30',
    notes: `${FIRMAEC_JAR_NOTE} Class SubCaCertDarkcam20262036.`,
  },
  {
    slug: 'datil-subca-2021',
    commonName: 'Datil Autoridad de Certificacion Subordinada',
    rootSlug: 'datil',
    orgName: 'Datilmedia S.A.',
    pemContent: datilSubca2021Pem,
    fingerprintSha256: '5ccb79819ff09501ca1f96db93dae966211c34feaf4898f6e3097d91f9f679cd',
    validFrom: '2021-12-16',
    validUntil: '2031-12-14',
    notes: `${FIRMAEC_JAR_NOTE} Class SubCaCertDatil20212031.`,
  },
  {
    slug: 'datil-2025-subca',
    commonName: 'Datil Autoridad de Certificacion Subordinada 2',
    rootSlug: 'datil-2025',
    orgName: 'Datilmedia S.A.',
    pemContent: datil2025SubcaPem,
    fingerprintSha256: '903f8e3abf231f7af1530f5a959cc8c1f18891b29202b717da3ccc0df319e0c3',
    validFrom: '2025-09-25',
    validUntil: '2035-09-24',
    notes: `${FIRMAEC_JAR_NOTE} Class SubCaCertDatil20252035.`,
  },
  {
    slug: 'datil-2025-subca-corta-duracion',
    commonName: 'Datil Autoridad de Certificacion Subordinada Corta Duracion',
    rootSlug: 'datil-2025',
    orgName: 'Datilmedia S.A.',
    pemContent: datil2025SubcaCortaDuracionPem,
    fingerprintSha256: '9da27817ac4b682ea10303d3e0e101c3b972b674a5feddae702ca73af7ce1005',
    validFrom: '2026-01-22',
    validUntil: '2036-01-21',
    notes: `${FIRMAEC_JAR_NOTE} Class SubCaCertDatilCortaDuracion20262036. Short-duration issuing CA that runs in parallel with datil-2025-subca under the same root (datil-2025) — likely used for short-lived signing certs; both must stay listed.`,
  },
  {
    slug: 'firmasegura-subca',
    commonName: 'AUTORIDAD DE CERTIFICACION SUBCA-1 FIRMASEGURA S.A.S.',
    rootSlug: 'firmasegura',
    orgName: 'FIRMASEGURA S.A.S.',
    pemContent: firmaseguraSubcaPem,
    fingerprintSha256: 'ebd30e6bc02d0e74b1385b6d1f853dd656463c90d9af62994fc499b12c650752',
    validFrom: '2024-02-21',
    validUntil: '2043-12-20',
    notes: `${FIRMAEC_JAR_NOTE} Class SubCaCertFirmaSegura20232043.`,
  },
  {
    slug: 'lazzate-subca',
    commonName: 'Lazzate Emisor CA',
    rootSlug: 'lazzate',
    orgName: 'Lazzate Cia. Ltda.',
    pemContent: lazzateSubcaPem,
    fingerprintSha256: '9d3f6a8803ce0edd5767e85f2d6510f40b7f7e310184f2ae4c9dca0fa2531c9d',
    validFrom: '2022-10-13',
    validUntil: '2037-10-13',
    notes: `${FIRMAEC_JAR_NOTE} Class SubCaCertLazzate. Chains to the base "lazzate" root (distinct from the parallel lazzate-ca1/lazzate-ca2/lazzate-wego roots).`,
  },
  {
    slug: 'letmi-subca',
    commonName: 'LETMI RSA SUB C1',
    rootSlug: 'letmi',
    orgName: 'LETMI ECUADOR S.A.',
    pemContent: letmiSubcaPem,
    fingerprintSha256: '279f33e1aec8f61ce67abb6754ca6c72df6e965a63e4c8c440747cfaf6e77b11',
    validFrom: '2025-01-20',
    validUntil: '2035-01-18',
    notes: `${FIRMAEC_JAR_NOTE} Class SubCaCertLetmi20252035.`,
  },
  {
    slug: 'securitydata-legacy-subca-2011',
    commonName: 'AUTORIDAD DE CERTIFICACION SUB SECURITY DATA',
    rootSlug: 'securitydata-legacy',
    orgName: 'SECURITY DATA S.A.',
    pemContent: securitydataLegacySubca2011Pem,
    fingerprintSha256: 'd287640ae72f680b69b135b17df103ee1f268046665052255057a80dae29ddec',
    validFrom: '2011-02-16',
    validUntil: '2026-02-16',
    notes: `${FIRMAEC_JAR_NOTE} Class SubCaCertSecurityData20112026. EXPIRED (notAfter 2026-02-16) — kept for historical/LTV verification of documents signed within its validity window; the verifier evaluates cert validity at signing time, not at verification time.`,
  },
  {
    slug: 'securitydata-legacy-subca-2019',
    commonName: 'AUTORIDAD DE CERTIFICACION SUBCA-1 SECURITY DATA',
    rootSlug: 'securitydata-legacy',
    orgName: 'SECURITY DATA S.A. 1',
    pemContent: securitydataLegacySubca2019Pem,
    fingerprintSha256: '621b18b2738b6102ad61f77a675f9d169c86d0ce55087bd7c92a89c09defa830',
    validFrom: '2019-02-07',
    validUntil: '2031-02-07',
    notes: `${FIRMAEC_JAR_NOTE} Class SubCaCertSecurityData20192031.`,
  },
  {
    slug: 'uanataca-ca1-2016',
    commonName: 'UANATACA CA1 2016',
    rootSlug: 'uanataca',
    orgName: 'UANATACA S.A.',
    pemContent: uanatacaCa1_2016Pem,
    fingerprintSha256: '35a99284a220789ba0e062eeff1b5f2f74be43754469977cb318c7c86ad48f9f',
    validFrom: '2016-03-11',
    validUntil: '2029-03-11',
    notes: `${FIRMAEC_JAR_NOTE} Class SubCaCertUanataca0220162029. Third parallel UANATACA issuing CA alongside uanataca-ca2-2016 and uanataca-ca2-2021 — same root, different CN ("CA1" vs "CA2"), not a duplicate.`,
  },
];

// NOTE: `getIntermediates()` lives in ./index.ts (dynamic import) so that
// build-json.ts can import the index in plain Node without statically loading
// this file's Vite `?raw` PEM import. Import `{ getIntermediates }` from the
// package root, not from here.
