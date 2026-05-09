/**
 * gen-fixtures.ts — generate synthetic PAdES B-B PDF fixtures for verifier tests.
 *
 * Strategy:
 *   1. Build a minimal valid PDF skeleton containing a /Sig dictionary with a
 *      placeholder /Contents hex blob (zero-filled to a fixed size).
 *   2. Compute /ByteRange covering everything except the /Contents hex bytes.
 *   3. Hash the covered bytes (SHA-256 by default) and sign with node-forge
 *      `forge.pkcs7.createSignedData` (detached, includeContent=false).
 *   4. Embed the resulting CMS DER as the /Contents hex string.
 *
 * Run:
 *   node --experimental-strip-types packages/verifier/scripts/gen-fixtures.ts
 *
 * Outputs (in packages/verifier/tests/fixtures/):
 *   - bb-valid.pdf            — PAdES B-B, RSA-2048 + SHA-256, self-signed root
 *   - hash-mismatch.pdf       — bb-valid mutated 1 byte inside /ByteRange
 *   - weak-sha1.pdf           — same flow but digest=SHA-1
 *   - rsa-1024.pdf            — RSA-1024 key (below 2048 floor)
 *   - expired-cert.pdf        — cert notBefore/notAfter both in the past
 *   - untrusted-root.pdf      — same as bb-valid; trust roots will not match
 *                              (matches semantically — tests assert matchedRoot undefined)
 *   - incremental-tampered.pdf — bb-valid with extra bytes appended after %%EOF
 *   - unsigned.pdf            — minimal valid PDF with no /Sig
 *
 * Limitations / known issues are documented in tests/fixtures/README.md.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import forge from 'node-forge';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '..', 'tests', 'fixtures');
mkdirSync(FIXTURES_DIR, { recursive: true });

// ── helpers ────────────────────────────────────────────────────────────────
const CONTENTS_RESERVED = 8192; // bytes reserved for /Contents (hex chars = 2x)

/** Generate an RSA keypair + self-signed cert. */
interface CertOpts {
  keyBits: number;
  digestAlgo: 'sha256' | 'sha1';
  notBeforeOffsetMs?: number; // ms relative to now
  notAfterOffsetMs?: number;
  cn: string;
}
function makeCert(opts: CertOpts): { keys: forge.pki.rsa.KeyPair; cert: forge.pki.Certificate } {
  const keys = forge.pki.rsa.generateKeyPair({ bits: opts.keyBits });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '0' + Math.floor(Math.random() * 1e12).toString(16);
  const now = Date.now();
  cert.validity.notBefore = new Date(now + (opts.notBeforeOffsetMs ?? -86_400_000));
  cert.validity.notAfter = new Date(now + (opts.notAfterOffsetMs ?? 365 * 86_400_000));
  const attrs = [
    { name: 'commonName', value: opts.cn },
    { name: 'countryName', value: 'EC' },
    { name: 'organizationName', value: 'Firma EC Test' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
    { name: 'extKeyUsage', clientAuth: true, emailProtection: true },
  ]);
  // node-forge md.sha256 / md.sha1
  const md = opts.digestAlgo === 'sha1' ? forge.md.sha1.create() : forge.md.sha256.create();
  cert.sign(keys.privateKey, md);
  return { keys, cert };
}

