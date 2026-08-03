/**
 * anchorRescue.test.ts — el ancla GENÉRICA ("Firma"/"f)"/"firmado por", sin
 * nombre ni cédula que la respalde) como RESCATE, no como prioridad.
 *
 * Medido sobre el corpus real (1.458 PDFs): con la ancla genérica anteponiendo
 * incondicionalmente `tryAnchorPlacement` a `free-space` (rama 2.5, ahora
 * eliminada), no se cerraba NINGUNO de los 143 documentos sin colocación, y la
 * confianza `alta` bajaba de 62,2% a 59,6% en los 1.315 documentos que ya se
 * colocaban bien — el ancla los desplazaba hacia su propio texto, más cerca de
 * obstáculos y con menos aire.
 *
 * Este fichero prueba el rediseño puro (`computeAutoPlacement` con geometría
 * sintética, sin pasar por un PDF real):
 *   (a) anti-solape da `no_free_slot`, pero el ancla rescata un hueco a ~50pt.
 *   (b) el hueco más cercano al ancla está a >144pt (`2×boxH`) — NO se rescata.
 *   (c) un documento que YA se coloca por `free-space` —el rescate ni se
 *       invoca— sale con el rect IDÉNTICO con y sin `opts.anchor` conectado.
 *   (d) la rama de ancla PERSONALIZADA (nombre/cédula) sigue exigiendo match
 *       exacto (tolerancia `0.01`), nunca la tolerancia laxa del rescate.
 */
import { describe, expect, it } from 'vitest';

import {
  type AnchorPlacementHint,
  type ComputeAutoPlacementOpts,
  computeAutoPlacement,
} from '../src/autoPlacement.js';
import type { PageGeometry } from '../src/pageGeometry.js';
import type { TextBand } from '../src/textBands.js';

/** Página A4-ish redonda (612×792), sin recorte ni rotación — cifras limpias. */
function geo(page: number): PageGeometry {
  return {
    page,
    mediaW: 612,
    mediaH: 792,
    mediaX: 0,
    mediaY: 0,
    visX: 0,
    visY: 0,
    visW: 612,
    visH: 792,
    rotate: 0,
  };
}

/**
 * Página 0: "empaquetada" a propósito — una única banda de texto que cubre el
 * folio entero (además de una firma previa diminuta, irrelevante frente a la
 * banda) — para que ni el anti-solape ni el rescate puedan encontrar hueco
 * AHÍ. El propósito de esta página es solo forzar `no_free_slot` en el
 * anti-solape; el hueco de verdad vive en la página del ancla.
 */
const PAGE0_FULL_BAND: TextBand = { page: 0, y: 0, h: 792 };
const PAGE0_EXISTING = [{ page: 0, x: 20, y: 20, w: 30, h: 15 }];

describe('rescate por ancla genérica — solo interviene tras un no_free_slot real', () => {
  it('(a) anti-solape da no_free_slot; el ancla rescata un hueco a ~47pt', () => {
    const anchor: AnchorPlacementHint = { page: 1, preferredV: 380, kind: 'firma-label' };
    const opts: ComputeAutoPlacementOpts = {
      geometry: [geo(0), geo(1)],
      existing: PAGE0_EXISTING,
      textBands: [PAGE0_FULL_BAND, { page: 1, y: 400, h: 20 }],
      anchor,
    };

    const placement = computeAutoPlacement(opts);

    expect(placement.status).toBe('ok');
    if (placement.status !== 'ok') return;
    expect(placement.source).toBe('text-anchor');
    expect(placement.anchorKind).toBe('firma-label');
    expect(placement.page).toBe(1);
    // El hueco elegido no es el primero que encontró el barrido (v=18, a
    // 362pt del ancla): es el MÁS CERCANO al ancla entre los enumerados
    // (v=427, a 47pt) — la prueba de que `tryAnchorPlacement` compara todos
    // los huecos y no se queda con `slots[0]`.
    expect(placement.y).toBeCloseTo(427, 5);
    expect(Math.abs(placement.y - anchor.preferredV)).toBeLessThan(50);
  });

  it('(b) el hueco más cercano al ancla está a >144pt (2×boxH) — no se rescata', () => {
    const anchor: AnchorPlacementHint = { page: 1, preferredV: 500, kind: 'firma-label' };
    const withAnchor: ComputeAutoPlacementOpts = {
      geometry: [geo(0), geo(1)],
      existing: PAGE0_EXISTING,
      textBands: [PAGE0_FULL_BAND, { page: 1, y: 400, h: 300 }],
      anchor,
    };
    const withoutAnchor: ComputeAutoPlacementOpts = {
      geometry: withAnchor.geometry,
      existing: withAnchor.existing,
      textBands: withAnchor.textBands,
    };

    const placement = computeAutoPlacement(withAnchor);
    const baseline = computeAutoPlacement(withoutAnchor);

    // El hueco más próximo (v=320.99) queda a 179pt del ancla — por encima de
    // `ANCHOR_RESCUE_TOLERANCE_PT` (2×72=144) — así que el rescate declina y
    // el documento se aparta EXACTAMENTE igual que sin el fix: mismo motivo,
    // misma encuesta, ni un campo distinto.
    expect(placement.status).toBe('needs_review');
    if (placement.status !== 'needs_review') return;
    expect(placement.reason).toBe('no_free_slot');
    expect(placement).toEqual(baseline);
  });
});

