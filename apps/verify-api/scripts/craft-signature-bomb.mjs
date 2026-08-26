/**
 * Build a PDF that declares N signatures the verifier will actually PROCESS.
 *
 *   node scripts/craft-signature-bomb.mjs <signatures> <padBytes> <outFile>
 *
 * Why this script exists: verification costs O(signatures x document size), so
 * a document with many signatures is the cheapest way to burn our CPU. Any
 * regression test for the admission gate, or any measurement of the worker's
 * timeout, needs a document the engine does not reject early — otherwise the
 * numbers look great for the wrong reason.
 *
 * Getting that right is fiddly, so the invariants are written down here. The
 * parser (packages/verifier/src/pdf.ts) requires ALL of:
 *
 *   1. `/ByteRange [a b c d]` with plain decimals.
 *   2. `a === 0`, `a + b <= c`, `c + d <= fileSize`.
 *   3. A `/Contents <hex>` findable scanning FORWARD from `/ByteRange`.
 *   4. THE ONE THAT BITES: absolute correlation — the `<` of `/Contents` must
 *      sit at byte offset `a + b` of the FINAL file, and the `>` at `c - 1`.
 *      Hand-written dictionaries like `[0 100 200 300]` fail here, and the
 *      symptom is misleading: `verifyAllSignatures` maps the pre-iteration
 *      throw to `signatureCount: 0` + `overallStatus: 'invalid'`, which reads
 *      like "no signatures found". The real cause is in `signatures[0].error`
 *      — read it before concluding anything about performance.
 *
 * The `/Contents` blob is a REAL CMS lifted from a fixture. With junk hex,
 * `parseCms` throws on the first line of each signature and the expensive work
 * (whole-document digest, RSA verify, DSS extraction, LTV scan) never happens.
 *
 * Layout is two passes with FIXED-WIDTH numbers, so computing offsets cannot
 * shift the bytes those offsets describe. The script aborts on any drift.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../../../packages/verifier/tests/fixtures/eci-real-signed.pdf');

const signatures = Number(process.argv[2] ?? 50);
const padBytes = Number(process.argv[3] ?? 4_000_000);
const outFile = process.argv[4] ?? resolve(here, '../signature-bomb.pdf');

const fixture = readFileSync(FIXTURE).toString('latin1');
const match = fixture.match(/\/Contents\s*<([0-9A-Fa-f]+)>/);
if (match === null) throw new Error(`no /Contents blob in ${FIXTURE}`);
const cmsHex = match[1];

const pad10 = (n) => String(n).padStart(10, '0');

/** Fixed-width block: the widths are what make the two passes agree. */
const block = (b, c, d) =>
  `\n${pad10(0)} obj\n/ByteRange [${pad10(0)} ${pad10(b)} ${pad10(c)} ${pad10(d)}] ` +
  `/Contents <${cmsHex}> /SubFilter /adbe.pkcs7.detached\nendobj\n`;

const header = `%PDF-1.7\n% filler\n${'A'.repeat(padBytes)}\n`;

// Pass 1 — lay out with dummy values to learn where each `<` and `>` land.
let cursor = header;
const positions = [];
for (let i = 0; i < signatures; i += 1) {
  const dummy = block(0, 0, 0);
  const openRel = dummy.indexOf('<');
  positions.push({ start: cursor.length, openRel, closeRel: dummy.indexOf('>', openRel) });
  cursor += dummy;
}
const size = cursor.length;

// Pass 2 — same layout, real offsets.
let out = header;
for (const p of positions) {
  const b = p.start + p.openRel; // a + b === offset of '<'
  const c = p.start + p.closeRel + 1; // c === offset just past '>'
  out += block(b, c, size - c);
}
if (out.length !== size) throw new Error(`layout drift: ${out.length} != ${size}`);

writeFileSync(outFile, Buffer.from(out, 'latin1'));
console.log(`wrote ${outFile}: ${out.length} bytes, ${signatures} signatures`);
