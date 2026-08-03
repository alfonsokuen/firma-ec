/**
 * fontResources.ts — resuelve `/Resources /Font/<nombre>` a un {@link FontDecoder}.
 *
 * `fontDecode.ts` (FASE 1) sabe decodificar bytes de cadena PDF a code points,
 * pero necesita que alguien le entregue la tabla de la fuente correcta: el
 * `/Encoding` de una fuente simple, o el `/ToUnicode` de una Type0. Este módulo
 * hace ese puente leyendo el diccionario de fuente del PDF con `pdf-lib`.
 *
 * Privacidad: este módulo NUNCA toca el contenido de una cadena de texto — solo
 * lee METADATOS de fuente (nombres de `/Encoding`, tablas `/Differences`, el
 * stream `/ToUnicode`). Lo único que sale de aquí es un {@link FontDecoder}, que
 * a su vez respeta el contrato de privacidad de `fontDecode.ts` (sink `void`).
 *
 * Presupuestos propios, independientes del presupuesto de la página que ya
 * gestiona `textBands.ts`: una fuente puede fallar sin que la página completa
 * se declare no analizable, porque el ancla es una MEJORA sobre las bandas, no
 * un requisito. Por eso {@link createFontResourceCache} nunca lanza: cualquier
 * fallo de parseo degrada esa fuente concreta a "todo sin mapear" y sigue.
 */

import {
  PDFArray,
  PDFDict,
  type PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
} from 'pdf-lib';

import { decodeStreamBounded } from './boundedDecode.js';
import {
  type BaseEncoding,
  type CodePointSink,
  type DecodeOutcome,
  type FontDecoder,
  UNMAPPED_CODE_POINT,
  createSimpleFontDecoder,
  createToUnicodeDecoder,
} from './fontDecode.js';

/**
 * Tope de bytes DESCOMPRIMIDOS del stream `/ToUnicode` de UNA fuente. Una CMap
 * legítima de un subconjunto embebido anda en unos pocos KB; pasarse de aquí
 * es tratarla como si no existiera, no colgar el parseo de todo el documento.
 *
 * Bajado en su día de 1 MB a 64 KB por una medición que YA NO aplica: una CMap
 * de 990.072 bytes tardaba 303.284 ms en `createToUnicodeDecoder`, pero esa
 * lentitud la causaba la FALTA de `MAX_TOTAL_MAP_ENTRIES` (ver
 * `fontDecode.ts`) — el tope de entradas que ese mismo cambio añadió. Con el
 * tope de entradas puesto, una CMap de 836 KB (dentro del rango que 64 KB
 * rechazaba) cuesta 17,1 ms: el techo de BYTES ya no compra protección contra
 * DoS, esa la da el de entradas. Lo único que seguía comprando era ceguera en
 * fuentes CJK y subconjuntos no reducidos, cuyo `/ToUnicode` legítimo supera
 * 64 KB con facilidad. Subido a 512 KB — sigue siendo un techo, solo que uno
 * que no descarta CMaps reales. Se aplica ANTES de decodificar (ver
 * {@link decodeStreamBounded}), no después de haber inflado el stream entero.
 */
// Exportado SOLO para que los tests de mutación afirmen el número real en
// vez de duplicarlo como constante mágica (y quedar desalineados si cambia).
export const MAX_TOUNICODE_BYTES = 512 * 1024;

/**
 * Tope de fuentes DISTINTAS resueltas por documento. Un PDF corriente usa un
 * puñado; un documento adversario con cientos de subconjuntos no puede forzar
 * a este módulo a parsear sin límite. Pasado el tope, toda fuente nueva
 * decodifica todo-unmapped — la cobertura ya refleja esa degradación.
 */
// Exportado SOLO para que los tests de mutación afirmen el número real en
// vez de duplicarlo como constante mágica.
export const MAX_FONTS_PER_DOC = 64;

/** Resuelve `/Resources /Font/<nombre>` a un decoder, con caché por documento. */
export interface FontResourceCache {
  /**
   * `resources` son los `/Resources` vigentes (de la página o del Form XObject
   * actual); `fontName` es el operando de `Tf` tal cual aparece en el content
   * stream, con la barra inicial (p.ej. `"/F1"`). Nunca lanza: ante cualquier
   * fuente ilegible devuelve un decoder que marca todo como no mapeado.
   */
  resolveFont(resources: PDFDict | null, fontName: string | undefined): FontDecoder;
}

