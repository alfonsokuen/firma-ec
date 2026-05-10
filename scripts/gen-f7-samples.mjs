#!/usr/bin/env node
/**
 * F7 Batch IV — generate B-LT + B-LTA sample PDFs.
 *
 * Strategy
 * ────────
 * The sandbox cannot reach live OCSP/CRL responders (ARCOTEL ACEs are not
 * publicly reachable from this build network, and the test .p12 isn't issued
 * by them anyway), so we follow the fallback path documented in the F7 Batch
 * IV plan rule #1:
 *
 *   1. Reuse the F6 B-T sample (sample-b-t-freetsa.pdf) as the input.
 *   2. Synthesize a plausible DssData with the F6 leaf+issuer DER bytes +
 *      a placeholder CRL produced by the ltv-validation test helpers
 *      (synthCerts.ts). No real OCSP signed-response (would require a CA
 *      keypair we don't own here). The DSS layer is therefore *structurally*
 *      a B-LT — the verifier integration tests exercise the round-trip
 *      contract (DSS extracted, profile reported, no downgrade) but do not
 *      attempt to validate the synthetic CRL against the real signer cert.
 *   3. Call `appendDss({ pdfBytes, dss })` → `sample-b-lt.pdf`.
 *   4. Call `appendDocumentTimestamp({ pdfBytes: <B-LT> })` against
 *      FreeTSA (real network). On rate-limit, sleep 60s once and retry.
 *      → `sample-b-lta.pdf`.
 *
 * Outputs (mirrored in two locations like F6):
 *   _backups/F7-cross-val-artifacts/sample-b-t.pdf            (copy of F6)
 *   _backups/F7-cross-val-artifacts/sample-b-lt.pdf
 *   _backups/F7-cross-val-artifacts/sample-b-lta.pdf
 *   packages/verifier/tests/fixtures/sample-b-lt.pdf
 *   packages/verifier/tests/fixtures/sample-b-lta.pdf
 *
 * Caveats (also documented in the consuming test file headers):
 * - The OCSP set in the synthetic DSS is empty (`ocsps: []`) — the test
 *   asserts `embeddedOcspCount === 0 && embeddedCrlCount >= 1`. Real-world
 *   B-LT PDFs will typically carry at least one BasicOCSPResponse.
 * - The CRL is signed by a *synthetic* CA, not the actual issuer of the
 *   rsa2048-valid.p12 fixture. `verifyLtv()` therefore reports
 *   `retrospectiveValid === false` plus an `errors[]` entry; the test
 *   accepts this.
 *
 * Prereqs:
 *   pnpm -F @firma-ec/signer build
 *   pnpm -F @firma-ec/dss-pdf build
 *   pnpm -F @firma-ec/ltv-validation build
 *   pnpm -F @firma-ec/tsa-client build
 *   (cd packages/<pkg>/dist && for f in *.js; do sed -i -E
 *      "s|from '(\\./[a-zA-Z][a-zA-Z0-9_-]*)'|from '\\1.js'|g" "$f"; done)
 *   ... and temporarily switch each package.json `main`/`types` to the
 *   `./dist/index.js` flavour for the run (same workflow as
 *   gen-f6-samples.mjs).
 *
 * Run: `node scripts/gen-f7-samples.mjs`
 *
 * @see docs/superpowers/plans/2026-05-10-firma-ec-F7-LTV.md §Task 31
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';
import * as pkijs from 'pkijs';
import forge from 'node-forge';

pkijs.setEngine(
  'node-webcrypto',
  new pkijs.CryptoEngine({ name: 'node-webcrypto', crypto: webcrypto }),
);
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const F6_BT = resolve(REPO_ROOT, '_backups/F6-cross-val-artifacts/sample-b-t-freetsa.pdf');
const P12 = resolve(REPO_ROOT, 'packages/signer/tests/fixtures/rsa2048-valid.p12');
const PIN = 'test1234';

const ARTIFACT_DIR = resolve(REPO_ROOT, '_backups/F7-cross-val-artifacts');
const VERIFIER_FIX = resolve(REPO_ROOT, 'packages/verifier/tests/fixtures');

const ARTIFACT_BT_COPY = resolve(ARTIFACT_DIR, 'sample-b-t.pdf');
const ARTIFACT_BLT = resolve(ARTIFACT_DIR, 'sample-b-lt.pdf');
const ARTIFACT_BLTA = resolve(ARTIFACT_DIR, 'sample-b-lta.pdf');

if (!existsSync(ARTIFACT_DIR)) mkdirSync(ARTIFACT_DIR, { recursive: true });

// ── Dynamic-import compiled packages ──────────────────────────────────────
const SIGNER_DIST = resolve(REPO_ROOT, 'packages/signer/dist');
const DSS_DIST = resolve(REPO_ROOT, 'packages/dss-pdf/dist');

const { parsePfx } = await import(pathToFileURL(resolve(SIGNER_DIST, 'p12.js')).href);
const { appendDss, appendDocumentTimestamp } = await import(
  pathToFileURL(resolve(DSS_DIST, 'index.js')).href
);

// Load the synth helper directly from source via tsx-style relative import.
// Tests use it as a TS module; for the Node script we want a tiny inline
// re-implementation of just `makeSyntheticCrlDer` to avoid pulling tsx.
// For simplicity, we keep the script honest: if the helper isn't compiled,
// we ship an *empty* CRL list and rely on `appendDss` validating shape only.
let makeSynthCrl = null;
try {
  const helpersJs = pathToFileURL(
    resolve(REPO_ROOT, 'packages/ltv-validation/dist/tests/helpers/synthCerts.js'),
  ).href;
  ({ makeSyntheticCrlDer: makeSynthCrl } = await import(helpersJs));
} catch {
  console.warn('[gen-f7] synth helpers not compiled — emitting DSS with empty CRL set');
}

// ── Read F6 B-T sample ────────────────────────────────────────────────────
if (!existsSync(F6_BT)) {
  console.error(`[gen-f7] missing F6 B-T sample at ${F6_BT}`);
  console.error('[gen-f7] run scripts/gen-f6-samples.mjs first.');
  process.exit(1);
}
const btBytes = new Uint8Array(readFileSync(F6_BT));
copyFileSync(F6_BT, ARTIFACT_BT_COPY);
console.log(`[gen-f7] B-T copy → ${ARTIFACT_BT_COPY} (${btBytes.byteLength} bytes)`);

// ── Recover signer + issuer DER from the .p12 to populate DSS /Certs ─────
const p12Bytes = new Uint8Array(readFileSync(P12));
const pfx = await parsePfx(p12Bytes, PIN);
console.log(`[gen-f7] signer CN: ${pfx.signingCert.subjectCN}`);

const certs = [pfx.signingCert.der];
for (const c of pfx.chainCerts ?? []) certs.push(c.der);

// ── Build a synthetic CRL (best-effort) — using a throwaway forge CA ─────
let crls = [];
if (makeSynthCrl) {
  const keyPair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const caCert = forge.pki.createCertificate();
  caCert.publicKey = keyPair.publicKey;
  caCert.serialNumber = '01';
  caCert.validity.notBefore = new Date(Date.now() - 86400000);
  caCert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const attrs = [{ name: 'commonName', value: 'F7 Synthetic CA' }];
  caCert.setSubject(attrs);
  caCert.setIssuer(attrs);
  caCert.sign(keyPair.privateKey, forge.md.sha256.create());

  try {
    const crlDer = makeSynthCrl({
      caCert,
      caKey: keyPair.privateKey,
      revokedSerialsHex: [],
    });
    crls = [crlDer];
    console.log(`[gen-f7] synthetic CRL: ${crlDer.byteLength} bytes`);
  } catch (e) {
    console.warn('[gen-f7] CRL synth failed, continuing with empty CRL set:', e?.message ?? e);
  }
}

// ── Build DssData + append to B-T → B-LT ─────────────────────────────────
// VRI key = uppercase hex SHA-1 of the inner signature /Contents bytes.
// For the synthesis pass we omit /VRI (legal per ETSI when /Certs/OCSPs/CRLs
// are exhaustive). appendDss accepts `vri: {}`.
const dssData = {
  certs,
  ocsps: [],
  crls,
  vri: {},
};

console.log(`[gen-f7] DssData: ${certs.length} certs, 0 OCSPs, ${crls.length} CRLs`);
const bltBytes = await appendDss({ pdfBytes: btBytes, dss: dssData });
writeFileSync(ARTIFACT_BLT, bltBytes);
writeFileSync(resolve(VERIFIER_FIX, 'sample-b-lt.pdf'), bltBytes);
console.log(`[gen-f7] B-LT → ${ARTIFACT_BLT} (${bltBytes.byteLength} bytes)`);

// ── B-LTA — append a document timestamp via FreeTSA ──────────────────────
async function appendLta() {
  return appendDocumentTimestamp({
    pdfBytes: bltBytes,
    tsaUrl: 'https://freetsa.org/tsr',
    timeoutMs: 15000,
  });
}

console.log('[gen-f7] requesting document timestamp from https://freetsa.org/tsr…');
let dts;
try {
  dts = await appendLta();
} catch (e) {
  console.error('[gen-f7] document TS attempt 1 threw:', e?.message ?? e);
  console.log('[gen-f7] sleeping 60s then retrying once…');
  await new Promise((r) => setTimeout(r, 60_000));
  dts = await appendLta();
}

if (dts.ok) {
  writeFileSync(ARTIFACT_BLTA, dts.pdfBytes);
  writeFileSync(resolve(VERIFIER_FIX, 'sample-b-lta.pdf'), dts.pdfBytes);
  console.log(
    `[gen-f7] B-LTA → ${ARTIFACT_BLTA} (${dts.pdfBytes.byteLength} bytes), TSA ${dts.tsaIssuerCN} @ ${dts.signingTime.toISOString()}`,
  );
} else {
  console.error('[gen-f7] document TS failed:', dts.reason, dts.detail);
  console.error('[gen-f7] B-LTA NOT generated — B-LT fixture suffices for Batch IV.');
}

console.log('[gen-f7] done.');
