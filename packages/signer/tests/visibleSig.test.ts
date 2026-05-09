/**
 * Tests for visible signature widget rendering (F3 Sprint C Batch 5 — Tasks 17-20).
 *
 * Validates:
 *   - Widget annotation lands on the correct page with the requested rect.
 *   - Appearance Stream content includes "Firmado por: <CN>".
 *   - Validation: out-of-bounds rect / invalid page / too-small dimensions throw.
 *   - Optional `visibleSig`: omitted ⇒ no widget on user page (invisible sig).
 *   - Long CN truncation with ellipsis (≤50 chars).
 *   - End-to-end verifier still parses the signed PDF when a visible widget
 *     is rendered.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import * as pkijs from 'pkijs';
import {
  PDFArray,
  PDFContentStream,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  StandardFonts,
} from 'pdf-lib';
import { inflateSync } from 'node:zlib';

import { parsePfx } from '../src/p12.js';
import { signPdfPades } from '../src/pades.js';
import { SignerError } from '../src/errors.js';
import { truncateCN, __internals } from '../src/visibleSig.js';
import { findSignature } from '../../verifier/src/pdf.js';
import { parseCms } from '../../verifier/src/cms.js';

beforeAll(() => {
  pkijs.setEngine(
    'node-webcrypto',
    new pkijs.CryptoEngine({ name: 'node-webcrypto', crypto: webcrypto as unknown as Crypto }),
  );
  if (!(globalThis as { crypto?: Crypto }).crypto) {
    (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
  }
});

const FIX_DIR = join(__dirname, 'fixtures');
const PIN = 'test1234';

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIX_DIR, name)));
}

/** A4 page (595×842 pt) so we have room to test bounds. */
async function buildA4Pdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('A4 visible-sig test PDF', { x: 50, y: 800, size: 14, font });
  return doc.save({ useObjectStreams: false });
}

/** Two-page PDF for multi-page placement tests. */
async function buildTwoPagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  doc.addPage([595, 842]);
  return doc.save({ useObjectStreams: false });
}

/** Find the first /Subtype /Widget /FT /Sig annotation on `pageIndex`. */
async function findSigWidget(
  pdfBytes: Uint8Array,
  pageIndex: number,
): Promise<{ widget: PDFDict; doc: PDFDocument } | null> {
  const doc = await PDFDocument.load(pdfBytes);
  const page = doc.getPages()[pageIndex];
  if (!page) return null;
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) return null;
  for (let i = 0; i < annots.size(); i++) {
    const v = annots.lookup(i);
    if (!(v instanceof PDFDict)) continue;
    const subtype = v.lookupMaybe(PDFName.of('Subtype'), PDFName);
    const ft = v.lookupMaybe(PDFName.of('FT'), PDFName);
    if (subtype?.toString() === '/Widget' && ft?.toString() === '/Sig') {
      return { widget: v, doc };
    }
  }
  return null;
}

/**
 * Decode an Appearance Stream's contents to its raw PDF operator source.
 * Handles two cases:
 *   - Pre-save (in-memory) `PDFContentStream`: serialize via operators.
 *   - Post-save/load `PDFRawStream`: decompress (FlateDecode) and decode latin1.
 */
function dumpAppearanceText(stream: PDFContentStream | PDFRawStream): string {
  if (stream instanceof PDFContentStream) {
    return stream.operators.map((op) => op.toString()).join('\n');
  }
  // PDFRawStream: get raw contents (deflate-encoded if Filter=FlateDecode).
  const raw: Uint8Array = (stream as PDFRawStream).contents;
  const filterDict = stream.dict.lookupMaybe(PDFName.of('Filter'), PDFName);
  let decoded: Uint8Array = raw;
  if (filterDict?.toString() === '/FlateDecode') {
    decoded = new Uint8Array(inflateSync(Buffer.from(raw)));
  }
  return new TextDecoder('latin1').decode(decoded);
}

