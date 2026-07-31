/**
 * Defectos del análisis previo a la colocación automática del lote.
 *
 *   A2 · `/V` se miraba SOLO en el widget, pero es heredable por `/Parent`
 *        igual que `/FT` (PDF 32000-1 §12.7.3.1) — y `/FT` sí se resolvía
 *        subiendo. Los productores que separan campo y widget ponen `/V` en el
 *        padre: el análisis daba `existing = []` y clasificaba una firma YA
 *        PUESTA como "campo de firma vacío", así que la colocación elegía
 *        `source:'empty-field'` con el rect EXACTO de la firma existente y se
 *        firmaba encima. Y `empty-field` tiene prioridad, así que ganaba sobre
 *        todo lo demás.
 *
 *   A6 · Un PDF cifrado se analizaba con `ignoreEncryption:true` y salía "ok",
 *        pero `pades.ts` carga SIN esa opción, así que la firma reventaba
 *        siempre — el documento acababa como error genérico en vez de
 *        apartado. Y un PDF ilegible se traducía a `document_has_no_pages`,
 *        que es falso: no es que no tenga páginas, es que no se pudo abrir.
 *
 * Ningún test preexistente se modifica: este fichero es nuevo.
 */

import { PDFDict, PDFDocument, PDFName, type PDFRef } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { analyzePdfForPlacement } from '../src/analyzePdf.js';
import { computeAutoPlacement } from '../src/autoPlacement.js';

const PAGE_W = 595.28;
const PAGE_H = 841.89;

/** Rect de la firma ya puesta que la auditoría midió. */
const PRIOR_RECT = { x: 40, y: 50, w: 160, h: 60 };

/**
 * PDF cuyo widget de firma NO lleva `/FT` ni `/V` propios: ambos viven en el
 * `/Parent` (campo AcroForm separado del widget). Es exactamente lo que
 * producen las herramientas que separan campo y widget.
 */
async function buildInheritedValueSigPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const ctx = doc.context;

  const sigValueRef = ctx.register(ctx.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite' }));

  const parentRef = ctx.nextRef();
  const widgetRef = ctx.nextRef();

  ctx.assign(
    parentRef,
    ctx.obj({
      FT: 'Sig',
      T: 'Firma1',
      V: sigValueRef,
      Kids: [widgetRef],
    }),
  );
  ctx.assign(
    widgetRef,
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      Parent: parentRef,
      F: 4,
      Rect: [PRIOR_RECT.x, PRIOR_RECT.y, PRIOR_RECT.x + PRIOR_RECT.w, PRIOR_RECT.y + PRIOR_RECT.h],
    }),
  );

  page.node.set(PDFName.of('Annots'), ctx.obj([widgetRef]));
  doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [parentRef as PDFRef], SigFlags: 3 }));

  return doc.save({ useObjectStreams: false });
}

/**
 * PDF marcado como cifrado. No hace falta cifrar de verdad: pdf-lib decide por
 * la presencia de `/Encrypt` en el trailer, y es esa decisión (y no el
 * algoritmo) la que hace reventar la firma.
 */
async function buildEncryptedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE_W, PAGE_H]);
  const bytes = await doc.save({ useObjectStreams: false });
  const patched = Buffer.from(bytes)
    .toString('latin1')
    .replace(
      'trailer\n<<',
      'trailer\n<< /Encrypt << /Filter /Standard /V 1 /R 2 /O <0102> /U <0304> /P -1 >>',
    );
  return new Uint8Array(Buffer.from(patched, 'latin1'));
}

describe('A2 — `/V` heredado del /Parent: la firma previa NO puede pasar por campo vacío', () => {
  it('el widget con /V en el padre cuenta como firma EXISTENTE, no como hueco libre', async () => {
    const analysis = await analyzePdfForPlacement(await buildInheritedValueSigPdf());

    expect(analysis.geometry).toHaveLength(1);
    expect(analysis.emptySigFields).toEqual([]);
    expect(analysis.existing).toHaveLength(1);
    expect(analysis.existing[0]).toMatchObject({ page: 0, ...PRIOR_RECT });
  });

  it('y por tanto la colocación NO reutiliza el rect de la firma existente', async () => {
    const analysis = await analyzePdfForPlacement(await buildInheritedValueSigPdf());
    const placement = computeAutoPlacement({
      geometry: analysis.geometry,
      existing: analysis.existing,
      emptySigFields: analysis.emptySigFields,
    });

    if (placement.status === 'ok') {
      expect(placement.source).not.toBe('empty-field');
      const overlapsPrior =
        placement.x < PRIOR_RECT.x + PRIOR_RECT.w &&
        PRIOR_RECT.x < placement.x + placement.w &&
        placement.y < PRIOR_RECT.y + PRIOR_RECT.h &&
        PRIOR_RECT.y < placement.y + placement.h;
      expect(overlapsPrior).toBe(false);
    }
  });
});

