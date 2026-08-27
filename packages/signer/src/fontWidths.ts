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
 * Tope de INTERVALOS leidos del `/W` de las fuentes CID de UN documento, sumados.
 *
 * "Intervalos", no CIDs: un `[cFirst cLast w]` ocupa UNA entrada aunque cubra
 * cien mil codigos. Esa es la diferencia que importa — la primera version
 * expandia cada rango a un `Map` por CID, y con el tope aplicado a las claves
 * expandidas un PDF hostil con 64 fuentes de rangos anchos llegaba a **129 MB
 * medidos** de mapas. Guardando intervalos, la memoria pasa a ser proporcional
 * a lo que el fichero REALMENTE contiene, no a lo que el fichero DECLARA cubrir.
 *
 * El tope sigue existiendo, ahora como cota total del documento y no por
 * fuente: un `/W` con un millon de entradas de verdad si ocupa un millon de
 * intervalos. Al superarlo, la fuente que lo cruza se resuelve a `null` —sin
 * ancho, el estimador calla— en vez de devolver medidas a medias.
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

  if (widths) {
    // Con `/Widths` presente manda el documento y SOLO el documento. Un codigo
    // fuera de `[FirstChar, FirstChar+len)` vale `/MissingWidth`, que por
    // defecto es 0 (ISO 32000-1 §9.8.1) — NUNCA la tabla AFM.
    //
    // Caer al AFM ahi era un numero falso con aspecto de medida: una fuente
    // llamada `Arial` puede traer `/Widths` de un SUBCONJUNTO cualquiera, y
    // para los codigos que ese subconjunto no cubre la Helvetica de Adobe no
    // dice nada sobre este documento. El AFM solo entra cuando NO hay
    // `/Widths` en absoluto, que es el caso que la spec deja sin metricas.
    const porDefecto = missing ?? 0;
    return {
      codeLength: 1,
      widthOf(code: number): number {
        const w = widths[code - firstChar];
        return w !== undefined && Number.isFinite(w) ? w : porDefecto;
      },
    };
  }

  // Sin `/Widths`: solo las 14 estandar (y sus clones metricamente
  // compatibles) tienen metricas conocidas fuera del documento.
  const baseFont = nameAt(pdfDoc, fontDict, 'BaseFont');
  const stdKey = baseFont ? standardFontKey(baseFont) : null;
  if (stdKey !== null) {
    return {
      codeLength: 1,
      widthOf: (code: number): number | null => standardWidth(stdKey, code) ?? missing,
    };
  }
  if (missing !== null) {
    return { codeLength: 1, widthOf: (): number => missing };
  }
  return null;
}

/** Un tramo de CIDs con el mismo ancho. `start` y `end` son inclusivos. */
interface CidRange {
  start: number;
  end: number;
  width: number;
}

/**
 * `/W` de una fuente CID: `[ c [w1 w2 …] cFirst cLast w … ]` (ISO 32000-1
 * §9.7.4.3), leido como INTERVALOS y jamas expandido.
 *
 * `null` si el `/W` gasta mas intervalos de los que le quedan al documento
 * (ver {@link MAX_CID_WIDTH_ENTRIES}): media tabla de anchos es peor que
 * ninguna, porque produce medidas correctas para unos codigos e inventadas
 * para otros sin que nada distinga unas de otras.
 */
function parseCidWidths(pdfDoc: PDFDocument, w: PDFArray, presupuesto: number): CidRange[] | null {
  const out: CidRange[] = [];
  const items = w.asArray().map((e) => resolve(pdfDoc, e));
  let i = 0;
  while (i < items.length) {
    if (out.length >= presupuesto) return null;
    const first = items[i];
    if (!(first instanceof PDFNumber)) break;
    const start = first.asNumber();
    if (!Number.isFinite(start)) break;
    const second = items[i + 1];
    if (second instanceof PDFArray) {
      const list = second.asArray();
      for (let k = 0; k < list.length; k++) {
        if (out.length >= presupuesto) return null;
        const v = resolve(pdfDoc, list[k]);
        if (v instanceof PDFNumber && Number.isFinite(v.asNumber())) {
          out.push({ start: start + k, end: start + k, width: v.asNumber() });
        }
      }
      i += 2;
      continue;
    }
    const third = items[i + 2];
    if (second instanceof PDFNumber && third instanceof PDFNumber) {
      const end = second.asNumber();
      const width = third.asNumber();
      if (Number.isFinite(end) && Number.isFinite(width) && end >= start) {
        out.push({ start, end, width });
      }
      i += 3;
      continue;
    }
    break; // forma que no es ninguna de las dos: el resto del array no es fiable
  }
  // Ordenados por arranque para poder buscar por biseccion. Los tramos de un
  // `/W` legitimo no se solapan; si un documento los solapa, gana el primero
  // que encuentre la busqueda, que es tan arbitrario como cualquier otro
  // criterio y no justifica un pase de normalizacion.
  out.sort((a, b) => a.start - b.start);
  return out;
}