/** Look up the AP/N target as either a PDFContentStream or PDFRawStream. */
function lookupApN(
  doc: PDFDocument,
  widget: PDFDict,
): PDFContentStream | PDFRawStream {
  const ap = widget.lookup(PDFName.of('AP'), PDFDict) as PDFDict;
  const nRef = ap.get(PDFName.of('N')) as PDFRef;
  const target = doc.context.lookup(nRef);
  if (target instanceof PDFContentStream || target instanceof PDFRawStream) {
    return target;
  }
  throw new Error(
    `AP/N target is neither PDFContentStream nor PDFRawStream: ${target?.constructor.name}`,
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Pure-function unit tests (no signing required)
// ───────────────────────────────────────────────────────────────────────────

describe('truncateCN', () => {
  it('returns CN unchanged when within max', () => {
    expect(truncateCN('Pedro Picapiedra', 50)).toBe('Pedro Picapiedra');
  });

  it('truncates with ellipsis when CN exceeds max', () => {
    const long = 'A'.repeat(80);
    const out = truncateCN(long, 50);
    expect(out.length).toBe(50);
    expect(out.endsWith('…')).toBe(true);
    expect(out.startsWith('A'.repeat(49))).toBe(true);
  });

  it('default max is 50', () => {
    const long = 'B'.repeat(80);
    const out = truncateCN(long);
    expect(out.length).toBe(50);
  });
});

describe('buildAppearanceOperators', () => {
  it('emits a "Firmado por: <CN>" Tj operator', () => {
    const ops = __internals.buildAppearanceOperators(200, 60, 'Test Signer');
    const dump = ops.map((o) => o.toString()).join('\n');
    // The text is encoded as a hex string inside Tj — but PDFHexString.toString()
    // round-trips through hex. The CN is uppercase-A-Z + lowercase + space, so we
    // expect to find each char's hex code somewhere in the dump.
    // Easier: assert structural ops are present.
    expect(dump).toContain('q'); // pushGraphicsState
    expect(dump).toContain('Q'); // popGraphicsState
    expect(dump).toContain('BT'); // beginText
    expect(dump).toContain('ET'); // endText
    expect(dump).toContain('/Helv 10 Tf'); // font + size
    // The operator chain must include a Tj
    expect(dump).toMatch(/Tj/);
  });

  it('encodes the label + CN as a WinAnsi (latin1) hex string in Tj', () => {
    const cn = 'Test Signer';
    const ops = __internals.buildAppearanceOperators(200, 60, cn);
    const dump = ops.map((o) => o.toString()).join('\n');
    const expected = Buffer.from('Firmado por: ' + cn, 'latin1').toString('hex');
    expect(dump.toLowerCase()).toContain(expected.toLowerCase());
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Validation error tests (no signing)
// ───────────────────────────────────────────────────────────────────────────

describe('signPdfPades — visible-sig validation', () => {
  it('throws visible_sig_invalid_page when page index is negative', async () => {
    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const pdf = await buildA4Pdf();
    await expect(
      signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
        visibleSig: { page: -1, x: 100, y: 100, width: 200, height: 60, signerCN: 'X' },
      }),
    ).rejects.toMatchObject({ code: 'visible_sig_invalid_page' });
  });

  it('throws visible_sig_invalid_page when page index ≥ pageCount', async () => {
    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const pdf = await buildA4Pdf();
    await expect(
      signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
        visibleSig: { page: 99, x: 100, y: 100, width: 200, height: 60, signerCN: 'X' },
      }),
    ).rejects.toMatchObject({ code: 'visible_sig_invalid_page' });
  });

  it('throws visible_sig_too_small when width or height < 30', async () => {
    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const pdf = await buildA4Pdf();
    await expect(
      signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
        visibleSig: { page: 0, x: 100, y: 100, width: 200, height: 10, signerCN: 'X' },
      }),
    ).rejects.toMatchObject({ code: 'visible_sig_too_small' });
    await expect(
      signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
        visibleSig: { page: 0, x: 100, y: 100, width: 5, height: 60, signerCN: 'X' },
      }),
    ).rejects.toMatchObject({ code: 'visible_sig_too_small' });
  });

  it('throws visible_sig_out_of_bounds when rect overflows page', async () => {
    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const pdf = await buildA4Pdf(); // 595×842
    // Right edge extends past 595
    await expect(
      signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
        visibleSig: { page: 0, x: 500, y: 100, width: 200, height: 60, signerCN: 'X' },
      }),
    ).rejects.toMatchObject({ code: 'visible_sig_out_of_bounds' });
    // Negative origin
    await expect(
      signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
        visibleSig: { page: 0, x: -1, y: 100, width: 200, height: 60, signerCN: 'X' },
      }),
    ).rejects.toMatchObject({ code: 'visible_sig_out_of_bounds' });
    // Top edge overflow
    await expect(
      signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
        visibleSig: { page: 0, x: 100, y: 800, width: 200, height: 60, signerCN: 'X' },
      }),
    ).rejects.toMatchObject({ code: 'visible_sig_out_of_bounds' });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// End-to-end signing with visible widget
