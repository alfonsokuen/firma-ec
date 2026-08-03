/**
 * propagationPlacementTable.test.ts — F2a: `AnchorPlacementKind` gana el
 * miembro `'lote-propagacion'` y se exporta `toCanonicalRect`. NINGÚN
 * consumidor real corre todavía (F2, capa PWA, viene después) — este archivo
 * es la prueba de que el motor ya está listo para recibirlo sin haber tocado
 * ninguna rama de lógica: `computeAutoPlacement` trata `'lote-propagacion'`
 * exactamente igual que trataría cualquier `AnchorPlacementKind` que no sea
 * `'firma-label'` (la rama de la línea ~1248 de `autoPlacement.ts` no
 * distingue KINDS más allá de ese único `!==`).
 *
 * Fixtures sintéticos con geometría directa (mismo estilo que
 * `anchorRescue.test.ts`) — no hace falta un PDF real para ejercitar
 * `computeAutoPlacement`, que es puramente geometría + bandas de texto.
 *
 * `toCanonicalRect` primero: la garantía que hace posible F2 es que el hint de
 * posición se calcule canonicalizando el RECT completo que un humano confirmó
 * en otro documento, no una sola esquina con `toCanonical` (incorrecto en
 * páginas rotadas — ver el comentario de `toCanonicalRect` en
 * `autoPlacement.ts`).
 */
import { describe, expect, it } from 'vitest';

// Este tipo de opciones no forma parte del barrel público (solo lo consumen
// llamadores dentro del propio paquete) -- se importa por ruta profunda a
// propósito, a diferencia de `toCanonicalRect`/`AnchorPlacementHint`/
// `computeAutoPlacement`, que SÍ son la interfaz que `apps/pwa` va a usar.
import { type ComputeAutoPlacementOpts, toCanonical } from '../src/autoPlacement.js';
import {
  type AnchorPlacementHint,
  DEFAULT_SIG_BOX_H,
  DEFAULT_SIG_BOX_W,
  computeAutoPlacement,
  toCanonicalRect,
} from '../src/index.js';
import type { PageGeometry } from '../src/pageGeometry.js';
import type { TextBand } from '../src/textBands.js';

/** Página A4-ish redonda (612×792) — mismo helper que `anchorRescue.test.ts`. */
function geo(page: number, rotate: 0 | 90 | 180 | 270 = 0): PageGeometry {
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
    rotate,
  };
}

function describePlacement(p: ReturnType<typeof computeAutoPlacement>): string {
  return p.status === 'ok'
    ? `ok p${p.page} x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} w=${p.w.toFixed(2)} h=${p.h.toFixed(2)} ${p.source}${p.anchorKind ? `(${p.anchorKind})` : ''}`
    : `REVIEW p${p.page} ${p.reason}`;
}

describe('toCanonicalRect — canonicaliza el RECT completo, no una esquina', () => {
  it('en una página con /Rotate 180, difiere de canonicalizar solo la esquina (x,y) con toCanonical', () => {
    const rotated = geo(0, 180);
    // Rect absoluto que un humano confirmó a mano: esquina inferior-izquierda
    // (20,427), 216×70.
    const rect = { x: 20, y: 427, w: 216, h: 70 };

    const canonRect = toCanonicalRect(rotated, rect);
    const canonPointOnly = toCanonical(rotated, rect.x, rect.y);

    // El rect completo (mínimo sobre ambas esquinas transformadas) da un
    // resultado bien distinto de canonicalizar solo la esquina (x,y) --
    // en rotate=180 esa esquina deja de ser la "mínima" en espacio canónico.
    expect(canonRect).toEqual({ x: 376, y: 295, w: 216, h: 70 });
    expect(canonPointOnly).toEqual({ u: 592, v: 365 });
    expect(canonRect.x).not.toBeCloseTo(canonPointOnly.u, 0);
    expect(canonRect.y).not.toBeCloseTo(canonPointOnly.v, 0);
  });

  it('en rotate=0 (identidad), coincide con canonicalizar la esquina — caso trivial de control', () => {
    const flat = geo(0, 0);
    const rect = { x: 20, y: 427, w: 216, h: 70 };
    expect(toCanonicalRect(flat, rect)).toEqual({ x: 20, y: 427, w: 216, h: 70 });
  });
});

