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
import { MERGE_TOLERANCE_PT, type TextBand } from './textBands.js';

/**
 * Lo que se vio al buscar sitio, más allá del sitio elegido.
 *
 * El buscador siempre supo esto —recorría candidatos y se quedaba con el
 * primero— pero lo tiraba. Aquí se conserva, porque la diferencia entre "cabía
 * en un único hueco justo" y "cabía en medio folio en blanco" es exactamente lo
 * que distingue una colocación de la que fiarse de una que conviene enseñar
 * antes de pedir el PIN.
 *
 * Esto es MATERIA PRIMA, no un veredicto: nada de lo que hay aquí cambia hoy
 * dónde cae la estampa. Quien decide es el clasificador de confianza.
 */
export interface PlacementSurvey {
  /**
   * Cuántos HUECOS distintos cabían en la página elegida — dos posiciones que
   * se pisan son el mismo hueco, no dos opciones. Se cuenta hasta
   * {@link MAX_ENUMERATED_SLOTS}; llegar al tope significa "muchos", no
   * exactamente ese número. `0` cuando no cabía ninguno.
   */
  slots: number;
  /**
   * Distancia (pt) del sitio elegido al obstáculo más cercano —texto o firma
   * previa—, o `null` si en esa página no había ningún obstáculo. Nunca baja de
   * `GAP/2`: por debajo de eso el sitio no se habría considerado libre.
   */
  clearance: number | null;
  /**
   * Dónde y por cuánto se separa el segundo hueco del elegido. El orden de los
   * candidatos es lexicográfico —primero la altura, luego la posición
   * horizontal—, así que basta con mirar el primer eje en el que los dos
   * difieren. `null` si no hubo segundo hueco.
   */
  margin: { axis: 'vertical' | 'horizontal'; delta: number } | null;
  /**
   * Otras páginas (0-based) donde el cuadro por defecto habría cabido. Solo se
   * calcula cuando la página elegida no tenía sitio: es lo que hace accionable
   * un `no_free_slot` —"aquí no cabe, en la 2 sí"— en vez de un callejón.
   * Se examinan como mucho {@link MAX_PAGES_SURVEYED} páginas, empezando por
   * el final; en un documento más largo la lista queda incompleta a propósito.
   */
  alsoFits: number[];
}

/**
 * Superconjunto de `AnchorKind` (`anchorMatch.ts`, sin tocar ni importar —evita
 * el ciclo anchorPlacement→autoPlacement→anchorMatch): todo `AnchorKind` es
 * asignable aquí, pero `'lote-propagacion'` NO es un `AnchorKind` — a
 * propósito, para que el sistema de tipos deje explícito que una propagación
 * de posición dentro de un lote (F2: la posición que un humano ya confirmó en
 * OTRO documento del mismo lote) nunca es una ancla de TEXTO (FASE 3: nombre/
 * cédula/etiqueta "Firma" leídos del propio documento).
 */
export type AnchorPlacementKind =
  | 'firma-label'
  | 'firmante-nombre'
  | 'firmante-cedula'
  | 'lote-propagacion';

/**
 * Lo mínimo que `computeAutoPlacement` necesita del ancla de texto: DÓNDE
 * preferiría caer la estampa (en el mismo espacio canónico que usa
 * `enumerateSlots`) y de qué TIPO es el ancla, para decidir la prioridad.
 *
 * Forma estructural, no el `AnchorChoice` completo de `anchorPlacement.ts`
 * (que trae además `signals`/`personalized` — un superconjunto es asignable
 * aquí sin que este módulo tenga que importar ese, rompiendo el ciclo).
 */
export interface AnchorPlacementHint {
  page: number;
  preferredV: number;
  preferredU?: number;
  kind: AnchorPlacementKind;
}

export type AutoPlacement =
  | {
      status: 'ok';
      page: number;
      x: number;
      y: number;
      w: number;
      h: number;
      rotate: 0 | 90 | 180 | 270;
      /**
       * De dónde salió la posición. `reserved-gap` es un caso propio de
       * `free-space` y no un matiz suyo: la estampa no cayó en "un sitio donde
       * cabía", cayó en el hueco que el documento **dejó a propósito** encima
       * del bloque de firma (ver {@link reservedGapV}).
       *
       * La distinción no es cosmética. Un hueco reservado es estrecho y tiene
       * texto debajo POR CONSTRUCCIÓN —está delimitado por el párrafo de
       * arriba y el nombre impreso de abajo—, así que las señales de estrechez
       * disparan siempre ahí. Sin separar la fuente, el clasificador marcaba
       * como dudosas justo las colocaciones que más lo habían acertado.
       *
       * `text-anchor` (FASE 3): el sitio salió del nombre/cédula del firmante
       * o de una etiqueta "Firma"/"f)" encontrada en el documento — nunca
       * COLOCA por sí sola, solo reordena qué candidato prueba primero
       * `enumerateSlots`, así que sigue pasando por el mismo anti-solape y la
       * misma validación de legibilidad que cualquier otro origen.
       */
      source:
        | 'empty-field'
        | 'anti-overlap'
        | 'default-footer'
        | 'free-space'
        | 'reserved-gap'
        | 'text-anchor';
      /** Presente solo cuando `source === 'text-anchor'`: de qué tipo era el ancla honrada. */
      anchorKind?: AnchorPlacementKind;
      /**
       * Ausente cuando no se buscó nada: un campo de firma declarado por el
       * documento y el pie de una página en blanco no son el resultado de
       * comparar candidatos, así que no hay encuesta que contar.
       */
      survey?: PlacementSurvey;
    }
  | { status: 'needs_review'; page: number; reason: string; survey?: PlacementSurvey };

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
   *
   * Sin bandas para una página, esa página se resuelve con el algoritmo previo
   * a que esto existiera —barrido anclado al elemento más bajo y pie de página
   * por defecto—, byte a byte. Esa equivalencia está fijada en
   * `textBandsPlacement.test.ts` sobre el corpus real, no solo declarada aquí:
   * es la red que permite que un fallo del lector de texto no cambie dónde
   * firma nadie.
   */
  textBands?: TextBand[] | undefined;
  /**
   * Páginas cuyo contenido NO se pudo recorrer entero. Sus bandas (si llegó
   * alguna) se descartan: media lista de texto es peor que ninguna, porque
   * parece completa. Estas páginas caen al comportamiento anterior.
   */
  unanalyzedPages?: number[] | undefined;
  /**
   * Ancla de texto (FASE 3), ya reducida a un único sitio preferido por
   * `computeAnchorPlacement` (`anchorPlacement.ts`). `undefined` ⇒
   * comportamiento IDÉNTICO al de antes de que el ancla existiera — ni una
   * rama nueva se ejecuta, así que las tablas congeladas sobre el corpus real
   * (`textBandsPlacement.test.ts`) no se mueven ni un punto.
   */
  anchor?: AnchorPlacementHint | undefined;
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
 * Franja inferior donde vive el pie de página. Al buscar el hueco reservado,
 * lo que caiga aquí no cuenta como contenido: un número de página aislado
 * abajo del todo desplazaría el hueco elegido a la zona que hay ENCIMA de él,
 * y la firma acabaría por debajo del nombre del firmante.
 *
 * 90 pt y no 60: medido sobre documentos reales del usuario, los números de
 * página llegan a `y=66`. Con 60 la banda del pie no se saltaba y el hueco
 * elegido era el vacío que hay por encima de ELLA.
 */
const FOOTER_STRIP_PT = 90;

/**
 * Separación máxima entre líneas de un mismo bloque. El bloque de firma son
 * varias líneas seguidas —nombre, cargo, "CI:"— y el hueco reservado está por
 * encima de todas ellas, no entre dos de ellas. 30 pt cubre el interlineado
 * doble de un párrafo sin llegar a tragarse un claro de firma.
 */
export const BLOCK_GAP_PT = 30;

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

