/**
 * smartPlacement.ts — colocación inteligente (anti-solape) del cuadro de firma.
 *
 * Cuando un PDF ya trae firmas VISIBLES (widgets con /Rect no degenerado), el
 * default histórico (centrado, 12% desde abajo de la última página) podía caer
 * encima de una firma previa, obligando al usuario a arrastrar para corregir.
 *
 * Esta función pura, dados los rects de las firmas visibles previas y las
 * dimensiones de las páginas, decide:
 *   - La PÁGINA destino = la de la ÚLTIMA firma existente (los co-firmantes se
 *     agrupan en la misma hoja, como en un escrito legal).
 *   - Un SLOT libre en esa página: junto a las firmas existentes (a la derecha
 *     en la misma banda, o una fila arriba), sin solaparlas.
 *
 * Devuelve `null` cuando NO hay firmas visibles que evitar — en ese caso el
 * llamador conserva el comportamiento por defecto (BoxPlacer auto-coloca su
 * caja centrada). Es decir: este módulo SOLO cambia el caso multi-firma, que es
 * exactamente donde el solape era un problema.
 *
 * Sistema de coordenadas: PDF user-space, origen abajo-izquierda (bottom-left),
 * en puntos (pt) — el mismo que usa BoxPosition.
 */

/** Rectángulo de un widget de firma existente. `page` es 0-based. */
export interface ExistingSigRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Dimensiones (pt) de una página. `page` es 0-based. */
export interface PageDim {
  page: number;
  w: number;
  h: number;
}

