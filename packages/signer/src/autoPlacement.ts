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
 * El resultado siempre se valida contra las MISMAS comprobaciones que
 * `validateVisibleSig` (visibleSig.ts:143-160) antes de devolver `status: 'ok'`:
 * encaje en el MediaBox Y el mínimo de legibilidad de 30×30 (ver
 * {@link visibleSigRejection}). Y `status: 'ok'` significa exactamente eso: si
 * no hay hueco libre en la página, el documento se aparta con `no_free_slot` en
 * vez de colocarse encima de la firma anterior.
 * La comprobación del MediaBox asume implícitamente que su origen es (0,0)
 * — si no lo es, un rect correcto puede no "encajar" en esos términos; en ese
 * caso el resultado es `needs_review`, nunca un rect inválido ni una
 * excepción (spec §4 criterio 7).
 */

import type { PageGeometry } from './pageGeometry.js';
import type { TextBand } from './textBands.js';

export type AutoPlacement =
  | {
      status: 'ok';
      page: number;
      x: number;
      y: number;
      w: number;
      h: number;
      rotate: 0 | 90 | 180 | 270;
      source: 'empty-field' | 'anti-overlap' | 'default-footer' | 'free-space';
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
  /**
   * Por qué el documento no se pudo leer, tal como lo reporta
   * `analyzePdfForPlacement`. Sin esto, un PDF cifrado o corrupto salía con el
   * motivo `document_has_no_pages`, que es falso y manda a la persona a buscar
   * un problema que no existe.
   */
  failure?: 'encrypted' | 'unreadable' | undefined;
  /**
   * Franjas verticales con texto (`analyzePdfForPlacement`). Se tratan como
   * ocupadas: la estampa cae en blanco de verdad, no encima de una cláusula.
   * Omitirlas reproduce exactamente el comportamiento anterior, que es lo que
   * ocurre cuando el contenido no se pudo recorrer.
   */
  textBands?: TextBand[] | undefined;
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

/**
 * Mínimo de legibilidad que exige `validateVisibleSig` (`MIN_VISIBLE_SIG_WIDTH` /
 * `MIN_VISIBLE_SIG_HEIGHT` en `visibleSig.ts:108-109`). Duplicado aquí por la
 * misma razón que el resto del módulo (ver la nota de arquitectura arriba: este
 * paquete no puede importar el camino de firma sin arrastrarlo).
 *
 * Que faltara era el defecto D3: un campo de firma vacío diminuto, o una caja
 * encogida por el anti-solape (`Math.min(boxH, orientedH * 0.2)`, que en una
 * página de menos de ~150 pt de alto da menos de 30), pasaba este pre-chequeo y
 * reventaba luego al firmar con `visible_sig_too_small`. El documento salía
 * `failed` cuando la verdad era "hay que colocarla a mano".
 */
const MIN_VISIBLE_SIG_WIDTH = 30;
const MIN_VISIBLE_SIG_HEIGHT = 30;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Por qué `validateVisibleSig` rechazaría este rect, o `null` si lo aceptaría.
 * Sufijo del motivo de `needs_review`, para que la UI pueda decir QUÉ pasa: un
 * rect fuera de la caja y uno demasiado pequeño se arreglan de forma distinta.
 */
type VisibleSigRejection = 'rect_out_of_media_box' | 'rect_too_small' | 'rect_outside_visible_area';

/**
 * Holgura (pt) al comparar contra el área visible.
 *
 * `visX/visY/visW/visH` salen de intersectar CropBox con MediaBox, y esas
 * coordenadas vienen de números en coma flotante del PDF; sin holgura, un rect
 * que coincide EXACTAMENTE con el borde del recorte se rechazaría por un error
 * de redondeo de la última cifra. Medio punto tipográfico es indetectable a la
 * vista y muy superior a cualquier error de redondeo acumulado.
 */
const VISIBLE_AREA_EPSILON = 0.5;

/**
 * Réplica de las comprobaciones de `validateVisibleSig` (visibleSig.ts:143-160)
 * que este módulo puede evaluar sin el PDF: el mínimo de legibilidad y el encaje
 * en el MediaBox. Se duplica a propósito (no se importa `visibleSig.ts` desde
 * este módulo puro) para poder rechazar ANTES de intentar firmar, con el mismo
 * criterio que usará el paso final.
 *
 * Queda fuera `visible_sig_invalid_page`: depende del nº de páginas del
 * documento, y aquí toda página razonada viene de `geometry`, que ya es la lista
 * de páginas reales.
 */
function visibleSigRejection(rect: Rect, geo: PageGeometry): VisibleSigRejection | null {
  if (rect.w < MIN_VISIBLE_SIG_WIDTH || rect.h < MIN_VISIBLE_SIG_HEIGHT) {
    return 'rect_too_small';
  }
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > geo.mediaW || rect.y + rect.h > geo.mediaH) {
    return 'rect_out_of_media_box';
  }
  // Defecto A4 — la compuerta solo miraba el MediaBox, nunca el área que el
  // visor MUESTRA. Con un CropBox estrecho y desplazado (tickets de 80 mm,
  // escaneos recortados, imposición) el rect cabía de sobra en el MediaBox y
  // aun así salía 58 pt fuera del recorte —justo la banda del QR— y la
  // validación decía OK. Encajar en el MediaBox es necesario (lo exige
  // `validateVisibleSig`), pero no es suficiente para que se VEA.
  if (
    rect.x < geo.visX - VISIBLE_AREA_EPSILON ||
    rect.y < geo.visY - VISIBLE_AREA_EPSILON ||
    rect.x + rect.w > geo.visX + geo.visW + VISIBLE_AREA_EPSILON ||
    rect.y + rect.h > geo.visY + geo.visH + VISIBLE_AREA_EPSILON
  ) {
    return 'rect_outside_visible_area';
  }
  return null;
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

  // Se barre desde el BORDE INFERIOR hacia arriba, no desde el elemento más
  // bajo: con el texto contando como ocupado, el blanco que queda DEBAJO del
  // último párrafo es el sitio natural de la firma, y anclar el barrido en el
  // elemento más bajo lo saltaba entero — dejando sin hueco a documentos que
  // tienen media página libre al pie.
  const baselineV = EDGE_MARGIN;

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
  // A4 — el pie de página no pasaba por ninguna acotación, a diferencia de la
  // rama anti-solape (que sí usa `clampRect`). El centrado
  // `(orientedW − boxW) / 2` va seguido de un `Math.min` contra
  // `orientedW − EDGE_MARGIN − boxW`, que con un área visible MÁS ESTRECHA que
  // el cuadro es NEGATIVO y gana: `u` medido = −58, es decir la estampa
  // arrancaba 58 pt a la izquierda del recorte. Se aplica el mismo criterio de
  // `clampRect` — nunca por debajo de `EDGE_MARGIN` — invirtiendo el orden de
  // las cotas.
  //
  // Solo se acota el eje `u`: `v` es la constante `EDGE_MARGIN`, nunca puede
  // salir negativa, y moverla convertiría en "colocable" una página más baja
  // que el propio cuadro (la estampa taparía la hoja entera de borde a borde).
  // Ese caso debe seguir apartándose, no encajarse a la fuerza.
  const u = Math.max(EDGE_MARGIN, Math.min((orientedW - boxW) / 2, orientedW - EDGE_MARGIN - boxW));
  const v = EDGE_MARGIN;
  const rect = rectFromCanonical(geo, { x: u, y: v, w: boxW, h: boxH });
  return { page: geo.page, ...rect };
}

