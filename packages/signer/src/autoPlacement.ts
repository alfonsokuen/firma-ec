/**
 * autoPlacement.ts — colocación automática de la firma visible para el flujo
 * de LOTES (sin humano por documento). Puro y determinista: misma entrada →
 * misma salida, sin `Date.now()` ni aleatoriedad.
 *
 * Resuelve, en este orden (spec §3.2):
 *   1. Campo de firma vacío (`/FT /Sig` sin `/V`) declarado por el documento.
 *   2. Anti-solape contra firmas visibles previas — mismo algoritmo (slot
 *      libre, banda por banda, holgura GAP/2) que
 *      `apps/pwa/src/ui/firma/smartPlacement.ts` → `computeSmartPlacement`,
 *      pero razonando sobre el área VISIBLE de la página y con la rotación
 *      aplicada.
 *   3. Pie de la última página (default de producto).
 *
 * ⚠️ Nota de arquitectura (desviación reportada, no silenciosa): la spec pide
 * "reutilizar" `computeSmartPlacement` importándolo. No es posible: la
 * dirección de dependencia del workspace es `apps/pwa → @firma-ec/signer`
 * (ver `apps/pwa/package.json`), nunca al revés — `packages/signer` no tiene
 * (ni debe tener) un edge hacia `apps/pwa`, y su `tsconfig.json` fija
 * `rootDir: "src"`, así que un import relativo cruzando a `apps/pwa` rompería
 * el build. Este módulo REIMPLEMENTA el mismo algoritmo de forma
 * autocontenida (mismas constantes, mismo criterio de holgura) en vez de
 * importarlo. Si las dos copias divergen en el futuro, es deuda a vigilar.
 *
 * Todo el cálculo ocurre en el área visible (`PageGeometry.visX/Y/W/H`, es
 * decir `CropBox ∩ MediaBox`), nunca sobre el MediaBox pelado — ese es
 * exactamente el defecto D2 que este módulo existe para no repetir.
 *
 * El resultado siempre se valida contra la MISMA comprobación que
 * `validateVisibleSig` (visibleSig.ts:143) antes de devolver `status: 'ok'`.
 * Esa comprobación asume implícitamente que el origen del MediaBox es (0,0)
 * — si no lo es, un rect correcto puede no "encajar" en esos términos; en ese
 * caso el resultado es `needs_review`, nunca un rect inválido ni una
 * excepción (spec §4 criterio 7).
 */

import type { PageGeometry } from './pageGeometry.js';

export type AutoPlacement =
  | {
      status: 'ok';
      page: number;
      x: number;
      y: number;
      w: number;
      h: number;
      rotate: 0 | 90 | 180 | 270;
      source: 'empty-field' | 'anti-overlap' | 'default-footer';
    }
  | { status: 'needs_review'; page: number; reason: string };