/**
 * Tabla congelada: `computeAutoPlacement` con `anchor.kind: 'lote-propagacion'`
 * frente a la misma llamada sin `anchor`. Cada fila es un escenario distinto
 * (no variaciones de un mismo documento, a diferencia de
 * `anchorPlacementTable.test.ts`), así que el "fixture" de cada fila es la
 * función que lo arma, no un `content` de PDF compartido.
 */

describe('(a) mismo hueco libre que pide el hint → se honra, dentro de 0.01pt en v', () => {
  it('el rect confirmado a mano en OTRO documento del lote reproduce la MISMA posición aquí', () => {
    // El rect que un humano confirmó en el primer documento del lote, en
    // coordenadas absolutas de esa página (rotate=0, así que canonicalizar
    // es identidad -- la rotación real ya está cubierta arriba).
    const confirmedRect = { x: 20, y: 427, w: 216, h: 70 };
    const hintCanon = toCanonicalRect(geo(0), confirmedRect);
    const anchor: AnchorPlacementHint = {
      page: 0,
      preferredV: hintCanon.y,
      preferredU: hintCanon.x,
      kind: 'lote-propagacion',
    };
    // Mismo formato de página, misma banda de texto -- el hueco libre real es
    // idéntico al del primer documento.
    const textBands: TextBand[] = [{ page: 0, y: 400, h: 20 }];
    const opts: ComputeAutoPlacementOpts = { geometry: [geo(0)], existing: [], textBands, anchor };

    const placement = computeAutoPlacement(opts);

    expect(placement.status).toBe('ok');
    if (placement.status !== 'ok') return;
    expect(placement.source).toBe('text-anchor');
    expect(placement.anchorKind).toBe('lote-propagacion');
    expect(placement.page).toBe(0);
    expect(placement.x).toBeCloseTo(hintCanon.x, 5);
    // `toBeCloseTo(x, 2)` exige |diff| < 0.005, no "dentro de 0.01pt" -- la
    // holgura real que Vitest aplica en precisión 2.
    expect(placement.y).toBeCloseTo(hintCanon.y, 2);
    // El TAMAÑO no viaja en el hint (`AnchorPlacementHint` solo trae
    // `preferredU`/`preferredV`): aunque el rect confirmado fuera 216×70, la
    // estampa sale con el tamaño por defecto porque nadie pasó `boxW`/`boxH`
    // en `opts`. Pasarlos es responsabilidad del LLAMADOR (F2, capa PWA), no
    // de este hint -- por eso el tamaño confirmado no se reproduce aquí.
    expect(placement.w).toBe(DEFAULT_SIG_BOX_W);
    expect(placement.h).toBe(DEFAULT_SIG_BOX_H);
  });
});

describe('(b) sitio del hint ocupado por una banda de texto, sin firmas previas → idéntico a la línea base', () => {
  it('CON hint y SIN hint dan el resultado BYTE A BYTE idéntico (nunca peor que la línea base)', () => {
    // Garantía ACOTADA a documentos sin firmas previas (existing: []): con
    // firmas previas visibles, el hint sí puede sesgar el anti-solape (ver
    // caso (c)) -- ahí la garantía de "nunca peor" no aplica por diseño.
    const textBands: TextBand[] = [{ page: 0, y: 600, h: 50 }];
    // preferredV=615 cae DENTRO de la banda [600,650]: el sitio que el hint
    // pide está ocupado, así que `tryAnchorPlacement` no encuentra un
    // candidato exacto ahí (tolerancia 0.01) y el pipeline normal decide,
    // igual que si no hubiera hint.
    const anchor: AnchorPlacementHint = { page: 0, preferredV: 615, kind: 'lote-propagacion' };
    const withHint: ComputeAutoPlacementOpts = {
      geometry: [geo(0)],
      existing: [],
      textBands,
      anchor,
    };
    const withoutHint: ComputeAutoPlacementOpts = { geometry: [geo(0)], existing: [], textBands };

    const placementWithHint = computeAutoPlacement(withHint);
    const placementWithoutHint = computeAutoPlacement(withoutHint);

    expect(placementWithHint).toEqual(placementWithoutHint);
    expect(placementWithoutHint.status).toBe('ok');
    if (placementWithoutHint.status !== 'ok') return;
    expect(placementWithoutHint.source).toBe('free-space');
  });
});

