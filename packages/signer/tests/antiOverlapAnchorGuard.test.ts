/**
 * antiOverlapAnchorGuard.test.ts — 3 hallazgos de una doble revisión QA
 * (code-reviewer + silent-failure-hunter, ambos EJECUTANDO reproducciones
 * reales) sobre `computeAntiOverlapPlacement`/`tryAnchorPlacement`, todos
 * activados por primera vez en producción por F2a (el hint de propagación de
 * posición de lote, `kind: 'lote-propagacion'`).
 *
 * (P0) `computeAntiOverlapPlacement` metía `anchor.preferredV`/`preferredU`
 *      como candidato preferente en `enumerateSlots`, que valida el solape en
 *      la posición SIN acotar. Después hacía `clampRect(...)` y devolvía ese
 *      rect acotado sin volver a comprobar nada contra los mismos obstáculos.
 *      `tryAnchorPlacement` ya tenía el guard correcto (`clampAndRevalidate`,
 *      hallazgo QA post-merge anterior); nunca se replicó aquí.
 *
 * (P1 rango) Ningún camino con ancla validaba que `preferredV`/`preferredU`
 *      fueran finitos y `preferredV` cayera dentro de `[0, orientedH]` de la
 *      página del ancla. Un hint corrupto se clampaba en silencio a la cima
 *      de la página y salía `status:'ok'` sin ninguna señal de que el hint
 *      era basura.
 *
 * (P1 eje u) `tryAnchorPlacement` decidía "honrado" comparando SOLO `v`. Si
 *      `preferredU` no era alcanzable en esa página, el motor igual aceptaba
 *      con `source:'text-anchor'`, con la firma corrida en el eje horizontal
 *      respecto a lo pedido.
 */
import { describe, expect, it } from 'vitest';

import {
  type AnchorPlacementHint,
  type ComputeAutoPlacementOpts,
  type ExistingSigRect,
  computeAutoPlacement,
} from '../src/autoPlacement.js';
import type { PageGeometry } from '../src/pageGeometry.js';

/** Página A4-ish redonda (612×792), sin recorte ni rotación. */
function geo(over: Partial<PageGeometry> = {}): PageGeometry {
  return {
    page: 0,
    mediaW: 612,
    mediaH: 792,
    mediaX: 0,
    mediaY: 0,
    visX: 0,
    visY: 0,
    visW: 612,
    visH: 792,
    rotate: 0,
    ...over,
  };
}

