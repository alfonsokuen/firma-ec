/**
 * F7 LTV integration tests for signPdfPades.
 *
 * Approach: mock the LTV layer (`@firma-ec/ltv-validation`) so we don't hit
 * the network, then exercise the orchestration paths:
 *   - LT happy path → output is B-LT (DSS present), profile === 'B-LT'.
 *   - LTA happy path → output is B-LTA (DSS + doc-ts), profile === 'B-LTA'.
 *   - OCSP revoked → throws SignerError('certificate_revoked').
 *   - LTV timeout → degrades to B-T.
 *
 * @see docs/superpowers/specs/2026-05-10-firma-ec-F7-LTV-design.md §5.2
 */

import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pkijs from 'pkijs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const mockFetchOcsp = vi.fn();
const mockFetchCrl = vi.fn();
const mockIsCertRevoked = vi.fn();

vi.mock('@firma-ec/ltv-validation', async () => {
  const actual = await vi.importActual<typeof import('@firma-ec/ltv-validation')>(
    '@firma-ec/ltv-validation',
  );
  return {
    ...actual,
    fetchOcsp: (...args: unknown[]) => mockFetchOcsp(...args),
    fetchCrl: (...args: unknown[]) => mockFetchCrl(...args),
    isCertRevoked: (...args: unknown[]) => mockIsCertRevoked(...args),
  };
});

const mockAppendDocumentTimestamp = vi.fn();
vi.mock('@firma-ec/dss-pdf', async () => {
  const actual = await vi.importActual<typeof import('@firma-ec/dss-pdf')>('@firma-ec/dss-pdf');
  return {
    ...actual,
    appendDocumentTimestamp: (...args: unknown[]) => mockAppendDocumentTimestamp(...args),
  };
});

import { findDocumentTimestamps, parseDss } from '@firma-ec/dss-pdf';
import { SignerError } from '../src/errors.js';
import { parsePfx } from '../src/p12.js';
import { signPdfPades } from '../src/pades.js';

const FIX_DIR = join(__dirname, 'fixtures');
const PIN = 'test1234';

beforeAll(() => {
  pkijs.setEngine(
    'node-webcrypto',
    new pkijs.CryptoEngine({ name: 'node-webcrypto', crypto: webcrypto as unknown as Crypto }),
  );
  if (!(globalThis as { crypto?: Crypto }).crypto) {
    (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
  }
});

afterEach(() => {
  mockFetchOcsp.mockReset();
  mockFetchCrl.mockReset();
  mockIsCertRevoked.mockReset();
  mockAppendDocumentTimestamp.mockReset();
});

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIX_DIR, name)));
}

async function buildMinimalPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('F7 LTV test fixture', { x: 50, y: 100, size: 14, font });
  return doc.save({ useObjectStreams: false });
}

function fakeOcspResponse(): Uint8Array {
  // Recognizable DER stub — parseDss preserves whatever bytes we hand it.
  return new Uint8Array([0x30, 0x82, 0x01, 0x00, 0xaa, 0xbb, 0xcc, 0xdd]);
}

