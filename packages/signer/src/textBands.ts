/**
 * textBands.ts — dónde hay TEXTO en cada página, para no estampar encima.
 *
 * La colocación automática sabía esquivar firmas previas y respetar campos de
 * firma declarados, pero no tenía ni idea de dónde estaba el contenido: si el
 * párrafo llegaba al pie, la estampa caía sobre las letras. En un contrato eso
 * no es un detalle estético — tapa cláusulas.
 *
 * Qué se mide y qué NO:
 *  - **Solo texto.** Las imágenes y los trazados se ignoran a propósito: un
 *    membrete o una marca de agua a página completa ocupan todo el papel y, si
 *    contaran, no quedaría un solo hueco libre en ningún documento. Están
 *    hechas para que se dibuje encima.
 *  - **Bandas de ancho completo.** Se registra el intervalo vertical que ocupa
 *    cada línea, no su rectángulo exacto: medir el ancho real exige las
 *    métricas de la fuente incrustada. Es deliberadamente conservador — la
 *    estampa acaba en blanco de verdad, no en el margen derecho de un párrafo.
 *  - **Sin CTM.** No se interpreta `cm`: el contenido de un documento de texto
 *    normal se dibuja en el espacio de la página. Un PDF que escale su
 *    contenido dará bandas desplazadas; por eso ningún fallo aquí es fatal —
 *    quien llama se queda sin bandas y vuelve al comportamiento anterior.
 *
 * Privacidad: se leen posiciones, nunca el texto mostrado. Ningún carácter del
 * documento sale de esta función.
 */

import {
  type PDFDocument,
  PDFArray,
  PDFName,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
} from 'pdf-lib';

/** Intervalo vertical ocupado por texto en una página. `page` es 0-based. */
export interface TextBand {
  page: number;
  /** Borde inferior en espacio de usuario. */
  y: number;
  /** Alto en pt. */
  h: number;
}

/**
 * Alto mínimo atribuido a una línea cuando el tamaño de fuente no se pudo leer.
 * 12pt es el cuerpo habitual de un contrato; quedarse corto es peor que pasarse
 * porque deja pasar un solape.
 */
const FALLBACK_FONT_SIZE_PT = 12;

/** Tope de operadores procesados por página: corta en seco un stream patológico. */
const MAX_OPERATORS_PER_PAGE = 200_000;

/** Bandas separadas por menos de esto se funden en una sola. */
const MERGE_TOLERANCE_PT = 2;

/** `true` si el token es un número PDF. */
function isNumber(token: string): boolean {
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(token);
}

/**
 * Trocea un content stream en tokens, saltándose lo que no importa: las cadenas
 * `(...)` y `<...>` se colapsan a un marcador, porque su CONTENIDO es el texto
 * del documento y aquí no se lee jamás.
 */
function tokenize(content: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = content.length;

  while (i < n && tokens.length < MAX_OPERATORS_PER_PAGE) {
    const ch = content[i]!;

    if (ch === '%') {
      while (i < n && content[i] !== '\n' && content[i] !== '\r') i++;
      continue;
    }
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f' || ch === '\0') {
      i++;
      continue;
    }
    if (ch === '(') {
      // Cadena literal: se recorre respetando anidamiento y escapes, y se
      // descarta. Nunca se guarda su contenido.
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        const c = content[i]!;
        if (c === '\\') i++;
        else if (c === '(') depth++;
        else if (c === ')') depth--;
        i++;
      }
      tokens.push('(str)');
      continue;
    }
    if (ch === '<' && content[i + 1] !== '<') {
      while (i < n && content[i] !== '>') i++;
      i++;
      tokens.push('(str)');
      continue;
    }
    if (ch === '<' || ch === '>') {
      tokens.push(content.slice(i, i + 2));
      i += 2;
      continue;
    }
    if (ch === '[' || ch === ']' || ch === '{' || ch === '}') {
      tokens.push(ch);
      i++;
      continue;
    }

    let j = i;
    while (j < n && !/[\s()<>[\]{}/%]/.test(content[j]!)) j++;
    if (ch === '/') {
      j = i + 1;
      while (j < n && !/[\s()<>[\]{}/%]/.test(content[j]!)) j++;
    }
    if (j === i) j = i + 1;
    tokens.push(content.slice(i, j));
    i = j;
  }

  return tokens;
}