describe('(c) firma previa visible + hint → rama que SÍ cambia de comportamiento a propósito', () => {
  it('congelado: el hint gana sobre el barrido normal de anti-solape cuando su sitio está libre', () => {
    // A diferencia de (b), aquí SÍ hay una firma previa visible. El hint
    // apunta a un hueco (v=300) que queda libre frente a esa firma (y=20..80)
    // -- `tryAnchorPlacement` (paso 1.5, que corre ANTES del anti-solape para
    // cualquier kind !== 'firma-label') lo acepta directamente, porque
    // `enumerateSlots` siempre prueba el `preferredV` como candidato propio.
    // Verificado leyendo `autoPlacement.ts`: el paso 1.5 nunca compara contra
    // `reservedGapV` ni contra el sesgo interno de `computeAntiOverlapPlacement`
    // -- gana ANTES de que ese código se ejecute siquiera. Es la rama que F2
    // (capa PWA) va a activar por primera vez en producción: el pipeline YA
    // hacía esto para anclas de texto (FASE 3); F2a solo le da un `kind`
    // nuevo para que el llamador pueda distinguir el origen del hint.
    const existing = [{ page: 0, x: 20, y: 20, w: 216, h: 60 }];
    const anchor: AnchorPlacementHint = { page: 0, preferredV: 300, kind: 'lote-propagacion' };
    const withHint: ComputeAutoPlacementOpts = { geometry: [geo(0)], existing, anchor };
    const withoutHint: ComputeAutoPlacementOpts = { geometry: [geo(0)], existing };

    const placementWithHint = computeAutoPlacement(withHint);
    const placementWithoutHint = computeAutoPlacement(withoutHint);

    expect(describePlacement(placementWithHint)).toBe(
      'ok p0 x=18.00 y=300.00 w=240.00 h=72.00 text-anchor(lote-propagacion)',
    );
    expect(describePlacement(placementWithoutHint)).toBe(
      'ok p0 x=250.00 y=20.00 w=240.00 h=72.00 anti-overlap',
    );
    // No es una regresión de F2a: es comportamiento HEREDADO de la FASE 3
    // (parte D, medida sobre 82 contratos reales) que F2a simplemente activa
    // con una fuente de hint distinta.
    expect(placementWithHint).not.toEqual(placementWithoutHint);
  });
});

describe('(d) campo de firma vacío + hint → el campo vacío gana SIEMPRE', () => {
  it('emptySigFields se respeta tal cual; el hint ni se evalúa', () => {
    const anchor: AnchorPlacementHint = { page: 0, preferredV: 500, kind: 'lote-propagacion' };
    const emptySigFields = [{ page: 0, x: 20, y: 700, w: 200, h: 50 }];

    const placement = computeAutoPlacement({
      geometry: [geo(0)],
      existing: [],
      emptySigFields,
      anchor,
    });

    expect(placement.status).toBe('ok');
    if (placement.status !== 'ok') return;
    expect(placement.source).toBe('empty-field');
    expect(placement.x).toBe(20);
    expect(placement.y).toBe(700);
    expect(placement.w).toBe(200);
    expect(placement.h).toBe(50);
  });
});

describe('(e) hint apunta a una página que el documento no tiene → degrada a sin-hint, nunca error', () => {
  it('mismo resultado con y sin hint -- jamás needs_review artificial ni excepción', () => {
    const textBands: TextBand[] = [{ page: 0, y: 600, h: 50 }];
    // El documento tiene una sola página (índice 0); el hint apunta a la 5,
    // que no existe -- `tryAnchorPlacement` busca la geometría de esa página
    // (`geometry.find`), no la encuentra, y devuelve `null` sin lanzar.
    const anchor: AnchorPlacementHint = { page: 5, preferredV: 100, kind: 'lote-propagacion' };
    const withHint: ComputeAutoPlacementOpts = {
      geometry: [geo(0)],
      existing: [],
      textBands,
      anchor,
    };
    const withoutHint: ComputeAutoPlacementOpts = { geometry: [geo(0)], existing: [], textBands };

    expect(() => computeAutoPlacement(withHint)).not.toThrow();
    const placementWithHint = computeAutoPlacement(withHint);
    const placementWithoutHint = computeAutoPlacement(withoutHint);

    expect(placementWithHint).toEqual(placementWithoutHint);
    expect(placementWithHint.status).toBe('ok');
  });
});
