/**
 * fontWidths.ts — resuelve `/Resources /Font/<nombre>` a los ANCHOS de sus
 * glifos, que es lo unico que hace falta para saber donde TERMINA una linea.
 *
 * Es el hermano metrico de `fontResources.ts`: aquel resuelve la fuente a un
 * decoder de code points (que letra es cada byte), este a un ancho por codigo
 * (cuanto avanza cada byte). Van por separado a proposito — el decoder solo
 * existe cuando alguien pide el ancla de texto, mientras que los anchos hacen
 * falta SIEMPRE que se lean bandas, y arrastrar `/ToUnicode` para medir un
 * avance seria pagar el parseo caro por el dato barato.
 *
 * Privacidad: igual que `fontResources.ts`, aqui NUNCA sale ni un caracter del
 * documento. Solo entran codigos (numeros) y salen anchos (numeros).
 *
 * Nunca lanza: cualquier fuente ilegible degrada a `null` —"no se sabe el
 * ancho"— y quien estima el fin de linea simplemente no opina sobre esa linea.
 */

import { PDFArray, PDFDict, type PDFDocument, PDFName, PDFNumber, PDFRef } from 'pdf-lib';

import { standardFontKey, standardWidth } from './standardFontWidths.js';

/**
 * Tope de fuentes DISTINTAS a las que se les leen anchos por documento. Mismo
 * criterio que `MAX_FONTS_PER_DOC` en `fontResources.ts`: un documento con
 * cientos de subconjuntos no puede forzar un parseo sin limite.
 */
export const MAX_WIDTH_FONTS_PER_DOC = 64;

/**
 * Tope de entradas leidas del `/W` de una fuente CID. Un `/W` legitimo de un
 * subconjunto real anda en cientos; el formato admite rangos
 * (`cfirst clast w`) que se expandirian a millones de claves si se aceptara
 * cualquier cosa. Pasado el tope se deja de leer y lo que quede cae a `/DW`.
 */
export const MAX_CID_WIDTH_ENTRIES = 65_536;

/** Ancho por defecto de una fuente CID sin `/DW` (ISO 32000-1 §9.7.4.3). */
const DEFAULT_CID_WIDTH = 1000;

/** Los anchos de UNA fuente, ya resueltos. */
export interface FontWidths {
  /**
   * Bytes por codigo en el content stream: 1 en fuentes simples, 2 en Type0.
   *
   * Las Type0 se tratan SIEMPRE como 2 bytes: es lo que emite Identity-H, que
   * es practicamente lo unico que se ve en documentos de ofimatica. Una CMap
   * predefinida de ancho variable se mediria mal — por eso el estimador exige
   * ademas que la longitud de la cadena sea par antes de creerse el avance.
   */
  codeLength: 1 | 2;
  /** Ancho en milesimas de em del codigo, o `null` si no se conoce. */
  widthOf(code: number): number | null;
}

function resolve(pdfDoc: PDFDocument, value: unknown): unknown {
  return value instanceof PDFRef ? pdfDoc.context.lookup(value) : value;
}

