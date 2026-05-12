/**
 * build-json.ts — Bundles tsl-ec roots into a static JSON artifact.
 *
 * Outputs:
 *   apps/pwa/public/trust/tsl-ec.json   — full trust list (consumed at runtime)
 *   apps/pwa/public/trust/tsl-ec.sha256 — SHA-256 of the JSON (used for SRI check in tsl.ts)
 *
 * Run via:
 *   node --experimental-strip-types packages/tsl-ec/src/build-json.ts
 *   (from the monorepo root — pnpm build:tsl)
 *
 * NOTE: This file must NOT use Vite `?raw` imports — it runs in plain Node.
 * PEM content is read from disk via readFileSync. The roots array is re-constructed
 * here from the same metadata as roots.ts to keep a single source of truth.
 *
 * Coverage as of 2026-05-09: 17 ARCOTEL-accredited ECIs (all placeholders).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TSL_VERSION, TSL_SEQUENCE, type TrustRoot } from './index.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootsDir = resolve(__dirname, 'roots');

/**
 * Read a PEM file from the roots/ directory.
 * Strips comment lines starting with '#' before returning so the JSON
 * only contains the actual PEM block (BEGIN/END CERTIFICATE).
 */
function readPem(slug: string): string {
  const raw = readFileSync(resolve(rootsDir, `${slug}-2024.pem`), 'utf-8');
  return raw
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .trim();
}

const NEW_PLACEHOLDER_NOTE =
  'Placeholder cert generated 2026-05-09; replace with real root from ARCOTEL ECI repository.';

// Metadata mirrors roots.ts — keep in sync when slots are updated.
const rootsMeta: Omit<TrustRoot, 'pemContent'>[] = [
  {
    slug: 'alpha-technologies',
    commonName: 'Alpha Technologies Root CA',
    orgName: 'Alpha Technologies Cia. Ltda.',
    country: 'EC',
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
    fingerprintSha256: 'c364f61aade5b398d841c4880951dd1d4e5c9165695304b4a10d1ad5d80da4e7',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    acceptedInGobEc: true,
    repositoryUrl: 'https://www.anf.es/es/pki/',
    notes: 'Placeholder generated 2026-05-08. Try CCADB or https://www.anf.es/repositorio.',
  },
  {
    slug: 'appfirmas',
    commonName: 'AppFirmas Root CA',
    orgName: 'AppFirmas S.A.',
    country: 'EC',
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
    commonName: 'ArgosData Root CA -SHA256',
    orgName: 'ArgosData Certificación de Información y Servicios Relacionados S.A.S.',
    country: 'EC',
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
      'Issues intermediate "ArgosData CA 1 - SHA256" which directly signs end-entity certs.',
  },
  {
    slug: 'bce',
    commonName: 'BCE ECI Root CA',
    orgName: 'Banco Central del Ecuador',
    country: 'EC',
    fingerprintSha256: 'bbba03d4bca802640c99e5cb004d5f6d223b82ebb98efe99c61cb3813c69f596',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    acceptedInGobEc: true,
    repositoryUrl: 'https://www.eci.bce.fin.ec/repositorio',
    notes: 'Placeholder generated 2026-05-08. DNS not resolvable. Try from EC network.',
  },
  {
    slug: 'judicatura',
    commonName: 'Consejo de la Judicatura ECI Root CA',
    orgName: 'Consejo de la Judicatura',
    country: 'EC',
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
    fingerprintSha256: 'e2885381a7fb682d106dd7d7a3b35d40a6d34669b558bb9225fa4aacffdb5b4a',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    acceptedInGobEc: true,
    repositoryUrl: 'https://datil.co/firma-electronica',
    notes: 'Placeholder generated 2026-05-08. /repositorio/root.crt returns 404. Verify ARCOTEL accreditation status.',
  },
  {
    slug: 'registro-civil',
    commonName: 'Registro Civil ECI Root CA',
    orgName: 'Dirección General de Registro Civil, Identificación y Cedulación',
    country: 'EC',
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
    fingerprintSha256: 'e40c3ce550fc7499766896148a19c187d3614efac701fa47301bd9d52622c1f9',
    validFrom: '2025-12-02',
    validUntil: '2050-12-03',
    isPlaceholder: false,
    acceptedInGobEc: true,
    repositoryUrl: 'https://firmas.eclipsoft.com/wp-content/uploads/2026/03/ECLIPSOFTCAROOT.cacert.cer',
    notes: 'Real root fetched 2026-05-10 from firmas.eclipsoft.com. Self-signed, valid 2025-12-02 → 2050-12-03.',
  },
  {
    slug: 'firmasegura',
    commonName: 'FirmaSegura Root CA',
    orgName: 'FirmaSegura S.A.S.',
    country: 'EC',
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
    fingerprintSha256: '3c3782f493d83cedd1452e9a9f6d7bfc404873e12f446f91b1470f8f27e63e03',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    acceptedInGobEc: true,
    repositoryUrl: 'https://www.securitydata.net.ec/descargas',
    notes: 'Placeholder generated 2026-05-08. No public root PEM at standard paths. Contact +593 2 392 2169.',
  },
  {
    slug: 'uanataca',
    commonName: 'UANATACA ROOT 2016',
    orgName: 'UANATACA S.A.',
    country: 'ES',
    fingerprintSha256: '44607b3d0ebd0d2bf181cb62f3cea9766dbb6718743f55b153a320ea99dfb5a6',
    validFrom: '2016-03-11',
    validUntil: '2041-03-11',
    isPlaceholder: false,
    acceptedInGobEc: true,
    repositoryUrl: 'https://web.uanataca.com/ec/certificados-ca',
    notes: 'Real root fetched 2026-05-10 from web.uanataca.com (EC repo). Self-signed, valid 2016-03-11 → 2041-03-11.',
  },
];

