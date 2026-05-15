/**
 * roots.ts — Trust anchors for the 17 ARCOTEL-accredited ECIs.
 *
 * PEM content is imported as raw text via Vite's `?raw` suffix.
 * In Node/Vitest, the `?raw` suffix is handled by the vitest config's
 * asset transform. In build-json.ts (plain Node), PEMs are read directly
 * with fs.readFileSync so no `?raw` is needed there.
 *
 * STATUS as of 2026-05-12 (F6.7 + v0.7.0):
 *   3/17 slots hold REAL roots:
 *     - eclipsesoft (ECLIPSOFT CA ROOT, self-signed 2025-12-02 → 2050-12-03)
 *     - uanataca   (UANATACA ROOT 2016, self-signed 2016-03-11 → 2041-03-11)
 *     - argosdata  (ArgosData Root CA -SHA256, self-signed 2022-06-09 → 2032-06-09)
 *   14/17 slots remain self-signed placeholders. ARCOTEL listing page does
 *   not link to per-ACE repositories; many ACEs (BCE, Datil, Security Data,
 *   registro-civil, judicatura, and smaller ECIs) do not publish their root
 *   certs at well-known URLs accessible from outside EC networks. Each
 *   placeholder's `notes` documents what was tried.
 *
 * Sources:
 *   - ARCOTEL listing (17 acreditadas):
 *       https://www.arcotel.gob.ec/listado-de-las-entidades-de-certificacion-de-informacion-y-servicios-relacionados-acreditados-y-terceros-vinculados-debidamente-acreditadas/
 *   - SRI gob.ec subset (8 acepted for the 13 procedures):
 *       https://www.sri.gob.ec/tramites-en-gob-ec
 */

import type { TrustRoot } from './index.ts';

// PEM imports — Vite resolves these as raw strings at bundle time.
// build-json.ts reads them via readFileSync instead (no bundler).
import alphaTechnologiesPem from './roots/alpha-technologies-2024.pem?raw';
import anfacPem from './roots/anfac-2024.pem?raw';
import appfirmasPem from './roots/appfirmas-2024.pem?raw';
import argosdataPem from './roots/argosdata-2024.pem?raw';
import bcePem from './roots/bce-2024.pem?raw';
import judicaturaPem from './roots/judicatura-2024.pem?raw';
import corpnewbestPem from './roots/corpnewbest-2024.pem?raw';
import darkcamPem from './roots/darkcam-2024.pem?raw';
import datilPem from './roots/datil-2024.pem?raw';
import registroCivilPem from './roots/registro-civil-2024.pem?raw';
import eclipsesoftPem from './roots/eclipsesoft-2024.pem?raw';
import firmaseguraPem from './roots/firmasegura-2024.pem?raw';
import lazzatePem from './roots/lazzate-2024.pem?raw';
import letmiPem from './roots/letmi-2024.pem?raw';
import primecorelatPem from './roots/primecorelat-2024.pem?raw';
import securitydataPem from './roots/securitydata-2024.pem?raw';
import uanatacaPem from './roots/uanataca-2024.pem?raw';

const NEW_PLACEHOLDER_NOTE =
  'Placeholder cert generated 2026-05-09; replace with real root from ARCOTEL ECI repository.';

