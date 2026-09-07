/**
 * textFit.ts — truncado de texto MIDIENDO el ancho real, no contando
 * caracteres.
 *
 * Por qué existe (defecto A5): las dos rutas que dibujan la estampa visible
 * (`visibleSig.ts` para la firma única, `incrementalUpdate.ts` para la
 * multifirma) truncaban el CN por número de caracteres. Un CN ecuatoriano real
 * de 35 caracteres —"ZAMBRANO CEDENO MARIA DE LOS ANGELE"— produce la línea
 * "Firmado por: …" que mide 223,2 pt a 8 pt de Helvetica contra los 162 pt que
 * el layout de lote deja libres: el BBox recorta el sobrante SIN error y el
 * nombre queda partido a mitad de palabra, sin elipsis. Con un humano mirando
 * cada documento eso se ve; en un lote se multiplica por N y nadie lo nota.
 *
 * La métrica es la de Helvetica que ya usa pdf-lib: `StandardFontEmbedder` es
 * exactamente el motor detrás de `PDFFont.widthOfTextAtSize` (`PDFFont`
 * delega en su embedder), así que medir aquí y dibujar allá no puede divergir.
 * Se usa el embedder directamente porque `buildAppearanceOperators` es
 * síncrona y no tiene a mano un `PDFDocument` donde embeber la fuente.
 *
 * Módulo puro: sin red, sin disco, sin reloj.
 */

import { StandardFontEmbedder, StandardFonts } from 'pdf-lib';

type FontNameArg = Parameters<typeof StandardFontEmbedder.for>[0];

/** Elipsis de un solo carácter (WinAnsi 0x85, presente en Helvetica). */
export const ELLIPSIS = '…';

/**
 * Medidor de Helvetica compartido. Es inmutable y sin estado por llamada
 * (`widthOfTextAtSize` solo lee la tabla AFM), así que una única instancia
 * perezosa sirve a todas las estampas del lote sin coste por documento.
 */
let helveticaMeasurer: StandardFontEmbedder | undefined;

function measurer(): StandardFontEmbedder {
  if (!helveticaMeasurer) {
    helveticaMeasurer = StandardFontEmbedder.for(StandardFonts.Helvetica as unknown as FontNameArg);
  }
  return helveticaMeasurer;
}

/** Sustituto de un carácter que Helvetica no puede dibujar ni tras quitarle la tilde. */
const UNENCODABLE_REPLACEMENT = '?';

/**
 * Deja `text` en caracteres que la Helvetica estándar (WinAnsiEncoding) SÍ
 * puede dibujar. Un carácter fuera de WinAnsi hacía lanzar al codificador de
 * pdf-lib —`WinAnsi cannot encode ""`— y esa excepción sin código llegaba
 * al usuario como «No se pudo firmar · code: unknown». El caso real: una CA
 * que mete UTF-8 en un TeletexString, con lo que la Ñ del apellido llega como
 * `Ã` + U+0091 (se repara al leer el certificado, pero la estampa no puede
 * depender de que todas las entradas vengan saneadas).
 *
 * Por carácter: si WinAnsi lo tiene, se queda; si no, se prueba su base sin
 * diacríticos (`Č` → `C`, `Ł` no tiene y cae al sustituto); si tampoco, `?`.
 * Un nombre con un `?` es feo; un lote que no firma por él es peor.
 */
export function helveticaSafe(text: string): string {
  const encoding = measurer().encoding;
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (encoding.canEncodeUnicodeCodePoint(cp)) {
      out += ch;
      continue;
    }
    const base = ch.normalize('NFD').codePointAt(0)!;
    out +=
      base !== cp && encoding.canEncodeUnicodeCodePoint(base)
        ? String.fromCodePoint(base)
        : UNENCODABLE_REPLACEMENT;
  }
  return out;
}

/**
 * Codifica `text` como literal hexadecimal PDF en WinAnsiEncoding, la
 * codificación con la que se declara `/Helv` en las dos rutas de la estampa.
 * Usa la tabla real de pdf-lib, no el byte bajo del code point: `…` es 0x85,
 * `’` es 0x92 y `€` es 0x80 en WinAnsi, nada que ver con su Unicode. Lo que
 * WinAnsi no tiene pasa antes por {@link helveticaSafe}, así que nunca lanza.
 */
export function toWinAnsiHex(text: string): string {
  const encoding = measurer().encoding;
  let hex = '';
  for (const ch of helveticaSafe(text)) {
    hex += encoding.encodeUnicodeCodePoint(ch.codePointAt(0)!).code.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Ancho en pt de `text` dibujado en Helvetica a `size` pt.
 *
 * Mide el texto YA saneado por {@link helveticaSafe}, que es exactamente lo
 * que se dibuja. El `try` queda como red por si pdf-lib lanzara por otra
 * razón: en ese caso se devuelve `Number.POSITIVE_INFINITY` para que el
 * llamante trunque en vez de propagar la excepción (una estampa recortada es
 * mala, tumbar el lote por una tilde rara es peor).
 */
export function widthOfText(text: string, size: number): number {
  if (text.length === 0) return 0;
  try {
    return measurer().widthOfTextAtSize(helveticaSafe(text), size);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Recorta `text` para que, dibujado a `size` pt, no supere `maxWidth` pt.
 *
 * Si hay que recortar se añade {@link ELLIPSIS}, y el resultado CON elipsis es
 * el que se mide — así lo que se devuelve cabe de verdad, no "casi".
 *
 * Devuelve la cadena vacía cuando ni la elipsis sola cabe: dibujar un glifo
 * suelto que el BBox va a cortar no informa de nada.
 */
export function truncateToWidth(text: string, size: number, maxWidth: number): string {
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return '';
  if (widthOfText(text, size) <= maxWidth) return text;

  const ellipsisWidth = widthOfText(ELLIPSIS, size);
  if (!Number.isFinite(ellipsisWidth) || ellipsisWidth > maxWidth) return '';

  const budget = maxWidth - ellipsisWidth;
  // Búsqueda binaria sobre el número de caracteres conservados: el ancho es
  // monótono creciente en la longitud del prefijo, así que basta con acotar.
  let lo = 0;
  let hi = text.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (widthOfText(text.slice(0, mid), size) <= budget) lo = mid;
    else hi = mid - 1;
  }
  if (lo === 0) return '';
  return text.slice(0, lo) + ELLIPSIS;
}

/**
 * Recorte por número de caracteres, con elipsis. Es lo único que hacía el
 * código previo a este módulo.
 *
 * Se conserva —y se aplica ANTES del ajuste por ancho— porque para los valores
 * que ya cabían deja la salida idéntica a la de antes del arreglo: el ajuste
 * por ancho solo actúa donde había desbordamiento silencioso.
 */
export function fitChars(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  return text.length <= maxChars ? text : text.slice(0, maxChars - 1) + ELLIPSIS;
}