const roots: TrustRoot[] = rootsMeta.map((meta) => ({
  ...meta,
  pemContent: readPem(meta.slug),
}));

const outPath = resolve(__dirname, '../../../apps/pwa/public/trust/tsl-ec.json');
const shaPath = resolve(__dirname, '../../../apps/pwa/public/trust/tsl-ec.sha256');

mkdirSync(dirname(outPath), { recursive: true });

const acceptedInGobEcCount = roots.filter((r) => r.acceptedInGobEc === true).length;

const payload = {
  version: TSL_VERSION,
  sequence: TSL_SEQUENCE,
  generatedAt: new Date().toISOString(),
  // Stats are advisory; consumers should compute them from `roots`.
  stats: {
    totalArcotelAccredited: roots.length,
    acceptedInGobEc: acceptedInGobEcCount,
    sources: {
      arcotel:
        'https://www.arcotel.gob.ec/listado-de-las-entidades-de-certificacion-de-informacion-y-servicios-relacionados-acreditados-y-terceros-vinculados-debidamente-acreditadas/',
      sriGobEc: 'https://www.sri.gob.ec/tramites-en-gob-ec',
    },
  },
  roots,
};

const json = JSON.stringify(payload, null, 2);
writeFileSync(outPath, json, 'utf-8');

const sha = createHash('sha256').update(json, 'utf-8').digest('hex');
writeFileSync(shaPath, `${sha}\n`, 'utf-8');

const placeholderCount = roots.filter((r) => r.isPlaceholder).length;
const realCount = roots.length - placeholderCount;

console.log(`Wrote ${outPath}`);
console.log(`  Roots: ${roots.length} total (${realCount} real, ${placeholderCount} placeholder)`);
console.log(`  Accepted on gob.ec (SRI subset): ${acceptedInGobEcCount}/${roots.length}`);
console.log(`  TSL version: ${TSL_VERSION} sequence: ${TSL_SEQUENCE}`);
console.log(`  SHA-256: ${sha}`);
console.log(`Wrote ${shaPath}`);

if (placeholderCount > 0) {
  console.warn(
    `\nWARNING: ${placeholderCount}/${roots.length} slots are PLACEHOLDER certs.` +
      '\nSignature chain validation against real ECI roots will NOT work until' +
      '\nplaceholder PEMs are replaced with genuine root certificates.',
  );
}