/**
 * Espejo de `MIN_LEGIBLE_SIG_WIDTH` (visibleSig.ts): el ancho por debajo del
 * cual la estampa no enseña ni un dato del firmante, porque el bloque de texto
 * arranca en un x fijo y el BBox recorta.
 *
 * Se duplica en vez de importarse por lo mismo que {@link MIN_VISIBLE_SIG_WIDTH}:
 * `visibleSig.ts` arrastra `qrcode`, y este modulo vive en el worker de
 * pre-vuelo, que no renderiza nada. `visibleSigLayoutFloor.test.ts` afirma que
 * los dos numeros siguen siendo el mismo, para que no puedan divergir en
 * silencio.
 */
const MIN_LEGIBLE_SIG_WIDTH = 78;
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
type VisibleSigRejection =
  | 'rect_not_finite'
  | 'rect_out_of_media_box'
  | 'rect_too_small'
  | 'rect_outside_visible_area';

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
  // Va PRIMERO y en positivo: todas las comprobaciones de abajo son `<` o `>`,
  // y `NaN` las aprueba todas porque cualquier comparación con él es `false`.
  // Un rect no finito era, literalmente, el único que no rechazaba nadie.
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.w) ||
    !Number.isFinite(rect.h) ||
    !Number.isFinite(geo.mediaW) ||
    !Number.isFinite(geo.mediaH)
  ) {
    return 'rect_not_finite';
  }
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
export function toCanonical(geo: PageGeometry, x: number, y: number): { u: number; v: number } {
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
export function orientedDims(geo: PageGeometry): { w: number; h: number } {
  return geo.rotate === 90 || geo.rotate === 270
    ? { w: geo.visH, h: geo.visW }
    : { w: geo.visW, h: geo.visH };
}

/**
 * Versión pública de {@link rectToCanonical}: canonicaliza un RECT completo,
 * no un solo punto. Necesaria porque `toCanonical` transforma únicamente una
 * esquina —en páginas con `/Rotate` 90/180/270 la rotación puede invertir cuál
 * esquina es la "mínima" en espacio canónico, así que canonicalizar solo una
 * esquina con `toCanonical` da un resultado INCORRECTO (confirmado
 * empíricamente: con `rotate=180` un hint canonicalizado como punto no
 * coincide con el que da canonicalizar el rect entero). La propagación de
 * posición dentro de un lote (F2, capa PWA) necesita canonicalizar el rect que
 * un humano confirmó a mano en otro documento del lote — de ahí que se
 * exporte en vez de dejarla privada.
 */
export function toCanonicalRect(
  geo: PageGeometry,
  rect: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  return rectToCanonical(geo, rect);
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
 * El hueco que el documento RESERVÓ para la firma, si lo hay.
 *
 * Una carta o un informe terminan igual: cierre, un espacio en blanco grande, y
 * debajo el nombre impreso del firmante. Ese espacio no está ahí por casualidad
 * — es donde va la firma, y la persona que redactó el documento lo dejó a
 * propósito.
 *
 * Se reconoce sin leer una sola letra, por pura anomalía: dentro de un párrafo
 * las líneas se separan 2-3 pt y entre párrafos 10-15, así que un claro donde
 * cabe un cuadro de firma entero **y que además tiene texto por debajo** no lo
 * produce el flujo normal del texto. El "texto por debajo" es la mitad que
 * importa: sin esa condición, el mayor claro de cualquier documento es el suelo
 * de la hoja, que es justo el sitio equivocado.
 *
 * Y ese suelo era exactamente lo que se venía eligiendo. El buscador probaba
 * las alturas de abajo arriba y se quedaba con la primera libre; en un documento
 * cuyo texto acaba a media página, la primera libre es siempre el borde
 * inferior. La estampa acababa a 10 cm del sitio, pegada al número de página,
 * y con la máxima confianza.
 *
 * NO vale coger el claro más bajo que quepa: el más bajo es casi siempre el
 * vacío entre el número de página y el bloque del firmante, y ahí la estampa
 * queda DEBAJO del nombre, que es exactamente al revés. El hueco bueno es el
 * que está justo ENCIMA del bloque final. De ahí los dos pasos: saltarse el
 * pie, y tratar el bloque de firma —nombre, cargo, cédula, líneas seguidas—
 * como una sola cosa antes de mirar qué hay encima.
 */
function reservedGapV(onPage: readonly Rect[], boxH: number): number | null {
  // Ascendente en `v` = del pie de la página hacia arriba.
  const sorted = [...onPage].sort((a, b) => a.y - b.y);

  // 1. El pie no cuenta. Un número de página aislado abajo del todo no es
  //    contenido: si contara, el hueco elegido sería el que hay por encima de
  //    ÉL, y la firma acabaría por debajo del nombre del firmante.
  let i = 0;
  while (i < sorted.length && sorted[i]!.y + sorted[i]!.h <= FOOTER_STRIP_PT) i++;
  if (i >= sorted.length) return null;

  // 2. El bloque de firma son varias líneas juntas —nombre, cargo, "CI:"— y el
  //    hueco va encima de TODAS, no entre ellas.
  let top = sorted[i]!.y + sorted[i]!.h;
  let j = i;
  while (j + 1 < sorted.length && sorted[j + 1]!.y - top <= BLOCK_GAP_PT) {
    j++;
    top = sorted[j]!.y + sorted[j]!.h;
  }

  // 3. Lo que queda por encima del bloque final. Si no hay nada encima, este
  //    bloque ES el documento y no hay hueco reservado que valga.
  const above = sorted[j + 1];
  if (!above || above.y - top < boxH + GAP) return null;
  return top + GAP * 0.5;
}

interface FreeSlotOpts {
  /**
   * `true` cuando entre los obstáculos hay bandas de texto. Cambia CÓMO se
   * eligen las alturas candidatas (ver {@link verticalCandidates}); en `false`
   * el barrido es exactamente el histórico.
   */
  textAware: boolean;
  /** Altura `u` a probar antes que ninguna otra (el centrado del pie). */
  preferredU?: number | undefined;
  /** Altura `v` a probar antes que ninguna otra (el hueco reservado). */
  preferredV?: number | undefined;
}

/**
 * Cuánto texto queda POR DEBAJO de este rect, en su misma página: cuántas
 * franjas y cuánto suman de alto.
 *
 * Devuelve la medida y no un sí/no porque la pregunta útil no es "¿hay algo
 * debajo?" —debajo casi siempre hay algo, aunque solo sea el número de
 * página— sino "¿hay bastante como para que la estampa esté en mitad del
 * documento?". Quien pregunta decide dónde pone el listón.
 *
 * "Debajo" es debajo EN PANTALLA, no en coordenadas de usuario: en una página
 * con `/Rotate 90` los dos ejes no coinciden, y la pregunta que importa es la
 * que ve la persona. Por eso ambos rects pasan por el espacio canónico.
 *
 * Vive aquí, y no en quien lo consulta, porque la conversión canónica es
 * geometría de esta página y no debe duplicarse: una segunda copia que se
 * desviara pondría la señal al revés justo en las páginas giradas.
 *
 * ⚠️ Con `/Rotate 90` o `270` esto devuelve SIEMPRE `false`, y no por un fallo:
 * una {@link TextBand} es una franja horizontal del espacio de usuario, y
 * girada un cuarto de vuelta se convierte en una columna que ocupa la altura
 * entera de la pantalla. Nada puede quedar por debajo de algo que llega de
 * borde a borde. La colocación en sí es correcta en esas páginas —el buscador
 * de hueco esquiva la columna igual de bien—; lo que no aplica es este matiz.
 * Se deja dicho para que nadie lo lea como una señal que "no salta nunca".
 */
/**
 * A qué altura del papel quedó el borde INFERIOR de este rect, medido desde el
 * pie de la página tal como se ve en pantalla. 0 = pegado al borde de abajo.
 *
 * Es la misma cuenta que hace el buscador de hueco (el eje `v` canónico), pero
 * expuesta para quien tenga que juzgar si la estampa acabó donde acaban las
 * firmas o en mitad del documento. Con `/Rotate` de por medio "abajo" no es el
 * `y` del PDF, y por eso no se puede calcular fuera de aquí.
 */
export function bottomGap(
  rect: { x: number; y: number; w: number; h: number },
  geo: PageGeometry,
): number {
  return rectToCanonical(geo, rect).y;
}

export function textBelow(
  rect: { x: number; y: number; w: number; h: number },
  geo: PageGeometry,
  bands: readonly TextBand[],
): { lines: number; height: number } {
  const stamp = rectToCanonical(geo, rect);
  let lines = 0;
  let height = 0;
  for (const b of bands) {
    if (b.page !== geo.page || !Number.isFinite(b.y) || !Number.isFinite(b.h) || b.h <= 0) continue;
    const band = rectToCanonical(geo, { x: geo.visX, y: b.y, w: geo.visW, h: b.h });
    if (band.y + band.h <= stamp.y) {
      lines += 1;
      height += band.h;
    }
  }
  return { lines, height };
}

/**
 * Alturas a probar, de abajo arriba.
 *
 * Sin texto se conserva la rejilla histórica: se ancla en el elemento más bajo
 * y sube a saltos de `h + GAP`. Es lo que hacía `smartPlacement.ts` y lo que
 * decidió dónde está la firma en todo lo ya firmado.
 *
 * Con texto esa rejilla no vale: sus saltos son de 86 pt y los huecos reales
 * entre párrafos miden 22–30, así que caía sistemáticamente fuera de ellos y
 * apartaba documentos con sitio de sobra. Se prueban los BORDES de cada
 * obstáculo —justo encima y justo debajo, con la misma holgura que exige el
 * test de solape—, que es donde un hueco puede empezar.
 */
function verticalCandidates(
  onPage: readonly Rect[],
  orientedH: number,
  h: number,
  textAware: boolean,
): number[] {
  const maxV = orientedH - EDGE_MARGIN - h;
  const pad = GAP * 0.5;

  if (!textAware) {
    const baselineV = Math.max(EDGE_MARGIN, Math.min(...onPage.map((r) => r.y)));
    const out: number[] = [];
    const step = h + GAP;
    // Tres formas de que este bucle no termine, y ninguna la traía un PDF
    // legítimo: paso ≤ 0 (cuadro de alto negativo), `maxV` no finito (MediaBox
    // basura), y `maxV` finito pero descomunal — una hoja de 1e11 pt genera
    // mil millones de alturas y `push` lanza `RangeError` mucho antes.
    //
    // Lanzar aquí no es un fallo aislado: el módulo promete "nunca lanza" y el
    // pre-vuelo del lote se lo cree, así que la excepción se llevaría por
    // delante los 50 documentos, no uno. Se corta en seco.
    if (!(step > 0) || !Number.isFinite(maxV)) return [];
    for (let v = baselineV; v <= maxV + 0.01 && out.length < MAX_VERTICAL_CANDIDATES; v += step) {
      out.push(v);
    }
    return out;
  }

  const set = new Set<number>([EDGE_MARGIN]);
  for (const r of onPage) {
    set.add(r.y + r.h + pad);
    set.add(r.y - pad - h - 0.01);
  }
  return [...set].filter((v) => v >= EDGE_MARGIN && v <= maxV + 0.01).sort((a, b) => a - b);
}

/**
 * Cuántos huecos DISTINTOS se llegan a contar antes de parar. Ocho bastan para
 * lo único que se necesita —el elegido, su alternativa, y si había pocos o
 * muchos—; pasado el tope se deja de contar y `slots` dice "muchos" en vez de
 * la cifra exacta.
 */
const MAX_ENUMERATED_SLOTS = 8;

/**
 * Tope de alturas a probar en el barrido sin texto. Una A4 da 9; 512 cubre una
 * hoja de 44.000 pt, tres veces el máximo que admite la spec de PDF (14.400).
 * Está para que una geometría absurda no genere un array de mil millones de
 * entradas, no para acotar un documento real.
 */
const MAX_VERTICAL_CANDIDATES = 512;

/** Un hueco libre, con su posición en el orden lexicográfico que lo eligió. */
interface Slot {
  rect: Rect;
  /** Altura canónica — primer nivel del orden. */
  v: number;
  /** Posición horizontal canónica — segundo nivel del orden. */
  u: number;
}

/**
 * Enumera los huecos libres de un área canónica `orientedW × orientedH` que no
 * solapen ninguno de `onPage` (ya en coordenadas canónicas), con holgura
 * `GAP/2`, **en orden de preferencia**: primero por altura, y a igual altura
 * por posición horizontal (el pie centrado antes que el margen izquierdo).
 *
 * Ese orden es el mismo recorrido que hacía el buscador anterior, que devolvía
 * el primer acierto; por eso `enumerateSlots(...)[0]` es, punto por punto, lo
 * que se colocaba antes. Lo nuevo no es la elección: es que ahora también se
 * sabe qué había en segundo lugar y cuántos huecos más cabían.
 */
function enumerateSlots(
  onPage: Rect[],
  orientedW: number,
  orientedH: number,
  w: number,
  h: number,
  opts: FreeSlotOpts,
): Slot[] {
  if (onPage.length === 0) return [];

  const uSet = new Set<number>([EDGE_MARGIN]);
  if (opts.preferredU !== undefined) uSet.add(opts.preferredU);
  for (const r of onPage) uSet.add(r.x + r.w + GAP);
  const uCandidates = [...uSet]
    .filter((u) => u >= EDGE_MARGIN && u + w <= orientedW - EDGE_MARGIN)
    .sort((a, b) => {
      // Con el pie centrado disponible, se prueba primero: un documento sin
      // conflicto que se resolvía centrado no debe pegarse al margen izquierdo
      // solo porque ahora sepamos dónde está el texto.
      if (a === opts.preferredU) return -1;
      if (b === opts.preferredU) return 1;
      return a - b;
    });

  const maxV = orientedH - EDGE_MARGIN - h;
  const pad = GAP * 0.5;
  const found: Slot[] = [];

  // El hueco reservado va PRIMERO, por delante del barrido de abajo arriba: es
  // el sitio que el documento eligió, no el que sobra.
  const vCandidates = verticalCandidates(onPage, orientedH, h, opts.textAware);
  if (opts.preferredV !== undefined) vCandidates.unshift(opts.preferredV);

  for (const v of vCandidates) {
    const vc = Math.min(v, maxV);
    for (const u of uCandidates) {
      const rect: Rect = { x: u, y: vc, w, h };
      if (onPage.some((r) => rectsOverlap(rect, r, pad))) continue;
      // Dos posiciones que se pisan son el MISMO hueco alcanzado por otro
      // borde, no dos opciones. Sin esto, un solo claro entre dos párrafos se
      // contaría cuatro veces —anclado arriba y abajo, centrado y a la
      // izquierda— y la encuesta diría "había sitio de sobra" donde solo había
      // un sitio. Se cuentan huecos, no coordenadas.
      if (found.some((s) => rectsOverlap(rect, s.rect, 0))) continue;
      found.push({ rect, v: vc, u });
      if (found.length >= MAX_ENUMERATED_SLOTS) return found;
    }
  }
  return found;
}

/**
 * Separación (pt) entre dos rects: cuánto hay que acercarlos para que se
 * toquen. Negativa si ya se solapan. Se toma el eje con más holgura porque
 * basta con estar separados en UNO para no pisarse — es el mismo criterio que
 * {@link rectsOverlap}, leído como distancia en vez de como sí/no.
 */
function separation(a: Rect, b: Rect): number {
  return Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));
}