export const roots: TrustRoot[] = [
  {
    slug: 'alpha-technologies',
    commonName: 'Alpha Technologies Root CA',
    orgName: 'Alpha Technologies Cia. Ltda.',
    country: 'EC',
    pemContent: alphaTechnologiesPem,
    fingerprintSha256: 'cc2648eb31552990eaa771a92389d421e88cabf391462dcb1604d8270193bf0d',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    isDefunct: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.arcotel.gob.ec/',
    notes: 'ARCOTEL-listed but no operational public presence (no public site, no PKI repository, no SRI acceptance). Marked inactive 2026-05-14.',
  },
  {
    slug: 'anfac',
    commonName: 'ANF High Assurance Ecuador Root CA',
    orgName: 'ANFAC AUTORIDAD DE CERTIFICACION ECUADOR C.A.',
    country: 'EC',
    pemContent: anfacPem,
    fingerprintSha256: '0f361d8b258123ea9bb84dd3f2c821c0285479626e1185e12f1a04b85546e459',
    validFrom: '2019-10-17',
    validUntil: '2039-10-12',
    isPlaceholder: false,
    acceptedInGobEc: true,
    repositoryUrl: 'https://www.anf.es/es/pki/',
    notes:
      'Real root extracted 2026-05-15 from PAdES CMS chain of a signed contract (Cliente GPS). ' +
      'Self-signed: CN=ANF High Assurance Ecuador Root CA, O=ANFAC AUTORIDAD DE CERTIFICACION ' +
      'ECUADOR C.A. (RUC 1792601215001), OU=ANF Clase 1 CA EC, C=EC. Valid 2019-10-17 → 2039-10-12 ' +
      '(20-year root). ANFAC Ecuador IS active despite the Ecuadorian domains being NXDOMAIN — they ' +
      'issue certificates under their own EC-incorporated root (not the Spanish ANF root).',
  },
  {
    slug: 'appfirmas',
    commonName: 'AppFirmas Root CA',
    orgName: 'AppFirmas S.A.',
    country: 'EC',
    pemContent: appfirmasPem,
    fingerprintSha256: '43a62f389df27c21c37733f0ea567899e4999bb0e09c3860801aeb374da3a417',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    isDefunct: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.arcotel.gob.ec/',
    notes: 'ARCOTEL-listed but no operational public presence (no public site, no PKI repository, no SRI acceptance). Marked inactive 2026-05-14.',
  },
  {
    slug: 'argosdata',
    commonName: 'ArgosData Root CA -SHA256',
    orgName: 'ArgosData Certificación de Información y Servicios Relacionados S.A.S.',
    country: 'EC',
    pemContent: argosdataPem,
    fingerprintSha256: 'aaf7700654779e09dd8e380776022b24f6dde672f50cf82f88406ab7b01bde39',
    validFrom: '2022-06-09',
    validUntil: '2032-06-09',
    isPlaceholder: false,
    acceptedInGobEc: true,
    repositoryUrl: 'https://argosdata.com.ec/firma-electronica-certificada/',
    notes:
      'Real root extracted 2026-05-12 via PKCS#12 -cacerts -nokeys from a client-issued .p12. ' +
      'Self-signed root, valid 2022-06-09 → 2032-06-09. ' +
      'Subject: C=EC, O=ArgosData, OU=ArgosData CA, CN=ArgosData Root CA -SHA256. ' +
      'Issues intermediate "ArgosData CA 1 - SHA256" which directly signs end-entity certs. ' +
      'ArgosData does not publish the root at well-known URLs; obtained from client-side .p12 chain export.',
  },
  {
    slug: 'bce',
    commonName: 'AUTORIDAD DE CERTIFICACION RAIZ DEL BANCO CENTRAL DEL ECUADOR',
    orgName: 'Banco Central del Ecuador',
    country: 'EC',
    pemContent: bcePem,
    fingerprintSha256: '11c7c59be9d21d216f0e8151378d53d03b314060559adc49da161ec4f7829bec',
    validFrom: '2011-08-08',
    validUntil: '2031-08-08',
    isPlaceholder: false,
    acceptedInGobEc: true,
    repositoryUrl: 'https://www.eci.bce.fin.ec/repositorio',
    notes:
      'Real root extracted 2026-05-15 from PAdES CMS chain of a Certificado de Matrimonio signed ' +
      'by the Director General del Registro Civil (Ottón José Rivadeneira González). Registro Civil ' +
      'uses BCE-issued certificates — the CMS chain delivered the BCE root directly. ' +
      'Subject == Issuer (self-signed): C=EC, O=BANCO CENTRAL DEL ECUADOR, OU=ECIBCE, L=Quito. ' +
      'Valid 2011-08-08 → 2031-08-08 (20-year root). ' +
      'BCE does NOT serve this PEM publicly (WAF blocks /aia/eciroot.crt); extracted offline from a real signed PDF.',
  },
  {
    slug: 'judicatura',
    commonName: 'Consejo de la Judicatura ECI Root CA',
    orgName: 'Consejo de la Judicatura',
    country: 'EC',
    pemContent: judicaturaPem,
    fingerprintSha256: 'cf45385ffc8b620f4001bd44dc6b207a2338d038d37a96baab4cd1524b2e10a9',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    acceptedInGobEc: true,
    repositoryUrl: 'https://www.funcionjudicial.gob.ec/',
    notes: NEW_PLACEHOLDER_NOTE,
  },
  {
    slug: 'corpnewbest',
    commonName: 'CorpNewBest Root CA',
    orgName: 'CorpNewBest Cia. Ltda.',
    country: 'EC',
    pemContent: corpnewbestPem,
    fingerprintSha256: '017106a027f37311e49f1fd6ae9f2dfb037790545ffaff5716b8ba1e695d0618',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    isDefunct: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.arcotel.gob.ec/',
    notes: 'ARCOTEL-listed but no operational public presence (no public site, no PKI repository, no SRI acceptance). Marked inactive 2026-05-14.',
  },
  {
    slug: 'darkcam',
    commonName: 'DarkCam Root CA',
    orgName: 'DarkCam S.A.',
    country: 'EC',
    pemContent: darkcamPem,
    fingerprintSha256: '8a35fdfdb68fa048a3b5bdb74e61e957083c40db990137c85e63346eafd4ec39',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    isDefunct: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.arcotel.gob.ec/',
    notes: 'ARCOTEL-listed but no operational public presence (no public site, no PKI repository, no SRI acceptance). Marked inactive 2026-05-14.',
  },
  {
    slug: 'datil',
    commonName: 'Datil Autoridad de Certificacion',
    orgName: 'Datilmedia S.A.',
    country: 'EC',
    pemContent: datilPem,
    fingerprintSha256: '401574c5215ed1d6f35575ea515a3bf3a0a03325307f6f01a59f4769563d74f9',
    validFrom: '2021-12-16',
    validUntil: '2031-12-14',
    isPlaceholder: false,
    acceptedInGobEc: true,
    repositoryUrl: 'https://datil-os-public.s3.us-west-2.amazonaws.com/98e21dbd-b6ec-4e83-b9e9-d4ae12b4d967/Root_CA.crt',
    notes:
      'Real root fetched 2026-05-14 from Datil public S3 bucket (linked from datil.com/certificados). ' +
      'Self-signed root, valid 2021-12-16 → 2031-12-14. ' +
      'Subject: C=EC, ST=Guayas, L=Guayaquil, O=Datilmedia S.A., OU=Entidad de certificacion de informacion, CN=Datil Autoridad de Certificacion.',
  },
  {
    slug: 'registro-civil',
    commonName: 'Registro Civil ECI Root CA',
    orgName: 'Dirección General de Registro Civil, Identificación y Cedulación',
    country: 'EC',
    pemContent: registroCivilPem,
    fingerprintSha256: '87e62886de2c5790734d10485e062dcc93d350a8e5c9496bc1906450df9a83ac',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.registrocivil.gob.ec/',
    notes: NEW_PLACEHOLDER_NOTE,
  },
  {
    slug: 'eclipsesoft',
    commonName: 'ECLIPSOFT CA ROOT',
    orgName: 'ECLIPSOFT S.A.',
    country: 'EC',
    pemContent: eclipsesoftPem,
    fingerprintSha256: 'e40c3ce550fc7499766896148a19c187d3614efac701fa47301bd9d52622c1f9',
    validFrom: '2025-12-02',
    validUntil: '2050-12-03',
    isPlaceholder: false,
    acceptedInGobEc: true,
    repositoryUrl: 'https://firmas.eclipsoft.com/wp-content/uploads/2026/03/ECLIPSOFTCAROOT.cacert.cer',
    notes:
      'Real root fetched 2026-05-10 from firmas.eclipsoft.com. Self-signed root, valid 2025-12-02 → 2050-12-03. ' +
      'Subject CN=ECLIPSOFT CA ROOT, O=ECLIPSOFT S.A., L=GUAYAQUIL, C=EC, organizationIdentifier=VATEC-0992253428001.',
  },
  {
    slug: 'firmasegura',
    commonName: 'FirmaSegura Root CA',
    orgName: 'FirmaSegura S.A.S.',
    country: 'EC',
    pemContent: firmaseguraPem,
    fingerprintSha256: 'd59d62f262a50275d8c3a286415781cdff0f28a4c6d561370c9e6c1fd3f912a1',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    isDefunct: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.firmasegura.ec/',
    notes: 'ARCOTEL-listed but domain inactive (firmasegura.ec / firmasegura.com DNS down or domain-for-sale). No SRI acceptance. Marked inactive 2026-05-14.',
  },
  {
    slug: 'lazzate',
    commonName: 'Lazzate Root CA',
    orgName: 'Lazzate Cia. Ltda.',
    country: 'EC',
    pemContent: lazzatePem,
    fingerprintSha256: 'aa7582d07e2c3be3701f48d0a92179355f3487169bf43c6fbec280d1830fc7c5',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    isDefunct: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.arcotel.gob.ec/',
    notes: 'ARCOTEL-listed but no operational public presence (no public site, no PKI repository, no SRI acceptance). Marked inactive 2026-05-14.',
  },
  {
    slug: 'letmi',
    commonName: 'LetMi Ecuador Root CA',
    orgName: 'LetMi Ecuador S.A.',
    country: 'EC',
    pemContent: letmiPem,
    fingerprintSha256: 'ef8b3c5d3dc4e73edcedaa11c20c1a224143df42e1d59583cf85f5e23381b132',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    isDefunct: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.arcotel.gob.ec/',
    notes: 'ARCOTEL-listed but no operational public presence (no public site, no PKI repository, no SRI acceptance). Marked inactive 2026-05-14.',
  },
  {
    slug: 'primecorelat',
    commonName: 'PrimeCoreLat Root CA',
    orgName: 'PrimeCoreLat S.A.S. B.I.C.',
    country: 'EC',
    pemContent: primecorelatPem,
    fingerprintSha256: '423440793ae2bb0b6ac5b6ee27a7ded40cfd716cafaa068568885e7925925d9b',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    isDefunct: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.arcotel.gob.ec/',
    notes: 'ARCOTEL-listed but no operational public presence (no public site, no PKI repository, no SRI acceptance). Marked inactive 2026-05-14.',
  },
  {
    slug: 'securitydata',
    commonName: 'AUTORIDAD DE CERTIFICACION RAIZ CA-2 SECURITY DATA',
    orgName: 'SECURITY DATA S.A. 2',
    country: 'EC',
    pemContent: securitydataPem,
    fingerprintSha256: '503b5960fa8cc58f3367642a911fd8f8277e474d6891637fe56ca2a69f069cbd',
    validFrom: '2019-10-15',
    validUntil: '2039-10-06',
    isPlaceholder: false,
    acceptedInGobEc: true,
    repositoryUrl: 'https://www.securitydata.net.ec/descargas',
    notes:
      'Real root extracted 2026-05-15 from PAdES CMS chain of a real signed contract (LT-level signature ' +
      'with full chain embedded). Self-signed: CN=AUTORIDAD DE CERTIFICACION RAIZ CA-2 SECURITY DATA, ' +
      'O=SECURITY DATA S.A. 2, OU=ENTIDAD DE CERTIFICACION DE INFORMACION, C=EC. Valid 2019-10-15 → 2039-10-06. ' +
      'Issues intermediate "AUTORIDAD DE CERTIFICACION SUBCA-2 SECURITY DATA" which signs end-entity certs. ' +
      'Security Data does not publish the root at well-known URLs; obtained from a client-side PDF.',
  },
  {
    slug: 'uanataca',
    commonName: 'UANATACA ROOT 2016',
    orgName: 'UANATACA S.A.',
    country: 'ES',
    pemContent: uanatacaPem,
    fingerprintSha256: '44607b3d0ebd0d2bf181cb62f3cea9766dbb6718743f55b153a320ea99dfb5a6',
    validFrom: '2016-03-11',
    validUntil: '2041-03-11',
    isPlaceholder: false,
    acceptedInGobEc: true,
    repositoryUrl: 'https://web.uanataca.com/ec/certificados-ca',
    notes:
      'Real root fetched 2026-05-10 from web.uanataca.com (EC repository). Self-signed root, valid 2016-03-11 → 2041-03-11. ' +
      'Subject C=ES, O=UANATACA S.A., CN=UANATACA ROOT 2016, organizationIdentifier=VATES-A66721499. ' +
      'Spanish-incorporated qualified TSP under eIDAS, ARCOTEL-accredited as ECI in Ecuador via UanaTaca Ecuador S.A.',
  },
];
