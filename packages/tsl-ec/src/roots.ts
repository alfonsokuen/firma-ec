/**
 * roots.ts — Trust anchors for the 17 ARCOTEL-accredited ECIs.
 *
 * PEM content is imported as raw text via Vite's `?raw` suffix.
 * In Node/Vitest, the `?raw` suffix is handled by the vitest config's
 * asset transform. In build-json.ts (plain Node), PEMs are read directly
 * with fs.readFileSync so no `?raw` is needed there.
 *
 * STATUS as of 2026-05-09:
 *   ALL 17 slots are PLACEHOLDERS. The first 7 were generated 2026-05-08;
 *   the remaining 10 were added 2026-05-09 to align with the official
 *   ARCOTEL accreditation list of 17 ECIs and ECI-equivalent organisms.
 *   Replace PEM files before enabling signature chain validation in production.
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
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.arcotel.gob.ec/',
    notes: NEW_PLACEHOLDER_NOTE,
  },
  {
    slug: 'anfac',
    commonName: 'ANFAC AC Ecuador Root CA',
    orgName: 'ANFAC Autoridad de Certificación Ecuador C.A.',
    country: 'EC',
    pemContent: anfacPem,
    fingerprintSha256: 'c364f61aade5b398d841c4880951dd1d4e5c9165695304b4a10d1ad5d80da4e7',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    acceptedInGobEc: true,
    repositoryUrl: 'https://www.anf.es/es/pki/',
    notes:
      'Placeholder generated 2026-05-08. Fetch failed: crl.anf.es returns 401; anf.es WP-content paths ' +
      'return 403; repo.anf.es DNS not resolvable. Retrieve from CCADB or anf.es/repositorio.',
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
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.arcotel.gob.ec/',
    notes: NEW_PLACEHOLDER_NOTE,
  },
  {
    slug: 'argosdata',
    commonName: 'ArgosData Root CA',
    orgName: 'ArgosData Certificación de Información y Servicios Relacionados S.A.S.',
    country: 'EC',
    pemContent: argosdataPem,
    fingerprintSha256: '544a218897f27094c3f7e38bdf820b43f2511db0f7b619a9905a5380452b62a2',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    acceptedInGobEc: true,
    repositoryUrl: 'https://www.arcotel.gob.ec/',
    notes: NEW_PLACEHOLDER_NOTE,
  },
  {
    slug: 'bce',
    commonName: 'BCE ECI Root CA',
    orgName: 'Banco Central del Ecuador',
    country: 'EC',
    pemContent: bcePem,
    fingerprintSha256: 'bbba03d4bca802640c99e5cb004d5f6d223b82ebb98efe99c61cb3813c69f596',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    acceptedInGobEc: true,
    repositoryUrl: 'https://www.eci.bce.fin.ec/repositorio',
    notes:
      'Placeholder generated 2026-05-08. Fetch failed: eci.bce.fin.ec DNS not resolvable from build host. ' +
      'Try: http://www.eci.bce.fin.ec/aia/eciroot.crt or https://www.eci.bce.fin.ec/repositorio from an EC network.',
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
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.arcotel.gob.ec/',
    notes: NEW_PLACEHOLDER_NOTE,
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
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.arcotel.gob.ec/',
    notes: NEW_PLACEHOLDER_NOTE,
  },
  {
    slug: 'datil',
    commonName: 'Datil Root CA',
    orgName: 'DatilMedia S.A.',
    country: 'EC',
    pemContent: datilPem,
    fingerprintSha256: 'e2885381a7fb682d106dd7d7a3b35d40a6d34669b558bb9225fa4aacffdb5b4a',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    acceptedInGobEc: true,
    repositoryUrl: 'https://datil.co/firma-electronica',
    notes:
      'Placeholder generated 2026-05-08. Fetch failed: datil.co/repositorio/root.crt returns 404; ' +
      'firma-electronica page returns 404. Verify ARCOTEL accreditation status and current PKI URL.',
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
    commonName: 'EclipSoft Root CA',
    orgName: 'EclipSoft S.A.',
    country: 'EC',
    pemContent: eclipsesoftPem,
    fingerprintSha256: '641b9b2cfe567248cf6e6f7c650b8d7b7eae6b808b15b2748b58f65eb2ba5157',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    acceptedInGobEc: true,
    repositoryUrl: 'http://www.eclipsesoft.ec/repositorio/root.crt',
    notes:
      'Placeholder generated 2026-05-08. eclipsesoft.ec DNS not resolvable from build host. ' +
      'Check ARCOTEL ECI registry for current repositorio URL.',
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
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.firmasegura.ec/',
    notes: NEW_PLACEHOLDER_NOTE,
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
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.arcotel.gob.ec/',
    notes: NEW_PLACEHOLDER_NOTE,
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
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.arcotel.gob.ec/',
    notes: NEW_PLACEHOLDER_NOTE,
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
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.arcotel.gob.ec/',
    notes: NEW_PLACEHOLDER_NOTE,
  },
  {
    slug: 'securitydata',
    commonName: 'Security Data Root CA',
    orgName: 'Security Data Seguridad en Datos y Firma Digital S.A.',
    country: 'EC',
    pemContent: securitydataPem,
    fingerprintSha256: '3c3782f493d83cedd1452e9a9f6d7bfc404873e12f446f91b1470f8f27e63e03',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    acceptedInGobEc: true,
    repositoryUrl: 'https://www.securitydata.net.ec/descargas',
    notes:
      'Placeholder generated 2026-05-08. /repositorio/root.crt and known WP-content paths return 404. ' +
      'Site live; root PEM not publicly exposed at standard paths. Contact +593 2 392 2169.',
  },
  {
    slug: 'uanataca',
    commonName: 'UanaTaca Ecuador Root CA',
    orgName: 'UanaTaca Ecuador S.A.',
    country: 'EC',
    pemContent: uanatacaPem,
    fingerprintSha256: '0ba205e2d2e321f9cfb1000d65635a5c11bae8f04684aa9b8312230aa8efbc38',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    acceptedInGobEc: true,
    repositoryUrl: 'https://www.uanataca.com/en/trustservice/pki/',
    notes:
      'Placeholder generated 2026-05-08. Cert URLs at uanataca.com redirect to HTML; no PEM link parseable. ' +
      'Try https://www.uanataca.com/public/pki/ or contact Uanataca support.',
  },
];
