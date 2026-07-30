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

/** Todo lo que `computeAutoPlacement` necesita, en datos planos. */
export interface PdfPlacementAnalysis {
  /** Geometría resuelta de cada página (vacío si el PDF no se pudo abrir). */
  geometry: PageGeometry[];
  /** Rects de firmas visibles previas (widgets `/FT /Sig` CON `/V`). */
  existing: ExistingSigRect[];
  /** Widgets `/FT /Sig` SIN `/V` — el documento declara dónde quiere la firma. */
  emptySigFields: EmptySigField[];
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

    const hasValue = widget.lookup(PDFName.of('V')) !== undefined;
    (hasValue ? existing : emptySigFields).push({ page: pageIndex, ...rect });
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
      // Un PDF cifrado con owner-password vacío es legible para geometría;
      // negarse aquí lo mandaría a needs_review sin necesidad.
      ignoreEncryption: true,
      throwOnInvalidObject: false,
      updateMetadata: false,
    });
  } catch {
    return { geometry: [], existing, emptySigFields };
  }

  let geometry: PageGeometry[];
  try {
    geometry = readPageGeometry(pdfDoc);
  } catch {
    return { geometry: [], existing, emptySigFields };
  }

  for (const [index, page] of pdfDoc.getPages().entries()) {
    try {
      collectSigWidgets(page.node, index, existing, emptySigFields);
    } catch {
      // Página con /Annots ilegible: se conserva su geometría (ya leída) y se
      // renuncia solo a sus widgets.
    }
  }

  return { geometry, existing, emptySigFields };
}
