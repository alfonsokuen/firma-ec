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

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TSL_SEQUENCE, TSL_VERSION, type TrustRoot } from './index.ts';

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

const FIRMAEC_REAL_NOTE =
  'Real root extracted 2026-05-22 from official MINTEL FirmaEC library (firmadigital-libreria). Self-signed. Replaces 2026-05-09 placeholder.';

// Metadata mirrors roots.ts — keep in sync when slots are updated.
const rootsMeta: Omit<TrustRoot, 'pemContent'>[] = [
  {
    slug: 'alpha-technologies',
    commonName: 'Alpha Technologies Root CA 2024',
    orgName: 'Alpha Technologies Cia. Ltda.',
    country: 'EC',
    fingerprintSha256: 'b474ffb9244470a0482d4c1519f8a41169121c710d3bb04a55fbe046e1ca6e0a',
    validFrom: '2024-11-20',
    validUntil: '2034-11-20',
    isPlaceholder: false,
    acceptedInGobEc: false,
    repositoryUrl: 'https://minka.gob.ec/mintel/ge/firmaec',
    notes: FIRMAEC_REAL_NOTE,
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
    notes:
      'Real root extracted 2026-05-15 from PAdES CMS of a signed contract. Self-signed, valid 2019-10-17 → 2039-10-12. ANFAC Ecuador issues under its own EC root, distinct from Spanish ANF.',
  },
  {
    slug: 'appfirmas',
    commonName: 'APPFIRMAS ROOT C1',
    orgName: 'AppFirmas S.A.',
    country: 'EC',
    fingerprintSha256: 'e7f929a7fafb8e55910df6130c8c990473b2df9049a20de746d06037f5c51405',
    validFrom: '2026-02-12',
    validUntil: '2049-02-12',
    isPlaceholder: false,
    acceptedInGobEc: false,
    repositoryUrl: 'https://minka.gob.ec/mintel/ge/firmaec',
    notes: FIRMAEC_REAL_NOTE,
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
    notes:
      'Real root extracted 2026-05-15 from PAdES CMS of a Registro Civil-signed Certificado de Matrimonio. Self-signed, valid 2011-08-08 → 2031-08-08.',
  },
  {
    slug: 'judicatura',
    commonName: 'ICERT-EC ENTIDAD DE CERTIFICACION RAIZ',
    orgName:
      'Consejo de la Judicatura — Subdirección Nacional de Seguridad de la Información DNTICS',
    country: 'EC',
    fingerprintSha256: 'a434953dc5a028313d9e07b8cfefdf5a47b08e2d353bffb854a52360d6ef00c6',
    validFrom: '2014-10-16',
    validUntil: '2034-10-16',
    isPlaceholder: false,
    acceptedInGobEc: true,
    repositoryUrl: 'https://www.icert.fje.gob.ec/',
    notes:
      'Real iCert-EC root extracted 2026-05-15 from PAdES CMS of a multi-signer judicial PDF. Self-signed, valid 2014-10-16 → 2034-10-16. Issues intermediate ENTIDAD DE CERTIFICACION ICERT-EC which signs end-entity certs.',
  },
  {
    slug: 'corpnewbest',
    commonName: 'AUT. DE CERT. RAIZ CA-1EFN CORPNEWBEST',
    orgName: 'CorpNewBest Cia. Ltda.',
    country: 'EC',
    fingerprintSha256: '08e8f7b16a3792fe8b70f3a90f70d4e1fe497dedec18aa58ec022bb9b600cc60',
    validFrom: '2026-02-26',
    validUntil: '2041-02-22',
    isPlaceholder: false,
    acceptedInGobEc: false,
    repositoryUrl: 'https://minka.gob.ec/mintel/ge/firmaec',
    notes: FIRMAEC_REAL_NOTE,
  },
  {
    slug: 'darkcam',
    commonName: 'CA Root (DARKCAM S.A.)',
    orgName: 'DarkCam S.A.',
    country: 'EC',
    fingerprintSha256: 'b058a0509e37c1d4a7d4dc36e56868edbf32c00454992313a848c6808691c67e',
    validFrom: '2026-01-29',
    validUntil: '2046-01-30',
    isPlaceholder: false,
    acceptedInGobEc: false,
    repositoryUrl: 'https://minka.gob.ec/mintel/ge/firmaec',
    notes: FIRMAEC_REAL_NOTE,
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
    repositoryUrl:
      'https://datil-os-public.s3.us-west-2.amazonaws.com/98e21dbd-b6ec-4e83-b9e9-d4ae12b4d967/Root_CA.crt',
    notes:
      'Real root fetched 2026-05-14 from Datil public S3 bucket. Self-signed, valid 2021-12-16 → 2031-12-14.',
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
    isDefunct: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://www.registrocivil.gob.ec/',
    notes:
      'Marcado isDefunct 2026-05-15: Registro Civil NO opera raíz PKI propia. Resolución 009-DIGERCIC-CGAJ-DPyN-2025 firmada por 4 funcionarios usa certs emitidos por BCE (Director Rivadeneira + analista Garnica) y Security Data CA-2 (Oquendo + Rentería). Acreditación ARCOTEL nominal.',
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
    repositoryUrl:
      'https://firmas.eclipsoft.com/wp-content/uploads/2026/03/ECLIPSOFTCAROOT.cacert.cer',
    notes:
      'Real root fetched 2026-05-10 from firmas.eclipsoft.com. Self-signed, valid 2025-12-02 → 2050-12-03.',
  },
  {
    slug: 'firmasegura',
    commonName: 'AUT. DE CERT. RAIZ CA-1 FIRMASEGURA S.A.S.',
    orgName: 'FirmaSegura S.A.S.',
    country: 'EC',
    fingerprintSha256: 'a190ea602f4503c6f78f194a5277dd0cf9b3142c35571afae9dedd58a44f3465',
    validFrom: '2023-12-27',
    validUntil: '2043-12-27',
    isPlaceholder: false,
    acceptedInGobEc: false,
    repositoryUrl: 'https://minka.gob.ec/mintel/ge/firmaec',
    notes: FIRMAEC_REAL_NOTE,
  },
  {
    slug: 'lazzate',
    commonName: 'Lazzate Root CA',
    orgName: 'Lazzate Cia. Ltda.',
    country: 'EC',
    fingerprintSha256: 'b81e7be598d0e74b05ea7316cc20bcd78c3f7064ac068577b55ca626322aea94',
    validFrom: '2022-10-13',
    validUntil: '2052-10-13',
    isPlaceholder: false,
    acceptedInGobEc: false,
    repositoryUrl: 'https://minka.gob.ec/mintel/ge/firmaec',
    notes: FIRMAEC_REAL_NOTE,
  },
  {
    slug: 'letmi',
    commonName: 'LETMI RSA ROOT C1',
    orgName: 'LetMi Ecuador S.A.',
    country: 'EC',
    fingerprintSha256: 'f0432c6296b952f086f802bd5eb4fc81c5ea313b190b6edc8e9174089c7b0787',
    validFrom: '2025-01-20',
    validUntil: '2055-01-13',
    isPlaceholder: false,
    acceptedInGobEc: false,
    repositoryUrl: 'https://minka.gob.ec/mintel/ge/firmaec',
    notes: FIRMAEC_REAL_NOTE,
  },
  {
    slug: 'primecorelat',
    commonName: 'Prime Core Root CA1',
    orgName: 'PrimeCoreLat S.A.S. B.I.C.',
    country: 'EC',
    fingerprintSha256: 'c1399c5122ea4517c2d7fb4d0646726aacf85cd3e3ee397cf5593da8cf5f3a05',
    validFrom: '2026-02-19',
    validUntil: '2038-02-16',
    isPlaceholder: false,
    acceptedInGobEc: false,
    repositoryUrl: 'https://minka.gob.ec/mintel/ge/firmaec',
    notes: FIRMAEC_REAL_NOTE,
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
    notes:
      'Real root extracted 2026-05-15 from PAdES CMS of a real signed contract. Self-signed, valid 2019-10-15 → 2039-10-06. Issues intermediate SUBCA-2 SECURITY DATA which signs end-entity certs.',
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
    notes:
      'Legacy Security Data root extracted 2026-05-15 from 6 PAdES CMS chains in production PDFs. Self-signed, valid 2011-02-16 → 2031-02-16. Co-exists with CA-2 root; certs issued under this root still valid until 2031.',
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
    notes:
      'Real root fetched 2026-05-10 from web.uanataca.com (EC repo). Self-signed, valid 2016-03-11 → 2041-03-11.',
  },
  {
    slug: 'alpha-technologies-2023',
    commonName: 'Alpha Technologies Root CA 2023',
    orgName: 'Alpha Technologies Cia. Ltda.',
    country: 'EC',
    fingerprintSha256: '36a9f77f04cf858164c446552acd74f4d20e79a999cf5cdb7a9d6d4053d2f416',
    validFrom: '2023-03-22',
    validUntil: '2033-03-22',
    isPlaceholder: false,
    isParallelAnchor: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://minka.gob.ec/mintel/ge/firmaec',
    notes:
      'Additional vintage (2023 generation) for Alpha Technologies Cia. Ltda., extracted 2026-05-22 from the official MINTEL FirmaEC library. Self-signed. Parallel anchor to the 2024 root.',
  },
  {
    slug: 'appfirmas-2025',
    commonName: 'APPFIRMAS S.A. Root AC',
    orgName: 'AppFirmas S.A.',
    country: 'EC',
    fingerprintSha256: '0c3dde9a588f1a56aad4c8ece14beac7170e5bbfba52cf66e3fd2fd191dbc9ba',
    validFrom: '2025-05-01',
    validUntil: '2050-04-30',
    isPlaceholder: false,
    isParallelAnchor: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://minka.gob.ec/mintel/ge/firmaec',
    notes:
      'Additional vintage (2025 generation) for AppFirmas S.A., extracted 2026-05-22 from the official MINTEL FirmaEC library. Self-signed. Parallel anchor to the APPFIRMAS ROOT C1 root.',
  },
  {
    slug: 'corpnewbest-2024',
    commonName: 'AUT. DE CERT. RAIZ CA-1EF CORPNEWBEST',
    orgName: 'CorpNewBest Cia. Ltda.',
    country: 'EC',
    fingerprintSha256: 'c5df4fd9babad3ff3771a92b1bb5e6157a39032c8cded66dad3ef16b421dab23',
    validFrom: '2024-01-10',
    validUntil: '2033-06-19',
    isPlaceholder: false,
    isParallelAnchor: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://minka.gob.ec/mintel/ge/firmaec',
    notes:
      'Additional vintage (CA-1EF, 2024 generation) for CorpNewBest Cia. Ltda., extracted 2026-05-22 from the official MINTEL FirmaEC library. Self-signed. Parallel anchor to the CA-1EFN root.',
  },
  {
    slug: 'lazzate-ca1',
    commonName: 'Lazzate Root CA1',
    orgName: 'Lazzate Cia. Ltda.',
    country: 'EC',
    fingerprintSha256: '40016e26c8021023551180ccad0b816269b92fb9cdfc701ac876f16f61e047fa',
    validFrom: '2023-11-10',
    validUntil: '2053-11-02',
    isPlaceholder: false,
    isParallelAnchor: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://minka.gob.ec/mintel/ge/firmaec',
    notes:
      'Additional vintage (Root CA1) for Lazzate Cia. Ltda., extracted 2026-05-22 from the official MINTEL FirmaEC library. Self-signed. Parallel anchor to the Lazzate Root CA root.',
  },
  {
    slug: 'lazzate-ca2',
    commonName: 'Lazzate Root CA2',
    orgName: 'Lazzate Cia. Ltda.',
    country: 'EC',
    fingerprintSha256: 'aa9d6d0d79839e5a1a5f2c1022952954f73a47de1c539ebd4567431f75a8e589',
    validFrom: '2023-11-29',
    validUntil: '2053-11-21',
    isPlaceholder: false,
    isParallelAnchor: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://minka.gob.ec/mintel/ge/firmaec',
    notes:
      'Additional vintage (Root CA2) for Lazzate Cia. Ltda., extracted 2026-05-22 from the official MINTEL FirmaEC library. Self-signed. Parallel anchor to the Lazzate Root CA root.',
  },
  {
    slug: 'lazzate-wego',
    commonName: 'WE-GO TERCER VINCULADO Root CA1',
    orgName: 'Lazzate Cia. Ltda. (WE-GO tercer vinculado)',
    country: 'EC',
    fingerprintSha256: '6fda1e91bc9c298030dcb887bcf04e70a308fa4f76b605aec114b83631a067ea',
    validFrom: '2024-01-20',
    validUntil: '2054-01-12',
    isPlaceholder: false,
    isParallelAnchor: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://minka.gob.ec/mintel/ge/firmaec',
    notes:
      'Additional vintage (WE-GO tercer vinculado Root CA1) for Lazzate Cia. Ltda., extracted 2026-05-22 from the official MINTEL FirmaEC library. Self-signed. Parallel anchor to the Lazzate Root CA root.',
  },
  {
    slug: 'primecorelat-ca2',
    commonName: 'Prime Core Root CA2',
    orgName: 'PrimeCoreLat S.A.S. B.I.C.',
    country: 'EC',
    fingerprintSha256: '63962e66cc1b0cda139e0e27284f8f82b522154cda3ab77d7e9ac72a246dc4b8',
    validFrom: '2026-02-19',
    validUntil: '2038-02-16',
    isPlaceholder: false,
    isParallelAnchor: true,
    acceptedInGobEc: false,
    repositoryUrl: 'https://minka.gob.ec/mintel/ge/firmaec',
    notes:
      'Additional vintage (Root CA2) for PrimeCoreLat S.A.S. B.I.C., extracted 2026-05-22 from the official MINTEL FirmaEC library. Self-signed. Parallel anchor to the Prime Core Root CA1 root.',
  },
  {
    slug: 'anfac-2024',
    commonName: 'ANF AC Ecuador Root CA',
    orgName: 'ANFAC AUTORIDAD DE CERTIFICACION ECUADOR C.A.',
    country: 'EC',
    fingerprintSha256: '2cffd0682dc8354c861b3be82c4a53a2746848192d2d7fc56d33e3be7a291005',
    validFrom: '2024-10-09',
    validUntil: '2044-10-04',
    isPlaceholder: false,
    isParallelAnchor: true,
    acceptedInGobEc: true,
    repositoryUrl: 'https://minka.gob.ec/mintel/ge/firmaec',
    notes:
      'Additional vintage (2024 generation) for ANFAC Ecuador, extracted 2026-05-22 from the official MINTEL FirmaEC library. Self-signed. Parallel anchor to the 2019 ANF High Assurance Ecuador root.',
  },
  {
    slug: 'anfac-2016',
    commonName: 'ANF Global Root CA',
    orgName: 'ANFAC AUTORIDAD DE CERTIFICACION ECUADOR C.A.',
    country: 'EC',
    fingerprintSha256: 'e0afbd2c0ee95a68cd9a3c590b2d3fe07c0a6d0be796ae5291e424d47792178e',
    validFrom: '2016-05-20',
    validUntil: '2036-05-15',
    isPlaceholder: false,
    isParallelAnchor: true,
    acceptedInGobEc: true,
    repositoryUrl: 'https://minka.gob.ec/mintel/ge/firmaec',
    notes:
      'Additional vintage (ANF Global Root CA, 2016 generation) bundled for ANFAC Ecuador, extracted 2026-05-22 from the official MINTEL FirmaEC library. Self-signed. Parallel anchor to the 2019 ANF High Assurance Ecuador root.',
  },
  {
    slug: 'argosdata-2026',
    commonName: 'ArgosData Root CA - SHA256 (2026)',
    orgName: 'ArgosData Certificación de Información y Servicios Relacionados S.A.S.',
    country: 'EC',
    fingerprintSha256: '4e98b76df921851434e57284785b6628d98dc30727d3b4ba23023e8c4785b7ff',
    validFrom: '2026-03-10',
    validUntil: '2036-03-07',
    isPlaceholder: false,
    isParallelAnchor: true,
    acceptedInGobEc: true,
    repositoryUrl: 'https://minka.gob.ec/mintel/ge/firmaec',
    notes:
      'Additional vintage (2026 generation) for ArgosData, extracted 2026-05-22 from the official MINTEL FirmaEC library. Self-signed. Parallel anchor to the 2022 ArgosData Root CA -SHA256 root.',
  },
  {
    slug: 'datil-2025',
    commonName: 'Datil Aut. de Certificacion Raiz 2',
    orgName: 'Datilmedia S.A.',
    country: 'EC',
    fingerprintSha256: '1453a4a87c88e1b021ffc135ad7278143cbd03d0696fdc53e7c240fee505fe11',
    validFrom: '2025-09-25',
    validUntil: '2045-09-21',
    isPlaceholder: false,
    isParallelAnchor: true,
    acceptedInGobEc: true,
    repositoryUrl: 'https://minka.gob.ec/mintel/ge/firmaec',
    notes:
      'Additional vintage (Raiz 2, 2025 generation) for Datilmedia S.A., extracted 2026-05-22 from the official MINTEL FirmaEC library. Self-signed. Parallel anchor to the 2021 Datil Autoridad de Certificacion root.',
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