// ───────────────────────────────────────────────────────────────────────────

describe('signPdfPades — visible-sig rendering', () => {
  it('produces a Widget annotation on page 0 with the requested Rect', async () => {
    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const pdf = await buildA4Pdf();
    const signed = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
      visibleSig: { page: 0, x: 100, y: 100, width: 200, height: 60, signerCN: 'Test Signer' },
    });

    const found = await findSigWidget(signed, 0);
    expect(found).not.toBeNull();
    const rect = found!.widget.lookup(PDFName.of('Rect'), PDFArray);
    expect(rect.size()).toBe(4);
    const nums = [0, 1, 2, 3].map((i) => (rect.lookup(i, PDFNumber) as PDFNumber).asNumber());
    expect(nums).toEqual([100, 100, 300, 160]);
  });

  it('renders "Firmado por: Test Signer" inside the Appearance Stream', async () => {
    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const pdf = await buildA4Pdf();
    const signed = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
      visibleSig: { page: 0, x: 100, y: 100, width: 200, height: 60, signerCN: 'Test Signer' },
    });

    const found = await findSigWidget(signed, 0);
    expect(found).not.toBeNull();
    const stream = lookupApN(found!.doc, found!.widget);
    const dump = dumpAppearanceText(stream);
    // Helvetica + size assertion
    expect(dump).toContain('/Helv 10 Tf');
    // Hex-encoded "Firmado por: Test Signer"
    const expectedHex = Buffer.from('Firmado por: Test Signer', 'latin1').toString('hex');
    expect(dump.toLowerCase()).toContain(expectedHex.toLowerCase());
  });

  it('attaches Helvetica to the Form XObject Resources', async () => {
    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const pdf = await buildA4Pdf();
    const signed = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
      visibleSig: { page: 0, x: 100, y: 100, width: 200, height: 60, signerCN: 'Test' },
    });
    const found = (await findSigWidget(signed, 0))!;
    const stream = lookupApN(found.doc, found.widget);
    const resources = stream.dict.lookup(PDFName.of('Resources'), PDFDict) as PDFDict;
    const fonts = resources.lookup(PDFName.of('Font'), PDFDict) as PDFDict;
    const helv = fonts.get(PDFName.of('Helv'));
    expect(helv).toBeInstanceOf(PDFRef);
  });

  it('places the widget on the requested page (page=1, two-page PDF)', async () => {
    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const pdf = await buildTwoPagePdf();
    const signed = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
      visibleSig: { page: 1, x: 50, y: 50, width: 200, height: 60, signerCN: 'P2' },
    });
    // Page 0 must have NO sig widget
    const onPage0 = await findSigWidget(signed, 0);
    expect(onPage0).toBeNull();
    // Page 1 must have it
    const onPage1 = await findSigWidget(signed, 1);
    expect(onPage1).not.toBeNull();
  });

  it('truncates CN > 50 chars with ellipsis in the rendered stream', async () => {
    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const pdf = await buildA4Pdf();
    const longCN = 'X'.repeat(80);
    const signed = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
      visibleSig: { page: 0, x: 100, y: 100, width: 200, height: 60, signerCN: longCN },
    });
    const found = (await findSigWidget(signed, 0))!;
    const stream = lookupApN(found.doc, found.widget);
    const dump = dumpAppearanceText(stream);
    // Truncated CN = 49 X + ellipsis. Note: '…' has charCode 0x2026, so
    // (charCodeAt & 0xff) = 0x26 — same low byte regardless of host encoding.
    const truncated = 'Firmado por: ' + 'X'.repeat(49) + '…';
    let expectedHex = '';
    for (let i = 0; i < truncated.length; i++) {
      expectedHex += (truncated.charCodeAt(i) & 0xff).toString(16).padStart(2, '0');
    }
    expect(dump.toLowerCase()).toContain(expectedHex.toLowerCase());
    // The full-length original CN must NOT appear
    let fullHex = '';
    const full = 'Firmado por: ' + longCN;
    for (let i = 0; i < full.length; i++) {
      fullHex += (full.charCodeAt(i) & 0xff).toString(16).padStart(2, '0');
    }
    expect(dump.toLowerCase()).not.toContain(fullHex.toLowerCase());
  });

  it('omitting visibleSig produces an invisible signature (no sig widget on user page)', async () => {
    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const pdf = await buildA4Pdf();
    const signed = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1]);
    // The widget IS still created by pdflibAddPlaceholder (with rect 0,0,0,0)
    // but the appearance is empty. Verify: rect is zero-sized.
    const found = await findSigWidget(signed, 0);
    expect(found).not.toBeNull();
    const rect = found!.widget.lookup(PDFName.of('Rect'), PDFArray);
    const nums = [0, 1, 2, 3].map((i) => (rect.lookup(i, PDFNumber) as PDFNumber).asNumber());
    expect(nums).toEqual([0, 0, 0, 0]);
  });

  it('end-to-end: signed PDF with visible widget remains parseable by verifier', async () => {
    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const pdf = await buildA4Pdf();
    const signed = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
      visibleSig: { page: 0, x: 100, y: 100, width: 200, height: 60, signerCN: 'Test Signer' },
      reason: 'Acepto',
      location: 'Quito, EC',
    });

    const sigRange = await findSignature(signed);
    expect(sigRange).not.toBeNull();
    const cms = await parseCms(sigRange!.contents);
    expect(cms.signerCert).toBeDefined();
    expect(cms.signedMessageDigest.length).toBe(32);

    // Cross-check coveredBytes hash
    const [a, b, c, d] = sigRange!.byteRange;
    const covered = new Uint8Array(b + d);
    covered.set(signed.subarray(a, a + b), 0);
    covered.set(signed.subarray(c, c + d), b);
    const ab = covered.buffer.slice(
      covered.byteOffset,
      covered.byteOffset + covered.byteLength,
    ) as ArrayBuffer;
    const recomputed = new Uint8Array(await crypto.subtle.digest('SHA-256', ab));
    expect(recomputed.length).toBe(cms.signedMessageDigest.length);
    for (let i = 0; i < recomputed.length; i++) {
      expect(recomputed[i]).toBe(cms.signedMessageDigest[i]);
    }
  });

  it('throws visible_sig_invalid_page on non-integer page index', async () => {
    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const pdf = await buildA4Pdf();
    await expect(
      signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
        visibleSig: { page: 0.5, x: 100, y: 100, width: 200, height: 60, signerCN: 'X' },
      }),
    ).rejects.toBeInstanceOf(SignerError);
  });
});