/**
 * La parte de la encuesta que sale de una enumeración. `clearance` y `alsoFits`
 * se rellenan aparte: no dependen del orden de los candidatos.
 */
function surveyOf(slots: readonly Slot[]): Pick<PlacementSurvey, 'slots' | 'margin'> {
  const [first, second] = slots;
  if (!first || !second) return { slots: slots.length, margin: null };
  return {
    slots: slots.length,
    margin:
      second.v !== first.v
        ? { axis: 'vertical', delta: Math.abs(second.v - first.v) }
        : { axis: 'horizontal', delta: Math.abs(second.u - first.u) },
  };
}

/**
 * El margen izquierdo del bloque de firma: dónde empieza la línea que hay justo
 * DEBAJO del hueco reservado, en el eje `u` de pantalla.
 *
 * Con el hueco resuelto, la estampa salía centrada en la hoja mientras el
 * nombre impreso arrancaba en el margen izquierdo — desalineada con la única
 * referencia que el documento ofrece. Una persona firma sobre el margen de su
 * nombre, no en el centro del papel.
 *
 * Devuelve `undefined` cuando ninguna banda de debajo trae `x`: entonces manda
 * el centrado de siempre, que es la respuesta correcta a "no lo sé".
 */
/** El bloque de texto que hay justo debajo del hueco reservado. */
interface SignatureBlock {
  /** Su borde izquierdo en canónico, SIN acotar todavía a la página. */
  u: number;
  /** La banda, para mirarle los arranques de línea (ver {@link columnHardRight}). */
  band: TextBand;
}

