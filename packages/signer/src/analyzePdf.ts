/**
 * analyzePdf.ts — ÚNICA entrada pública para analizar un PDF de cara a la
 * colocación automática de la firma visible.
 *
 * Por qué existe: `readPageGeometry` exige un `PDFDocument` de pdf-lib y
 * pdf-lib NO es (ni debe ser) dependencia de `apps/pwa`. Sin esta función, la
 * PWA no puede calcular la colocación ni con toda la voluntad — la firma
 * pública de aquí acepta BYTES y devuelve datos planos, así que pdf-lib queda
 * confinado a este paquete. Nada de tipos de pdf-lib cruza la frontera (eso es
 * lo que permite, además, mandar el resultado por `postMessage` si hiciera
 * falta).
 *
 * Qué mira, en un solo recorrido del documento:
 *   - geometría real por página (`/MediaBox`, `/CropBox`, `/Rotate`) →
 *     `readPageGeometry`;
 *   - widgets `/Subtype /Widget` con `/FT /Sig` (posiblemente heredado del
 *     `/Parent`): CON `/V` son firmas ya puestas — su `/Rect` es lo que el
 *     anti-solape debe esquivar; SIN `/V` son campos que el documento declara
 *     para que la firma vaya justo ahí.
 *
 * Contrato de robustez: un PDF corrupto, cifrado o ilegible NO revienta. Se
 * devuelve lo que se pudo leer (y listas vacías en el peor caso) porque un
 * documento ilegible del lote debe acabar en `needs_review`, no tumbar el
 * proceso entero.
 *
 * Módulo puro: sin red, sin disco, sin reloj.
 */

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib';

import type { EmptySigField, ExistingSigRect } from './autoPlacement.js';
import { type PageGeometry, readPageGeometry } from './pageGeometry.js';
import { type TextBand, readTextBands } from './textBands.js';

/**
 * Por qué el documento no se pudo leer. `undefined` = se leyó bien.
 *
 * Existe porque un análisis vacío tenía DOS causas indistinguibles y la
 * colocación las traducía a `document_has_no_pages`, que para un PDF cifrado o
 * corrupto es sencillamente falso: no es que no tenga páginas, es que no se
 * pudo abrir. Y el cifrado además es un caso de producto, no un fallo:
 * `pades.ts` carga SIN `ignoreEncryption`, así que firmar un PDF cifrado
 * revienta SIEMPRE — tiene que salir apartado, con su motivo, no como error
 * opaco al final del lote.
 */
export type PdfAnalysisFailure = 'encrypted' | 'unreadable';

/** Todo lo que `computeAutoPlacement` necesita, en datos planos. */
export interface PdfPlacementAnalysis {
  /** Geometría resuelta de cada página (vacío si el PDF no se pudo abrir). */
  geometry: PageGeometry[];
  /** Rects de firmas visibles previas (widgets `/FT /Sig` CON `/V`). */
  existing: ExistingSigRect[];
  /** Widgets `/FT /Sig` SIN `/V` — el documento declara dónde quiere la firma. */
  emptySigFields: EmptySigField[];
  /**
   * Franjas verticales donde hay texto, para que la colocación automática no
   * estampe encima de una cláusula.
   */
  textBands: TextBand[];
  /**
   * Páginas cuyo contenido NO se pudo recorrer entero. Sin esta lista, "no hay
   * texto" y "no pude mirar" eran el mismo `textBands: []` y la colocación
   * trataba una página ilegible como una hoja en blanco — buscaba hueco donde
   * no sabía qué había. Estas páginas vuelven al pie de página de siempre.
   */
  unanalyzedPages: number[];
  /**
   * Subconjunto de {@link unanalyzedPages}: páginas sin una sola letra visible
   * cuyo contenido es, en su mayor parte, una imagen colocada — un escaneo.
   *
   * Se propaga aparte porque el MOTIVO cambia la respuesta. Una hoja realmente
   * en blanco y un contrato escaneado llegan a la colocación exactamente igual
   * —sin bandas de texto— y salen exactamente igual: estampa al pie. La
   * diferencia es que en la segunda no sabemos qué hay debajo. Sin esta lista,
   * las dos son indistinguibles para quien tenga que decidir si enseñar una
   * vista previa.
   */
  imageOnlyPages: number[];
  /**
   * Subconjunto de {@link unanalyzedPages}: páginas cuyo único texto va en modo
   * invisible (`3 Tr` / `7 Tr`), la capa OCR de un escaneo. Mismo razonamiento
   * que {@link imageOnlyPages}.
   */
  ocrOnlyPages: number[];
  /** Presente solo si el documento no se pudo leer. Ver {@link PdfAnalysisFailure}. */
  failure?: PdfAnalysisFailure;
}

