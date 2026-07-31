/**
 * autoPlacement — endurecimiento D3 y D4.
 *
 * D3 · `fitsMediaBox` decía ser "réplica exacta" de `validateVisibleSig` pero no
 *      replicaba el mínimo de 30×30 (`visibleSig.ts:149`). Un rect diminuto
 *      pasaba el pre-chequeo y reventaba AL FIRMAR con `visible_sig_too_small`:
 *      el documento salía `failed` cuando la verdad era "hay que colocarla a
 *      mano". Dos vías reales de llegar ahí: un campo de firma vacío pequeño
 *      declarado por el propio PDF, y la caja encogida por el anti-solape
 *      (`Math.min(boxH, orientedH * 0.2)`, que en una página baja da < 30).
 *
 * D4 · El anti-solape NO garantizaba no solapar: sin hueco libre caía a un
 *      fallback centrado ENCIMA de la firma existente y devolvía
 *      `status:'ok', source:'anti-overlap'` — se firmaba tapando la firma
 *      anterior y se reportaba como éxito limpio.
 */

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIG_BOX_H,
  DEFAULT_SIG_BOX_W,
  type ExistingSigRect,
  computeAutoPlacement,
} from '../src/autoPlacement.js';
import { readPageGeometry } from '../src/pageGeometry.js';

const A4_W = 595.28;
const A4_H = 841.89;

/** Mínimo de legibilidad que impone `validateVisibleSig` (visibleSig.ts:108-109). */
const MIN_SIDE_PT = 30;

async function geometryFor(width: number, height: number) {
  const doc = await PDFDocument.create();
  doc.addPage([width, height]);
  return readPageGeometry(doc);
}

describe('D3 — el pre-chequeo replica el mínimo 30×30 de validateVisibleSig', () => {
  it('un campo de firma vacío diminuto se aparta a needs_review, no se intenta firmar', async () => {
    const geometry = await geometryFor(A4_W, A4_H);

    const placement = computeAutoPlacement({
      geometry,
      existing: [],
      // Ancho de sobra, alto por debajo del mínimo: exactamente lo que
      // `validateVisibleSig` rechaza con `visible_sig_too_small`.
      emptySigFields: [{ page: 0, x: 100, y: 100, w: 200, h: MIN_SIDE_PT - 1 }],
    });

    expect(placement.status).toBe('needs_review');
    if (placement.status !== 'needs_review') return;
    expect(placement.reason).toBe('empty_sig_field_rect_too_small');
  });

  it('un campo de firma vacío justo en el mínimo SÍ se acepta (la guarda no se pasa de celo)', async () => {
    const geometry = await geometryFor(A4_W, A4_H);

    const placement = computeAutoPlacement({
      geometry,
      existing: [],
      emptySigFields: [{ page: 0, x: 100, y: 100, w: MIN_SIDE_PT, h: MIN_SIDE_PT }],
    });

    expect(placement.status).toBe('ok');
    if (placement.status !== 'ok') return;
    expect(placement.source).toBe('empty-field');
  });

  it('la caja que el anti-solape encoge por debajo de 30 pt de alto se aparta, no revienta al firmar', async () => {
    // Página baja a propósito: el anti-solape hace `h = min(boxH, orientedH*0.2)`,
    // así que con 140 pt de alto la caja queda en 28 pt — por debajo del mínimo.
    const shortPageHeight = 140;
    expect(shortPageHeight * 0.2).toBeLessThan(MIN_SIDE_PT);
    const geometry = await geometryFor(A4_W, shortPageHeight);
    const existing: ExistingSigRect[] = [{ page: 0, x: 18, y: 18, w: 120, h: 40 }];

    const placement = computeAutoPlacement({ geometry, existing });

    expect(placement.status).toBe('needs_review');
    if (placement.status !== 'needs_review') return;
    // Sea por tamaño o porque en una página así tampoco queda hueco, lo que NO
    // puede pasar es que salga un 'ok' con un rect que el firmante rechazará.
    expect(['anti_overlap_rect_too_small', 'no_free_slot']).toContain(placement.reason);
  });

  it('un pie de página que no llega al mínimo se aparta con su propio motivo', async () => {
    // Página más baja que el propio cuadro de firma: el pie no cabe.
    const geometry = await geometryFor(A4_W, DEFAULT_SIG_BOX_H);

    const placement = computeAutoPlacement({ geometry, existing: [] });

    expect(placement.status).toBe('needs_review');
    if (placement.status !== 'needs_review') return;
    expect(placement.reason).toContain('default_footer_');
  });

  it('ningún resultado ok puede tener un lado por debajo del mínimo', async () => {
    const geometry = await geometryFor(A4_W, A4_H);
    const placement = computeAutoPlacement({ geometry, existing: [], boxW: 20, boxH: 20 });

    if (placement.status === 'ok') {
      expect(placement.w).toBeGreaterThanOrEqual(MIN_SIDE_PT);
      expect(placement.h).toBeGreaterThanOrEqual(MIN_SIDE_PT);
    } else {
      expect(placement.reason).toBe('default_footer_rect_too_small');
    }
  });
});

describe('D4 — sin hueco libre se aparta el documento; jamás se firma encima', () => {
  /** Firmas previas que ocupan toda la página en rejilla, sin dejar hueco. */
  function fillPage(width: number, height: number): ExistingSigRect[] {
    const rects: ExistingSigRect[] = [];
    const step = 40;
    for (let y = 0; y + step <= height; y += step) {
      for (let x = 0; x + step <= width; x += step) {
        rects.push({ page: 0, x, y, w: step, h: step });
      }
    }
    return rects;
  }

  it('una página saturada de firmas previas da needs_review con motivo no_free_slot', async () => {
    const geometry = await geometryFor(A4_W, A4_H);
    const existing = fillPage(A4_W, A4_H);

    const placement = computeAutoPlacement({ geometry, existing });

    expect(placement.status).toBe('needs_review');
    if (placement.status !== 'needs_review') return;
    expect(placement.reason).toBe('no_free_slot');
    expect(placement.page).toBe(0);
  });

  it('cuando devuelve ok por anti-solape, el rect NO solapa ninguna firma previa', async () => {
    const geometry = await geometryFor(A4_W, A4_H);
    const existing: ExistingSigRect[] = [
      { page: 0, x: 18, y: 18, w: DEFAULT_SIG_BOX_W, h: DEFAULT_SIG_BOX_H },
    ];

    const placement = computeAutoPlacement({ geometry, existing });

    expect(placement.status).toBe('ok');
    if (placement.status !== 'ok') return;
    expect(placement.source).toBe('anti-overlap');
    for (const previous of existing) {
      const disjoint =
        placement.x + placement.w <= previous.x ||
        previous.x + previous.w <= placement.x ||
        placement.y + placement.h <= previous.y ||
        previous.y + previous.h <= placement.y;
      expect(disjoint).toBe(true);
    }
  });

  it('el motivo no_free_slot es estable y determinista (misma entrada → misma salida)', async () => {
    const geometry = await geometryFor(A4_W, A4_H);
    const existing = fillPage(A4_W, A4_H);

    const first = computeAutoPlacement({ geometry, existing });
    const second = computeAutoPlacement({ geometry, existing });

    expect(first).toEqual(second);
  });
});