/** Resultado: posición sugerida. `page` es 1-based (igual que BoxPosition). */
export interface SmartPlacement {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SmartPlacementOpts {
  /** Rects de firmas previas (cualquier estado de visibilidad; se filtran). */
  existing: ExistingSigRect[];
  /** Dimensiones por página (al menos las páginas con firmas). */
  pageDims: PageDim[];
  /** Tamaño por defecto deseado del nuevo cuadro (pt). */
  defaultW: number;
  defaultH: number;
}

/**
 * Tamaño por defecto del cuadro de firma (pt) — layout FirmaEC split QR + 3
 * líneas. Fuente única de verdad compartida por BoxPlacer (default centrado) y
 * la colocación inteligente, para no duplicar el número mágico.
 */
export const DEFAULT_SIG_BOX_W = 240;
export const DEFAULT_SIG_BOX_H = 72;

/** Margen (pt) respecto a los bordes de la página. */
export const EDGE_MARGIN = 18;
/** Separación (pt) entre firmas para que no se toquen. */
export const GAP = 14;
/** Un rect se considera visible si ambos lados superan este umbral (pt). */
export const VISIBLE_MIN = 1;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
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

function clampRect(r: Rect, dim: PageDim): Rect {
  let { x, y } = r;
  const { w, h } = r;
  if (x < EDGE_MARGIN) x = EDGE_MARGIN;
  if (y < EDGE_MARGIN) y = EDGE_MARGIN;
  if (x + w > dim.w - EDGE_MARGIN) x = Math.max(0, dim.w - EDGE_MARGIN - w);
  if (y + h > dim.h - EDGE_MARGIN) y = Math.max(0, dim.h - EDGE_MARGIN - h);
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  return { x, y, w, h };
}

/** Default histórico: centrado horizontal, 12% desde abajo. */
function centeredFallback(dim: PageDim, w: number, h: number): Rect {
  return { x: (dim.w - w) / 2, y: dim.h * 0.12, w, h };
}

/**
 * Busca el primer slot libre en `dim` que no solape ninguna firma de `onPage`.
 * Estrategia: filas ascendentes alineadas a la banda inferior. En cada fila se
 * prueban posiciones x = margen izquierdo y justo-a-la-derecha de cada firma.
 */
function findFreeSlot(onPage: Rect[], dim: PageDim, w: number, h: number): Rect | null {
  if (onPage.length === 0) return null;

  // Baseline: alinear el fondo del nuevo cuadro con el de la firma más baja.
  const baselineY = Math.max(EDGE_MARGIN, Math.min(...onPage.map((r) => r.y)));

  // Candidatos x: margen izquierdo + justo a la derecha de cada firma.
  const xSet = new Set<number>([EDGE_MARGIN]);
  for (const r of onPage) xSet.add(r.x + r.w + GAP);
  const xCandidates = [...xSet]
    .filter((x) => x >= EDGE_MARGIN && x + w <= dim.w - EDGE_MARGIN)
    .sort((a, b) => a - b);

  const maxY = dim.h - EDGE_MARGIN - h;
  const pad = GAP * 0.5;

  for (let y = baselineY; y <= maxY + 0.01; y += h + GAP) {
    const yc = Math.min(y, maxY);
    for (const x of xCandidates) {
      const cand: Rect = { x, y: yc, w, h };
      if (!onPage.some((r) => rectsOverlap(cand, r, pad))) return cand;
    }
  }
  return null;
}

/**
 * Calcula la colocación inteligente. Devuelve `null` si no hay firmas visibles
 * previas (el llamador conserva el default).
 */
export function computeSmartPlacement(opts: SmartPlacementOpts): SmartPlacement | null {
  const visible = opts.existing.filter(
    (r) =>
      Number.isFinite(r.x) &&
      Number.isFinite(r.y) &&
      Number.isFinite(r.w) &&
      Number.isFinite(r.h) &&
      r.w > VISIBLE_MIN &&
      r.h > VISIBLE_MIN,
  );
  if (visible.length === 0) return null;

  // Página destino = la de la última firma existente.
  const target = Math.max(...visible.map((r) => r.page));
  const dim = opts.pageDims.find((d) => d.page === target);
  if (!dim || dim.w <= 0 || dim.h <= 0) return null;

  const w = Math.min(opts.defaultW, dim.w * 0.6);
  const h = Math.min(opts.defaultH, dim.h * 0.2);
  const onPage = visible.filter((r) => r.page === target);

  const slot = findFreeSlot(onPage, dim, w, h) ?? centeredFallback(dim, w, h);
  const clamped = clampRect(slot, dim);
  return { page: target + 1, x: clamped.x, y: clamped.y, w, h };
}

export interface PlaceAtBottomLastPageOpts {
  /** Dimensiones por página (mismo convenio 0-based que `PageDim.page`). */
  pageDims: PageDim[];
  /** Página destino, 0-based (mismo convenio que `PageDim.page`/`ExistingSigRect.page`). */
  lastPage: number;
  /** Rects de firmas previas (cualquier estado de visibilidad; se filtran). */
  existing: ExistingSigRect[];
  w?: number;
  h?: number;
}

/**
 * Coloca una caja centrada horizontalmente al pie de `lastPage`, con el borde
 * inferior a `EDGE_MARGIN` del borde inferior de la página (origen PDF
 * abajo-izquierda). Si esa posición colisiona con una firma existente en esa
 * página, sube en pasos de `h + GAP` hasta encontrar hueco. Si la página se
 * agota, delega en `computeSmartPlacement` (o, si tampoco hay firmas previas
 * que forzar, cae al borde superior calculado como último recurso).
 *
 * Determinista: misma entrada → misma salida. `page` en el resultado es
 * 1-based, igual que `computeSmartPlacement`.
 */
export function placeAtBottomLastPage(opts: PlaceAtBottomLastPageOpts): SmartPlacement {
  const { pageDims, lastPage, existing, w = DEFAULT_SIG_BOX_W, h = DEFAULT_SIG_BOX_H } = opts;
  const dim = pageDims.find((d) => d.page === lastPage);
  if (!dim || dim.w <= 0 || dim.h <= 0) {
    // Sin dimensiones conocidas: no hay página sobre la que razonar; devolver
    // un resultado determinista y seguro (esquina inferior-izquierda).
    return { page: lastPage + 1, x: EDGE_MARGIN, y: EDGE_MARGIN, w, h };
  }

  const onPage = existing.filter(
    (r) => r.page === lastPage && Number.isFinite(r.x) && Number.isFinite(r.y) && r.w > VISIBLE_MIN && r.h > VISIBLE_MIN,
  );

  const x = Math.min(Math.max((dim.w - w) / 2, EDGE_MARGIN), dim.w - EDGE_MARGIN - w);
  const maxY = dim.h - EDGE_MARGIN - h;
  const step = h + GAP;
  const pad = GAP * 0.5;

  for (let y = EDGE_MARGIN; y <= maxY + 0.01; y += step) {
    const yc = Math.min(y, maxY);
    const cand: Rect = { x, y: yc, w, h };
    if (!onPage.some((r) => rectsOverlap(cand, r, pad))) {
      return { page: lastPage + 1, x: cand.x, y: cand.y, w, h };
    }
  }

  // Página agotada: delegar en el fallback general.
  const smart = computeSmartPlacement({ existing, pageDims, defaultW: w, defaultH: h });
  if (smart) return smart;
  return { page: lastPage + 1, x, y: Math.max(EDGE_MARGIN, maxY), w, h };
}

export interface PlaceBoxAtTapOpts {
  /** Tap coords (CSS px) relative to the canvas overlay. */
  tapCssX: number;
  tapCssY: number;
  /** CSS width of the canvas (= pdfW * scale). */
  cssWidth: number;
  /** PDF page dims (pt). */
  pdfW: number;
  pdfH: number;
  /** Whether the originating pointer event was touch (applies finger offset). */
  isTouch: boolean;
  /** Destination page, 1-based (matches `SmartPlacement.page`). */
  page: number;
  w?: number;
  h?: number;
}

/** Finger-cover compensation (CSS px) applied on touch, same convention as BoxPlacer. */
const TOUCH_OFFSET_PX = 24;

/**
 * Convierte un tap (coords CSS del canvas) en una posición de caja de firma
 * centrada en el punto tocado, con el mismo cálculo que
 * `BoxPlacer.onOverlayPointerDown`: escala CSS→pt derivada de `cssWidth/pdfW`,
 * offset táctil de `TOUCH_OFFSET_PX` hacia arriba para que el dedo no tape la
 * caja, y clamp a los bordes de página. Función pura, determinista.
 */
export function placeBoxAtTap(opts: PlaceBoxAtTapOpts): SmartPlacement {
  const {
    tapCssX,
    tapCssY,
    cssWidth,
    pdfW,
    pdfH,
    isTouch,
    page,
    w = DEFAULT_SIG_BOX_W,
    h = DEFAULT_SIG_BOX_H,
  } = opts;

  const scale = cssWidth / pdfW;
  const cssToPtLocal = (px: number): number => px / scale;

  const x = cssToPtLocal(tapCssX) - w / 2;
  const cyAdj = isTouch ? tapCssY - TOUCH_OFFSET_PX : tapCssY;
  const y = pdfH - cssToPtLocal(cyAdj) - h / 2;

  const dim: PageDim = { page: page - 1, w: pdfW, h: pdfH };
  const clamped = clampRect({ x, y, w, h }, dim);
  return { page, x: clamped.x, y: clamped.y, w, h };
}

export interface ComputeGridPlacementsOpts {
  pageDims: PageDim[];
  /** Página destino, 0-based (mismo convenio que `PageDim.page`). */
  page: number;
  existing: ExistingSigRect[];
}

const GRID_COLS = 2;
const GRID_ROWS = 3;

/**
 * Devuelve hasta 6 posiciones candidatas en una rejilla 2×3 dentro de
 * `page`, con márgenes `EDGE_MARGIN` y separación `GAP`, cada celda del
 * tamaño por defecto de la caja de firma. Excluye las celdas que colisionan
 * con firmas existentes. Orden estable: fila inferior→superior, dentro de
 * cada fila columna izquierda→derecha.
 */
export function computeGridPlacements(opts: ComputeGridPlacementsOpts): SmartPlacement[] {
  const { pageDims, page, existing } = opts;
  const dim = pageDims.find((d) => d.page === page);
  if (!dim || dim.w <= 0 || dim.h <= 0) return [];

  const w = DEFAULT_SIG_BOX_W;
  const h = DEFAULT_SIG_BOX_H;
  const onPage = existing.filter(
    (r) =>
      r.page === page && Number.isFinite(r.x) && Number.isFinite(r.y) && r.w > VISIBLE_MIN && r.h > VISIBLE_MIN,
  );

  // v0.20.x — reparte las filas por TODA la altura útil de la página (no solo
  // la banda inferior), para que la rejilla numerada alcance también la zona
  // de la línea de firma (habitualmente en el tercio medio/superior de la
  // hoja). La fila 0 sigue ancorada a EDGE_MARGIN desde abajo; la última fila
  // llega a EDGE_MARGIN desde arriba.
  const usableH = dim.h - 2 * EDGE_MARGIN;
  // Página demasiado corta para siquiera una fila con márgenes: no hay
  // rejilla posible — el usuario cae a tap-libre/auto-sugerencia.
  if (usableH < h) return [];
  const rowStep = GRID_ROWS > 1 ? Math.max(0, (usableH - h) / (GRID_ROWS - 1)) : 0;

  const cells: SmartPlacement[] = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    const y = EDGE_MARGIN + row * rowStep;
    for (let col = 0; col < GRID_COLS; col++) {
      const x = EDGE_MARGIN + col * (w + GAP);
      const cand: Rect = { x, y, w, h };
      const insideBounds =
        x + w <= dim.w - EDGE_MARGIN + 0.01 &&
        y + h <= dim.h - EDGE_MARGIN + 0.01 &&
        y >= EDGE_MARGIN - 0.01;
      if (!insideBounds) continue;
      if (onPage.some((r) => rectsOverlap(cand, r, 0))) continue;
      cells.push({ page: page + 1, x, y, w, h });
    }
  }
  return cells.slice(0, GRID_COLS * GRID_ROWS);
}
