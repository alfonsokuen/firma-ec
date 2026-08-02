/**
 * anchorMatch.test.ts — normalización table-driven, ruptura de ventana por
 * UNMAPPED y por `endLine`, ambigüedad. `compileAnchorMatcher` se prueba
 * conectado a `readTextBands` (igual que `textBandsAnchor.test.ts`): así se
 * prueba el contrato REAL — cómo llegan los code points desde un PDF, no una
 * simulación de cómo "debería" llamarse el observer.
 */
import { PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { type AnchorHit, compileAnchorMatcher } from '../src/anchorMatch.js';
import { readTextBands } from '../src/textBands.js';

/** PDF de una página con UN solo font dict WinAnsi puro (sin /Differences). */
async function pdfWithPlainFont(content: string): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(content)));
  const font = doc.context.obj({
    Type: 'Font',
    Subtype: 'Type1',
    BaseFont: 'Helvetica',
    Encoding: 'WinAnsiEncoding',
  });
  const resources = doc.context.obj({ Font: doc.context.obj({ F1: doc.context.register(font) }) });
  page.node.set(PDFName.of('Resources'), resources);
  return PDFDocument.load(await doc.save());
}

/** PDF con DOS font dicts: F1 identidad, F2 con /Differences (para forzar UNMAPPED a voluntad). */
async function pdfWithUnmappableFont(
  content: string,
  unmappedCodes: number[],
): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(content)));
  const f1 = doc.context.obj({
    Type: 'Font',
    Subtype: 'Type1',
    BaseFont: 'Helvetica',
    Encoding: 'WinAnsiEncoding',
  });
  // F2: /Differences que borra el mapeo de los códigos dados con un nombre
  // AGL desconocido — `fontDecode.ts` los emite como UNMAPPED_CODE_POINT.
  const differences: Array<number | string> = [];
  for (const code of unmappedCodes) differences.push(code, 'glifoDesconocidoXYZ');
  const f2 = doc.context.obj({
    Type: 'Font',
    Subtype: 'Type1',
    BaseFont: 'Helvetica',
    Encoding: doc.context.obj({
      Type: 'Encoding',
      BaseEncoding: 'WinAnsiEncoding',
      Differences: differences,
    }),
  });
  const resources = doc.context.obj({
    Font: doc.context.obj({ F1: doc.context.register(f1), F2: doc.context.register(f2) }),
  });
  page.node.set(PDFName.of('Resources'), resources);
  return PDFDocument.load(await doc.save());
}

async function scan(
  doc: PDFDocument,
  spec: Parameters<typeof compileAnchorMatcher>[0],
): Promise<AnchorHit[]> {
  const matcher = compileAnchorMatcher(spec);
  readTextBands(doc, { textObserver: matcher.observer });
  return matcher.finish();
}