describe('el rescate nunca desplaza una colocación que ya funcionó', () => {
  it('(c) un documento que ya se coloca por free-space: rect idéntico con y sin ancla', () => {
    const geometry = [geo(0)];
    const textBands: TextBand[] = [{ page: 0, y: 600, h: 50 }];
    const base: Omit<ComputeAutoPlacementOpts, 'anchor'> = {
      geometry,
      existing: [],
      textBands,
    };
    // El ancla apunta a un `preferredV` cualquiera, deliberadamente lejos de
    // donde caerá la estampa: si el rescate se disparara aquí (no debería —
    // el pipeline normal nunca dijo `no_free_slot`), el rect se movería.
    const anchor: AnchorPlacementHint = { page: 0, preferredV: 999, kind: 'firma-label' };

    const withoutAnchor = computeAutoPlacement(base);
    const withAnchor = computeAutoPlacement({ ...base, anchor });

    expect(withoutAnchor.status).toBe('ok');
    if (withoutAnchor.status !== 'ok') return;
    expect(withoutAnchor.source).toBe('free-space');
    expect(withAnchor).toEqual(withoutAnchor);
  });
});

describe('la rama de ancla PERSONALIZADA sigue exigiendo match exacto (0.01), nunca la tolerancia del rescate', () => {
  it('(d) un hueco a 47pt del ancla NO se honra — cae a free-space, no a text-anchor', () => {
    const geometry = [geo(0)];
    const textBands: TextBand[] = [{ page: 0, y: 400, h: 20 }];
    // Mismo hueco a 47pt que el test (a) — pero esta vez el ancla es
    // PERSONALIZADA (`firmante-nombre`), no genérica. Con la tolerancia del
    // rescate (144pt) esto se habría honrado; con `0.01` (intocable, rama
    // 1.5) no.
    const anchor: AnchorPlacementHint = {
      page: 0,
      preferredV: 380,
      kind: 'firmante-nombre',
    };

    const placement = computeAutoPlacement({ geometry, existing: [], textBands, anchor });

    expect(placement.status).toBe('ok');
    if (placement.status !== 'ok') return;
    expect(placement.source).not.toBe('text-anchor');
    expect(placement.source).toBe('free-space');
    expect(placement.y).toBe(18);
  });

  it('control positivo: un match EXACTO (diff=0) sigue honrándose con la tolerancia de 0.01', () => {
    const geometry = [geo(0)];
    const textBands: TextBand[] = [{ page: 0, y: 400, h: 20 }];
    // v=427 es un candidato REAL que produce `enumerateSlots` para esta banda
    // (borde inferior + pad + GAP, ver el test (a)) — apuntar el ancla ahí
    // mismo es un match exacto, no una aproximación.
    const anchor: AnchorPlacementHint = {
      page: 0,
      preferredV: 427,
      kind: 'firmante-nombre',
    };

    const placement = computeAutoPlacement({ geometry, existing: [], textBands, anchor });

    expect(placement.status).toBe('ok');
    if (placement.status !== 'ok') return;
    expect(placement.source).toBe('text-anchor');
    expect(placement.anchorKind).toBe('firmante-nombre');
    expect(placement.y).toBeCloseTo(427, 5);
  });
});