/**
 * Resultado del anti-solape. Discriminado, y no `Rect | null`, porque las tres
 * situaciones son distintas y confundirlas fue el defecto D4: "no aplica"
 * (no hay firmas previas visibles) debe caer al pie de página, mientras que
 * "no cabe" tiene que apartar el documento — antes caía a un fallback centrado
 * ENCIMA de la firma existente y se devolvía como `status:'ok'`, es decir se
 * firmaba tapando la firma anterior y se reportaba como éxito limpio.
 */
type AntiOverlapOutcome =
  | { kind: 'placed'; page: number; rect: Rect }
  | { kind: 'no_free_slot'; page: number }
  | { kind: 'not_applicable' };

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
  textBands: readonly TextBand[] = [],
): AntiOverlapOutcome {
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
  if (visible.length === 0) return { kind: 'not_applicable' };

  const targetPage = Math.max(...visible.map((r) => r.page));
  const geo = geoByPage.get(targetPage);
  if (!geo) return { kind: 'not_applicable' };

  const { w: orientedW, h: orientedH } = orientedDims(geo);
  const w = Math.min(boxW, orientedW * 0.6);
  const h = Math.min(boxH, orientedH * 0.2);

  // El texto cuenta igual que una firma previa: un hueco "libre" que resulta
  // estar sobre un párrafo no es un hueco.
  const onPage = [
    ...visible.filter((r) => r.page === targetPage).map((r) => rectToCanonical(geo, r)),
    ...textBandRects(textBands, geo),
  ];

  const slot = findFreeSlot(onPage, orientedW, orientedH, w, h);
  if (!slot) return { kind: 'no_free_slot', page: targetPage };

  const clamped = clampRect(slot, orientedW, orientedH);
  const rect = rectFromCanonical(geo, clamped);
  return { kind: 'placed', page: targetPage, rect };
}

