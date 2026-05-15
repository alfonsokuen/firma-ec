/**
 * tsl-update/src/main.ts — TSL drift-check and re-fetch skeleton.
 *
 * FORWARD-LOOKING SCRIPT (F4 cron job)
 * =====================================
 * This script is a skeleton — not yet wired to a cron.
 * Run manually to check whether any ECI root has drifted (real cert replaced
 * its placeholder, or a fetched cert has been renewed).
 *
 * Usage:
 *   node --experimental-strip-types tools/tsl-update/src/main.ts
 *   bun run tools/tsl-update/src/main.ts
 *
 * Exit codes:
 *   0 — no drift detected (all roots match current PEMs)
 *   1 — drift detected (at least one root changed or was newly fetchable)
 *   2 — script error
 *
 * When drift is detected the operator should:
 *   1. Review the diff printed to stdout.
 *   2. Copy the new PEM to packages/tsl-ec/src/roots/<slug>-2024.pem.
 *   3. Update fingerprintSha256, validFrom, validUntil in roots.ts.
 *   4. Run `pnpm build:tsl` to regenerate tsl-ec.json + sha256.
 *   5. Commit with a SemVer bump on @firma-ec/tsl-ec.
 */

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootsDir = resolve(__dirname, '../../../packages/tsl-ec/src/roots');

interface EciEntry {
  slug: string;
  name: string;
  fetchUrls: string[];
}

const ECIS: EciEntry[] = [
  {
    slug: 'bce',
    name: 'BCE ECI',
    fetchUrls: [
      'http://www.eci.bce.fin.ec/aia/eciroot.crt',
      'http://www.eci.bce.fin.ec/repositorio/root.crt',
      'https://www.eci.bce.fin.ec/repositorio/root.crt',
    ],
  },
  {
    slug: 'securitydata',
    name: 'Security Data SA',
    fetchUrls: [
      'https://www.securitydata.net.ec/repositorio/root.crt',
      'http://aia.securitydata.net.ec/RootCA.crt',
      'http://ocsp.securitydata.net.ec/root.crt',
    ],
  },
  {
    slug: 'anfac',
    name: 'ANF AC',
    fetchUrls: [
      'http://crl.anf.es/AC_Raiz/root.crt',
      'https://repo.anf.es/downloads/ANF_Global_Root_CA.crt',
      'https://www.anf.es/es/pki/anfglobalrootca.crt',
    ],
  },
  {
    slug: 'uanataca',
    name: 'Uanataca',
    fetchUrls: [
      'https://www.uanataca.com/repositorio/root.crt',
      'https://www.uanataca.com/public/pki/Root_ca/uanataca-root-ca-2024.pem',
      'https://www.uanataca.com/public/pki/Root_ca/uanataca-root-ca.crt',
    ],
  },
  {
    slug: 'lazzate',
    name: 'Lazzate EC',
    fetchUrls: [
      'http://www.lazzate.com/repositorio/root.crt',
      'https://www.lazzate.com/repositorio/root.crt',
      'http://www.lazzate.com/pki/root.crt',
    ],
  },
  {
    slug: 'eclipsesoft',
    name: 'Eclipse Soft EC',
    fetchUrls: [
      'http://www.eclipsesoft.ec/repositorio/root.crt',
      'https://www.eclipsesoft.ec/repositorio/root.crt',
      'http://eclipsesoft.ec/repositorio/root.crt',
    ],
  },
  {
    slug: 'datil',
    name: 'Datil EC',
    fetchUrls: [
      'http://datil.co/repositorio/root.crt',
      'https://datil.co/pki/root.crt',
      'https://datil.co/firma-electronica/root.crt',
    ],
  },
];

const UA = 'Mozilla/5.0 (firmar.ec TSL updater; https://firmar.ec)';
const TIMEOUT_SECS = 10;

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function currentPemFingerprint(slug: string): string | null {
  const pemPath = resolve(rootsDir, `${slug}-2024.pem`);
  if (!existsSync(pemPath)) return null;
  const raw = readFileSync(pemPath, 'utf-8');
  // Strip comment lines
  const pem = raw
    .split('\n')
    .filter((l) => !l.startsWith('#'))
    .join('\n')
    .trim();
  return sha256Hex(Buffer.from(pem));
}

function tryFetch(url: string): Buffer | null {
  try {
    const result = execSync(`curl -sSL -m ${TIMEOUT_SECS} -A "${UA}" "${url}" -o -`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result;
  } catch {
    return null;
  }
}

function tryParseCert(buf: Buffer): { pem: string; fingerprint: string } | null {
  // Try DER first, then PEM
  for (const format of ['DER', 'PEM']) {
    try {
      const pem = execSync(
        `echo "${buf.toString('base64')}" | base64 -d | openssl x509 -inform ${format} -out /dev/stdout 2>/dev/null`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString();
      if (pem.includes('BEGIN CERTIFICATE')) {
        return { pem, fingerprint: sha256Hex(Buffer.from(pem)) };
      }
    } catch {
      continue;
    }
  }
  return null;
}

console.log('TSL drift-check — firmar.ec');
console.log(`Date: ${new Date().toISOString()}`);
console.log(`Roots dir: ${rootsDir}`);
console.log('');

let driftDetected = false;
const results: Array<{
  slug: string;
  status: 'unchanged' | 'drift' | 'placeholder' | 'error';
  detail: string;
}> = [];

for (const eci of ECIS) {
  const currentFp = currentPemFingerprint(eci.slug);
  if (!currentFp) {
    results.push({ slug: eci.slug, status: 'error', detail: 'PEM file missing' });
    continue;
  }

  console.log(`Checking ${eci.slug} (${eci.name})...`);
  let fetched: { pem: string; fingerprint: string } | null = null;

  for (const url of eci.fetchUrls) {
    process.stdout.write(`  Trying ${url} ... `);
    const buf = tryFetch(url);
    if (!buf || buf.length === 0) {
      console.log('failed (empty/network error)');
      continue;
    }
    fetched = tryParseCert(buf);
    if (fetched) {
      console.log('OK');
      break;
    }
    console.log('failed (not a valid cert)');
  }

  if (!fetched) {
    console.log(`  → Still unreachable. Current placeholder remains valid.\n`);
    results.push({ slug: eci.slug, status: 'placeholder', detail: 'all fetch attempts failed' });
    continue;
  }

  if (fetched.fingerprint === currentFp) {
    console.log(`  → Unchanged (fp: ${currentFp.slice(0, 16)}...)\n`);
    results.push({ slug: eci.slug, status: 'unchanged', detail: `fp: ${currentFp}` });
  } else {
    console.log(`  → DRIFT DETECTED!`);
    console.log(`     Old fp: ${currentFp}`);
    console.log(`     New fp: ${fetched.fingerprint}`);
    console.log(`     Action: copy new PEM → packages/tsl-ec/src/roots/${eci.slug}-2024.pem`);
    console.log(`             update fingerprintSha256 in roots.ts`);
    console.log(`             run: pnpm build:tsl\n`);
    driftDetected = true;
    results.push({
      slug: eci.slug,
      status: 'drift',
      detail: `old:${currentFp} new:${fetched.fingerprint}`,
    });
  }
}

console.log('\n=== SUMMARY ===');
for (const r of results) {
  const icon =
    r.status === 'unchanged'
      ? '✓'
      : r.status === 'placeholder'
        ? '??'
        : r.status === 'drift'
          ? '!!'
          : '✗';
  console.log(`  ${icon} ${r.slug.padEnd(14)} ${r.status}`);
}
console.log('');
console.log('TSL drift check complete.');

process.exit(driftDetected ? 1 : 0);