describe('normalización — table-driven', () => {
  const cases: Array<{ text: string; label: string }> = [
    { text: 'FIRMA', label: 'mayúsculas' },
    { text: 'firma', label: 'minúsculas' },
    { text: 'Firma', label: 'capitalizado' },
    { text: 'firma.', label: 'con punto de cierre' },
    { text: 'firma:', label: 'con dos puntos' },
    { text: '(firma)', label: 'entre paréntesis' },
    { text: 'firma_', label: 'con guion bajo' },
    { text: 'firma-', label: 'con guion' },
  ];

  for (const { text, label } of cases) {
    it(`"${text}" (${label}) matchea la etiqueta "firma"`, async () => {
      const doc = await pdfWithPlainFont(`BT /F1 12 Tf 1 0 0 1 50 700 Tm (${text}) Tj ET`);
      const hits = await scan(doc, {});
      expect(hits.some((h) => h.kind === 'firma-label')).toBe(true);
    });
  }

  it('vocálicos con tilde se normalizan a su base: "Cédula" matchea igual que "cedula"', async () => {
    const doc = await pdfWithPlainFont(
      'BT /F1 12 Tf 1 0 0 1 50 700 Tm (C\\351dula: 0912345678) Tj ET',
    );
    // \351 = 0xE9 = 'é' en WinAnsi.
    const hits = await scan(doc, { cedula: '0912345678' });
    expect(hits.some((h) => h.kind === 'firmante-cedula')).toBe(true);
  });

  it('Ñ/ñ se normaliza a "n": el nombre del CN con ñ matchea contra el documento sin acentuar en Word', async () => {
    // El CN trae "Muñoz"; el documento (mal tildado, como pasa en la práctica)
    // trae el mismo texto — ambos pasan por la MISMA normalización, así que
    // deben seguir coincidiendo entre sí.
    const doc = await pdfWithPlainFont('BT /F1 12 Tf 1 0 0 1 50 700 Tm (Juan Mu\\361oz) Tj ET');
    // \361 = 0xF1 = 'ñ' en WinAnsi.
    const hits = await scan(doc, { signerName: 'Juan Muñoz' });
    expect(hits.some((h) => h.kind === 'firmante-nombre')).toBe(true);
  });

  it('un texto sin ninguna etiqueta ni dato del firmante no produce hits', async () => {
    const doc = await pdfWithPlainFont(
      'BT /F1 12 Tf 1 0 0 1 50 700 Tm (Clausula primera del contrato) Tj ET',
    );
    const hits = await scan(doc, { signerName: 'Juan Muñoz', cedula: '0912345678' });
    expect(hits).toEqual([]);
  });
});

describe('ruptura de ventana por UNMAPPED_CODE_POINT', () => {
  it('"Fir" + glifo ilegible + "ma" NO matchea "firma" — no se pega a través del hueco', async () => {
    // F2 remapea 'r' (el 3er carácter de "Firma") a un nombre AGL desconocido:
    // el decoder lo emite como UNMAPPED_CODE_POINT.
    const doc = await pdfWithUnmappableFont(
      'BT /F1 12 Tf 1 0 0 1 50 700 Tm (Fi) Tj /F2 12 Tf (r) Tj /F1 12 Tf (ma) Tj ET',
      [0x72], // 'r' minúscula
    );
    const hits = await scan(doc, {});
    expect(hits.some((h) => h.kind === 'firma-label')).toBe(false);
  });

  it('sin el hueco (control positivo), "Firma" completo SÍ matchea', async () => {
    const doc = await pdfWithPlainFont('BT /F1 12 Tf 1 0 0 1 50 700 Tm (Firma) Tj ET');
    const hits = await scan(doc, {});
    expect(hits.some((h) => h.kind === 'firma-label')).toBe(true);
  });
});

describe('ruptura de ventana por endLine()', () => {
  it('"firmado" en una línea y "por" en la SIGUIENTE no matchea "firmado por"', async () => {
    const doc = await pdfWithPlainFont(
      'BT /F1 12 Tf 1 0 0 1 50 700 Tm (firmado) Tj ET BT /F1 12 Tf 1 0 0 1 50 680 Tm (por) Tj ET',
    );
    const hits = await scan(doc, {});
    expect(hits.some((h) => h.kind === 'firma-label')).toBe(false);
  });

  it('control positivo: "firmado por" en LA MISMA línea sí matchea', async () => {
    const doc = await pdfWithPlainFont('BT /F1 12 Tf 1 0 0 1 50 700 Tm (firmado por) Tj ET');
    const hits = await scan(doc, {});
    expect(hits.some((h) => h.kind === 'firma-label')).toBe(true);
  });
});