/** Decoder degradado: cuenta códigos de `codeLength` bytes, todos sin mapear. */
function unmappedDecoder(codeLength: number): FontDecoder {
  return {
    decode(bytes: Uint8Array, sink: CodePointSink, maxCodes?: number): DecodeOutcome {
      let codes = 0;
      for (let i = 0; i < bytes.length; i += codeLength) {
        if (maxCodes !== undefined && codes >= maxCodes) {
          return { codes, mapped: 0, truncated: true };
        }
        sink(UNMAPPED_CODE_POINT);
        codes++;
      }
      return { codes, mapped: 0 };
    },
  };
}

function resolve(pdfDoc: PDFDocument, value: unknown): unknown {
  return value instanceof PDFRef ? pdfDoc.context.lookup(value) : value;
}

function asDict(pdfDoc: PDFDocument, value: unknown): PDFDict | null {
  const resolved = resolve(pdfDoc, value);
  return resolved instanceof PDFDict ? resolved : null;
}

/** Nombre de `/Encoding` (o `/BaseEncoding`) → tipo base de `fontDecode.ts`. */
function encodingNameToBase(name: string): BaseEncoding | undefined {
  if (name === 'WinAnsiEncoding') return 'WinAnsi';
  if (name === 'MacRomanEncoding') return 'MacRoman';
  if (name === 'StandardEncoding') return 'Standard';
  // MacExpertEncoding u otra: fuera del subconjunto soportado, se deja sin
  // base explícita y `createSimpleFontDecoder` cae a su default.
  return undefined;
}

/** `/Differences [code name code name …]` → la forma que espera `fontDecode.ts`. */
function parseDifferences(pdfDoc: PDFDocument, arr: PDFArray): Array<number | string> {
  const out: Array<number | string> = [];
  for (const entry of arr.asArray()) {
    const resolved = resolve(pdfDoc, entry);
    if (resolved instanceof PDFNumber) out.push(resolved.asNumber());
    else if (resolved instanceof PDFName) out.push(resolved.decodeText());
  }
  return out;
}

/** Fuente simple (Type1/TrueType/MMType1) con `/Encoding` nombre o dict. */
function buildSimpleFontDecoder(pdfDoc: PDFDocument, fontDict: PDFDict): FontDecoder {
  const encodingValue = resolve(pdfDoc, fontDict.get(PDFName.of('Encoding')));

  let baseEncoding: BaseEncoding | undefined;
  let differences: Array<number | string> | undefined;

  if (encodingValue instanceof PDFName) {
    baseEncoding = encodingNameToBase(encodingValue.decodeText());
  } else if (encodingValue instanceof PDFDict) {
    const baseName = resolve(pdfDoc, encodingValue.get(PDFName.of('BaseEncoding')));
    if (baseName instanceof PDFName) baseEncoding = encodingNameToBase(baseName.decodeText());
    const diffArray = resolve(pdfDoc, encodingValue.get(PDFName.of('Differences')));
    if (diffArray instanceof PDFArray) differences = parseDifferences(pdfDoc, diffArray);
  }

  return createSimpleFontDecoder({
    ...(baseEncoding ? { baseEncoding } : {}),
    ...(differences ? { differences } : {}),
  });
}

/**
 * Fuente Type0. Solo se decodifica cuando trae `/ToUnicode` embebido: sin él
 * —Identity-H "pelado" o una CMap predefinida como `UniGB-UCS2-H`— no hay tabla
 * disponible en el documento y el contrato de `fontDecode.ts` es tratarla como
 * ilegible, no adivinar.
 */
function buildType0FontDecoder(pdfDoc: PDFDocument, fontDict: PDFDict): FontDecoder {
  const toUnicode = resolve(pdfDoc, fontDict.get(PDFName.of('ToUnicode')));
  if (!(toUnicode instanceof PDFRawStream)) return unmappedDecoder(2);

  let bytes: Uint8Array | null;
  try {
    // El presupuesto se aplica DURANTE la descompresión, no después: una CMap
    // que exceda `MAX_TOUNICODE_BYTES` nunca se infla entera en memoria (ver
    // cabecera de `boundedDecode.ts`).
    bytes = decodeStreamBounded(toUnicode, MAX_TOUNICODE_BYTES);
  } catch {
    // Mudo A PROPÓSITO: un stream `/ToUnicode` corrupto puede lanzar con
    // metadatos del documento en el mensaje de la excepción (p.ej. bytes del
    // propio stream, si el error viene de un parser interno). No hay dónde
    // meter eso sin arriesgar una fuga — se degrada a "todo sin mapear".
    return unmappedDecoder(2);
  }
  if (bytes === null) return unmappedDecoder(2);
  return createToUnicodeDecoder(bytes);
}