/**
 * Calcula la colocación automática de la firma visible para un documento del
 * lote. Nunca lanza: cuando el rect resultante no encajaría en la validación
 * de `visibleSig.ts`, devuelve `needs_review` para que el documento se aparte
 * a colocación manual en vez de firmarse mal o reventar el lote.
 */
/**
 * Las franjas de texto de UNA página, en el espacio canónico que usa el
 * buscador de hueco. Cada banda ocupa el ancho visible completo: medir el ancho
 * real de una línea exige las métricas de la fuente incrustada, y pasarse de
 * conservador aquí solo significa que la estampa acaba en blanco de verdad.
 */
function textBandRects(bands: readonly TextBand[], geo: PageGeometry): Rect[] {
  return bands
    .filter((b) => b.page === geo.page && Number.isFinite(b.y) && Number.isFinite(b.h) && b.h > 0)
    .map((b) => rectToCanonical(geo, { x: geo.visX, y: b.y, w: geo.visW, h: b.h }));
}

export function computeAutoPlacement(opts: ComputeAutoPlacementOpts): AutoPlacement {
  const { geometry, existing, emptySigFields = [] } = opts;
  const boxW = opts.boxW ?? DEFAULT_SIG_BOX_W;
  const boxH = opts.boxH ?? DEFAULT_SIG_BOX_H;

  // Un documento que no se pudo LEER no es un documento sin páginas: decirlo
  // mal manda a la persona a buscar un problema que no existe (defecto A6).
  if (opts.failure === 'encrypted') {
    return { status: 'needs_review', page: 0, reason: 'document_encrypted' };
  }
  if (opts.failure === 'unreadable') {
    return { status: 'needs_review', page: 0, reason: 'document_unreadable' };
  }
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
    const rejection = visibleSigRejection(field, geo);
    if (rejection) {
      return {
        status: 'needs_review',
        page: field.page,
        reason: `empty_sig_field_${rejection}`,
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

  const textBands = opts.textBands ?? [];

  // 2. Anti-solape contra firmas visibles previas.
  if (existing.length > 0) {
    const outcome = computeAntiOverlapPlacement(geometry, existing, boxW, boxH, textBands);
    if (outcome.kind === 'no_free_slot') {
      // La página ya está ocupada por firmas previas y no queda hueco. Antes se
      // colocaba encima y se devolvía 'ok' (D4): se firmaba tapando la firma
      // anterior y el lote lo contaba como éxito limpio.
      return { status: 'needs_review', page: outcome.page, reason: 'no_free_slot' };
    }
    if (outcome.kind === 'placed') {
      const geo = geoByPage.get(outcome.page);
      const rejection = geo ? visibleSigRejection(outcome.rect, geo) : 'rect_out_of_media_box';
      if (geo && rejection === null) {
        return {
          status: 'ok',
          page: outcome.page,
          x: outcome.rect.x,
          y: outcome.rect.y,
          w: outcome.rect.w,
          h: outcome.rect.h,
          rotate: geo.rotate,
          source: 'anti-overlap',
        };
      }
      return {
        status: 'needs_review',
        page: outcome.page,
        reason: `anti_overlap_${rejection}`,
      };
    }
  }

  // 3. Primer hueco libre de la última página, contando desde abajo. Antes se
  //    apoyaba la estampa al pie sin mirar nada: si el párrafo llegaba hasta
  //    ahí, la firma tapaba el texto — en un contrato, cláusulas.
  const lastGeo = geometry[geometry.length - 1]!;
  const lastPageText = textBandRects(textBands, lastGeo);
  if (lastPageText.length > 0) {
    const { w: orientedW, h: orientedH } = orientedDims(lastGeo);
    const slot = findFreeSlot(lastPageText, orientedW, orientedH, boxW, boxH);
    if (slot) {
      const rect = rectFromCanonical(lastGeo, slot);
      const rejection = visibleSigRejection(rect, lastGeo);
      if (rejection === null) {
        return {
          status: 'ok',
          page: lastGeo.page,
          x: rect.x,
          y: rect.y,
          w: rect.w,
          h: rect.h,
          rotate: lastGeo.rotate,
          source: 'free-space',
        };
      }
    }
    // La página está escrita de arriba abajo. Colocar la estampa encima del
    // texto es peor que no firmarla: se aparta para que una persona decida.
    return { status: 'needs_review', page: lastGeo.page, reason: 'no_free_slot' };
  }

  const footer = computeDefaultFooterPlacement(lastGeo, boxW, boxH);
  const footerRejection = visibleSigRejection(footer, lastGeo);
  if (footerRejection) {
    return {
      status: 'needs_review',
      page: lastGeo.page,
      reason: `default_footer_${footerRejection}`,
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
