/**
 * Tests de `analyzePdfForPlacement` — la ÚNICA entrada pública que permite a un
 * consumidor (la PWA) obtener todo lo que `computeAutoPlacement` necesita a
 * partir de bytes de PDF, sin depender de pdf-lib.
 *
 * Lo que se fija aquí:
 *   1. La firma pública NO filtra tipos de pdf-lib: entra `Uint8Array`, sale
 *      un objeto plano (criterio 5 de la tarea).
 *   2. Widgets `/FT /Sig` CON `/V` → `existing`; SIN `/V` → `emptySigFields`.
 *   3. `/FT` heredado vía `/Parent` cuenta como campo de firma.
 *   4. `/Rect` se normaliza (x/y mínimos, ancho/alto absolutos) aunque venga
 *      con las esquinas invertidas.
 *   5. Un PDF corrupto NO revienta: listas vacías.
 */
import { PDFArray, type PDFDict, PDFDocument, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { analyzePdfForPlacement } from '../src/analyzePdf.js';

const A4_W = 595.28;
const A4_H = 841.89;

interface WidgetSpec {
  rect: [number, number, number, number];
  /** `/V` presente ⇒ firma ya puesta. */
  signed?: boolean;
  /** Omite `/FT` en el widget y lo pone en un `/Parent` (herencia). */
  ftOnParent?: boolean;
  /** Sobrescribe `/FT` (para probar que un campo no-firma se ignora). */
  ft?: string;
  /** Omite `/Subtype /Widget`. */
  notWidget?: boolean;
}

async function makePdfWithWidgets(
  widgetsPerPage: WidgetSpec[][],
  pageOpts: { rotate?: number; cropBox?: [number, number, number, number] } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const widgets of widgetsPerPage) {
    const page = doc.addPage([A4_W, A4_H]);
    if (pageOpts.rotate) page.node.set(PDFName.of('Rotate'), doc.context.obj(pageOpts.rotate));
    if (pageOpts.cropBox) page.node.set(PDFName.of('CropBox'), doc.context.obj(pageOpts.cropBox));
    if (widgets.length === 0) continue;

    const annots = PDFArray.withContext(doc.context);
    for (const [i, w] of widgets.entries()) {
      const dict = doc.context.obj({}) as PDFDict;
      if (!w.notWidget) dict.set(PDFName.of('Subtype'), PDFName.of('Widget'));
      dict.set(PDFName.of('Type'), PDFName.of('Annot'));
      dict.set(PDFName.of('T'), PDFString.of(`campo-${i}`));
      const rect = PDFArray.withContext(doc.context);
      for (const n of w.rect) rect.push(PDFNumber.of(n));
      dict.set(PDFName.of('Rect'), rect);
      if (w.ftOnParent) {
        const parent = doc.context.obj({}) as PDFDict;
        parent.set(PDFName.of('FT'), PDFName.of(w.ft ?? 'Sig'));
        dict.set(PDFName.of('Parent'), doc.context.register(parent));
      } else {
        dict.set(PDFName.of('FT'), PDFName.of(w.ft ?? 'Sig'));
      }
      if (w.signed) {
        const sig = doc.context.obj({}) as PDFDict;
        sig.set(PDFName.of('Type'), PDFName.of('Sig'));
        dict.set(PDFName.of('V'), doc.context.register(sig));
      }
      annots.push(doc.context.register(dict));
    }
    page.node.set(PDFName.of('Annots'), annots);
  }
  return doc.save({ useObjectStreams: false });
}

describe('analyzePdfForPlacement', () => {
  it('devuelve la geometría de todas las páginas sin exponer tipos de pdf-lib', async () => {
    const bytes = await makePdfWithWidgets([[], []], { cropBox: [20, 30, 500, 700] });
    const analysis = await analyzePdfForPlacement(bytes);

    expect(analysis.geometry).toHaveLength(2);
    expect(analysis.geometry[0]).toEqual({
      page: 0,
      mediaW: A4_W,
      mediaH: A4_H,
      mediaX: 0,
      mediaY: 0,
      visX: 20,
      visY: 30,
      visW: 480,
      visH: 670,
      rotate: 0,
    });
    // Objeto plano, serializable por structured clone (o sea: sin PDFDocument
    // ni PDFDict dentro). Si algo de pdf-lib se filtrara, esto revienta.
    expect(() => structuredClone(analysis)).not.toThrow();
    expect(analysis.existing).toEqual([]);
    expect(analysis.emptySigFields).toEqual([]);
  });

  it('separa widgets de firma CON /V (existentes) de los SIN /V (campos vacíos)', async () => {
    const bytes = await makePdfWithWidgets([
      [{ rect: [40, 50, 200, 110], signed: true }, { rect: [300, 400, 540, 472] }],
    ]);
    const analysis = await analyzePdfForPlacement(bytes);

    expect(analysis.existing).toEqual([{ page: 0, x: 40, y: 50, w: 160, h: 60 }]);
    expect(analysis.emptySigFields).toEqual([{ page: 0, x: 300, y: 400, w: 240, h: 72 }]);
  });

  it('reconoce /FT /Sig heredado del /Parent', async () => {
    const bytes = await makePdfWithWidgets([[{ rect: [10, 20, 250, 92], ftOnParent: true }]]);
    const analysis = await analyzePdfForPlacement(bytes);

    expect(analysis.emptySigFields).toEqual([{ page: 0, x: 10, y: 20, w: 240, h: 72 }]);
  });

  it('ignora anotaciones que no son widgets de firma', async () => {
    const bytes = await makePdfWithWidgets([
      [
        { rect: [10, 20, 250, 92], ft: 'Tx' }, // campo de texto
        { rect: [10, 120, 250, 192], notWidget: true }, // no es /Widget
      ],
    ]);
    const analysis = await analyzePdfForPlacement(bytes);

    expect(analysis.emptySigFields).toEqual([]);
    expect(analysis.existing).toEqual([]);
  });

  it('normaliza un /Rect con las esquinas invertidas', async () => {
    const bytes = await makePdfWithWidgets([[{ rect: [340, 172, 100, 100] }]]);
    const analysis = await analyzePdfForPlacement(bytes);

    expect(analysis.emptySigFields).toEqual([{ page: 0, x: 100, y: 100, w: 240, h: 72 }]);
  });

  it('atribuye cada widget a SU página', async () => {
    const bytes = await makePdfWithWidgets([
      [{ rect: [10, 10, 120, 60], signed: true }],
      [{ rect: [20, 20, 260, 92] }],
    ]);
    const analysis = await analyzePdfForPlacement(bytes);

    expect(analysis.existing.map((r) => r.page)).toEqual([0]);
    expect(analysis.emptySigFields.map((r) => r.page)).toEqual([1]);
  });

  it('un PDF ilegible no revienta: devuelve listas y geometría vacías', async () => {
    const garbage = new TextEncoder().encode('esto no es un PDF, ni de lejos');
    const analysis = await analyzePdfForPlacement(garbage);

    expect(analysis).toEqual({ geometry: [], existing: [], emptySigFields: [] });
  });
});
