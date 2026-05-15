/**
 * Round-trip tests for appendDss + parseDss.
 *
 * Strategy: build a minimal valid PDF with pdf-lib (classical xref, no
 * encryption, no linearization), append DSS, then re-parse and assert that
 * the recovered DER bytes match the input.
 */

import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { DssWriteError, appendDssImpl } from '../src/incrementalDss';
import { appendDss } from '../src/index';
import { parseDss } from '../src/index';
import type { DssData } from '../src/index';

async function buildMinimalPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('dss-pdf round-trip fixture', { x: 40, y: 100, size: 12, font });
  // useObjectStreams:false → classical xref table (not xref streams).
  return doc.save({ useObjectStreams: false });
}

function fakeCert(seed: number): Uint8Array {
  const buf = new Uint8Array(64);
  for (let i = 0; i < buf.length; i++) buf[i] = (seed + i * 7) & 0xff;
  return buf;
}

describe('appendDss + parseDss round-trip', () => {
  it('preserves prior PDF bytes byte-perfect (slice-1 invariant)', async () => {
    const pdf = await buildMinimalPdf();
    const dss: DssData = {
      certs: [fakeCert(1), fakeCert(2)],
      ocsps: [fakeCert(10)],
      crls: [],
      vri: { ABC123: { certIndices: [0, 1], ocspIndices: [0], crlIndices: [] } },
    };
    const out = await appendDss({ pdfBytes: pdf, dss });
    expect(out.length).toBeGreaterThan(pdf.length);
    expect(out.subarray(0, pdf.length)).toEqual(pdf);
  });

  it('round-trips: parseDss(appendDss(x)) recovers the same DER bytes', async () => {
    const pdf = await buildMinimalPdf();
    const c1 = fakeCert(1);
    const c2 = fakeCert(2);
    const o1 = fakeCert(10);
    const r1 = fakeCert(20);
    const dss: DssData = {
      certs: [c1, c2],
      ocsps: [o1],
      crls: [r1],
      vri: { DEADBEEF: { certIndices: [0, 1], ocspIndices: [0], crlIndices: [0] } },
    };
    const out = await appendDss({ pdfBytes: pdf, dss });
    const parsed = parseDss(out);
    expect(parsed).not.toBeNull();
    expect(parsed!.certs.length).toBe(2);
    expect(parsed!.certs[0]).toEqual(c1);
    expect(parsed!.certs[1]).toEqual(c2);
    expect(parsed!.ocsps.length).toBe(1);
    expect(parsed!.ocsps[0]).toEqual(o1);
    expect(parsed!.crls.length).toBe(1);
    expect(parsed!.crls[0]).toEqual(r1);
    expect(parsed!.vri).toHaveProperty('DEADBEEF');
    expect(parsed!.vri.DEADBEEF!.certIndices).toEqual([0, 1]);
    expect(parsed!.vri.DEADBEEF!.ocspIndices).toEqual([0]);
    expect(parsed!.vri.DEADBEEF!.crlIndices).toEqual([0]);
  });

  it('parseDss returns null on a PDF without /DSS', async () => {
    const pdf = await buildMinimalPdf();
    expect(parseDss(pdf)).toBeNull();
  });

  it('output PDF still loads via pdf-lib after DSS append', async () => {
    const pdf = await buildMinimalPdf();
    const dss: DssData = {
      certs: [fakeCert(5)],
      ocsps: [],
      crls: [],
      vri: {},
    };
    const out = await appendDss({ pdfBytes: pdf, dss });
    // pdf-lib should accept the incremental output.
    const reloaded = await PDFDocument.load(out, { updateMetadata: false });
    expect(reloaded.getPageCount()).toBe(1);
  });

  it('Catalog of the output references the DSS dict', async () => {
    const pdf = await buildMinimalPdf();
    const dss: DssData = {
      certs: [fakeCert(7)],
      ocsps: [],
      crls: [],
      vri: {},
    };
    const out = await appendDss({ pdfBytes: pdf, dss });
    const txt = new TextDecoder('latin1').decode(out);
    // The latest Catalog revision (in the appended tail) must include /DSS.
    expect(txt.lastIndexOf('/DSS ')).toBeGreaterThan(pdf.length);
    // And /Prev pointing back at the old xref.
    expect(txt).toContain('/Prev ');
  });

  it('rejects out-of-range VRI indices', async () => {
    const pdf = await buildMinimalPdf();
    const dss: DssData = {
      certs: [fakeCert(1)],
      ocsps: [],
      crls: [],
      vri: { AB: { certIndices: [5], ocspIndices: [], crlIndices: [] } }, // 5 out of range
    };
    await expect(appendDssImpl({ pdfBytes: pdf, dss })).rejects.toBeInstanceOf(DssWriteError);
  });

  it('rejects non-uppercase-hex VRI keys', async () => {
    const pdf = await buildMinimalPdf();
    const dss: DssData = {
      certs: [],
      ocsps: [],
      crls: [],
      vri: { 'lower-case': { certIndices: [], ocspIndices: [], crlIndices: [] } },
    };
    await expect(appendDssImpl({ pdfBytes: pdf, dss })).rejects.toBeInstanceOf(DssWriteError);
  });
});