/** Un campo de firma `/FT /Sig` sin `/V` — su `/Rect` ya está en espacio de usuario. */
export interface EmptySigField {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rect de un widget de firma existente. `page` es 0-based. */
export interface ExistingSigRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ComputeAutoPlacementOpts {
  geometry: PageGeometry[];
  existing: ExistingSigRect[];
  emptySigFields?: EmptySigField[] | undefined;
  boxW?: number | undefined;
  boxH?: number | undefined;
}

/**
 * Tamaño por defecto del cuadro de firma (pt) — layout FirmaEC split QR + 3
 * líneas. Misma constante que `DEFAULT_SIG_BOX_W/H` en
 * `apps/pwa/src/ui/firma/smartPlacement.ts` (no importable desde aquí — ver
 * nota de arquitectura arriba). Mantener sincronizado si el layout cambia.
 */
export const DEFAULT_SIG_BOX_W = 240;
export const DEFAULT_SIG_BOX_H = 72;

/** Margen (pt) respecto a los bordes del área visible. Espejo de `EDGE_MARGIN`. */
export const EDGE_MARGIN = 18;
/** Separación (pt) entre firmas para que no se toquen. Espejo de `GAP`. */
export const GAP = 14;
/** Un rect existente se considera visible si ambos lados superan este umbral (pt). */
const VISIBLE_MIN = 1;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Réplica exacta de la comprobación de `validateVisibleSig` (visibleSig.ts:143):
 * `x ≥ 0 && y ≥ 0 && x+w ≤ mediaW && y+h ≤ mediaH`. Se duplica aquí a propósito
 * (no se importa `visibleSig.ts` desde este módulo puro) para poder rechazar
 * ANTES de intentar firmar, con el mismo criterio que usará el paso final.
 */
function fitsMediaBox(rect: Rect, geo: PageGeometry): boolean {
  return !(
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.w > geo.mediaW ||
    rect.y + rect.h > geo.mediaH
  );
}

/**
 * Mapa área-visible → "espacio canónico" de lectura: origen en la esquina
 * donde ancla la caja (según `/Rotate`), eje `v` creciendo hacia adentro
 * desde esa esquina, eje `u` recorriendo el borde perpendicular. Es una
 * isometría (rotación de múltiplo de 90° + traslación) — su inversa es
 * `fromCanonical`. Ver la derivación completa en la spec §2: para cada
 * `/Rotate`, qué borde de pantalla es "abajo" y cómo se ancla la caja ahí.
 */
function toCanonical(geo: PageGeometry, x: number, y: number): { u: number; v: number } {
  const { visX, visY, visW, visH, rotate } = geo;
  switch (rotate) {
    case 0:
      return { u: x - visX, v: y - visY };
    case 180:
      return { u: visX + visW - x, v: visY + visH - y };
    case 90:
      return { u: y - visY, v: visX + visW - x };
    case 270:
      return { u: visY + visH - y, v: x - visX };
  }
}

/** Inversa exacta de {@link toCanonical}. */
function fromCanonical(geo: PageGeometry, u: number, v: number): { x: number; y: number } {
  const { visX, visY, visW, visH, rotate } = geo;
  switch (rotate) {
    case 0:
      return { x: visX + u, y: visY + v };
    case 180:
      return { x: visX + visW - u, y: visY + visH - v };
    case 90:
      return { y: visY + u, x: visX + visW - v };
    case 270:
      return { y: visY + visH - u, x: visX + v };
  }
}

/** Dimensiones del área visible tal como se ven en pantalla (ejes u×v). */
function orientedDims(geo: PageGeometry): { w: number; h: number } {
  return geo.rotate === 90 || geo.rotate === 270
    ? { w: geo.visH, h: geo.visW }
    : { w: geo.visW, h: geo.visH };
}

/** Transforma un rect absoluto (dos esquinas) a un rect canónico (u,v,w,h). */
function rectToCanonical(geo: PageGeometry, r: Rect): Rect {
  const c1 = toCanonical(geo, r.x, r.y);
  const c2 = toCanonical(geo, r.x + r.w, r.y + r.h);
  const u = Math.min(c1.u, c2.u);
  const v = Math.min(c1.v, c2.v);
  return { x: u, y: v, w: Math.abs(c2.u - c1.u), h: Math.abs(c2.v - c1.v) };
}

/** Transforma un rect canónico (u,v,w,h) de vuelta a un rect absoluto. */
function rectFromCanonical(geo: PageGeometry, r: Rect): Rect {
  const a1 = fromCanonical(geo, r.x, r.y);
  const a2 = fromCanonical(geo, r.x + r.w, r.y + r.h);
  const x = Math.min(a1.x, a2.x);
  const y = Math.min(a1.y, a2.y);
  return { x, y, w: Math.abs(a2.x - a1.x), h: Math.abs(a2.y - a1.y) };
}

/** ¿Se solapan a y b, con un `pad` de holgura entre ellos? */
function rectsOverlap(a: Rect, b: Rect, pad: number): boolean {
  return !(
    a.x + a.w + pad <= b.x ||
    b.x + b.w + pad <= a.x ||
    a.y + a.h + pad <= b.y ||
    b.y + b.h + pad <= a.y
  );
}

/**
 * Busca el primer slot libre en un área canónica `orientedW × orientedH` que
 * no solape ninguno de `onPage` (ya en coordenadas canónicas), holgura
 * `GAP/2`. Mismo algoritmo que `findFreeSlot` en `smartPlacement.ts`: filas
 * ascendentes alineadas a la banda del borde de anclaje (v mínimo), en cada
 * fila se prueban posiciones u = margen y justo-junto-a-cada-firma.
 */
function findFreeSlot(
  onPage: Rect[],
  orientedW: number,
  orientedH: number,
  w: number,
  h: number,
): Rect | null {
  if (onPage.length === 0) return null;

  const baselineV = Math.max(EDGE_MARGIN, Math.min(...onPage.map((r) => r.y)));

  const uSet = new Set<number>([EDGE_MARGIN]);
  for (const r of onPage) uSet.add(r.x + r.w + GAP);
  const uCandidates = [...uSet]
    .filter((u) => u >= EDGE_MARGIN && u + w <= orientedW - EDGE_MARGIN)
    .sort((a, b) => a - b);

  const maxV = orientedH - EDGE_MARGIN - h;
  const pad = GAP * 0.5;

  for (let v = baselineV; v <= maxV + 0.01; v += h + GAP) {
    const vc = Math.min(v, maxV);
    for (const u of uCandidates) {
      const cand: Rect = { x: u, y: vc, w, h };
      if (!onPage.some((r) => rectsOverlap(cand, r, pad))) return cand;
    }
  }
  return null;
}

/** Fallback cuando no hay slot libre: centrado, 12% desde el borde de anclaje. */
function centeredFallback(orientedW: number, orientedH: number, w: number, h: number): Rect {
  return { x: (orientedW - w) / 2, y: orientedH * 0.12, w, h };
}

function clampRect(r: Rect, orientedW: number, orientedH: number): Rect {
  let { x, y } = r;
  const { w, h } = r;
  if (x < EDGE_MARGIN) x = EDGE_MARGIN;
  if (y < EDGE_MARGIN) y = EDGE_MARGIN;
  if (x + w > orientedW - EDGE_MARGIN) x = Math.max(0, orientedW - EDGE_MARGIN - w);
  if (y + h > orientedH - EDGE_MARGIN) y = Math.max(0, orientedH - EDGE_MARGIN - h);
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  return { x, y, w, h };
}

/**
 * Fuente 3 — pie de la última página. Ancla en canónico (bottom = v mínimo),
 * centrado en u, con el mismo `EDGE_MARGIN` que el flujo interactivo.
 */
function computeDefaultFooterPlacement(
  geo: PageGeometry,
  boxW: number,
  boxH: number,
): { page: number } & Rect {
  const { w: orientedW } = orientedDims(geo);
  const u = Math.min(Math.max((orientedW - boxW) / 2, EDGE_MARGIN), orientedW - EDGE_MARGIN - boxW);
  const v = EDGE_MARGIN;
  const rect = rectFromCanonical(geo, { x: u, y: v, w: boxW, h: boxH });
  return { page: geo.page, ...rect };
}

/**
 * Fuente 2 — anti-solape. Convierte cada firma previa a coordenadas
 * canónicas de SU PROPIA página (con su propio `/Rotate`), busca un slot
 * libre en esa página con el mismo algoritmo que `smartPlacement.ts`, y
 * transforma el resultado de vuelta a coordenadas absolutas.
 *
 * La página destino es la de la ÚLTIMA firma existente (mismo criterio que
 * `computeSmartPlacement`: los co-firmantes se agrupan en la misma hoja).
 */
function computeAntiOverlapPlacement(
  geometry: PageGeometry[],
  existing: ExistingSigRect[],
  boxW: number,
  boxH: number,
): ({ page: number } & Rect) | null {
  const geoByPage = new Map(geometry.map((g) => [g.page, g]));

  const visible = existing.filter(
    (r) =>
      Number.isFinite(r.x) &&
      Number.isFinite(r.y) &&
      Number.isFinite(r.w) &&
      Number.isFinite(r.h) &&
      r.w > VISIBLE_MIN &&
      r.h > VISIBLE_MIN,
  );
  if (visible.length === 0) return null;

  const targetPage = Math.max(...visible.map((r) => r.page));
  const geo = geoByPage.get(targetPage);
  if (!geo) return null;

  const { w: orientedW, h: orientedH } = orientedDims(geo);
  const w = Math.min(boxW, orientedW * 0.6);
  const h = Math.min(boxH, orientedH * 0.2);

  const onPage = visible.filter((r) => r.page === targetPage).map((r) => rectToCanonical(geo, r));

  const slot =
    findFreeSlot(onPage, orientedW, orientedH, w, h) ??
    centeredFallback(orientedW, orientedH, w, h);
  const clamped = clampRect(slot, orientedW, orientedH);
  const rect = rectFromCanonical(geo, clamped);
  return { page: targetPage, ...rect };
}

/**
 * Calcula la colocación automática de la firma visible para un documento del
 * lote. Nunca lanza: cuando el rect resultante no encajaría en la validación
 * de `visibleSig.ts`, devuelve `needs_review` para que el documento se aparte
 * a colocación manual en vez de firmarse mal o reventar el lote.
 */
export function computeAutoPlacement(opts: ComputeAutoPlacementOpts): AutoPlacement {
  const { geometry, existing, emptySigFields = [] } = opts;
  const boxW = opts.boxW ?? DEFAULT_SIG_BOX_W;
  const boxH = opts.boxH ?? DEFAULT_SIG_BOX_H;

  if (geometry.length === 0) {
    return { status: 'needs_review', page: 0, reason: 'document_has_no_pages' };
  }
  const geoByPage = new Map(geometry.map((g) => [g.page, g]));

  // 1. Campo de firma vacío: se respeta tal cual, en orden de página.
  if (emptySigFields.length > 0) {
    const field = [...emptySigFields].sort((a, b) => a.page - b.page)[0]!;
    const geo = geoByPage.get(field.page);
    if (!geo) {
      return {
        status: 'needs_review',
        page: field.page,
        reason: 'empty_sig_field_page_missing_geometry',
      };
    }
    if (!fitsMediaBox(field, geo)) {
      return {
        status: 'needs_review',
        page: field.page,
        reason: 'empty_sig_field_rect_out_of_media_box',
      };
    }
    return {
      status: 'ok',
      page: field.page,
      x: field.x,
      y: field.y,
      w: field.w,
      h: field.h,
      rotate: geo.rotate,
      source: 'empty-field',
    };
  }

  // 2. Anti-solape contra firmas visibles previas.
  if (existing.length > 0) {
    const placed = computeAntiOverlapPlacement(geometry, existing, boxW, boxH);
    if (placed) {
      const geo = geoByPage.get(placed.page);
      if (geo && fitsMediaBox(placed, geo)) {
        return {
          status: 'ok',
          page: placed.page,
          x: placed.x,
          y: placed.y,
          w: placed.w,
          h: placed.h,
          rotate: geo.rotate,
          source: 'anti-overlap',
        };
      }
      return {
        status: 'needs_review',
        page: placed.page,
        reason: 'anti_overlap_rect_out_of_media_box',
      };
    }
  }

  // 3. Pie de la última página — default de producto.
  const lastGeo = geometry[geometry.length - 1]!;
  const footer = computeDefaultFooterPlacement(lastGeo, boxW, boxH);
  if (!fitsMediaBox(footer, lastGeo)) {
    return {
      status: 'needs_review',
      page: lastGeo.page,
      reason: 'default_footer_rect_out_of_media_box',
    };
  }
  return {
    status: 'ok',
    page: lastGeo.page,
    x: footer.x,
    y: footer.y,
    w: footer.w,
    h: footer.h,
    rotate: lastGeo.rotate,
    source: 'default-footer',
  };
}