describe('A6 — cifrado e ilegible tienen motivo propio, no "no tiene páginas"', () => {
  it('un PDF cifrado se reporta como tal y acaba en needs_review con motivo propio', async () => {
    const analysis = await analyzePdfForPlacement(await buildEncryptedPdf());
    expect(analysis.failure).toBe('encrypted');

    const placement = computeAutoPlacement({
      geometry: analysis.geometry,
      existing: analysis.existing,
      emptySigFields: analysis.emptySigFields,
      failure: analysis.failure,
    });
    expect(placement).toEqual({
      status: 'needs_review',
      page: 0,
      reason: 'document_encrypted',
    });
  });

  it('un PDF corrupto no se confunde con uno de cero páginas', async () => {
    const garbage = new Uint8Array(512).fill(0x41);
    garbage.set(new TextEncoder().encode('%PDF-1.7\n'), 0);
    const analysis = await analyzePdfForPlacement(garbage);
    expect(analysis.failure).toBe('unreadable');

    const placement = computeAutoPlacement({
      geometry: analysis.geometry,
      existing: analysis.existing,
      emptySigFields: analysis.emptySigFields,
      failure: analysis.failure,
    });
    expect(placement).toEqual({
      status: 'needs_review',
      page: 0,
      reason: 'document_unreadable',
    });
  });

  it('un PDF sano no declara fallo alguno', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([PAGE_W, PAGE_H]);
    const analysis = await analyzePdfForPlacement(await doc.save({ useObjectStreams: false }));
    expect(analysis.failure).toBeUndefined();
    expect(analysis.geometry).toHaveLength(1);
  });
});

describe('A2 — la herencia de /V no rompe el caso normal', () => {
  it('un campo de firma REALMENTE vacío (sin /V en la cadena) sigue siendo hueco libre', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const ctx = doc.context;
    const parentRef = ctx.nextRef();
    const widgetRef = ctx.nextRef();
    ctx.assign(parentRef, ctx.obj({ FT: 'Sig', T: 'Vacio1', Kids: [widgetRef] }));
    ctx.assign(
      widgetRef,
      ctx.obj({
        Type: 'Annot',
        Subtype: 'Widget',
        Parent: parentRef,
        F: 4,
        Rect: [100, 100, 300, 180],
      }),
    );
    page.node.set(PDFName.of('Annots'), ctx.obj([widgetRef]));

    const analysis = await analyzePdfForPlacement(await doc.save({ useObjectStreams: false }));
    expect(analysis.existing).toEqual([]);
    expect(analysis.emptySigFields).toHaveLength(1);
  });

  it('un /Parent cíclico no cuelga el análisis', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const ctx = doc.context;
    const aRef = ctx.nextRef();
    const bRef = ctx.nextRef();
    ctx.assign(aRef, ctx.obj({ FT: 'Sig', Parent: bRef }));
    ctx.assign(
      bRef,
      ctx.obj({
        Type: 'Annot',
        Subtype: 'Widget',
        Parent: aRef,
        Rect: [10, 10, 210, 90],
      }),
    );
    // El widget de la página es `b`; su cadena /Parent vuelve sobre sí misma.
    page.node.set(PDFName.of('Annots'), ctx.obj([bRef]));
    const dict = ctx.lookup(bRef, PDFDict);
    expect(dict).toBeInstanceOf(PDFDict);

    const analysis = await analyzePdfForPlacement(await doc.save({ useObjectStreams: false }));
    expect(analysis.existing.length + analysis.emptySigFields.length).toBe(1);
  });
});
