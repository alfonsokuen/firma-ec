#!/usr/bin/env node
/**
 * F6 Batch V — generate B-B + B-T sample PDFs via Node + signer directly.
 *
 * Fallback path documented in the Batch V plan rule #8/#10: when the
 * Playwright E2E suite cannot run in the sandbox (vite preview + browser
 * launch unavailable), this still produces the required artifacts:
 *   1. apps/pwa/tests/e2e/fixtures/sample-b-t.pdf  (so TSA-4 doesn't skip
 *      when the suite is run on a dev machine).
 *   2. _backups/F6-cross-val-artifacts/sample-b-b-no-tsa.pdf
 *   3. _backups/F6-cross-val-artifacts/sample-b-t-freetsa.pdf
 *
 * Real FreeTSA calls. Respect rate limit (~5 req/min/IP). On failure we
 * sleep 60s and retry once.
 *
 * Prereqs:
 *   1. `pnpm -F @firma-ec/signer build && pnpm -F @firma-ec/tsa-client build`
 *   2. tsa-client dist needs `.js` extensions on relative imports — patch
 *      with: `(cd packages/tsa-client/dist && for f in *.js; do sed -i -E
 *      "s|from '(\\./[a-zA-Z][a-zA-Z0-9_-]*)'|from '\\1.js'|g" "$f"; done)`
 *   3. Temporarily switch packages/tsa-client/package.json `main`/`types`
 *      from `./src/index.ts` → `./dist/index.js` for the run.
 *
 * Run: `node scripts/gen-f6-samples.mjs`
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import * as pkijs from 'pkijs';

// pkijs needs a CryptoEngine in Node. Set it up before importing the signer
// (the signer's modules call pkijs at import time in some paths).
pkijs.setEngine(
  'node-webcrypto',
  new pkijs.CryptoEngine({ name: 'node-webcrypto', crypto: webcrypto }),
);
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const HERE = dirname(fileURLToPath(import.meta.url));
// HERE = scripts/ ; REPO_ROOT one up.
const REPO_ROOT = resolve(HERE, '..');
const SAMPLE_PDF = resolve(REPO_ROOT, 'apps/pwa/tests/e2e/fixtures/sample.pdf');
const P12 = resolve(REPO_ROOT, 'packages/signer/tests/fixtures/rsa2048-valid.p12');
const PIN = 'test1234';
const E2E_FIXTURE_BT = resolve(REPO_ROOT, 'apps/pwa/tests/e2e/fixtures/sample-b-t.pdf');
const ARTIFACT_DIR = resolve(REPO_ROOT, '_backups/F6-cross-val-artifacts');
const ARTIFACT_BB = resolve(ARTIFACT_DIR, 'sample-b-b-no-tsa.pdf');
const ARTIFACT_BT = resolve(ARTIFACT_DIR, 'sample-b-t-freetsa.pdf');

if (!existsSync(ARTIFACT_DIR)) mkdirSync(ARTIFACT_DIR, { recursive: true });

// Resolve signer dist via absolute file URL (script lives in scripts/, signer
// dist lives in packages/signer/dist).
import { pathToFileURL } from 'node:url';
const SIGNER_DIST = resolve(REPO_ROOT, 'packages/signer/dist');
const { parsePfx } = await import(pathToFileURL(resolve(SIGNER_DIST, 'p12.js')).href);
const { signPdfPades } = await import(pathToFileURL(resolve(SIGNER_DIST, 'pades.js')).href);

const pdfBytes = new Uint8Array(readFileSync(SAMPLE_PDF));
const p12Bytes = new Uint8Array(readFileSync(P12));

console.log('[gen] parsing .p12 fixture (rsa2048-valid)…');
const pfx = await parsePfx(p12Bytes, PIN);
console.log(`[gen] signer CN: ${pfx.signingCert.subjectCN}`);

// ── B-B (no TSA) ──────────────────────────────────────────────────────────
console.log('[gen] signing B-B (timestamp: false)…');
const bbResult = await signPdfPades(pdfBytes, pfx, {
  timestamp: false,
  reason: 'F6 cross-val B-B sample',
  location: 'firma.ec',
  signingTime: new Date('2026-05-10T12:00:00Z'),
});
writeFileSync(ARTIFACT_BB, bbResult.signedPdf);
console.log(`[gen] B-B → ${ARTIFACT_BB} (${bbResult.signedPdf.byteLength} bytes)`);
console.log(`[gen] B-B timestamp meta: ${JSON.stringify(bbResult.timestamp)}`);

// ── B-T (FreeTSA real) ────────────────────────────────────────────────────
async function signBT() {
  return signPdfPades(pdfBytes, pfx, {
    timestamp: true,
    tsaUrl: 'https://freetsa.org/tsr',
    tsaTimeoutMs: 15000,
    reason: 'F6 cross-val B-T sample',
    location: 'firma.ec',
    signingTime: new Date(),
  });
}

console.log('[gen] signing B-T against https://freetsa.org/tsr (real network)…');
let btResult;
try {
  btResult = await signBT();
} catch (e) {
  console.error('[gen] B-T attempt 1 threw:', e?.message ?? e);
  console.log('[gen] sleeping 60s (rate-limit precaution) then retrying once…');
  await new Promise((r) => setTimeout(r, 60_000));
  btResult = await signBT();
}

console.log(`[gen] B-T timestamp meta: ${JSON.stringify({
  ok: btResult.timestamp.ok,
  reason: btResult.timestamp.reason,
  tsaUrl: btResult.timestamp.tsaUrl,
  genTime: btResult.timestamp.genTime,
})}`);

if (!btResult.timestamp.ok) {
  console.error('[gen] B-T did NOT succeed. Reason:', btResult.timestamp.reason);
  console.error('[gen] writing the fallback B-B-equivalent output anyway for inspection.');
}

writeFileSync(ARTIFACT_BT, btResult.signedPdf);
console.log(`[gen] B-T → ${ARTIFACT_BT} (${btResult.signedPdf.byteLength} bytes)`);

// Also drop a copy at the E2E fixture location so TSA-4 doesn't skip when
// the test suite is executed on a dev machine.
writeFileSync(E2E_FIXTURE_BT, btResult.signedPdf);
console.log(`[gen] E2E fixture → ${E2E_FIXTURE_BT}`);

console.log('[gen] done.');