/** Build a PDF skeleton with placeholder /Contents and compute /ByteRange. */
function buildPdfSkeleton(): { pdfBytes: Uint8Array; contentsStart: number; contentsEnd: number; byteRangeOffset: number } {
  // Compose body text. Placeholder strings get patched after we know offsets.
  const placeholderBR = '0000000000 0000000000 0000000000 0000000000';
  const placeholderContents = '0'.repeat(CONTENTS_RESERVED * 2);
  const body =
    `%PDF-1.7\n%\xe2\xe3\xcf\xd3\n` +
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [3 0 R] /SigFlags 3 >> >>\nendobj\n` +
    `2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n` +
    `3 0 obj\n<< /FT /Sig /Type /Annot /Subtype /Widget /F 132 /T (Sig1) /V 5 0 R /P 4 0 R /Rect [0 0 0 0] >>\nendobj\n` +
    `4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Annots [3 0 R] >>\nendobj\n` +
    `5 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached ` +
    `/ByteRange [${placeholderBR}] /Contents <${placeholderContents}> ` +
    `/M (D:20260508000000Z) /Reason (Test fixture) /Location (EC) >>\nendobj\n` +
    `xref\n0 6\n0000000000 65535 f \n0000000015 00000 n \n0000000080 00000 n \n0000000130 00000 n \n0000000220 00000 n \n0000000310 00000 n \n` +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF\n`;

  const enc = new TextEncoder();
  const bytes = enc.encode(body);
  const text = body;

  // Find /Contents <...> placeholder
  const contentsTag = '/Contents <';
  const contentsTagIdx = text.indexOf(contentsTag);
  if (contentsTagIdx < 0) throw new Error('placeholder /Contents not found');
  const contentsStart = enc.encode(text.substring(0, contentsTagIdx + contentsTag.length)).length; // byte offset of '<' + 1
  const contentsEnd = contentsStart + CONTENTS_RESERVED * 2; // index of '>'

  // /ByteRange placeholder offset (the '0000000000 ...' string)
  const brTagIdx = text.indexOf('/ByteRange [');
  const byteRangeOffset = enc.encode(text.substring(0, brTagIdx + '/ByteRange ['.length)).length;

  return { pdfBytes: bytes, contentsStart, contentsEnd, byteRangeOffset };
}

/** Patch /ByteRange and /Contents in the skeleton, then sign. */
function signPdfSkeleton(
  skeleton: ReturnType<typeof buildPdfSkeleton>,
  cert: forge.pki.Certificate,
  privateKey: forge.pki.rsa.PrivateKey,
  digestAlgo: 'sha256' | 'sha1',
): Uint8Array {
  const { pdfBytes, contentsStart, contentsEnd, byteRangeOffset } = skeleton;

  const a = 0;
  const b = contentsStart - 1; // index of '<' itself; covered = [0, contentsStart-1)
  const c = contentsEnd + 1;   // first byte after '>'
  const d = pdfBytes.length - c;

  // Build /ByteRange string with fixed-width (10-char) numbers to match placeholder length
  const fmt = (n: number) => n.toString().padStart(10, '0');
  const brStr = `${fmt(a)} ${fmt(b)} ${fmt(c)} ${fmt(d)}`;
  if (brStr.length !== '0000000000 0000000000 0000000000 0000000000'.length) {
    throw new Error(`/ByteRange placeholder length mismatch: ${brStr.length}`);
  }

  // Patch /ByteRange
  const enc = new TextEncoder();
  const brBytes = enc.encode(brStr);
  const patched = new Uint8Array(pdfBytes);
  patched.set(brBytes, byteRangeOffset);

  // Build covered bytes (everything except the /Contents hex blob)
  const covered = new Uint8Array(b + d);
  covered.set(patched.subarray(a, a + b), 0);
  covered.set(patched.subarray(c, c + d), b);

  // Sign with PKCS#7 detached
  const p7 = forge.pkcs7.createSignedData();
  // forge expects content as binary string (latin1)
  let contentBin = '';
  for (let i = 0; i < covered.length; i++) contentBin += String.fromCharCode(covered[i]!);
  p7.content = forge.util.createBuffer(contentBin);
  p7.addCertificate(cert);
  p7.addSigner({
    key: privateKey,
    certificate: cert,
    digestAlgorithm: digestAlgo === 'sha1' ? forge.pki.oids.sha1 : forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest /* value computed automatically */ },
      { type: forge.pki.oids.signingTime, value: new Date().toISOString() },
    ],
  });
  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();

  // Hex encode + pad to reserved length
  let hex = '';
  for (let i = 0; i < der.length; i++) hex += der.charCodeAt(i).toString(16).padStart(2, '0');
  if (hex.length > CONTENTS_RESERVED * 2) {
    throw new Error(`CMS too large (${hex.length / 2} bytes), increase CONTENTS_RESERVED`);
  }
  hex = hex.padEnd(CONTENTS_RESERVED * 2, '0');

  // Patch /Contents hex
  const hexBytes = enc.encode(hex);
  patched.set(hexBytes, contentsStart);

  return patched;
}

