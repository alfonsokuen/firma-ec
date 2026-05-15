/**
 * F6 Task 11 — signPdfPades end-to-end timestamp propagation.
 *
 * - timestamp:false → result.timestamp.ok=false, no unsignedAttr in embedded CMS.
 * - timestamp:true (default) + mocked TSA timeout → still valid B-B PDF +
 *   result.timestamp.reason='timeout'.
 * - timestamp:true + mocked TSA ok (KAT token) → result.timestamp.ok=true,
 *   embedded CMS contains the unsignedAttr.
 */

import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as asn1js from 'asn1js';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pkijs from 'pkijs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const mockRequestTimestamp = vi.fn();
vi.mock('@firma-ec/tsa-client', async () => {
  const actual =
    await vi.importActual<typeof import('@firma-ec/tsa-client')>('@firma-ec/tsa-client');
  return {
    ...actual,
    requestTimestamp: (...args: unknown[]) => mockRequestTimestamp(...args),
  };
});

import { parseCms } from '../../verifier/src/cms.js';
import { findSignature } from '../../verifier/src/pdf.js';
import { parsePfx } from '../src/p12.js';
import { signPdfPades } from '../src/pades.js';

const FIX_DIR = join(__dirname, 'fixtures');
const PIN = 'test1234';
const OID_SIGNATURE_TIMESTAMP_TOKEN = '1.2.840.113549.1.9.16.2.14';

beforeAll(() => {
  pkijs.setEngine(
    'node-webcrypto',
    new pkijs.CryptoEngine({ name: 'node-webcrypto', crypto: webcrypto as unknown as Crypto }),
  );
  if (!(globalThis as { crypto?: Crypto }).crypto) {
    (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
  }
});

afterEach(() => mockRequestTimestamp.mockReset());

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIX_DIR, name)));
}

async function buildMinimalPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('firma.ec F6 timestamp test', { x: 50, y: 100, size: 14, font });
  return doc.save({ useObjectStreams: false });
}

function loadKatToken(): Uint8Array | null {
  const path = join(
    __dirname,
    '..',
    '..',
    'tsa-client',
    'tests',
    '__fixtures__',
    'freetsa-kat-2026-05-09.tsr',
  );
  try {
    const tsrBytes = new Uint8Array(readFileSync(path));
    const ab = tsrBytes.buffer.slice(
      tsrBytes.byteOffset,
      tsrBytes.byteOffset + tsrBytes.byteLength,
    ) as ArrayBuffer;
    const outer = asn1js.fromBER(ab);
    if (outer.offset === -1) return null;
    const seq = outer.result as asn1js.Sequence;
    const items = seq.valueBlock.value;
    if (items.length < 2) return null;
    return new Uint8Array(items[1]!.toBER(false));
  } catch {
    return null;
  }
}

async function hasTimestampUnsignedAttr(signedPdf: Uint8Array): Promise<boolean> {
  // Use the verifier's signature locator + raw ASN.1 parse so we don't rely
  // on textual /Contents heuristics (those misfire on PDFs with appearance
  // streams that also contain '<...>' literals).
  const sig = await findSignature(signedPdf);
  if (!sig) return false;
  // parseCms validates structure but doesn't surface unsignedAttrs — re-parse
  // with pkijs directly for the unsigned-attr OID check.
  await parseCms(sig.contents); // sanity
  const ab = sig.contents.buffer.slice(
    sig.contents.byteOffset,
    sig.contents.byteOffset + sig.contents.byteLength,
  ) as ArrayBuffer;
  const asn = asn1js.fromBER(ab);
  if (asn.offset === -1) return false;
  const ci = new pkijs.ContentInfo({ schema: asn.result });
  const sd = new pkijs.SignedData({ schema: ci.content });
  const si = sd.signerInfos[0]!;
  const attrs =
    (si as unknown as { unsignedAttrs?: { attributes: { type: string }[] } }).unsignedAttrs
      ?.attributes ?? [];
  return attrs.some((a) => a.type === OID_SIGNATURE_TIMESTAMP_TOKEN);
}

describe('signPdfPades — F6 timestamp propagation', () => {
  it('timestamp:false → no TSA call, no unsignedAttr, B-B output', async () => {
    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const pdf = await buildMinimalPdf();
    const result = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
      timestamp: false,
    });
    expect(mockRequestTimestamp).not.toHaveBeenCalled();
    expect(result.timestamp.ok).toBe(false);
    expect(result.timestamp.reason).toBe('disabled');
    expect(await findSignature(result.signedPdf)).not.toBeNull();
    expect(await hasTimestampUnsignedAttr(result.signedPdf)).toBe(false);
  });

  it('timestamp default true + TSA timeout → valid B-B fallback, reason=timeout', async () => {
    mockRequestTimestamp.mockResolvedValueOnce({ error: 'timeout', detail: 'mock' });
    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const pdf = await buildMinimalPdf();
    const result = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1]);
    expect(mockRequestTimestamp).toHaveBeenCalledTimes(1);
    expect(result.timestamp.ok).toBe(false);
    expect(result.timestamp.reason).toBe('timeout');
    expect(await findSignature(result.signedPdf)).not.toBeNull();
    expect(await hasTimestampUnsignedAttr(result.signedPdf)).toBe(false);
  });

  it.runIf(loadKatToken() !== null)(
    'TSA ok → embedded unsignedAttr + result.timestamp.ok=true',
    async () => {
      const token = loadKatToken()!;
      mockRequestTimestamp.mockResolvedValueOnce({
        token,
        tsaUrl: 'https://freetsa.org/tsr',
        hashAlgo: 'SHA-256',
        signingTime: new Date('2026-05-10T04:16:38.845Z'),
        tsaCert: {
          subjectCN: 'www.freetsa.org',
          issuerCN: 'www.freetsa.org',
          der: new Uint8Array(0),
          notBefore: new Date('2016-03-13T01:57:39Z'),
          notAfter: new Date('2026-03-11T01:57:39Z'),
        },
        serialNumberHex: 'aabbccdd',
      });
      const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
      const pdf = await buildMinimalPdf();
      const result = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1]);
      expect(result.timestamp.ok).toBe(true);
      expect(result.timestamp.tsaUrl).toBe('https://freetsa.org/tsr');
      expect(await hasTimestampUnsignedAttr(result.signedPdf)).toBe(true);
    },
  );
});