function signatureBlock(
  bands: readonly TextBand[],
  geo: PageGeometry,
  gapV: number,
): SignatureBlock | undefined {
  let bestV = Number.NEGATIVE_INFINITY;
  let best: SignatureBlock | undefined;
  for (const b of bands) {
    if (b.page !== geo.page || b.x === undefined || !Number.isFinite(b.x)) continue;
    if (!Number.isFinite(b.y) || !Number.isFinite(b.h) || b.h <= 0) continue;
    const r = rectToCanonical(geo, { x: b.x, y: b.y, w: 1, h: b.h });
    // La banda inmediatamente por debajo del hueco: la más alta de las que
    // quedan bajo él.
    if (r.y + r.h <= gapV && r.y > bestV) {
      bestV = r.y;
      best = { u: r.x, band: b };
    }
  }
  return best;
}

/** Acota el borde izquierdo del bloque a los márgenes útiles de la página. */
function clampBlockU(u: number, boxW: number, orientedW: number): number {
  const maxU = orientedW - EDGE_MARGIN - boxW;
  return Math.max(EDGE_MARGIN, Math.min(u, maxU));
}

/**
 * Separación mínima entre dos arranques de la MISMA línea base para leerlos
 * como columnas y no como una sangría.
 *
 * El umbral existe pero NO es la pieza que sostiene el arreglo, y conviene
 * decirlo: quien evita los falsos positivos es exigir que los dos arranques
 * COMPARTAN LÍNEA BASE -- dos textos en la misma línea solo pueden estar uno
 * al lado del otro -- y, sobre todo, que lo único que se haga al detectarlos
 * sea recortar por la DERECHA. Un bloque de un solo firmante, centrado o
 * sangrado, tiene un arranque por línea y ni entra.
 *
 * Un par etiqueta/valor SÍ entra, y conviene ser exacto sobre lo que cuesta:
 * es un no-op solo si el valor arranca a mas de `boxW + GAP/2` del ancla
 * (247 pt con el ancho por defecto). Dentro de la ventana [umbral, 247) el
 * recorte SI ocurre en un documento de un solo firmante y la estampa sale mas
 * estrecha, con el nombre posiblemente truncado. Se acepta porque desde los
 * arranques de linea ese caso es INDISTINGUIBLE de dos columnas de verdad a
 * esa misma distancia, y de los dos errores posibles este es el barato.
 *
 * La ventana está MEDIDA en `columnSignatureBlock.test.ts`: la mayor sangría
 * que comparte línea base sin ser columna es la de un numeral y su texto
 * (~22 pt) y la separación inter-columna más estrecha, con cada firmante
 * centrado en su media página, ~211 pt. Cualquier valor entre ambas sirve;
 * 150 deja el margen amplio del lado que duele -- un falso positivo es
 * gratis, un falso negativo estampa sobre el hueco del cofirmante.
 *
 * Pero esa ventana se midió en A4, y un valor absoluto no viaja: en A5 las
 * columnas caben en menos sitio y su separación real cae POR DEBAJO de 150,
 * con lo que el detector callaba y la estampa invadía (95 pt medidos). De ahí
 * {@link COLUMN_SPLIT_FRACTION}: se toma el menor de los dos. En A4 la
 * fracción da 148,8 -- prácticamente el mismo valor, y los controles de una
 * sola columna no se mueven-- y en A5 baja a 105, que sigue siendo 4,7 veces
 * la sangría más ancha medida.
 */
const COLUMN_SPLIT_PT = 150;

/** El umbral de columna, como fracción del ancho útil. Ver {@link COLUMN_SPLIT_PT}. */
const COLUMN_SPLIT_FRACTION = 0.25;

/** Un bloque a varias columnas, ya resuelto: dónde anclar y hasta dónde llegar. */
interface ColumnSplit {
  /**
   * Donde EMPIEZA la columna de al lado. Cota derecha dura y gratuita: un
   * arranque de línea sale de la matriz de texto, sin métricas de fuente.
   *
   * Ojo con lo que significa exactamente -- acota dónde empieza la columna
   * vecina, no dónde termina la nuestra; para eso harían falta las métricas de
   * la fuente incrustada, y no se necesitan: el conflicto con el texto propio
   * ya lo resuelve el barrido de huecos.
   */
  boundary: number;
  /** Borde izquierdo de la columna donde va la estampa (siempre la primera). */
  anchorU: number;
}

/**
 * Resuelve el bloque en columnas, o `null` si no lo está.
 *
 * El ancla NO puede heredarse de `band.x`: esa es la `x` de la línea más baja
 * del bloque, y basta con que una columna lleve una línea más que la otra --un
 * RUC bajo la empresa, y no bajo la persona natural-- para que la línea más
 * baja pertenezca a la columna DERECHA. Medido: el ancla se iba a 362,8, no
 * quedaba ningún corte a su derecha, no se recortaba nada y la estampa caía
 * ENTERA sobre el hueco del cofirmante. Anclar a la primera columna es una
 * decisión, no una casualidad del orden de las líneas.
 *
 * `orientedW` entra porque el umbral es relativo: ver {@link COLUMN_SPLIT_PT}.
 */
function columnSplit(band: TextBand, geo: PageGeometry, orientedW: number): ColumnSplit | null {
  const starts = band.starts;
  if (starts === undefined || starts.length < 2) return null;

  const canon: Array<{ u: number; v: number }> = [];
  for (const s of starts) {
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) continue;
    const r = rectToCanonical(geo, { x: s.x, y: s.y, w: 1, h: 1 });
    canon.push({ u: r.x, v: r.y });
  }
  if (canon.length < 2) return null;

  const umbral = Math.min(COLUMN_SPLIT_PT, orientedW * COLUMN_SPLIT_FRACTION);
  const ordenados = [...canon].sort((a, b) => a.v - b.v || a.u - b.u);
  let boundary: number | null = null;
  let fila: Array<{ u: number; v: number }> = [];
  const cerrarFila = (): void => {
    for (let i = 1; i < fila.length; i += 1) {
      const izq = fila[i - 1]!;
      const dcha = fila[i]!;
      if (dcha.u - izq.u < umbral) continue;
      // El PRIMER corte de la fila; de todas las filas, el más a la izquierda.
      // Asi la frontera delimita siempre la PRIMERA columna.
      if (boundary === null || dcha.u < boundary) boundary = dcha.u;
      break;
    }
    fila = [];
  };
  for (const punto of ordenados) {
    if (fila.length > 0 && Math.abs(punto.v - fila[0]!.v) > MERGE_TOLERANCE_PT) cerrarFila();
    fila.push(punto);
  }
  cerrarFila();
  if (boundary === null) return null;

  // El ancla, dentro ya de la primera columna: mismo criterio de siempre --el
  // margen izquierdo de su línea más baja, que es donde una persona apoyaría
  // la firma-- pero aplicado a la columna correcta y no al bloque entero.
  const primera = canon.filter((c) => c.u < (boundary as number));
  if (primera.length === 0) return null;
  let anclaje = primera[0]!;
  for (const c of primera) {
    if (c.v < anclaje.v || (c.v === anclaje.v && c.u < anclaje.u)) anclaje = c;
  }
  return { boundary, anchorU: anclaje.u };
}