/** El diccionario de fuente para `fontName` dentro de `resources`, con su `PDFRef` si lo tiene. */
function getFontDict(
  pdfDoc: PDFDocument,
  resources: PDFDict,
  fontName: string,
): { dict: PDFDict; ref: PDFRef | null } | null {
  if (!fontName.startsWith('/')) return null;
  const fonts = asDict(pdfDoc, resources.get(PDFName.of('Font')));
  if (!fonts) return null;
  const raw = fonts.get(PDFName.of(fontName.slice(1)));
  if (raw === undefined) return null;
  const ref = raw instanceof PDFRef ? raw : null;
  const resolved = resolve(pdfDoc, raw);
  if (!(resolved instanceof PDFDict)) return null;
  return { dict: resolved, ref };
}

function buildDecoder(pdfDoc: PDFDocument, fontDict: PDFDict): FontDecoder {
  const subtype = resolve(pdfDoc, fontDict.get(PDFName.of('Subtype')));
  const subtypeName = subtype instanceof PDFName ? subtype.decodeText() : '';
  return subtypeName === 'Type0'
    ? buildType0FontDecoder(pdfDoc, fontDict)
    : buildSimpleFontDecoder(pdfDoc, fontDict);
}

/**
 * Crea una caché de fuentes a nivel de DOCUMENTO: las fuentes se comparten
 * entre páginas (un mismo `/F1` referenciado desde cien páginas es la misma
 * `PDFRef`), así que se parsean una sola vez. Vive tanto como dure UNA llamada
 * a `readTextBands`.
 *
 * La clave es el `PDFDict` del font dict, vía `WeakMap`, NO `PDFRef.toString()`.
 * Un `/Font/F1` puede ser un diccionario DIRECTO (PDF válido; pdf-lib lo
 * entrega como `PDFDict` sin `PDFRef`) y en ese caso `found.ref` es `null` —
 * cachear por ref dejaba esos casos sin cachear NUNCA, así que `resolveFont`
 * se re-ejecutaba en cada operación de texto y el tope de fuentes tampoco los
 * contaba. El `PDFDict` en sí es estable dentro de UNA carga de documento
 * (pdf-lib no lo re-crea entre lecturas), así que sirve como clave tanto para
 * el caso directo como el indirecto.
 */
export function createFontResourceCache(pdfDoc: PDFDocument): FontResourceCache {
  const cache = new WeakMap<PDFDict, FontDecoder>();
  let fontCount = 0;

  return {
    resolveFont(resources: PDFDict | null, fontName: string | undefined): FontDecoder {
      try {
        if (!resources || !fontName) return unmappedDecoder(1);
        const found = getFontDict(pdfDoc, resources, fontName);
        if (!found) return unmappedDecoder(1);

        const cached = cache.get(found.dict);
        if (cached) return cached;

        if (fontCount >= MAX_FONTS_PER_DOC) {
          // Presupuesto de fuentes agotado: esta fuente (y cualquier otra
          // nueva a partir de ahora) decodifica todo-unmapped. Se cachea
          // igual, para no repetir el intento de parseo si se vuelve a ver.
          const degraded = unmappedDecoder(1);
          cache.set(found.dict, degraded);
          return degraded;
        }

        fontCount++;
        const decoder = buildDecoder(pdfDoc, found.dict);
        cache.set(found.dict, decoder);
        return decoder;
      } catch {
        // Mudo A PROPÓSITO: un `/Encoding` o `/Differences` con forma
        // corrupta puede lanzar con metadatos del documento en el mensaje.
        // Un fallo de fuente jamás puede degradar las bandas: se cae a
        // "todo sin mapear" y el llamador sigue como si el ancla no existiera.
        return unmappedDecoder(1);
      }
    },
  };
}