describe('signPdfPades — F7 LTV orchestration', () => {
  it('LT happy path: OCSP good for full chain → output is B-LT with DSS embedded', async () => {
    const ocspDer = fakeOcspResponse();
    mockFetchOcsp.mockResolvedValue({
      ok: true,
      responseDer: ocspDer,
      status: 'good',
      producedAt: new Date(),
      thisUpdate: new Date(),
      responderUrl: 'http://ocsp.example/',
      signatureValid: true,
    });

    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const pdf = await buildMinimalPdf();
    const result = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
      timestamp: false, // keep B-T off so test focuses on LT layer
      ltv: { longTermArchive: false },
    });
    expect(result.ltv.profile).toBe('B-LT');
    expect(result.ltv.longTermAchieved).toBe(true);
    expect(result.ltv.archiveAchieved).toBe(false);
    expect(result.ltv.embeddedOcspCount).toBeGreaterThan(0);

    // DSS must be parseable back from the output.
    const parsed = parseDss(result.signedPdf);
    expect(parsed).not.toBeNull();
    expect(parsed!.ocsps.length).toBe(result.ltv.embeddedOcspCount);
    // Recovered OCSP DER matches what we mocked.
    expect(parsed!.ocsps[0]).toEqual(ocspDer);
  });

  it('LTA happy path: LT succeeds + document timestamp succeeds → output is B-LTA', async () => {
    mockFetchOcsp.mockResolvedValue({
      ok: true,
      responseDer: fakeOcspResponse(),
      status: 'good',
      producedAt: new Date(),
      thisUpdate: new Date(),
      responderUrl: 'http://ocsp.example/',
      signatureValid: true,
    });
    mockAppendDocumentTimestamp.mockImplementation(
      async ({ pdfBytes }: { pdfBytes: Uint8Array }) => {
        // Build a sentinel marker we can detect after-the-fact.
        const marker = new TextEncoder().encode('\n%doc-ts-stub\n');
        const out = new Uint8Array(pdfBytes.length + marker.length);
        out.set(pdfBytes, 0);
        out.set(marker, pdfBytes.length);
        return {
          ok: true,
          pdfBytes: out,
          tsaIssuerCN: 'mock-tsa',
          signingTime: new Date('2026-05-10T12:00:00Z'),
        };
      },
    );

    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const pdf = await buildMinimalPdf();
    const result = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
      timestamp: false,
      ltv: {}, // defaults: longTerm=true, longTermArchive=true
    });
    expect(result.ltv.profile).toBe('B-LTA');
    expect(result.ltv.longTermAchieved).toBe(true);
    expect(result.ltv.archiveAchieved).toBe(true);
    expect(result.ltv.documentTimestampTsaIssuer).toBe('mock-tsa');
    expect(mockAppendDocumentTimestamp).toHaveBeenCalledTimes(1);
  });

  it('OCSP revoked → signPdfPades throws SignerError(certificate_revoked)', async () => {
    mockFetchOcsp.mockResolvedValue({
      ok: true,
      responseDer: fakeOcspResponse(),
      status: 'revoked',
      producedAt: new Date(),
      thisUpdate: new Date(),
      revokedAt: new Date(),
      responderUrl: 'http://ocsp.example/',
      signatureValid: true,
    });

    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const pdf = await buildMinimalPdf();
    await expect(
      signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
        timestamp: false,
        ltv: {},
      }),
    ).rejects.toMatchObject({
      name: 'SignerError',
      code: 'certificate_revoked',
    });
  });

  it('LTV timeout: OCSP + CRL both fail → degrades to B-T, profile reflects truth', async () => {
    mockFetchOcsp.mockResolvedValue({ ok: false, reason: 'timeout', detail: 'mock timeout' });
    mockFetchCrl.mockResolvedValue({ ok: false, reason: 'timeout', detail: 'mock timeout' });

    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const pdf = await buildMinimalPdf();
    const result = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
      timestamp: false, // no B-T
      ltv: {},
    });
    // No DSS appended because no OCSP/CRL data was available.
    expect(result.ltv.longTermAchieved).toBe(false);
    expect(result.ltv.archiveAchieved).toBe(false);
    // Profile is 'B-B' because timestamp was off; if timestamp had succeeded
    // it would be 'B-T'. Either way it must NOT be B-LT or B-LTA.
    expect(['B-B', 'B-T']).toContain(result.ltv.profile);
    // Warnings include the timeout codes.
    const codes = result.ltv.warnings.map((w) => w.code);
    expect(codes.some((c) => c.startsWith('ocsp_'))).toBe(true);
    // findDocumentTimestamps must return [] (no doc-ts appended).
    expect(findDocumentTimestamps(result.signedPdf).length).toBe(0);
    // parseDss returns null (no DSS).
    expect(parseDss(result.signedPdf)).toBeNull();
  });

  it('ltv.longTerm: false → output stays at B-T/B-B verbatim, no DSS, no warnings invoked', async () => {
    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const pdf = await buildMinimalPdf();
    const result = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
      timestamp: false,
      ltv: { longTerm: false },
    });
    expect(result.ltv.longTermAchieved).toBe(false);
    expect(result.ltv.archiveAchieved).toBe(false);
    expect(parseDss(result.signedPdf)).toBeNull();
    // We didn't enter the LTV pipeline so no OCSP fetch was attempted.
    expect(mockFetchOcsp).not.toHaveBeenCalled();
  });
});
