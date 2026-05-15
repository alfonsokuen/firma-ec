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
const PEM_FILENAME_OVERRIDES: Record<string, string> = {
  'securitydata-legacy': 'securitydata-legacy-2011.pem',
};

function readPem(slug: string): string {
  const fname = PEM_FILENAME_OVERRIDES[slug] ?? `${slug}-2024.pem`;
  const raw = readFileSync(resolve(rootsDir, fname), 'utf-8');
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
    isDefunct: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.arcotel.gob.ec/',
    notes: 'ARCOTEL-listed but no operational public presence. Marked inactive 2026-05-14.',
  },
  {
    slug: 'anfac',
    commonName: 'ANF High Assurance Ecuador Root CA',
    orgName: 'ANFAC AUTORIDAD DE CERTIFICACION ECUADOR C.A.',
    country: 'EC',
    fingerprintSha256: '0f361d8b258123ea9bb84dd3f2c821c0285479626e1185e12f1a04b85546e459',
    validFrom: '2019-10-17',
    validUntil: '2039-10-12',
    isPlaceholder: false,
    acceptedInGobEc: true,
    repositoryUrl: 'https://www.anf.es/es/pki/',
    notes: 'Real root extracted 2026-05-15 from PAdES CMS of a signed contract. Self-signed, valid 2019-10-17 → 2039-10-12. ANFAC Ecuador issues under its own EC root, distinct from Spanish ANF.',
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
    isDefunct: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.arcotel.gob.ec/',
    notes: 'ARCOTEL-listed but no operational public presence. Marked inactive 2026-05-14.',
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
    commonName: 'AUTORIDAD DE CERTIFICACION RAIZ DEL BANCO CENTRAL DEL ECUADOR',
    orgName: 'Banco Central del Ecuador',
    country: 'EC',
    fingerprintSha256: '11c7c59be9d21d216f0e8151378d53d03b314060559adc49da161ec4f7829bec',
    validFrom: '2011-08-08',
    validUntil: '2031-08-08',
    isPlaceholder: false,
    acceptedInGobEc: true,
    repositoryUrl: 'https://www.eci.bce.fin.ec/repositorio',
    notes: 'Real root extracted 2026-05-15 from PAdES CMS of a Registro Civil-signed Certificado de Matrimonio. Self-signed, valid 2011-08-08 → 2031-08-08.',
  },
  {
    slug: 'judicatura',
    commonName: 'ICERT-EC ENTIDAD DE CERTIFICACION RAIZ',
    orgName: 'Consejo de la Judicatura — Subdirección Nacional de Seguridad de la Información DNTICS',
    country: 'EC',
    fingerprintSha256: 'a434953dc5a028313d9e07b8cfefdf5a47b08e2d353bffb854a52360d6ef00c6',
    validFrom: '2014-10-16',
    validUntil: '2034-10-16',
    isPlaceholder: false,
    acceptedInGobEc: true,
    repositoryUrl: 'https://www.icert.fje.gob.ec/',
    notes: 'Real iCert-EC root extracted 2026-05-15 from PAdES CMS of a multi-signer judicial PDF. Self-signed, valid 2014-10-16 → 2034-10-16. Issues intermediate ENTIDAD DE CERTIFICACION ICERT-EC which signs end-entity certs.',
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
    isDefunct: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.arcotel.gob.ec/',
    notes: 'ARCOTEL-listed but no operational public presence. Marked inactive 2026-05-14.',
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
    isDefunct: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.arcotel.gob.ec/',
    notes: 'ARCOTEL-listed but no operational public presence. Marked inactive 2026-05-14.',
  },
  {
    slug: 'datil',
    commonName: 'Datil Autoridad de Certificacion',
    orgName: 'Datilmedia S.A.',
    country: 'EC',
    fingerprintSha256: '401574c5215ed1d6f35575ea515a3bf3a0a03325307f6f01a59f4769563d74f9',
    validFrom: '2021-12-16',
    validUntil: '2031-12-14',
    isPlaceholder: false,
    acceptedInGobEc: true,
    repositoryUrl: 'https://datil-os-public.s3.us-west-2.amazonaws.com/98e21dbd-b6ec-4e83-b9e9-d4ae12b4d967/Root_CA.crt',
    notes: 'Real root fetched 2026-05-14 from Datil public S3 bucket. Self-signed, valid 2021-12-16 → 2031-12-14.',
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
    isDefunct: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.firmasegura.ec/',
    notes: 'ARCOTEL-listed but domain inactive. Marked inactive 2026-05-14.',
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
    isDefunct: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.arcotel.gob.ec/',
    notes: 'ARCOTEL-listed but no operational public presence. Marked inactive 2026-05-14.',
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
    isDefunct: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.arcotel.gob.ec/',
    notes: 'ARCOTEL-listed but no operational public presence. Marked inactive 2026-05-14.',
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
    isDefunct: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.arcotel.gob.ec/',
    notes: 'ARCOTEL-listed but no operational public presence. Marked inactive 2026-05-14.',
  },
  {
    slug: 'securitydata',
    commonName: 'AUTORIDAD DE CERTIFICACION RAIZ CA-2 SECURITY DATA',
    orgName: 'SECURITY DATA S.A. 2',
    country: 'EC',
    fingerprintSha256: '503b5960fa8cc58f3367642a911fd8f8277e474d6891637fe56ca2a69f069cbd',
    validFrom: '2019-10-15',
    validUntil: '2039-10-06',
    isPlaceholder: false,
    acceptedInGobEc: true,
    repositoryUrl: 'https://www.securitydata.net.ec/descargas',
    notes: 'Real root extracted 2026-05-15 from PAdES CMS of a real signed contract. Self-signed, valid 2019-10-15 → 2039-10-06. Issues intermediate SUBCA-2 SECURITY DATA which signs end-entity certs.',
  },
  {
    slug: 'securitydata-legacy',
    commonName: 'AUTORIDAD DE CERTIFICACION RAIZ SECURITY DATA',
    orgName: 'SECURITY DATA S.A.',
    country: 'EC',
    fingerprintSha256: 'fc8d6968851e6dc8c4be8fe8962e52d85ad32c90cd7b0d7fb6376c7a165c0e2a',
    validFrom: '2011-02-16',
    validUntil: '2031-02-16',
    isPlaceholder: false,
    isParallelAnchor: true,
    acceptedInGobEc: true,
    repositoryUrl: 'https://www.securitydata.net.ec/descargas',
    notes: 'Legacy Security Data root extracted 2026-05-15 from 6 PAdES CMS chains in production PDFs. Self-signed, valid 2011-02-16 → 2031-02-16. Co-exists with CA-2 root; certs issued under this root still valid until 2031.',
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