/** Recorre los operadores de UNA página y devuelve sus bandas de texto. */
function bandsFromContent(content: string, page: number): TextBand[] {
  const tokens = tokenize(content);
  const bands: TextBand[] = [];

  let fontSize = FALLBACK_FONT_SIZE_PT;
  let leading = 0;
  // Posición e escala verticales del texto actual (`e`/`f` de Tm, más Td/TD).
  let textY = 0;
  let lineY = 0;
  let vScale = 1;
  const operands: string[] = [];

  const emit = (): void => {
    const h = Math.abs(fontSize * vScale);
    if (!Number.isFinite(textY) || !Number.isFinite(h) || h <= 0) return;
    // La caja de una línea va del descendente al ascendente; aproximar con
    // [baseline − 0.25·size, baseline + 0.85·size] cubre ambos sin exagerar.
    bands.push({ page, y: textY - h * 0.25, h: h * 1.1 });
  };

  for (const token of tokens) {
    if (isNumber(token) || token.startsWith('/') || token === '(str)' || token === '[' || token === ']') {
      operands.push(token);
      continue;
    }

    switch (token) {
      case 'BT':
        textY = 0;
        lineY = 0;
        vScale = 1;
        break;
      case 'Tf': {
        const size = Number(operands[operands.length - 1]);
        if (Number.isFinite(size) && size > 0) fontSize = size;
        break;
      }
      case 'TL': {
        const value = Number(operands[operands.length - 1]);
        if (Number.isFinite(value)) leading = value;
        break;
      }
      case 'Tm': {
        // a b c d e f Tm — `d` es la escala vertical, `f` la posición.
        const nums = operands.filter(isNumber).map(Number);
        if (nums.length >= 6) {
          const d = nums[nums.length - 3]!;
          const f = nums[nums.length - 1]!;
          if (Number.isFinite(d) && d !== 0) vScale = d;
          if (Number.isFinite(f)) {
            textY = f;
            lineY = f;
          }
        }
        break;
      }
      case 'Td':
      case 'TD': {
        const nums = operands.filter(isNumber).map(Number);
        if (nums.length >= 2) {
          const ty = nums[nums.length - 1]!;
          if (Number.isFinite(ty)) {
            lineY += ty;
            textY = lineY;
          }
          if (token === 'TD' && Number.isFinite(ty)) leading = -ty;
        }
        break;
      }
      case 'T*':
        lineY -= leading;
        textY = lineY;
        break;
      case "'":
      case '"':
        lineY -= leading;
        textY = lineY;
        emit();
        break;
      case 'Tj':
      case 'TJ':
        emit();
        break;
      default:
        break;
    }
    operands.length = 0;
  }

  return bands;
}

/** Funde las bandas que se tocan o se solapan, para no inflar la lista. */
function mergeBands(bands: TextBand[]): TextBand[] {
  if (bands.length === 0) return [];
  const sorted = [...bands].sort((a, b) => a.y - b.y);
  const merged: TextBand[] = [];

  let current = { ...sorted[0]! };
  for (const band of sorted.slice(1)) {
    const currentTop = current.y + current.h;
    if (band.y <= currentTop + MERGE_TOLERANCE_PT) {
      current.h = Math.max(currentTop, band.y + band.h) - current.y;
    } else {
      merged.push(current);
      current = { ...band };
    }
  }
  merged.push(current);
  return merged;
}

/** Concatena los content streams de una página, ya descomprimidos. */
function pageContent(pdfDoc: PDFDocument, pageIndex: number): string | null {
  const page = pdfDoc.getPages()[pageIndex];
  if (!page) return null;

  const raw = page.node.get(PDFName.of('Contents'));
  const resolved = raw instanceof PDFRef ? pdfDoc.context.lookup(raw) : raw;
  const streams = resolved instanceof PDFArray ? resolved.asArray() : [resolved];

  const parts: string[] = [];
  for (const entry of streams) {
    const stream = entry instanceof PDFRef ? pdfDoc.context.lookup(entry) : entry;
    if (!(stream instanceof PDFRawStream)) continue;
    try {
      parts.push(new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()));
    } catch {
      // Un stream con un filtro que no sabemos deshacer no invalida los demás.
      continue;
    }
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

/**
 * Bandas de texto de todas las páginas. Nunca lanza: un documento cuyo
 * contenido no se puede recorrer devuelve una lista vacía, y quien llama se
 * comporta como antes de que esto existiera.
 */
export function readTextBands(pdfDoc: PDFDocument): TextBand[] {
  const out: TextBand[] = [];
  const pageCount = pdfDoc.getPageCount();

  for (let page = 0; page < pageCount; page++) {
    try {
      const content = pageContent(pdfDoc, page);
      if (content === null) continue;
      out.push(...mergeBands(bandsFromContent(content, page)));
    } catch {
      continue;
    }
  }
  return out;
}
