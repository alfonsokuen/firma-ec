import type { ExistingSigRect } from '../../ui/firma/smartPlacement.ts';
import type { PageDim } from '../../ui/firma/smartPlacement.ts';

/**
 * signatureScan.ts — el barrido de widgets de firma de un PDF, extraído de
 * `PdfPreview.svelte` para poder probarlo.
 *
 * 🔴 El defecto que motivó la extracción: el bucle hacía `catch { annots = [] }`
 * por página, sin log ni marca. Una página cuyo diccionario de anotaciones no
 * parsea entraba al resultado como página **sin firmas**, y el escaneo salía
 * con la forma exacta de un escaneo completo. Aguas abajo eso significa que
 * `computeSmartPlacement` coloca la caja encima de una firma que nunca vio y
 * que, en el lote, `overlapsExistingSignature` da `false` sobre una lista
 * incompleta — con lo que el aviso de solape, la única doble confirmación que
 * hay en ese flujo, no llega a dispararse. Resultado posible: un PDF entregado
 * con el sello encima de la firma del co-firmante, irreversible (ya se gastó
 * PKCS#7 + TSA + OCSP) y sin una sola línea en consola.
 *
 * Por eso el resultado ahora distingue «no hay firmas» de «no pude mirar»:
 * quien consume decide, pero ya no puede confundirlos.
 *
 * Trabaja contra una interfaz mínima ({@link ScannableDoc}) y no contra pdf.js,
 * para que los tests puedan pasar dobles con páginas que fallan a voluntad.
 */

/** Lo que este módulo necesita de una página; pdf.js lo cumple de sobra. */
export interface ScannablePage {
  getViewport(opts: { scale: number }): { width: number; height: number };
  getAnnotations(opts: { intent: string }): Promise<ScannableAnnotation[]>;
}

/** Anotación tal como la publica pdf.js (campos que aquí importan). */
export interface ScannableAnnotation {
  subtype?: string;
  fieldType?: string;
  rect?: unknown;
}

/** Lo que este módulo necesita de un documento. */
export interface ScannableDoc {
  numPages: number;
  getPage(pageNumber: number): Promise<ScannablePage>;
}

export interface SignatureScan {
  /** Rects en espacio de usuario PDF (pt, origen abajo-izquierda), 0-based. */
  widgets: ExistingSigRect[];
  /** Dimensiones de las páginas efectivamente recorridas. */
  pageDims: PageDim[];
  /**
   * `true` si alguna página no pudo mirarse. **El anti-solape no es fiable**:
   * puede haber firmas que no están en `widgets`. No es lo mismo que
   * `widgets.length === 0`, y ésa es justo la confusión que costaba caro.
   */
  incomplete: boolean;
  /** Cuántas páginas fallaron (0 cuando `incomplete` es `false`). */
  failedPages: number;
}

/**
 * Páginas a partir de las cuales no se recorre el documento entero: en un
 * documento legal las firmas viven al final, y barrer mil páginas en un móvil
 * cuesta más de lo que aporta.
 */
export const SCAN_FULL_MAX_PAGES = 50;
export const SCAN_TAIL_PAGES = 15;

/** Rect degenerado o ausente: no hay nada visible que esquivar. */
function rectOf(a: ScannableAnnotation): { x: number; y: number; w: number; h: number } | null {
  const r = a.rect;
  if (!Array.isArray(r) || r.length < 4) return null;
  const [x0, y0, x1, y1] = r as number[];
  if (![x0, y0, x1, y1].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return {
    x: Math.min(x0 as number, x1 as number),
    y: Math.min(y0 as number, y1 as number),
    w: Math.abs((x1 as number) - (x0 as number)),
    h: Math.abs((y1 as number) - (y0 as number)),
  };
}

/**
 * Recorre el documento y devuelve los widgets de firma que encuentra.
 *
 * **Nunca lanza**: un documento ilegible produce un resultado `incomplete`, no
 * una excepción — quien llama está pintando una vista previa y no puede
 * permitirse que esto tumbe el flujo. Pero tampoco miente: si una página no se
 * pudo mirar, se dice.
 */
export async function scanSignatureWidgets(doc: ScannableDoc): Promise<SignatureScan> {
  const widgets: ExistingSigRect[] = [];
  const pageDims: PageDim[] = [];
  let failedPages = 0;

  const total = doc.numPages;
  const start = total > SCAN_FULL_MAX_PAGES ? Math.max(0, total - SCAN_TAIL_PAGES) : 0;

  for (let i = start; i < total; i++) {
    try {
      const page = await doc.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      pageDims.push({ page: i, w: vp.width, h: vp.height });
      // El fallo de anotaciones se cuenta APARTE del de la página entera: en
      // este caso sí sabemos el tamaño de la página (sirve para colocar), pero
      // no si tiene firmas — y eso es exactamente lo que hay que confesar.
      let annots: ScannableAnnotation[];
      try {
        annots = await page.getAnnotations({ intent: 'display' });
      } catch {
        failedPages += 1;
        continue;
      }
      for (const a of annots) {
        if (a.subtype !== 'Widget' || a.fieldType !== 'Sig') continue;
        const rect = rectOf(a);
        if (!rect) continue;
        widgets.push({ page: i, ...rect });
      }
    } catch {
      // La página entera es inaccesible: ni dimensiones ni anotaciones.
      failedPages += 1;
    }
  }

  return { widgets, pageDims, incomplete: failedPages > 0, failedPages };
}