describe('firmante-nombre — bigramas consecutivos del CN', () => {
  it('"Juan Carlos Perez" en el documento matchea contra el CN completo', async () => {
    const doc = await pdfWithPlainFont('BT /F1 12 Tf 1 0 0 1 50 700 Tm (Juan Carlos Perez) Tj ET');
    const hits = await scan(doc, { signerName: 'Juan Carlos Perez' });
    expect(hits.some((h) => h.kind === 'firmante-nombre')).toBe(true);
  });

  it('un bigrama intermedio del CN ("Carlos Perez") en el documento también matchea', async () => {
    const doc = await pdfWithPlainFont(
      'BT /F1 12 Tf 1 0 0 1 50 700 Tm (recibido por Carlos Perez hoy) Tj ET',
    );
    const hits = await scan(doc, { signerName: 'Juan Carlos Perez' });
    expect(hits.some((h) => h.kind === 'firmante-nombre')).toBe(true);
  });

  it('UNA sola palabra del CN, aislada, NO matchea (exige ≥2 consecutivas)', async () => {
    const doc = await pdfWithPlainFont('BT /F1 12 Tf 1 0 0 1 50 700 Tm (Carlos vino ayer) Tj ET');
    const hits = await scan(doc, { signerName: 'Juan Carlos Perez' });
    expect(hits.some((h) => h.kind === 'firmante-nombre')).toBe(false);
  });

  it('sin signerName, nunca se emite firmante-nombre', async () => {
    const doc = await pdfWithPlainFont('BT /F1 12 Tf 1 0 0 1 50 700 Tm (Juan Carlos Perez) Tj ET');
    const hits = await scan(doc, {});
    expect(hits.some((h) => h.kind === 'firmante-nombre')).toBe(false);
  });
});

describe('firmante-cedula — con y sin etiqueta', () => {
  it('los 10 dígitos exactos, solos, matchean', async () => {
    const doc = await pdfWithPlainFont('BT /F1 12 Tf 1 0 0 1 50 700 Tm (0912345678) Tj ET');
    const hits = await scan(doc, { cedula: '0912345678' });
    expect(hits.some((h) => h.kind === 'firmante-cedula')).toBe(true);
  });

  it('"CI: " + dígitos matchea', async () => {
    const doc = await pdfWithPlainFont('BT /F1 12 Tf 1 0 0 1 50 700 Tm (CI: 0912345678) Tj ET');
    const hits = await scan(doc, { cedula: '0912345678' });
    expect(hits.some((h) => h.kind === 'firmante-cedula')).toBe(true);
  });

  it('"C.I." + dígitos (etiqueta partida en dos palabras por los puntos) matchea', async () => {
    const doc = await pdfWithPlainFont('BT /F1 12 Tf 1 0 0 1 50 700 Tm (C.I. 0912345678) Tj ET');
    const hits = await scan(doc, { cedula: '0912345678' });
    expect(hits.some((h) => h.kind === 'firmante-cedula')).toBe(true);
  });

  it('unos dígitos DISTINTOS a la cédula del firmante no matchean (no es cualquier número de 10 cifras)', async () => {
    const doc = await pdfWithPlainFont('BT /F1 12 Tf 1 0 0 1 50 700 Tm (CI: 1111111111) Tj ET');
    const hits = await scan(doc, { cedula: '0912345678' });
    expect(hits.some((h) => h.kind === 'firmante-cedula')).toBe(false);
  });

  it('sin cedula en el spec, nunca se emite firmante-cedula', async () => {
    const doc = await pdfWithPlainFont('BT /F1 12 Tf 1 0 0 1 50 700 Tm (0912345678) Tj ET');
    const hits = await scan(doc, {});
    expect(hits.some((h) => h.kind === 'firmante-cedula')).toBe(false);
  });
});

describe('geometría del hit', () => {
  it('un hit lleva la posición de SU línea (x/y/h), no un valor fijo', async () => {
    const doc = await pdfWithPlainFont('BT /F1 12 Tf 1 0 0 1 123 456 Tm (Firma) Tj ET');
    const hits = await scan(doc, {});
    const hit = hits.find((h) => h.kind === 'firma-label');
    expect(hit).toBeDefined();
    expect(hit!.page).toBe(0);
    expect(hit!.x).toBeCloseTo(123, 5);
    expect(hit!.y).toBeGreaterThan(400); // baseline 456 menos el descenso de línea
  });
});
