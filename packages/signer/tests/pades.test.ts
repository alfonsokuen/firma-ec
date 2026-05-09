/**
 * End-to-end PAdES-B-B signing tests with cross-package verifier integrity.
 *
 * Generates a minimal PDF in-runtime with pdf-lib, signs it with `signPdfPades`,
 * then asserts:
 *   - `findSignature` (verifier) recovers a SignedRange,
 *   - `parseCms` (verifier) parses the embedded CMS without throwing,
 *   - the hash of coveredBytes (verifier-side recomputation) matches the
 *     CMS messageDigest signed attribute,
 *   - /Reason and /Location land in the PDF dict when supplied.
 *   - ECDSA-P256 fixture also produces a valid signed PDF.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import * as pkijs from 'pkijs';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { parsePfx } from '../src/p12.js';
import { signPdfPades } from '../src/pades.js';
import { findSignature } from '../../verifier/src/pdf.js';
import { parseCms } from '../../verifier/src/cms.js';

beforeAll(() => {
  pkijs.setEngine(
    'node-webcrypto',
    new pkijs.CryptoEngine({ name: 'node-webcrypto', crypto: webcrypto as unknown as Crypto }),
  );
  // Make WebCrypto globally available for the signer package (which uses
  // global `crypto.subtle`).
  if (!(globalThis as { crypto?: Crypto }).crypto) {
    (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
  }
});

const FIX_DIR = join(__dirname, 'fixtures');
const PIN = 'test1234';

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIX_DIR, name)));
}

async function buildMinimalPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('firma.ec test PDF', { x: 50, y: 100, size: 14, font });
  return doc.save({ useObjectStreams: false });
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', ab));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('signPdfPades — RSA-2048 happy path', () => {
  it('produces a PDF with a parseable PAdES signature', async () => {
    const pfxBytes = loadFixture('rsa2048-valid.p12');
    const pfx = await parsePfx(pfxBytes, PIN);
    const pdf = await buildMinimalPdf();

    const signed = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1]);

    // Verifier round-trip
    const sigRange = await findSignature(signed);
    expect(sigRange).not.toBeNull();
    // Note: verifier's parseString currently doesn't decode PDF Name objects
    // (`/SubFilter /ETSI.CAdES.detached`), only literal/hex strings — so the
    // returned subFilter is 'unknown' for our pdf-lib output. We therefore
    // sniff the raw PDF bytes for the subfilter token instead.
    const sniff = new TextDecoder('latin1').decode(signed);
    expect(sniff).toContain('ETSI.CAdES.detached');

    const cms = await parseCms(sigRange!.contents);
    expect(cms.signerCert).toBeDefined();
    expect(cms.signedMessageDigest.length).toBe(32); // SHA-256
    expect(cms.signedAttrsDer.length).toBeGreaterThan(0);
  });

  it('cross-check: verifier-recomputed coveredBytes hash matches CMS messageDigest', async () => {
    const pfxBytes = loadFixture('rsa2048-valid.p12');
    const pfx = await parsePfx(pfxBytes, PIN);
    const pdf = await buildMinimalPdf();
    const signed = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1]);

    const sigRange = (await findSignature(signed))!;
    const cms = await parseCms(sigRange.contents);

    const [a, b, c, d] = sigRange.byteRange;
    const covered = new Uint8Array(b + d);
    covered.set(signed.subarray(a, a + b), 0);
    covered.set(signed.subarray(c, c + d), b);
    const recomputed = await sha256(covered);

    expect(bytesEqual(recomputed, cms.signedMessageDigest)).toBe(true);
  });

  it('writes /Reason and /Location into the PDF Sig dict (not CMS)', async () => {
    const pfxBytes = loadFixture('rsa2048-valid.p12');
    const pfx = await parsePfx(pfxBytes, PIN);
    const pdf = await buildMinimalPdf();
    const signed = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
      reason: 'Acepto',
      location: 'Quito, EC',
    });

    const sigRange = (await findSignature(signed))!;
    expect(sigRange.reason).toBe('Acepto');
    expect(sigRange.location).toBe('Quito, EC');
  });
});

describe('signPdfPades — ECDSA P-256', () => {
  it('produces a PDF with a parseable ECDSA-signed PAdES', async () => {
    const pfxBytes = loadFixture('ecdsa-p256-valid.p12');
    const pfx = await parsePfx(pfxBytes, PIN);
    const pdf = await buildMinimalPdf();

    const signed = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1]);

    const sigRange = (await findSignature(signed))!;
    expect(sigRange).not.toBeNull();
    const cms = await parseCms(sigRange.contents);
    // ECDSA-with-SHA256 OID
    expect(cms.signatureAlgoOid).toBe('1.2.840.10045.4.3.2');
    expect(cms.signedMessageDigest.length).toBe(32);

    // Cross-check messageDigest against recomputed coveredBytes hash
    const [a, b, c, d] = sigRange.byteRange;
    const covered = new Uint8Array(b + d);
    covered.set(signed.subarray(a, a + b), 0);
    covered.set(signed.subarray(c, c + d), b);
    const recomputed = await sha256(covered);
    expect(bytesEqual(recomputed, cms.signedMessageDigest)).toBe(true);
  });
});