function numberAt(pdfDoc: PDFDocument, dict: PDFDict, key: string): number | null {
  const v = resolve(pdfDoc, dict.get(PDFName.of(key)));
  if (v instanceof PDFNumber) {
    const n = v.asNumber();
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function nameAt(pdfDoc: PDFDocument, dict: PDFDict, key: string): string | null {
  const v = resolve(pdfDoc, dict.get(PDFName.of(key)));
  return v instanceof PDFName ? v.decodeText() : null;
}

/** El `/Widths` de una fuente simple como mapa denso desde `/FirstChar`. */
function simpleWidths(pdfDoc: PDFDocument, fontDict: PDFDict): number[] | null {
  const arr = resolve(pdfDoc, fontDict.get(PDFName.of('Widths')));
  if (!(arr instanceof PDFArray)) return null;
  const out: number[] = [];
  for (const entry of arr.asArray()) {
    const v = resolve(pdfDoc, entry);
    // Un hueco no numerico no se salta: desplazaria todos los codigos
    // siguientes. Se marca con `NaN`, que `widthOf` trata como desconocido.
    out.push(v instanceof PDFNumber && Number.isFinite(v.asNumber()) ? v.asNumber() : Number.NaN);
  }
  return out.length > 0 ? out : null;
}

/** El `/MissingWidth` del `/FontDescriptor`, o `null`. */
function missingWidthOf(pdfDoc: PDFDocument, fontDict: PDFDict): number | null {
  const fd = resolve(pdfDoc, fontDict.get(PDFName.of('FontDescriptor')));
  return fd instanceof PDFDict ? numberAt(pdfDoc, fd, 'MissingWidth') : null;
}

function buildSimpleWidths(pdfDoc: PDFDocument, fontDict: PDFDict): FontWidths | null {
  const widths = simpleWidths(pdfDoc, fontDict);
  const firstChar = numberAt(pdfDoc, fontDict, 'FirstChar') ?? 0;
  const missing = missingWidthOf(pdfDoc, fontDict);
  const baseFont = nameAt(pdfDoc, fontDict, 'BaseFont');
  // La tabla estandar es el RESPALDO, no la primera opcion: un `/Widths`
  // incrustado describe la fuente real (subconjunto, kerning aplanado); la
  // tabla AFM solo describe la Helvetica de Adobe.
  const stdKey = baseFont ? standardFontKey(baseFont) : null;
  if (!widths && stdKey === null && missing === null) return null;

  return {
    codeLength: 1,
    widthOf(code: number): number | null {
      if (widths) {
        const w = widths[code - firstChar];
        if (w !== undefined && Number.isFinite(w)) return w;
      }
      if (stdKey !== null) {
        const w = standardWidth(stdKey, code);
        if (w !== null) return w;
      }
      return missing;
    },
  };
}

/**
 * `/W` de una fuente CID: `[ c [w1 w2 …] cFirst cLast w … ]` (ISO 32000-1
 * §9.7.4.3). Se aplana a un `Map` por CID; los rangos se expanden hasta
 * {@link MAX_CID_WIDTH_ENTRIES} y lo que sobre cae a `/DW`.
 */
function parseCidWidths(pdfDoc: PDFDocument, w: PDFArray): Map<number, number> {
  const out = new Map<number, number>();
  const items = w.asArray().map((e) => resolve(pdfDoc, e));
  let i = 0;
  while (i < items.length && out.size < MAX_CID_WIDTH_ENTRIES) {
    const first = items[i];
    if (!(first instanceof PDFNumber)) break;
    const start = first.asNumber();
    const second = items[i + 1];
    if (second instanceof PDFArray) {
      const list = second.asArray();
      for (let k = 0; k < list.length && out.size < MAX_CID_WIDTH_ENTRIES; k++) {
        const v = resolve(pdfDoc, list[k]);
        if (v instanceof PDFNumber && Number.isFinite(v.asNumber()))
          out.set(start + k, v.asNumber());
      }
      i += 2;
      continue;
    }
    const third = items[i + 2];
    if (second instanceof PDFNumber && third instanceof PDFNumber) {
      const end = second.asNumber();
      const width = third.asNumber();
      if (Number.isFinite(end) && Number.isFinite(width) && end >= start) {
        for (let c = start; c <= end && out.size < MAX_CID_WIDTH_ENTRIES; c++) out.set(c, width);
      }
      i += 3;
      continue;
    }
    break; // forma que no es ninguna de las dos: el resto del array no es fiable
  }
  return out;
}

function buildType0Widths(pdfDoc: PDFDocument, fontDict: PDFDict): FontWidths | null {
  const descendants = resolve(pdfDoc, fontDict.get(PDFName.of('DescendantFonts')));
  if (!(descendants instanceof PDFArray)) return null;
  const cidFont = resolve(pdfDoc, descendants.asArray()[0]);
  if (!(cidFont instanceof PDFDict)) return null;

  const dw = numberAt(pdfDoc, cidFont, 'DW') ?? DEFAULT_CID_WIDTH;
  const wArray = resolve(pdfDoc, cidFont.get(PDFName.of('W')));
  const widths =
    wArray instanceof PDFArray ? parseCidWidths(pdfDoc, wArray) : new Map<number, number>();

  return {
    codeLength: 2,
    widthOf(code: number): number | null {
      // Identity-H: el codigo de 2 bytes ES el CID. Con cualquier otra CMap
      // esto seria una aproximacion, y por eso el llamador solo confia en el
      // avance de una Type0 cuando la cadena tiene longitud par.
      return widths.get(code) ?? dw;
    },
  };
}

/** El diccionario de fuente para `fontName` dentro de `resources`. */
function getFontDict(pdfDoc: PDFDocument, resources: PDFDict, fontName: string): PDFDict | null {
  if (!fontName.startsWith('/')) return null;
  const fonts = resolve(pdfDoc, resources.get(PDFName.of('Font')));
  if (!(fonts instanceof PDFDict)) return null;
  const resolved = resolve(pdfDoc, fonts.get(PDFName.of(fontName.slice(1))));
  return resolved instanceof PDFDict ? resolved : null;
}

/** Resuelve `/Resources /Font/<nombre>` a sus anchos, con cache por documento. */
export interface FontWidthCache {
  resolveWidths(resources: PDFDict | null, fontName: string | undefined): FontWidths | null;
}

/**
 * Cache de anchos a nivel de DOCUMENTO. Misma clave que `fontResources.ts` —el
 * `PDFDict` de la fuente, via `WeakMap`— y por la misma razon: un `/Font/F1`
 * puede ser un diccionario directo sin `PDFRef`, y cachear por ref dejaba esos
 * casos re-parseandose en cada operacion de texto.
 *
 * El valor cacheado incluye el `null`: una fuente sin metricas no se reintenta.
 */
export function createFontWidthCache(pdfDoc: PDFDocument): FontWidthCache {
  const cache = new WeakMap<PDFDict, FontWidths | null>();
  let fontCount = 0;

  return {
    resolveWidths(resources: PDFDict | null, fontName: string | undefined): FontWidths | null {
      try {
        if (!resources || !fontName) return null;
        const dict = getFontDict(pdfDoc, resources, fontName);
        if (!dict) return null;

        const cached = cache.get(dict);
        if (cached !== undefined) return cached;
        if (fontCount >= MAX_WIDTH_FONTS_PER_DOC) {
          cache.set(dict, null);
          return null;
        }
        fontCount++;

        const subtype = nameAt(pdfDoc, dict, 'Subtype');
        const built =
          subtype === 'Type0' ? buildType0Widths(pdfDoc, dict) : buildSimpleWidths(pdfDoc, dict);
        cache.set(dict, built);
        return built;
      } catch {
        // Mudo A PROPOSITO, mismo contrato que `fontResources.ts`: un
        // `/Widths` o un `/W` con forma corrupta puede lanzar con metadatos
        // del documento dentro del mensaje. Un fallo de fuente jamas puede
        // degradar las bandas — se cae a "sin anchos" y el estimador calla.
        return null;
      }
    },
  };
}