/** ¿Se solapan dos rects absolutos, SIN ninguna holgura? Chequeo puro AABB. */
function rectsOverlapPlain(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

describe('P0 (QA post-merge, EJECUTANDO): computeAntiOverlapPlacement debe revalidar tras clampRect', () => {
  it('repro exacto del hallazgo: preferredV=5 (bajo EDGE_MARGIN) ya no puede salir "ok" solapando la firma previa', () => {
    // Repro dado por los revisores: dos firmas previas en la página 0, un
    // hint de ancla que pide un `v` justo debajo de EDGE_MARGIN (18) --
    // exactamente lo típico de un rect que un humano confirmó cerca del pie
    // de la página en OTRO documento del lote (F2a).
    const existing: ExistingSigRect[] = [
      { page: 0, x: 18, y: 85, w: 240, h: 60 },
      { page: 0, x: 300, y: 700, w: 200, h: 60 },
    ];
    const anchor: AnchorPlacementHint = {
      page: 0,
      preferredV: 5,
      preferredU: 18,
      kind: 'lote-propagacion',
    };
    const opts: ComputeAutoPlacementOpts = { geometry: [geo()], existing, anchor };

    const placement = computeAutoPlacement(opts);

    if (placement.status === 'ok') {
      const rect = { x: placement.x, y: placement.y, w: placement.w, h: placement.h };
      // La firma previa que el defecto pisaba (85..145 en `y`, 18..258 en
      // `x`). Antes del fix: `x=18, y=18` -- EXACTAMENTE dentro de este rect.
      const overlapsExisting0 = rectsOverlapPlain(rect, existing[0]!);
      expect(overlapsExisting0).toBe(false);
      // Y el rect concreto que el defecto producía tampoco puede volver a
      // salir: es la firma de que el guard de verdad cambió el resultado, no
      // que el test sea vacuamente permisivo.
      expect(rect).not.toEqual({ x: 18, y: 18, w: 240, h: 72 });
    } else {
      // Declinar también es una respuesta correcta: mejor `needs_review` que
      // una colocación que pisa una firma previa.
      expect(placement.status).toBe('needs_review');
      expect(placement.reason).toBe('no_free_slot');
    }
  });

  it('si coloca, `survey.clearance` describe el rect FINAL (tras acotar), no el candidato sin acotar', () => {
    const existing: ExistingSigRect[] = [
      { page: 0, x: 18, y: 85, w: 240, h: 60 },
      { page: 0, x: 300, y: 700, w: 200, h: 60 },
    ];
    const anchor: AnchorPlacementHint = {
      page: 0,
      preferredV: 5,
      preferredU: 18,
      kind: 'lote-propagacion',
    };
    const placement = computeAutoPlacement({ geometry: [geo()], existing, anchor });
    if (placement.status !== 'ok' || !placement.survey) return;

    const rect = { x: placement.x, y: placement.y, w: placement.w, h: placement.h };
    // Separación real (pt) del rect FINAL contra cada obstáculo -- el mismo
    // criterio que `separation()` en `autoPlacement.ts`, calculado aquí de
    // forma independiente para no reusar la función bajo prueba.
    const realClearance = Math.min(
      ...existing.map((r) =>
        Math.max(r.x - (rect.x + rect.w), rect.x - (r.x + r.w), r.y - (rect.y + rect.h), rect.y - (r.y + r.h)),
      ),
    );
    expect(placement.survey.clearance).toBeCloseTo(realClearance, 5);
    // Antes del fix, `clearance` se medía sobre el candidato SIN acotar
    // (y=5), que reportaba 8pt de holgura -- positivo -- mientras el rect
    // final (y=18, solapando) tenía holgura NEGATIVA de verdad. Un
    // `clearance` que describe el rect final nunca puede ser positivo si el
    // propio rect solapa un obstáculo.
    const overlapsAny = existing.some((r) => rectsOverlapPlain(rect, r));
    if (overlapsAny) expect(placement.survey.clearance).toBeLessThanOrEqual(0);
  });
});

describe('P1 (QA post-merge): rango de preferredV/preferredU se sanea en un único punto de entrada', () => {
  it('preferredV no finito, o fuera de [0, orientedH], deja al ancla FUERA del cómputo por completo', () => {
    const existing: ExistingSigRect[] = [{ page: 0, x: 18, y: 18, w: 240, h: 72 }];
    const baseline = computeAutoPlacement({ geometry: [geo()], existing });

    const corruptedAnchors: AnchorPlacementHint[] = [
      { page: 0, preferredV: 5000, kind: 'lote-propagacion' }, // fuera de [0, 792]
      { page: 0, preferredV: Number.POSITIVE_INFINITY, kind: 'lote-propagacion' },
      { page: 0, preferredV: Number.NaN, kind: 'lote-propagacion' },
      { page: 0, preferredV: -100, kind: 'lote-propagacion' },
      { page: 0, preferredV: 100, preferredU: Number.NaN, kind: 'lote-propagacion' },
    ];

    for (const anchor of corruptedAnchors) {
      const withAnchor = computeAutoPlacement({ geometry: [geo()], existing, anchor });
      // Byte a byte igual que sin ancla conectado: el hint corrupto no debe
      // colar ni un campo distinto, ni un `reason` que confunda el problema
      // real con uno inventado por el ancla.
      expect(withAnchor).toEqual(baseline);
    }
  });

  it('un preferredV VÁLIDO en el mismo escenario sí sigue participando (control positivo, el saneamiento no apaga el ancla entera)', () => {
    const existing: ExistingSigRect[] = [{ page: 0, x: 18, y: 18, w: 240, h: 72 }];
    const anchor: AnchorPlacementHint = { page: 0, preferredV: 300, kind: 'lote-propagacion' };

    const withAnchor = computeAutoPlacement({ geometry: [geo()], existing, anchor });
    const baseline = computeAutoPlacement({ geometry: [geo()], existing });

    expect(withAnchor.status).toBe('ok');
    if (withAnchor.status !== 'ok') return;
    expect(withAnchor.source).toBe('text-anchor');
    expect(withAnchor).not.toEqual(baseline);
  });
});

describe('P1 (QA post-merge): el eje u también debe estar cerca del ancla para contar como "honrado"', () => {
  it('un preferredU inalcanzable en la página (página angosta) no se acepta solo porque v coincide exacto', () => {
    // Página angosta (300pt de ancho, como en `anchorPlacementTable.test.ts`):
    // con el cuadro por defecto (240pt de ancho) un `preferredU=200` exige
    // `200+240=440 <= 300-18=282`, imposible -- `enumerateSlots` lo descarta
    // de sus candidatos `u` y el hueco más cercano en `v` termina con
    // `u=18` (el margen izquierdo), a 182pt de los 200 pedidos.
    const narrow = geo({ mediaW: 300, visW: 300 });
    // Un obstáculo diminuto en la esquina superior: sin él, `onPage` queda
    // vacío y `enumerateSlots` corta en seco (early return) antes de que este
    // escenario pueda ni siquiera enumerar candidatos.
    const existing: ExistingSigRect[] = [{ page: 0, x: 0, y: 770, w: 5, h: 5 }];
    const anchor: AnchorPlacementHint = {
      page: 0,
      preferredV: 18, // coincide EXACTO con el primer candidato de v (EDGE_MARGIN)
      preferredU: 200,
      kind: 'firmante-nombre', // ancla PERSONALIZADA -- rama 1.5, tolerancia de v 0.01
    };

    const placement = computeAutoPlacement({ geometry: [narrow], existing, anchor });

    // Antes del fix esto salía `ok`/`text-anchor` con `x=18` -- a 182pt del
    // `preferredU=200` pedido -- porque solo se comparaba `v`. Ahora, sin un
    // `u` alcanzable cerca del pedido, el ancla no cuenta como honrada.
    if (placement.status === 'ok') {
      expect(placement.source).not.toBe('text-anchor');
    }
  });

  it('control positivo: el mismo escenario con preferredU alcanzable (u=18) SÍ se honra', () => {
    const narrow = geo({ mediaW: 300, visW: 300 });
    const existing: ExistingSigRect[] = [{ page: 0, x: 0, y: 770, w: 5, h: 5 }];
    const anchor: AnchorPlacementHint = {
      page: 0,
      preferredV: 18,
      preferredU: 18,
      kind: 'firmante-nombre',
    };

    const placement = computeAutoPlacement({ geometry: [narrow], existing, anchor });

    expect(placement.status).toBe('ok');
    if (placement.status !== 'ok') return;
    expect(placement.source).toBe('text-anchor');
    expect(placement.x).toBeCloseTo(18, 5);
  });
});
