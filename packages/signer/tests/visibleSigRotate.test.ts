/**
 * Tests for the `rotate` extension to `attachVisibleSignatureAppearance`
 * (visibleSig.ts §3.3 — spec §4 criterio 2). Ejercita el post-proceso de la
 * apariencia directamente (mismo camino que `pades.ts` usa antes de firmar),
 * sin necesidad de un PFX real ni de completar la firma CMS.
 *
 * NO se toca `visibleSig.test.ts` (existente) — este es un archivo nuevo.
 */
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { PDFArray, PDFContentStream, PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import {
  type VisibleSigInput,
  attachVisibleSignatureAppearance,
  embedHelvetica,
} from '../src/visibleSig.js';

async function buildA4Pdf(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return doc;
}

/** Reproduce el post-proceso que `pades.ts` hace antes de firmar (Tasks 17-19). */
async function attach(doc: PDFDocument, spec: VisibleSigInput) {
  const helvFontRef = await embedHelvetica(doc);
  pdflibAddPlaceholder({
    pdfDoc: doc,
    reason: 'test',
    contactInfo: '',
    name: 'Test Signer',
    location: '',
    signingTime: new Date('2026-01-01T00:00:00Z'),
    signatureLength: 8192,
    widgetRect: [spec.x, spec.y, spec.x + spec.width, spec.y + spec.height],
  });
  return attachVisibleSignatureAppearance(doc, spec, helvFontRef);
}

function numArr(arr: PDFArray): number[] {
  const out: number[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const n = arr.lookup(i, PDFNumber);
    out.push(n.asNumber());
  }
  return out;
}

describe('rotate = 0 (default) — byte-idéntico al comportamiento previo', () => {
  it('BBox = [0,0,width,height] y Matrix identidad', async () => {
    const doc = await buildA4Pdf();
    const spec: VisibleSigInput = {
      page: 0,
      x: 50,
      y: 50,
      width: 200,
      height: 60,
      signerCN: 'ACME',
    };
    const { widget } = await attach(doc, spec);
    const ap = widget.lookup(PDFName.of('AP'), PDFDict);
    const apStream = doc.context.lookup(ap.get(PDFName.of('N')), PDFContentStream);
    const bbox = numArr(apStream.dict.lookup(PDFName.of('BBox'), PDFArray));
    const matrix = numArr(apStream.dict.lookup(PDFName.of('Matrix'), PDFArray));
    expect(bbox).toEqual([0, 0, 200, 60]);
    expect(matrix).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('omitir rotate produce el mismo BBox/Matrix que rotate: 0 explícito', async () => {
    const doc1 = await buildA4Pdf();
    const doc2 = await buildA4Pdf();
    const base: Omit<VisibleSigInput, 'rotate'> = {
      page: 0,
      x: 50,
      y: 50,
      width: 200,
      height: 60,
      signerCN: 'ACME',
    };
    const r1 = await attach(doc1, base);
    const r2 = await attach(doc2, { ...base, rotate: 0 });
    const bboxOf = (doc: PDFDocument, widget: PDFDict) => {
      const ap = widget.lookup(PDFName.of('AP'), PDFDict);
      const apStream = doc.context.lookup(ap.get(PDFName.of('N')), PDFContentStream);
      return numArr(apStream.dict.lookup(PDFName.of('BBox'), PDFArray));
    };
    expect(bboxOf(doc1, r1.widget)).toEqual(bboxOf(doc2, r2.widget));
  });
});

describe('criterio 2 — /Rotate 90 y 180: Matrix esperado, BBox sin rotar', () => {
  it('rotate: 90 → Matrix [0,-1,1,0,0,0], BBox = [0,0,height,width] (swap)', async () => {
    const doc = await buildA4Pdf();
    // Físicamente el rect es h×w (240 boxH pasa a ancho físico, 240 boxW a alto).
    const spec: VisibleSigInput = {
      page: 0,
      x: 300,
      y: 400,
      width: 72, // físico = boxH
      height: 240, // físico = boxW
      signerCN: 'ACME',
      rotate: 90,
    };
    const { widget } = await attach(doc, spec);
    const ap = widget.lookup(PDFName.of('AP'), PDFDict);
    const apStream = doc.context.lookup(ap.get(PDFName.of('N')), PDFContentStream);
    const bbox = numArr(apStream.dict.lookup(PDFName.of('BBox'), PDFArray));
    const matrix = numArr(apStream.dict.lookup(PDFName.of('Matrix'), PDFArray));
    // BBox sin rotar: swap de vuelta a las dims "en lectura" (240x72).
    expect(bbox).toEqual([0, 0, 240, 72]);
    expect(matrix).toEqual([0, -1, 1, 0, 0, 0]);
  });

  it('rotate: 180 → Matrix [-1,0,0,-1,0,0], BBox = [0,0,width,height] (sin swap)', async () => {
    const doc = await buildA4Pdf();
    const spec: VisibleSigInput = {
      page: 0,
      x: 300,
      y: 400,
      width: 240,
      height: 72,
      signerCN: 'ACME',
      rotate: 180,
    };
    const { widget } = await attach(doc, spec);
    const ap = widget.lookup(PDFName.of('AP'), PDFDict);
    const apStream = doc.context.lookup(ap.get(PDFName.of('N')), PDFContentStream);
    const bbox = numArr(apStream.dict.lookup(PDFName.of('BBox'), PDFArray));
    const matrix = numArr(apStream.dict.lookup(PDFName.of('Matrix'), PDFArray));
    expect(bbox).toEqual([0, 0, 240, 72]);
    expect(matrix).toEqual([-1, 0, 0, -1, 0, 0]);
  });

  it('rotate: 270 → Matrix [0,1,-1,0,0,0], BBox swap', async () => {
    const doc = await buildA4Pdf();
    const spec: VisibleSigInput = {
      page: 0,
      x: 20,
      y: 400,
      width: 72,
      height: 240,
      signerCN: 'ACME',
      rotate: 270,
    };
    const { widget } = await attach(doc, spec);
    const ap = widget.lookup(PDFName.of('AP'), PDFDict);
    const apStream = doc.context.lookup(ap.get(PDFName.of('N')), PDFContentStream);
    const bbox = numArr(apStream.dict.lookup(PDFName.of('BBox'), PDFArray));
    const matrix = numArr(apStream.dict.lookup(PDFName.of('Matrix'), PDFArray));
    expect(bbox).toEqual([0, 0, 240, 72]);
    expect(matrix).toEqual([0, 1, -1, 0, 0, 0]);
  });
});