/** Ancho del CID en los tramos, o `null` si ninguno lo cubre. Biseccion. */
function widthInRanges(ranges: readonly CidRange[], cid: number): number | null {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid]!;
    if (cid < r.start) hi = mid - 1;
    else if (cid > r.end) lo = mid + 1;
    else return r.width;
  }
  return null;
}

/**
 * Cuantos intervalos gasto la ultima llamada a {@link buildType0Widths}. Se
 * devuelve por aqui —y no en el tipo de retorno— para no ensuciar `FontWidths`
 * con contabilidad que solo le interesa a la cache.
 */
let ultimoGastoDeIntervalos = 0;

function buildType0Widths(
  pdfDoc: PDFDocument,
  fontDict: PDFDict,
  presupuesto: number,
): FontWidths | null {
  ultimoGastoDeIntervalos = 0;
  // El codigo de 2 bytes solo ES el CID en Identity-H. Con una CMap
  // predefinida (`UniGB-UCS2-H`), con una CMap incrustada como stream, o en
  // cualquier modo VERTICAL (`Identity-V`, `*-V`, donde el avance ni siquiera
  // es horizontal), el mapeo codigo->CID es otro y medir con `/W` como si
  // fuera la identidad da un numero inventado. Sin esa certeza no se opina.
  const encoding = resolve(pdfDoc, fontDict.get(PDFName.of('Encoding')));
  if (!(encoding instanceof PDFName) || encoding.decodeText() !== 'Identity-H') return null;

  const descendants = resolve(pdfDoc, fontDict.get(PDFName.of('DescendantFonts')));
  if (!(descendants instanceof PDFArray)) return null;
  const cidFont = resolve(pdfDoc, descendants.asArray()[0]);
  if (!(cidFont instanceof PDFDict)) return null;

  const dw = numberAt(pdfDoc, cidFont, 'DW') ?? DEFAULT_CID_WIDTH;
  const wArray = resolve(pdfDoc, cidFont.get(PDFName.of('W')));
  let ranges: CidRange[] = [];
  if (wArray instanceof PDFArray) {
    const leidos = parseCidWidths(pdfDoc, wArray, presupuesto);
    if (leidos === null) return null;
    ranges = leidos;
  }
  ultimoGastoDeIntervalos = ranges.length;

  return {
    codeLength: 2,
    widthOf: (code: number): number => widthInRanges(ranges, code) ?? dw,
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
  // Presupuesto de intervalos `/W` COMPARTIDO por todas las fuentes CID del
  // documento: sin el, el tope por fuente se multiplicaba por
  // `MAX_WIDTH_FONTS_PER_DOC` y el techo real era 64 veces mas alto de lo que
  // decia. Ver {@link MAX_CID_WIDTH_ENTRIES}.
  let intervalosLibres = MAX_CID_WIDTH_ENTRIES;

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
        // Type3: su `/Widths` va en el espacio de glifo que define
        // `/FontMatrix`, NO en milesimas de em (ISO 32000-1 §9.6.5). Leerlo
        // como si fueran milesimas daba 2,00 pt donde la medida real eran
        // 26,68 — un numero falso, no una aproximacion. Se descarta entera:
        // las Type3 son marginales en documentos de ofimatica y no merecen una
        // rama de escalado sin corpus con que validarla.
        let built: FontWidths | null;
        if (subtype === 'Type3') {
          built = null;
        } else if (subtype === 'Type0') {
          built = buildType0Widths(pdfDoc, dict, intervalosLibres);
          intervalosLibres -= ultimoGastoDeIntervalos;
        } else {
          built = buildSimpleWidths(pdfDoc, dict);
        }
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
