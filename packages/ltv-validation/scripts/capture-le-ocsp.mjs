#!/usr/bin/env node
/**
 * Capture a frozen Let's Encrypt OCSP `good` response as a KAT fixture.
 *
 * Network-only (sandbox can't run this). Run on a dev box:
 *
 *   LE_HOST=letsencrypt.org pnpm --filter @firma-ec/ltv-validation \
 *     exec node scripts/capture-le-ocsp.mjs
 *
 * Writes `tests/__fixtures__/le-ocsp-good-<date>.der` and prints SHA-256.
 *
 * Pre-reqs: openssl ≥ 3 in PATH.
 */

import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const here = resolve(__dirname, '..');
const fxDir = resolve(here, 'tests', '__fixtures__');

const host = process.env.LE_HOST ?? 'letsencrypt.org';
const tmp = resolve(here, '.tmp-ocsp-capture');
execSync(`mkdir -p "${tmp}"`);

console.log(`[capture] fetching cert chain from ${host}:443 ...`);
execSync(
  `openssl s_client -connect ${host}:443 -servername ${host} -showcerts < /dev/null > "${tmp}/chain.pem" 2>/dev/null`,
);

// Split chain.pem into separate certs
const chain = readFileSync(`${tmp}/chain.pem`, 'utf8');
const certs = [...chain.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)].map(
  (m) => m[0],
);
if (certs.length < 2) {
  console.error('[capture] expected ≥2 certs in chain.pem');
  process.exit(1);
}
writeFileSync(`${tmp}/cert.pem`, certs[0]);
writeFileSync(`${tmp}/issuer.pem`, certs[1]);

console.log('[capture] querying http://r3.o.lencr.org ...');
const today = new Date().toISOString().slice(0, 10);
const out = resolve(fxDir, `le-ocsp-good-${today}.der`);
execSync(
  `openssl ocsp -issuer "${tmp}/issuer.pem" -cert "${tmp}/cert.pem" -url http://r3.o.lencr.org -respout "${out}" -noverify`,
  { stdio: 'inherit' },
);

const der = readFileSync(out);
const sha256 = createHash('sha256').update(der).digest('hex');
console.log(`[capture] wrote ${out}`);
console.log(`[capture] SHA-256(${out.split(/[\\/]/).pop()}) = ${sha256}`);
console.log(`[capture] update tests/__fixtures__/README.md with the hash above.`);
