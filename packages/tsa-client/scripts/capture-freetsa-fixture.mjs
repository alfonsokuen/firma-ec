#!/usr/bin/env node
/**
 * Capture a real FreeTSA TimeStampReq/TimeStampResp pair into __fixtures__/.
 *
 * Usage (from repo root or this package dir):
 *   node packages/tsa-client/scripts/capture-freetsa-fixture.mjs
 *
 * Network is required. The captured pair is checked into the repo so unit
 * tests can run offline (they consume the .tsr fixture via mocked fetch).
 *
 * The imprint is the SHA-256 of the fixed string "firma-ec-F6-test-vector",
 * so the same plaintext can be re-hashed to validate the captured response.
 *
 * The nonce is also fixed (1..8) to make the fixture reproducible across captures.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildTimeStampReq, postTimeStampReq } from '../src/request.ts';
// Note: this script is .mjs but imports .ts directly. Run via:
//   node --experimental-strip-types packages/tsa-client/scripts/capture-freetsa-fixture.mjs
// or via tsx:  pnpm dlx tsx packages/tsa-client/scripts/capture-freetsa-fixture.mjs

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '../tests/__fixtures__');
const TSQ_PATH = resolve(FIXTURE_DIR, 'freetsa-kat-2026-05-09.tsq');
const TSR_PATH = resolve(FIXTURE_DIR, 'freetsa-kat-2026-05-09.tsr');
const META_PATH = resolve(FIXTURE_DIR, 'freetsa-kat-2026-05-09.meta.json');

const FIXED_PLAINTEXT = 'firma-ec-F6-test-vector';
const FIXED_NONCE = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

async function main() {
  await mkdir(FIXTURE_DIR, { recursive: true });

  const imprint = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(FIXED_PLAINTEXT)),
  );

  const tsq = buildTimeStampReq(imprint, 'SHA-256', FIXED_NONCE);
  await writeFile(TSQ_PATH, tsq);
  console.log(`Wrote ${TSQ_PATH} (${tsq.byteLength} bytes)`);

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);
  let tsr;
  try {
    tsr = await postTimeStampReq('https://freetsa.org/tsr', tsq, controller.signal);
  } finally {
    clearTimeout(t);
  }
  await writeFile(TSR_PATH, tsr);
  console.log(`Wrote ${TSR_PATH} (${tsr.byteLength} bytes)`);

  const meta = {
    capturedAt: new Date().toISOString(),
    plaintext: FIXED_PLAINTEXT,
    imprintHex: Array.from(imprint, (b) => b.toString(16).padStart(2, '0')).join(''),
    nonceHex: Array.from(FIXED_NONCE, (b) => b.toString(16).padStart(2, '0')).join(''),
    hashAlgo: 'SHA-256',
    tsaUrl: 'https://freetsa.org/tsr',
  };
  await writeFile(META_PATH, JSON.stringify(meta, null, 2) + '\n');
  console.log(`Wrote ${META_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