/**
 * El ancho que cabe en la columna, o el de siempre si no hay nada que recortar.
 *
 * Se aplica ANTES de `enumerateSlots`, nunca encogiendo el rect después:
 * mover o redimensionar un rect ya validado es exactamente el defecto que
 * documenta {@link clampAndRevalidate}, y no se reincide.
 */
function widthWithinColumn(boxW: number, anchorU: number, hardRight: number | null): number {
  if (hardRight === null) return boxW;
  // Desde el ancla YA ACOTADA, no desde la cruda: si el bloque arranca a menos
  // de EDGE_MARGIN del borde, `clampBlockU` empuja la caja a la derecha
  // DESPUES de calcular el hueco, y el ancho sobrante se convertía en
  // invasion (13 pt medidos). Una cota que se calcula en un sitio donde la
  // caja no va a estar no es una cota.
  const room = hardRight - GAP / 2 - Math.max(EDGE_MARGIN, anchorU);
  if (!Number.isFinite(room) || room >= boxW) return boxW;
  // El suelo es el del LAYOUT, no el del validador. Un rect de 43 pt pasa
  // `visibleSigRejection` (que solo pide 30x30) y aun asi se firma MUDO: el
  // bloque de nombre/cedula/fecha arranca en un x fijo y el BBox lo recorta
  // entero. Estrechar hasta ahi cambiaba un defecto visible --la estampa en el
  // hueco del cofirmante-- por uno peor y silencioso, sobre una firma ya
  // gastada. Por debajo de la cota se conserva el ancho de siempre: invade,
  // exactamente como antes de este arreglo, pero se lee.
  //
  // Entre esta cota y el ancho por defecto la estampa SI se estrecha y el
  // nombre puede truncarse. Es un intercambio aceptado a proposito: el dato
  // fuerte del firmante vive en el PKCS#7, no en el dibujo, mientras que
  // estampar en el hueco del otro firmante ensucia el documento para todos.
  // atajo: no distingue "columna estrecha de verdad" de "bloque raro"; el dia
  // que aparezca un documento real aqui, esto merece `needs_review` en vez de
  // elegir en silencio entre invadir y truncar.
  if (room < MIN_LEGIBLE_SIG_WIDTH) return boxW;
  return room;
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
 * Acota un candidato dentro de los márgenes de página y revalida que el
 * acotado siga siendo un hueco libre, o `null` si dejó de serlo.
 *
 * `enumerateSlots` valida el solape contra los obstáculos en la posición SIN
 * acotar de `preferredV`/`preferredU` (que saltan a propósito el filtro
 * `v >= EDGE_MARGIN` de `verticalCandidates`, para poder aterrizar cerca del
 * borde) — pero `clampRect` reubica el rect DESPUÉS, sin volver a comprobar
 * nada contra esos mismos obstáculos. Un ancla o hint cerca del borde inferior
 * podía salir `status:'ok'` con la estampa encima de una firma previa o una
 * banda de texto (hallazgo QA post-merge: repro determinista, 3,2% de las
 * colocaciones por ancla en un barrido de 40.000 escenarios).
 *
 * Único punto que hace este acotar-y-revalidar: `tryAnchorPlacement` y
 * `computeAntiOverlapPlacement` comparten esta función en vez de cada uno
 * tener su propia copia del guard, para que no puedan volver a divergir (el
 * guard de `tryAnchorPlacement` vivía ya aquí antes de este fix; el de
 * `computeAntiOverlapPlacement` nunca se escribió — ese es el defecto P0).
 *
 * Si acotar NO movió el rect, no hace falta revalidar: `enumerateSlots` ya lo
 * comprobó en esa misma posición.
 */
function clampAndRevalidate(
  rect: Rect,
  onPage: readonly Rect[],
  orientedW: number,
  orientedH: number,
): Rect | null {
  const clamped = clampRect(rect, orientedW, orientedH);
  if (
    (clamped.x !== rect.x || clamped.y !== rect.y) &&
    onPage.some((r) => rectsOverlap(clamped, r, GAP * 0.5))
  ) {
    return null;
  }
  return clamped;
}

/** Posición `u` centrada del cuadro, acotada al margen. */
function centeredU(orientedW: number, boxW: number): number {
  return Math.max(EDGE_MARGIN, Math.min((orientedW - boxW) / 2, orientedW - EDGE_MARGIN - boxW));
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
  const u = centeredU(orientedW, boxW);
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
  | { kind: 'placed'; page: number; rect: Rect; survey: PlacementSurvey }
  | { kind: 'no_free_slot'; page: number; survey: PlacementSurvey }
  | { kind: 'not_applicable' };

/**
 * Cuántas páginas se examinan al buscar dónde MÁS habría cabido. Se empieza
 * por el final —la firma pertenece al final del documento— y se para aquí: en
 * un expediente de doscientas hojas la lista queda incompleta, y eso es
 * preferible a recorrerlas todas cincuenta veces dentro del navegador.
 */
const MAX_PAGES_SURVEYED = 24;

/** Firmas previas con rect utilizable — las de tamaño cero no tapan nada. */
function visibleExisting(existing: readonly ExistingSigRect[]): ExistingSigRect[] {
  return existing.filter(
    (r) =>
      Number.isFinite(r.x) &&
      Number.isFinite(r.y) &&
      Number.isFinite(r.w) &&
      Number.isFinite(r.h) &&
      r.w > VISIBLE_MIN &&
      r.h > VISIBLE_MIN,
  );
}

/**
 * Páginas donde el cuadro POR DEFECTO habría cabido, excluida `excludePage`.
 *
 * Deliberadamente no participa en elegir: que quepa en la página 2 no es razón
 * para firmar ahí un contrato cuya última hoja está llena. Es lo que hay que
 * poder ofrecerle a una persona cuando se le dice que no cabe.
 *
 * Usa `boxW`/`boxH` tal cual, sin el encogido del anti-solape: la pregunta es
 * si cabe la estampa normal, no una recortada para meterla con calzador.
 */
function pagesWithRoom(
  geometry: readonly PageGeometry[],
  existing: readonly ExistingSigRect[],
  textBands: readonly TextBand[],
  boxW: number,
  boxH: number,
  excludePage: number,
): number[] {
  const visible = visibleExisting(existing);
  const out: number[] = [];
  let examined = 0;

  for (let i = geometry.length - 1; i >= 0 && examined < MAX_PAGES_SURVEYED; i--) {
    const geo = geometry[i]!;
    if (geo.page === excludePage) continue;
    examined++;

    const bandRects = textBandRects(textBands, geo);
    const onPage = [
      ...visible.filter((r) => r.page === geo.page).map((r) => rectToCanonical(geo, r)),
      ...bandRects,
    ];

    const { w: orientedW, h: orientedH } = orientedDims(geo);
    let rect: Rect;
    if (onPage.length === 0) {
      rect = computeDefaultFooterPlacement(geo, boxW, boxH);
    } else {
      const [slot] = enumerateSlots(onPage, orientedW, orientedH, boxW, boxH, {
        textAware: bandRects.length > 0,
        preferredU: centeredU(orientedW, boxW),
      });
      if (!slot) continue;
      rect = rectFromCanonical(geo, clampRect(slot.rect, orientedW, orientedH));
    }
    if (visibleSigRejection(rect, geo) === null) out.push(geo.page);
  }
  return out.sort((a, b) => a - b);
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
  textBands: readonly TextBand[] = [],
  anchor?: AnchorPlacementHint | undefined,
): AntiOverlapOutcome {
  const geoByPage = new Map(geometry.map((g) => [g.page, g]));

  const visible = visibleExisting(existing);
  if (visible.length === 0) return { kind: 'not_applicable' };

  const targetPage = Math.max(...visible.map((r) => r.page));
  const geo = geoByPage.get(targetPage);
  if (!geo) return { kind: 'not_applicable' };

  const { w: orientedW, h: orientedH } = orientedDims(geo);
  const w = Math.min(boxW, orientedW * 0.6);
  const h = Math.min(boxH, orientedH * 0.2);

  // El texto cuenta igual que una firma previa: un hueco "libre" que resulta
  // estar sobre un párrafo no es un hueco.
  const bandRects = textBandRects(textBands, geo);
  const onPage = [
    ...visible.filter((r) => r.page === targetPage).map((r) => rectToCanonical(geo, r)),
    ...bandRects,
  ];

  // FASE 3 (parte D) — GATEADO por `anchor !== undefined`: sin ancla activa,
  // ni una línea de aquí se ejecuta y el resultado es BYTE A BYTE el de
  // siempre (lo que sostienen las tablas congeladas del corpus real).
  //
  // Con el ancla activa, el anti-solape dejaba de heredar el criterio de
  // `reservedGapV`/el propio ancla: buscaba el primer hueco libre desde ABAJO
  // y olvidaba dónde iba la firma. Medido sobre 82 contratos reales: un
  // documento YA firmado que necesitaba una 2ª firma la mandaba al suelo de
  // la página (y=68) en vez de junto a la primera (y=311, donde la pondría
  // una persona). Con la 1ª firma como obstáculo, `enumerateSlots` la coloca
  // al lado si el ancla/hueco reservado lo permite; si no cabe ahí, el barrido
  // normal sigue siendo el respaldo.
  let preferredV: number | undefined;
  let preferredU: number | undefined;
  if (anchor !== undefined && anchor.page === targetPage) {
    preferredV = anchor.preferredV;
    preferredU = anchor.preferredU;
  } else {
    // Sin ancla TAMBIEN se busca el bloque de firma. La correccion de arriba
    // existia desde que se midio que "un documento YA firmado que necesitaba
    // una 2a firma la mandaba al suelo de la pagina en vez de junto a la
    // primera", pero estaba encerrada tras `anchor !== undefined` -- y en
    // produccion el unico productor de `anchor` es el hint de propagacion del
    // LOTE. Es decir: el arreglo nunca alcanzaba al caso que lo motivo, la
    // firma individual sobre un documento que ya trae una.
    //
    // Medido sobre un NDA real de dos firmantes con la primera firma ya
    // puesta: la caja pasa de x=18 (el borde de la hoja) a x=102,98, que es
    // exactamente donde arranca la raya del segundo firmante.
    // Se exige haber ENCONTRADO el bloque, no solo que exista un hueco. Sin
    // bandas de texto --una pagina que no se pudo recorrer-- "hueco reservado"
    // se calcularia solo con los rects de las firmas previas, que no dicen
    // nada sobre donde va la siguiente: seria una preferencia inventada. En
    // ese caso no se opina y el barrido de siempre decide, igual que antes.
    const reserved = reservedGapV(onPage, h);
    const bloque = reserved !== null ? signatureBlock(textBands, geo, reserved) : undefined;
    if (reserved !== null && bloque !== undefined) {
      preferredV = reserved;
      // Sin recorte de columna a proposito: el ancho aqui puede venir de un
      // hint de propagacion del lote, que es una decision explicita de la
      // persona, y este punto no distingue una cosa de la otra.
      preferredU = clampBlockU(bloque.u, w, orientedW);
    }
  }

  const slots = enumerateSlots(onPage, orientedW, orientedH, w, h, {
    textAware: bandRects.length > 0 || preferredV !== undefined,
    ...(preferredV !== undefined ? { preferredV } : {}),
    ...(preferredU !== undefined ? { preferredU } : {}),
  });
  // El mismo defecto P0 que ya tenía el guard en `tryAnchorPlacement` (ver
  // `clampAndRevalidate`), aquí sin guard hasta este fix: se aceptaba el
  // PRIMER slot enumerado y se devolvía `clampRect(slot.rect, ...)` sin volver
  // a comprobar el solape -- un `preferredV`/`preferredU` cerca del borde
  // podía salir `status:'ok'` con la estampa encima de una firma previa o una
  // banda de texto. Se prueba cada candidato en el mismo orden de preferencia
  // que ya traía `enumerateSlots`; el primero que sobreviva al acotado gana, y
  // si NINGUNO sobrevive el documento se aparta (`no_free_slot`), nunca `ok`
  // con un rect que no pasó el guard.
  let chosen: { slot: Slot; clamped: Rect } | undefined;
  for (const s of slots) {
    const clamped = clampAndRevalidate(s.rect, onPage, orientedW, orientedH);
    if (clamped) {
      chosen = { slot: s, clamped };
      break;
    }
  }
  if (!chosen) {
    return {
      kind: 'no_free_slot',
      page: targetPage,
      survey: {
        ...surveyOf(slots),
        clearance: null,
        alsoFits: pagesWithRoom(geometry, existing, textBands, boxW, boxH, targetPage),
      },
    };
  }

  const rect = rectFromCanonical(geo, chosen.clamped);
  return {
    kind: 'placed',
    page: targetPage,
    rect,
    survey: {
      ...surveyOf(slots),
      // Sobre el rect FINAL (tras acotar y pasar el guard), no sobre el
      // candidato sin acotar: medirlo antes del clamp reportaba una holgura
      // que ya no describía el rect de verdad devuelto (hallazgo QA
      // post-merge, mismo repro que el guard de arriba).
      clearance: Math.min(...onPage.map((r) => separation(chosen.clamped, r))),
      alsoFits: [],
    },
  };
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

/**
 * Intenta colocar la estampa exactamente donde señala un ancla de texto.
 *
 * El ancla NUNCA coloca por sí sola (ver la cabecera del módulo): se limita a
 * proponer `preferredV`/`preferredU` a `enumerateSlots`, que sigue mirando
 * firmas previas y bandas de texto como obstáculos. Se considera "honrada"
 * solo si el hueco elegido cae EXACTAMENTE en `preferredV` (mismo epsilon que
 * `reserved-gap`, ver más abajo): si el barrido tuvo que buscar en otro sitio
 * porque el preferido estaba ocupado, esto devuelve `null` y quien llama cae
 * al pipeline normal (anti-solape / hueco reservado / pie), arrastrando la
 * señal `ancla_sin_sitio` en el clasificador de confianza.
 */
function tryAnchorPlacement(
  anchor: AnchorPlacementHint,
  geometry: readonly PageGeometry[],
  existing: readonly ExistingSigRect[],
  textBands: readonly TextBand[],
  boxW: number,
  boxH: number,
  /**
   * Cuánto puede alejarse en `v` el hueco elegido del ancla y seguir contando
   * como "honrado". La rama 1.5 (ancla personalizada — nombre/cédula) pasa
   * `0.01`: exige coincidencia exacta, cero cambio de comportamiento respecto
   * a como funcionaba antes de que este parámetro existiera. El rescate por
   * ancla genérica pasa una tolerancia mucho mayor (ver
   * `rescueWithGenericAnchor`): ahí "cerca del ancla" es una banda entera, no
   * un punto.
   */
  toleranceV: number,
): {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: 0 | 90 | 180 | 270;
  survey: PlacementSurvey;
} | null {
  const geo = geometry.find((g) => g.page === anchor.page);
  if (!geo) return null;

  const { w: orientedW, h: orientedH } = orientedDims(geo);
  const visible = visibleExisting(existing).filter((r) => r.page === anchor.page);
  const bandRects = textBandRects(textBands, geo);
  const onPage = [...visible.map((r) => rectToCanonical(geo, r)), ...bandRects];

  const slots = enumerateSlots(onPage, orientedW, orientedH, boxW, boxH, {
    textAware: true,
    preferredV: anchor.preferredV,
    ...(anchor.preferredU !== undefined ? { preferredU: anchor.preferredU } : {}),
  });

  // El hueco más cercano al ancla en `v`, no forzosamente `slots[0]`: cuando el
  // preferido no cabe, el siguiente hueco de la lista (ordenada de abajo
  // arriba) no es necesariamente el más próximo al ancla. `slots` ya viene
  // acotado a `MAX_ENUMERATED_SLOTS` huecos por `enumerateSlots`, así que este
  // barrido es O(8), no una búsqueda sin límite.
  let best: Slot | undefined;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const s of slots) {
    const diff = Math.abs(s.v - anchor.preferredV);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }
  // >= , no > : la rama personalizada pasaba `Math.abs(...) >= 0.01` para
  // RECHAZAR antes de que este parámetro existiera -- mantener el mismo
  // limite (no solo el mismo valor) es lo que de verdad congela su
  // comportamiento previo, encontrado por QA post-merge.
  if (!best || bestDiff >= toleranceV) return null;

  // Eje `u` (hallazgo P1 QA post-merge): "honrado" comparaba SOLO `v`. Si
  // `preferredU` no era alcanzable en esta página (p.ej. un rect confirmado
  // en una página apaisada propagado a una vertical), el hueco más cercano en
  // `v` podía tener un `u` arbitrariamente lejos del pedido y esto igual
  // aceptaba con `source:'text-anchor'` -- "posición honrada" con la firma
  // corrida hasta cientos de puntos en el eje horizontal. Misma tolerancia
  // holgada que ya usa el rescate genérico (`anchorRescueToleranceV`, 2×boxH):
  // suficiente para el margen real de un bloque de firma, no cualquier hueco
  // libre de la página.
  if (
    anchor.preferredU !== undefined &&
    Math.abs(best.u - anchor.preferredU) >= anchorRescueToleranceV(boxH)
  ) {
    return null;
  }

  const clamped = clampAndRevalidate(best.rect, onPage, orientedW, orientedH);
  if (!clamped) return null;
  const rect = rectFromCanonical(geo, clamped);
  if (visibleSigRejection(rect, geo) !== null) return null;

  return {
    page: anchor.page,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    rotate: geo.rotate,
    // Antes ausente (hallazgo QA post-merge): sin esto, un rescate que cae
    // exactamente en el hueco más apretado de la pagina salia `alta`
    // indistinguible de una colocacion limpia -- las señales de estrechez
    // (`hueco_unico`/`hueco_justo`) viven detrás de `survey` en
    // `classifyPlacement` y sin dato no podian opinar.
    survey: {
      ...surveyOf(slots),
      clearance: Math.min(...onPage.map((r) => separation(clamped, r))),
      alsoFits: [],
    },
  };
}

/**
 * Tolerancia (pt) del rescate por ancla genérica — cuán lejos del ancla puede
 * caer el hueco elegido y seguir contando como "cerca de la etiqueta Firma".
 * `2 * boxH` (≈144pt con el cuadro por defecto de 72pt de alto): suficiente
 * para alcanzar el hueco justo encima o debajo del bloque de firma, sin
 * aceptar cualquier hueco libre de la página. Se calcula sobre el `boxH` real
 * y no sobre la constante por defecto, porque un cuadro personalizado cambia
 * qué cuenta como "cerca".
 */
function anchorRescueToleranceV(boxH: number): number {
  return 2 * boxH;
}

/**
 * Rescate por ancla GENÉRICA ("Firma"/"f)"/"firmado por", sin nombre ni
 * cédula que la respalde). No es una prioridad: es un último recurso que
 * SOLO se prueba cuando el pipeline normal (anti-solape, free-space) ya
 * dijo `no_free_slot` — nunca desplaza una colocación que ya funcionó, que
 * es justo el defecto medido en el corpus real (baja la confianza `alta` de
 * 62,2% a 59,6% en los 1.315 documentos que ya se colocaban bien).
 *
 * Devuelve `null` si no hay ancla genérica activa o si el rescate no
 * encuentra hueco dentro de {@link anchorRescueToleranceV}: quien llama debe
 * devolver el `needs_review` original SIN CAMBIOS (mismo `survey`).
 */
function rescueWithGenericAnchor(
  anchor: AnchorPlacementHint | undefined,
  geometry: readonly PageGeometry[],
  existing: readonly ExistingSigRect[],
  boxW: number,
  boxH: number,
  textBands: readonly TextBand[],
): AutoPlacement | null {
  if (!anchor || anchor.kind !== 'firma-label') return null;

  const anchored = tryAnchorPlacement(
    anchor,
    geometry,
    existing,
    textBands,
    boxW,
    boxH,
    anchorRescueToleranceV(boxH),
  );
  if (!anchored) return null;

  return { status: 'ok', ...anchored, source: 'text-anchor', anchorKind: anchor.kind };
}

/**
 * Único punto de saneamiento del ancla (hallazgo P1 QA post-merge): un
 * `preferredV`/`preferredU` no finito, o `preferredV` fuera de
 * `[0, orientedH]` de la página que indica `anchor.page`, se clampaba en
 * silencio a la cima de la página en `enumerateSlots`
 * (`Math.min(v, maxV)`) y salía `status:'ok', source:'anti-overlap'` sin
 * ninguna señal de que el hint venía corrupto.
 *
 * Se trata el ancla como si NO existiera para el resto del cómputo -- no se
 * "arregla" el valor, se descarta el ancla entera y el pipeline normal decide
 * con sus propios motivos, correctos. Si la página del ancla no tiene
 * geometría, no se puede acotar el rango: se deja pasar (ya lo resuelve
 * `tryAnchorPlacement`/`computeAntiOverlapPlacement`, que ignoran un
 * `anchor.page` sin geometría por su cuenta).
 */
function sanitizeAnchor(
  anchor: AnchorPlacementHint | undefined,
  geometry: readonly PageGeometry[],
): AnchorPlacementHint | undefined {
  if (!anchor) return undefined;
  if (!Number.isFinite(anchor.preferredV)) return undefined;
  if (anchor.preferredU !== undefined && !Number.isFinite(anchor.preferredU)) return undefined;

  const geo = geometry.find((g) => g.page === anchor.page);
  if (geo) {
    const { h: orientedH } = orientedDims(geo);
    if (anchor.preferredV < 0 || anchor.preferredV > orientedH) return undefined;
  }
  return anchor;
}

/**
 * DIAGNÓSTICO — no participa en la colocación real. El hueco más cercano al
 * ancla entre los que enumeraría el rescate, y a qué distancia en `v`. `null`
 * si la página del ancla no tiene geometría o si no se enumeró ningún hueco.
 *
 * Existe para instrumentar el embudo del rescate sobre el corpus real
 * (`scripts/measure-anchor-rescue-funnel.ts`) reusando el enumerador REAL en
 * vez de duplicar su lógica en un script aparte, que podría divergir en
 * silencio del motor y reportar números que no corresponden a lo que de
 * verdad se coloca.
 */
export function nearestRescueSlotDeltaV(
  anchor: AnchorPlacementHint,
  geometry: readonly PageGeometry[],
  existing: readonly ExistingSigRect[],
  textBands: readonly TextBand[],
  boxW: number = DEFAULT_SIG_BOX_W,
  boxH: number = DEFAULT_SIG_BOX_H,
): { slotsEnumerated: number; deltaV: number | null } {
  const geo = geometry.find((g) => g.page === anchor.page);
  if (!geo) return { slotsEnumerated: 0, deltaV: null };

  const { w: orientedW, h: orientedH } = orientedDims(geo);
  const visible = visibleExisting(existing).filter((r) => r.page === anchor.page);
  const bandRects = textBandRects(textBands, geo);
  const onPage = [...visible.map((r) => rectToCanonical(geo, r)), ...bandRects];

  const slots = enumerateSlots(onPage, orientedW, orientedH, boxW, boxH, {
    textAware: true,
    preferredV: anchor.preferredV,
    ...(anchor.preferredU !== undefined ? { preferredU: anchor.preferredU } : {}),
  });
  if (slots.length === 0) return { slotsEnumerated: 0, deltaV: null };

  const deltaV = Math.min(...slots.map((s) => Math.abs(s.v - anchor.preferredV)));
  return { slotsEnumerated: slots.length, deltaV };
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

  // Una página que no se pudo recorrer entera no aporta bandas: media lista de
  // texto engaña más que ninguna, porque el algoritmo la trata como completa.
  const unanalyzed = new Set(opts.unanalyzedPages ?? []);
  const textBands = (opts.textBands ?? []).filter((b) => !unanalyzed.has(b.page));

  // Saneamiento ÚNICO del ancla (hallazgo P1 QA post-merge, ver
  // `sanitizeAnchor`): a partir de aquí, `anchor` reemplaza a `opts.anchor` en
  // todo el resto de esta función. Un hint corrupto queda fuera del cómputo
  // por completo -- nunca llega a `tryAnchorPlacement` ni a
  // `computeAntiOverlapPlacement` -- así que tampoco puede confundir ningún
  // `reason` de `needs_review` con un problema real de geometría.
  const anchor = sanitizeAnchor(opts.anchor, geometry);

  // 1.5 — ancla PERSONALIZADA (FASE 3): antes que el anti-solape. Prioridad
  // §3.2-bis (revisada — medido en corpus real, 2026-08): empty-field > ancla
  // personalizada > anti-solape > free-space > default-footer. La ancla
  // GENÉRICA ("Firma"/"f)", sin nombre ni cédula) ya NO tiene prioridad
  // propia: es un RESCATE de último recurso (ver `rescueWithGenericAnchor`)
  // que solo se prueba cuando anti-solape o free-space ya dijeron
  // `no_free_slot` — anteponerla incondicionalmente no cerraba ninguno de los
  // documentos sin colocación y sí bajaba la confianza `alta` de 62,2% a
  // 59,6% en los que ya se colocaban bien. `tryAnchorPlacement` sigue
  // respetando firmas previas y texto como obstáculos: el ancla reordena,
  // nunca coloca por encima de nadie.
  if (anchor && anchor.kind !== 'firma-label') {
    const anchored = tryAnchorPlacement(anchor, geometry, existing, textBands, boxW, boxH, 0.01);
    if (anchored) {
      return { status: 'ok', ...anchored, source: 'text-anchor', anchorKind: anchor.kind };
    }
  }

  // 2. Anti-solape contra firmas visibles previas.
  if (existing.length > 0) {
    const outcome = computeAntiOverlapPlacement(geometry, existing, boxW, boxH, textBands, anchor);
    if (outcome.kind === 'no_free_slot') {
      // La página ya está ocupada por firmas previas y no queda hueco. Antes se
      // colocaba encima y se devolvía 'ok' (D4): se firmaba tapando la firma
      // anterior y el lote lo contaba como éxito limpio.
      //
      // Antes de apartar el documento, un último intento: si hay una etiqueta
      // "Firma" genérica cerca, puede que el hueco que el anti-solape descartó
      // (porque buscaba desde abajo, sin saber del ancla) sí sirva visto desde
      // el ancla. Rescate, no preferencia — solo entra aquí porque ya falló lo
      // normal.
      const rescued = rescueWithGenericAnchor(anchor, geometry, existing, boxW, boxH, textBands);
      if (rescued) return rescued;
      return {
        status: 'needs_review',
        page: outcome.page,
        reason: 'no_free_slot',
        survey: outcome.survey,
      };
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
          survey: outcome.survey,
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
    const reserved = reservedGapV(lastPageText, boxH);
    // Alineada con el bloque de firma, no centrada en la hoja: una firma se
    // pone sobre el margen del nombre impreso, que es donde la pondría una
    // persona. Solo cuando hay hueco reservado — en el pie por defecto el
    // centrado sigue siendo lo correcto.
    const bloque = reserved !== null ? signatureBlock(textBands, lastGeo, reserved) : undefined;
    // Si el bloque está a dos columnas -- dos firmantes lado a lado -- el
    // ancho por defecto se pasa de largo y el borde derecho de la estampa
    // acaba dentro del hueco que el documento reserva al COFIRMANTE. No pisa
    // texto, así que no lo caza ninguna comprobación de solape: se mete en el
    // blanco donde el otro tiene que firmar. Se recorta al arranque de esa
    // columna.
    //
    // Solo cuando el ancho es el POR DEFECTO: un `boxW` explícito viene de una
    // persona que ya eligió el tamaño (hint de propagación del lote), y esa
    // elección no se pisa.
    const columnas =
      opts.boxW === undefined && bloque !== undefined
        ? columnSplit(bloque.band, lastGeo, orientedW)
        : null;
    const anclaU = columnas?.anchorU ?? bloque?.u;
    const gapBoxW =
      columnas !== null ? widthWithinColumn(boxW, columnas.anchorU, columnas.boundary) : boxW;
    const alignedU = anclaU !== undefined ? clampBlockU(anclaU, gapBoxW, orientedW) : undefined;
    const slots = enumerateSlots(lastPageText, orientedW, orientedH, gapBoxW, boxH, {
      textAware: true,
      preferredU: alignedU ?? centeredU(orientedW, gapBoxW),
      ...(reserved !== null ? { preferredV: reserved } : {}),
    });
    const [slot] = slots;
    // ¿Acabó en el hueco reservado, o solo cerca? `preferredV` se prueba antes
    // que ninguna otra altura, así que el hueco reservado se HONRÓ si y solo si
    // la altura elegida es esa misma. Si el rect no cabía ahí, el barrido
    // siguió y devolvió otra cosa: eso es `free-space` corriente, y merece las
    // señales de estrechez que `reserved-gap` no merece.
    const inReservedGap =
      reserved !== null && slot !== undefined && Math.abs(slot.v - reserved) < 0.01;
    let rejected: VisibleSigRejection | null = null;
    if (slot) {
      const rect = rectFromCanonical(lastGeo, slot.rect);
      const rejection = visibleSigRejection(rect, lastGeo);
      rejected = rejection;
      if (rejection === null) {
        return {
          status: 'ok',
          page: lastGeo.page,
          x: rect.x,
          y: rect.y,
          w: rect.w,
          h: rect.h,
          rotate: lastGeo.rotate,
          source: inReservedGap ? 'reserved-gap' : 'free-space',
          survey: {
            ...surveyOf(slots),
            clearance: Math.min(...lastPageText.map((r) => separation(slot.rect, r))),
            alsoFits: [],
          },
        };
      }
    }
    // La página está escrita de arriba abajo. Colocar la estampa encima del
    // texto es peor que no firmarla: se aparta para que una persona decida.
    //
    // Pero "no cabía" y "cabía y el rect no valía" son cosas distintas, y esta
    // rama las confundía: con un hueco encontrado y rechazado devolvía
    // `no_free_slot`, que la pantalla traduce a "no queda espacio en blanco".
    // Se mandaba a la persona a buscar sitio cuando el problema era, por
    // ejemplo, un MediaBox que no arranca en el origen. Las otras dos ramas
    // —anti-solape y pie— sí propagaban el motivo real; esta es la simetría
    // que faltaba. `no_free_slot` queda reservado a que no hubiera ni un hueco.
    //
    // Igual que en el anti-solape: solo se rescata el `no_free_slot` real (no
    // había ni un hueco). Un `free_space_<rejection>` es un hueco que SÍ se
    // encontró y el ancla no tiene nada que arreglar ahí — el problema es
    // geométrico (MediaBox, tamaño), no de prioridad.
    if (!rejected) {
      const rescued = rescueWithGenericAnchor(anchor, geometry, existing, boxW, boxH, textBands);
      if (rescued) return rescued;
    }
    return {
      status: 'needs_review',
      page: lastGeo.page,
      reason: rejected ? `free_space_${rejected}` : 'no_free_slot',
      survey: {
        ...surveyOf(slots),
        clearance: null,
        alsoFits: pagesWithRoom(geometry, existing, textBands, boxW, boxH, lastGeo.page),
      },
    };
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