/**
 * Tope de saltos al resolver `/FT` heredado por la cadena `/Parent`.
 *
 * La jerarquía de campos AcroForm de un PDF real tiene 2-3 niveles (formulario
 * → grupo → widget); 8 deja margen de sobra y, sobre todo, corta en seco un
 * `/Parent` cíclico de un documento malformado, que sin cota cuelga el worker.
 */
const MAX_FIELD_PARENT_DEPTH = 8;

/**
 * Lado mínimo (pt) para considerar un `/Rect` utilizable.
 *
 * Un widget de firma con lado 0 es la forma canónica de declarar una firma
 * INVISIBLE (PDF 32000-1 §12.7.4.5): no ocupa sitio, así que no estorba al
 * anti-solape ni sirve como destino de colocación. Se descarta en vez de
 * propagar un rect degenerado que produciría una estampa de área nula.
 */
const MIN_USABLE_RECT_SIDE = 0;

/** Lee el nombre PDF de una clave, sin la barra inicial. `undefined` si no es un nombre. */
function nameValue(dict: PDFDict, key: string): string | undefined {
  const raw = dict.lookup(PDFName.of(key));
  if (!(raw instanceof PDFName)) return undefined;
  return raw.asString().replace(/^\//, '');
}

/**
 * Resuelve `/FT` en el propio widget o, si no lo tiene, subiendo por `/Parent`
 * (PDF 32000-1 §12.7.3.1: `/FT` es heredable). Un widget de firma que hereda su
 * `/FT` es exactamente el caso que, si se ignora, hace que el documento parezca
 * no tener campo de firma y la estampa acabe en cualquier otro sitio.
 */
function resolveFieldType(widget: PDFDict): string | undefined {
  let current: PDFDict | undefined = widget;
  for (let depth = 0; depth < MAX_FIELD_PARENT_DEPTH && current; depth += 1) {
    const ft = nameValue(current, 'FT');
    if (ft !== undefined) return ft;
    const parent: unknown = current.lookup(PDFName.of('Parent'));
    current = parent instanceof PDFDict ? parent : undefined;
  }
  return undefined;
}

/**
 * ¿Este campo tiene valor (`/V`), propio o heredado del `/Parent`?
 *
 * `/V` es heredable por la misma cláusula que `/FT` (PDF 32000-1 §12.7.3.1) y
 * los productores que separan campo y widget lo ponen en el padre. Mirarlo solo
 * en el widget era el defecto A2: una firma YA PUESTA salía clasificada como
 * "campo de firma vacío", y como la rama `empty-field` tiene prioridad sobre
 * todo lo demás, la colocación devolvía el rect EXACTO de la firma existente
 * (160×60 ≥ el mínimo de 30×30, así que la validación decía OK) y se firmaba
 * encima de la firma anterior.
 */
function hasFieldValue(widget: PDFDict): boolean {
  let current: PDFDict | undefined = widget;
  for (let depth = 0; depth < MAX_FIELD_PARENT_DEPTH && current; depth += 1) {
    if (current.lookup(PDFName.of('V')) !== undefined) return true;
    const parent: unknown = current.lookup(PDFName.of('Parent'));
    current = parent instanceof PDFDict ? parent : undefined;
  }
  return false;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * `/Rect` → rect normalizado (x/y mínimos, ancho/alto absolutos). El array del
 * PDF es `[x1 y1 x2 y2]` y la spec NO garantiza que la primera esquina sea la
 * inferior-izquierda, así que asumirlo produce anchos negativos.
 */
function readRect(dict: PDFDict): Rect | undefined {
  const arr = dict.lookup(PDFName.of('Rect'));
  if (!(arr instanceof PDFArray) || arr.size() < 4) return undefined;
  const nums: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const n = arr.lookup(i);
    if (!(n instanceof PDFNumber)) return undefined;
    const v = n.asNumber();
    if (!Number.isFinite(v)) return undefined;
    nums.push(v);
  }
  const [x1, y1, x2, y2] = nums as [number, number, number, number];
  const rect: Rect = {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
  if (rect.w <= MIN_USABLE_RECT_SIDE || rect.h <= MIN_USABLE_RECT_SIDE) return undefined;
  return rect;
}

/** Recorre `/Annots` de una página y reparte los widgets de firma en los dos cubos. */
function collectSigWidgets(
  pageNode: PDFDict,
  pageIndex: number,
  existing: ExistingSigRect[],
  emptySigFields: EmptySigField[],
): void {
  const annots = pageNode.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) return;

  for (let i = 0; i < annots.size(); i += 1) {
    let widget: unknown;
    try {
      widget = annots.lookup(i);
    } catch {
      // Referencia rota a una anotación: se salta ESA anotación, no el
      // documento (un PDF malformado no debe costar el lote entero).
      continue;
    }
    if (!(widget instanceof PDFDict)) continue;
    if (nameValue(widget, 'Subtype') !== 'Widget') continue;
    if (resolveFieldType(widget) !== 'Sig') continue;

    const rect = readRect(widget);
    if (!rect) continue;

    (hasFieldValue(widget) ? existing : emptySigFields).push({ page: pageIndex, ...rect });
  }
}

/**
 * Analiza `pdfBytes` y devuelve geometría + firmas previas + campos de firma
 * vacíos, listo para `computeAutoPlacement`.
 *
 * Nunca lanza: si el documento no se puede abrir devuelve el análisis vacío, y
 * si una página o anotación concreta es ilegible se salta solo esa.
 */
export async function analyzePdfForPlacement(pdfBytes: Uint8Array): Promise<PdfPlacementAnalysis> {
  const existing: ExistingSigRect[] = [];
  const emptySigFields: EmptySigField[] = [];

  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(pdfBytes, {
      // Se carga tolerando el cifrado para poder DISTINGUIRLO (`isEncrypted`)
      // de un documento simplemente corrupto; el cifrado se reporta abajo.
      ignoreEncryption: true,
      throwOnInvalidObject: false,
      updateMetadata: false,
    });
  } catch {
    return {
      geometry: [],
      existing,
      emptySigFields,
      textBands: [],
      unanalyzedPages: [],
      imageOnlyPages: [],
      ocrOnlyPages: [],
      failure: 'unreadable',
    };
  }

  // A6 — un PDF cifrado se leía "ok" aquí y reventaba SIEMPRE al firmar
  // (`pades.ts` e `incrementalUpdate.ts` cargan sin `ignoreEncryption`), así
  // que el documento salía como error genérico al final del lote en vez de
  // apartado. Se reporta antes de mirar nada más: por muy legible que sea su
  // geometría, este documento no se puede firmar por este camino.
  if (pdfDoc.isEncrypted) {
    return {
      geometry: [],
      existing,
      emptySigFields,
      textBands: [],
      unanalyzedPages: [],
      imageOnlyPages: [],
      ocrOnlyPages: [],
      failure: 'encrypted',
    };
  }

  let geometry: PageGeometry[];
  try {
    geometry = readPageGeometry(pdfDoc);
  } catch {
    return {
      geometry: [],
      existing,
      emptySigFields,
      textBands: [],
      unanalyzedPages: [],
      imageOnlyPages: [],
      ocrOnlyPages: [],
      failure: 'unreadable',
    };
  }

  for (const [index, page] of pdfDoc.getPages().entries()) {
    try {
      collectSigWidgets(page.node, index, existing, emptySigFields);
    } catch {
      // Página con /Annots ilegible: se conserva su geometría (ya leída) y se
      // renuncia solo a sus widgets.
    }
  }

  // El contenido es informativo: si no se puede recorrer, la colocación sigue
  // funcionando sin él (peor, pero funcionando). Lo que NO puede pasar es que
  // un fallo aquí se lea como "la página está en blanco" — de ahí que el fallo
  // marque TODAS las páginas como no analizadas, no ninguna.
  let textBands: TextBand[] = [];
  let unanalyzedPages: number[] = [];
  let imageOnlyPages: number[] = [];
  let ocrOnlyPages: number[] = [];
  try {
    const result = readTextBands(pdfDoc);
    textBands = result.bands;
    unanalyzedPages = result.unanalyzedPages;
    imageOnlyPages = result.imageOnlyPages;
    ocrOnlyPages = result.ocrOnlyPages;
  } catch {
    textBands = [];
    unanalyzedPages = geometry.map((g) => g.page);
    // No se sabe POR QUÉ no se pudo leer, así que no se afirma que fuera un
    // escaneo: "no analizada" es lo único cierto aquí.
    imageOnlyPages = [];
    ocrOnlyPages = [];
  }

  return {
    geometry,
    existing,
    emptySigFields,
    textBands,
    unanalyzedPages,
    imageOnlyPages,
    ocrOnlyPages,
  };
}
