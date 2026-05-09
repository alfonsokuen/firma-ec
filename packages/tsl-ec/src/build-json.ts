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

// Metadata mirrors roots.ts — keep in sync when slots are updated.
const rootsMeta: Omit<TrustRoot, 'pemContent'>[] = [
  {
    slug: 'bce',
    commonName: 'BCE ECI Root CA',
    orgName: 'Banco Central del Ecuador — Entidad de Certificación de Información',
    country: 'EC',
    fingerprintSha256: 'bbba03d4bca802640c99e5cb004d5f6d223b82ebb98efe99c61cb3813c69f596',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    repositoryUrl: 'https://www.eci.bce.fin.ec/repositorio',
    notes: 'Placeholder generated 2026-05-08. DNS not resolvable. Try from EC network.',
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
    repositoryUrl: 'https://www.securitydata.net.ec/descargas',
    notes: 'Placeholder generated 2026-05-08. No public root PEM at standard paths. Contact +593 2 392 2169.',
  },
  {
    slug: 'anfac',
    commonName: 'ANF Global Root CA',
    orgName: 'ANF Autoridad de Certificación (Spain, accredited EC)',
    country: 'ES',
    fingerprintSha256: 'c364f61aade5b398d841c4880951dd1d4e5c9165695304b4a10d1ad5d80da4e7',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    repositoryUrl: 'https://www.anf.es/es/pki/',
    notes: 'Placeholder generated 2026-05-08. Try CCADB or https://www.anf.es/repositorio.',
  },
  {
    slug: 'uanataca',
    commonName: 'Uanataca Root CA',
    orgName: 'Uanataca S.A. (Spain/Ecuador)',
    country: 'ES',
    fingerprintSha256: '0ba205e2d2e321f9cfb1000d65635a5c11bae8f04684aa9b8312230aa8efbc38',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    repositoryUrl: 'https://www.uanataca.com/en/trustservice/pki/',
    notes: 'Placeholder generated 2026-05-08. Cert URLs redirect to HTML. Contact Uanataca support.',
  },
  {
    slug: 'lazzate',
    commonName: 'Lazzate Root CA',
    orgName: 'Lazzate EC (entity identity unclear)',
    country: 'EC',
    fingerprintSha256: 'aa7582d07e2c3be3701f48d0a92179355f3487169bf43c6fbec280d1830fc7c5',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    repositoryUrl: 'http://www.lazzate.com/repositorio/root.crt',
    notes: 'Placeholder generated 2026-05-08. lazzate.com resolves to Italian municipality. Verify at ARCOTEL.',
  },
  {
    slug: 'eclipsesoft',
    commonName: 'Eclipse Soft Root CA',
    orgName: 'Eclipse Soft S.A. Ecuador',
    country: 'EC',
    fingerprintSha256: '641b9b2cfe567248cf6e6f7c650b8d7b7eae6b808b15b2748b58f65eb2ba5157',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    repositoryUrl: 'http://www.eclipsesoft.ec/repositorio/root.crt',
    notes: 'Placeholder generated 2026-05-08. eclipsesoft.ec DNS not resolvable. Check ARCOTEL for current URL.',
  },
  {
    slug: 'datil',
    commonName: 'Datil Root CA',
    orgName: 'Datil Co. Ecuador',
    country: 'EC',
    fingerprintSha256: 'e2885381a7fb682d106dd7d7a3b35d40a6d34669b558bb9225fa4aacffdb5b4a',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    repositoryUrl: 'https://datil.co/firma-electronica',
    notes: 'Placeholder generated 2026-05-08. /repositorio/root.crt returns 404. Verify ARCOTEL accreditation status.',
  },
];

const roots: TrustRoot[] = rootsMeta.map((meta) => ({
  ...meta,
  pemContent: readPem(meta.slug),
}));

const outPath = resolve(__dirname, '../../../apps/pwa/public/trust/tsl-ec.json');
const shaPath = resolve(__dirname, '../../../apps/pwa/public/trust/tsl-ec.sha256');

mkdirSync(dirname(outPath), { recursive: true });

const payload = {
  version: TSL_VERSION,
  sequence: TSL_SEQUENCE,
  generatedAt: new Date().toISOString(),
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
console.log(`  SHA-256: ${sha}`);
console.log(`Wrote ${shaPath}`);

if (placeholderCount > 0) {
  console.warn(
    `\nWARNING: ${placeholderCount}/${roots.length} slots are PLACEHOLDER certs.` +
    '\nSignature chain validation against real ECI roots will NOT work until' +
    '\nplaceholder PEMs are replaced with genuine root certificates.',
  );
}
