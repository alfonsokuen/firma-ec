/**
 * Document timestamp writer + finder tests.
 *
 * Mocks `@firma-ec/tsa-client.requestTimestamp` to return a synthetic token so
 * we don't hit the network during tests.
 */

import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockRequestTimestamp = vi.fn();
vi.mock('@firma-ec/tsa-client', async () => {
  const actual =
    await vi.importActual<typeof import('@firma-ec/tsa-client')>('@firma-ec/tsa-client');
  return {
    ...actual,
    requestTimestamp: (...args: unknown[]) => mockRequestTimestamp(...args),
  };
});

import { appendDocumentTimestamp, appendDss, findDocumentTimestamps } from '../src/index';
import type { DssData } from '../src/index';

async function buildMinimalPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('doc-ts fixture', { x: 40, y: 100, size: 12, font });
  return doc.save({ useObjectStreams: false });
}

afterEach(() => mockRequestTimestamp.mockReset());

function fakeToken(seed: number): Uint8Array {
  // Use a recognizable byte pattern.
  const buf = new Uint8Array(200);
  for (let i = 0; i < buf.length; i++) buf[i] = (seed + i * 3) & 0xff;
  return buf;
}

describe('appendDocumentTimestamp', () => {
  it('TSA ok → writes /DocTimeStamp /Sig dict + token written into /Contents', async () => {
    const token = fakeToken(7);
    mockRequestTimestamp.mockResolvedValueOnce({
      token,
      tsaUrl: 'https://freetsa.org/tsr',
      hashAlgo: 'SHA-256',
      signingTime: new Date('2026-05-10T12:00:00Z'),
      tsaCert: {
        subjectCN: 'www.freetsa.org',
        issuerCN: 'www.freetsa.org',
        der: new Uint8Array(0),
        notBefore: new Date(),
        notAfter: new Date(),
      },
      serialNumberHex: 'aabbccdd',
    });
    const pdf = await buildMinimalPdf();
    const res = await appendDocumentTimestamp({
      pdfBytes: pdf,
      tsaUrl: 'https://freetsa.org/tsr',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.tsaIssuerCN).toBe('www.freetsa.org');

    const found = findDocumentTimestamps(res.pdfBytes);
    expect(found.length).toBe(1);
    // Token bytes recovered should match (after stripping trailing-zero
    // padding, but the token does not end with 0x00 in our fakeToken).
    expect(found[0]!.tokenDer.slice(0, token.length)).toEqual(token);
  });

  it('TSA timeout → ok:false, reason=timeout', async () => {
    mockRequestTimestamp.mockResolvedValueOnce({ error: 'timeout', detail: 'mock' });
    const pdf = await buildMinimalPdf();
    const res = await appendDocumentTimestamp({ pdfBytes: pdf });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('timeout');
  });

  it('preserves prior PDF bytes byte-perfect (slice-1 invariant) on success', async () => {
    mockRequestTimestamp.mockResolvedValueOnce({
      token: fakeToken(99),
      tsaUrl: 'https://freetsa.org/tsr',
      hashAlgo: 'SHA-256',
      signingTime: new Date(),
      tsaCert: {
        subjectCN: 'tsa',
        issuerCN: 'tsa',
        der: new Uint8Array(0),
        notBefore: new Date(),
        notAfter: new Date(),
      },
      serialNumberHex: '01',
    });
    const pdf = await buildMinimalPdf();
    const res = await appendDocumentTimestamp({ pdfBytes: pdf });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.pdfBytes.subarray(0, pdf.length)).toEqual(pdf);
  });

  it('findDocumentTimestamps returns [] when no doc-ts present', async () => {
    const pdf = await buildMinimalPdf();
    expect(findDocumentTimestamps(pdf)).toEqual([]);
  });
});

describe('appendDss → appendDocumentTimestamp full B-LTA round-trip', () => {
  it('B-T → appendDss → appendDocumentTimestamp produces B-LTA preserving all prior bytes', async () => {
    mockRequestTimestamp.mockResolvedValueOnce({
      token: fakeToken(42),
      tsaUrl: 'https://freetsa.org/tsr',
      hashAlgo: 'SHA-256',
      signingTime: new Date(),
      tsaCert: {
        subjectCN: 'tsa',
        issuerCN: 'tsa',
        der: new Uint8Array(0),
        notBefore: new Date(),
        notAfter: new Date(),
      },
      serialNumberHex: '02',
    });
    const pdf = await buildMinimalPdf();
    const dss: DssData = {
      certs: [new Uint8Array([1, 2, 3])],
      ocsps: [new Uint8Array([4, 5, 6])],
      crls: [],
      vri: {},
    };
    const bLt = await appendDss({ pdfBytes: pdf, dss });
    const res = await appendDocumentTimestamp({ pdfBytes: bLt });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.pdfBytes.subarray(0, bLt.length)).toEqual(bLt);
    expect(bLt.subarray(0, pdf.length)).toEqual(pdf);
    // findDocumentTimestamps recovers exactly 1 doc-ts.
    expect(findDocumentTimestamps(res.pdfBytes).length).toBe(1);
  });
});