function writeFixture(name: string, bytes: Uint8Array): void {
  const path = resolve(FIXTURES_DIR, name);
  writeFileSync(path, bytes);
  console.log(`  ${name} → ${bytes.length} bytes`);
}

// ── fixture generators ─────────────────────────────────────────────────────

function genUnsignedPdf(): Uint8Array {
  const body =
    `%PDF-1.4\n%\xe2\xe3\xcf\xd3\n` +
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n` +
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> >>\nendobj\n` +
    `xref\n0 4\n0000000000 65535 f \n0000000015 00000 n \n0000000060 00000 n \n0000000110 00000 n \n` +
    `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n160\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

function genBbValid(): Uint8Array {
  const skeleton = buildPdfSkeleton();
  const { keys, cert } = makeCert({ keyBits: 2048, digestAlgo: 'sha256', cn: 'BB Valid Test Signer' });
  return signPdfSkeleton(skeleton, cert, keys.privateKey, 'sha256');
}

function genHashMismatch(): Uint8Array {
  const valid = genBbValid();
  const out = new Uint8Array(valid);
  // Mutate a byte at offset 50 (well inside the first /ByteRange covered region,
  // before /Contents). Avoid /ByteRange numeric region (~ offset 250-330).
  // Find a safe offset — first byte after %PDF header.
  out[50] = (out[50]! + 1) & 0xff;
  return out;
}

function genWeakSha1(): Uint8Array {
  const skeleton = buildPdfSkeleton();
  const { keys, cert } = makeCert({ keyBits: 2048, digestAlgo: 'sha1', cn: 'Weak SHA-1 Signer' });
  return signPdfSkeleton(skeleton, cert, keys.privateKey, 'sha1');
}

function genRsa1024(): Uint8Array {
  const skeleton = buildPdfSkeleton();
  const { keys, cert } = makeCert({ keyBits: 1024, digestAlgo: 'sha256', cn: 'RSA-1024 Weak Signer' });
  return signPdfSkeleton(skeleton, cert, keys.privateKey, 'sha256');
}

function genExpiredCert(): Uint8Array {
  const skeleton = buildPdfSkeleton();
  const oneYearMs = 365 * 86_400_000;
  const { keys, cert } = makeCert({
    keyBits: 2048,
    digestAlgo: 'sha256',
    cn: 'Expired Signer',
    notBeforeOffsetMs: -2 * oneYearMs,
    notAfterOffsetMs: -oneYearMs, // expired 1y ago
  });
  return signPdfSkeleton(skeleton, cert, keys.privateKey, 'sha256');
}

function genUntrustedRoot(): Uint8Array {
  // Same as bb-valid; the cert isn't in the ARCOTEL TSL, so path validation will reject.
  return genBbValid();
}

function genIncrementalTampered(): Uint8Array {
  const valid = genBbValid();
  const suffix = new TextEncoder().encode('\n%% appended-after-eof %%\n');
  const out = new Uint8Array(valid.length + suffix.length);
  out.set(valid, 0);
  out.set(suffix, valid.length);
  return out;
}

// ── main ───────────────────────────────────────────────────────────────────
console.log('Generating fixtures →', FIXTURES_DIR);

writeFixture('unsigned.pdf', genUnsignedPdf());
writeFixture('bb-valid.pdf', genBbValid());
writeFixture('hash-mismatch.pdf', genHashMismatch());
writeFixture('weak-sha1.pdf', genWeakSha1());
writeFixture('rsa-1024.pdf', genRsa1024());
writeFixture('expired-cert.pdf', genExpiredCert());
writeFixture('untrusted-root.pdf', genUntrustedRoot());
writeFixture('incremental-tampered.pdf', genIncrementalTampered());

console.log('Done.');
