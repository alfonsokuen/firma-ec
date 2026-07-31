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
 *  - **Texto invisible NO cuenta** (`3 Tr` / `7 Tr`): es la capa OCR de un
 *    escaneo, cubre la hoja entera y no se ve. Contarla apartaba el documento
 *    entero sin que hubiera una sola letra visible estorbando.
 *
 * Lo que SÍ se interpreta ahora, y antes no (era el defecto grave): la **matriz
 * de transformación**. Los PDF de Google Docs/Skia emiten `1 0 0 -1 0 792 cm`,
 * que invierte el eje vertical; sin aplicarla, las bandas salían reflejadas y
 * la estampa aterrizaba justo ENCIMA del texto creyendo que era blanco. Se
 * mantiene la pila `q`/`Q`, se compone `cm` y se recorren los Form XObject con
 * su propia `/Matrix`.
 *
 * Y cuando el recorrido no es fiable —stream que no se descomprime, XObject que
 * no se resuelve, tope de operadores o de bytes alcanzado, bandas que caen
 * fuera del papel— la página se marca en `unanalyzedPages` en vez de devolver
 * cero bandas. "No hay texto" y "no pude mirar" exigen decisiones opuestas:
 * la primera permite buscar hueco, la segunda obliga a volver al pie de página.
 *
 * Privacidad: se leen posiciones, nunca el texto mostrado. Ningún carácter del
 * documento sale de esta función.
 */

import {
  type PDFDocument,
  PDFArray,
  PDFDict,
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

export interface TextBandsResult {
  bands: TextBand[];
  /**
   * Páginas cuyo contenido no se pudo recorrer con garantías. Quien coloca debe
   * tratarlas como "sin información", NO como "sin texto".
   */
  unanalyzedPages: number[];
}

/**
 * Alto mínimo atribuido a una línea cuando el tamaño de fuente no se pudo leer.
 * 12pt es el cuerpo habitual de un contrato; quedarse corto es peor que pasarse
 * porque deja pasar un solape.
 */
const FALLBACK_FONT_SIZE_PT = 12;

/** Tope de operadores procesados por página: corta en seco un stream patológico. */
const MAX_OPERATORS_PER_PAGE = 200_000;

/**
 * Tope de bytes DESCOMPRIMIDOS por página. El tope de operadores acota el
 * recorrido, no la memoria: `decodePDFRawStream` infla el stream entero antes de
 * que veamos un solo token, y el pre-vuelo encadena hasta 50 documentos en el
 * hilo principal. 8 MB de content stream es un documento desmesurado; pasarse de
 * ahí se trata como "no analizable", no como "sin texto".
 */
const MAX_CONTENT_BYTES_PER_PAGE = 8 * 1024 * 1024;

/** Profundidad máxima de Form XObjects anidados. */
const MAX_XOBJECT_DEPTH = 8;

/** Bandas separadas por menos de esto se funden en una sola. */
const MERGE_TOLERANCE_PT = 2;

/** Holgura al comprobar que una banda cae dentro del papel. */
const PAGE_BOUNDS_TOLERANCE_PT = 2;

/** Matriz afín 2D del PDF: `[a b c d e f]`, punto fila por la izquierda. */
interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** `m × n` — aplicar `m` y después `n`, que es el orden del operador `cm`. */
function multiply(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.b * n.c,
    b: m.a * n.b + m.b * n.d,
    c: m.c * n.a + m.d * n.c,
    d: m.c * n.b + m.d * n.d,
    e: m.e * n.a + m.f * n.c + n.e,
    f: m.e * n.b + m.f * n.d + n.f,
  };
}

function isFiniteMatrix(m: Matrix): boolean {
  return [m.a, m.b, m.c, m.d, m.e, m.f].every((v) => Number.isFinite(v));
}

/** `true` si el token es un número PDF. */
function isNumber(token: string): boolean {
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(token);
}

function isWhitespace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f' || ch === '\0';
}

interface TokenizeResult {
  tokens: string[];
  /** `false` si hubo que cortar: el recorrido ya no cubre la página entera. */
  complete: boolean;
}

/**
 * Trocea un content stream en tokens, saltándose lo que no importa: las cadenas
 * `(...)` y `<...>` se colapsan a un marcador, porque su CONTENIDO es el texto
 * del documento y aquí no se lee jamás. Los datos binarios de una imagen en
 * línea (`BI … ID … EI`) se saltan enteros: un `(` suelto dentro del binario
 * se comía el resto del stream y la página salía muda.
 */
function tokenize(content: string): TokenizeResult {
  const tokens: string[] = [];
  let i = 0;
  const n = content.length;

  while (i < n) {
    if (tokens.length >= MAX_OPERATORS_PER_PAGE) return { tokens, complete: false };
    const ch = content[i]!;

    if (ch === '%') {
      while (i < n && content[i] !== '\n' && content[i] !== '\r') i++;
      continue;
    }
    if (isWhitespace(ch)) {
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
      if (depth > 0) return { tokens, complete: false };
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
    if (ch === '/') {
      j = i + 1;
      while (j < n && !/[\s()<>[\]{}/%]/.test(content[j]!)) j++;
    } else {
      while (j < n && !/[\s()<>[\]{}/%]/.test(content[j]!)) j++;
    }
    if (j === i) j = i + 1;
    const token = content.slice(i, j);
    i = j;
    tokens.push(token);

    if (token === 'ID') {
      const end = skipInlineImageData(content, i);
      if (end === null) return { tokens, complete: false };
      i = end;
      tokens.push('EI');
    }
  }

  return { tokens, complete: true };
}

/**
 * Devuelve el índice justo después del `EI` que cierra una imagen en línea, o
 * `null` si no aparece. El `EI` solo cuenta si va delimitado: la secuencia
 * `EI` puede salir por azar dentro del binario.
 */
function skipInlineImageData(content: string, start: number): number | null {
  let i = start + 1; // el byte tras `ID` es un único separador
  const n = content.length;
  while (i < n - 1) {
    if (
      content[i] === 'E' &&
      content[i + 1] === 'I' &&
      isWhitespace(content[i - 1]) &&
      (i + 2 >= n || isWhitespace(content[i + 2]))
    ) {
      return i + 2;
    }
    i++;
  }
  return null;
}

/** Estado del recorrido, compartido entre la página y sus Form XObjects. */
interface WalkContext {
  pdfDoc: PDFDocument;
  page: number;
  bands: TextBand[];
  /** Bytes descomprimidos que aún se pueden gastar en esta página. */
  bytesLeft: number;
  /** Refs de Form XObject ya abiertos: corta las referencias circulares. */
  visited: Set<string>;
}

/**
 * Recorre un content stream y acumula sus bandas. Devuelve `false` si algo
 * impidió verlo entero — la página deja de ser fiable en cuanto uno solo de sus
 * streams se corta.
 */
function walkContent(
  ctx: WalkContext,
  content: string,
  resources: PDFDict | null,
  baseCtm: Matrix,
  depth: number,
): boolean {
  const { tokens, complete } = tokenize(content);
  let reliable = complete;

  let ctm = baseCtm;
  const ctmStack: Matrix[] = [];
  let tm = IDENTITY;
  let tlm = IDENTITY;
  let fontSize = FALLBACK_FONT_SIZE_PT;
  let leading = 0;
  let renderMode = 0;
  const operands: string[] = [];

  const numbers = (): number[] => operands.filter(isNumber).map(Number);

  const emit = (): void => {
    // Texto invisible: la capa OCR de un escaneo. Ocupa la hoja entera y no se
    // ve; contarla apartaba documentos sin una sola letra visible estorbando.
    if (renderMode === 3 || renderMode === 7) return;
    const eff = multiply(tm, ctm);
    if (!isFiniteMatrix(eff)) return;
    // Alto de la línea en espacio de página: la componente vertical del vector
    // (0, fontSize) transformado. `b` cubre el texto girado 90°.
    const extent = Math.max(Math.abs(eff.d), Math.abs(eff.b)) * fontSize;
    if (!Number.isFinite(eff.f) || !Number.isFinite(extent) || extent <= 0) return;
    // La caja de una línea va del descendente al ascendente; aproximar con
    // [baseline − 0.25·alto, baseline + 0.85·alto] cubre ambos sin exagerar.
    ctx.bands.push({ page: ctx.page, y: eff.f - extent * 0.25, h: extent * 1.1 });
  };

  for (const token of tokens) {
    if (
      isNumber(token) ||
      token.startsWith('/') ||
      token === '(str)' ||
      token === '[' ||
      token === ']'
    ) {
      operands.push(token);
      continue;
    }

    switch (token) {
      case 'q':
        ctmStack.push(ctm);
        break;
      case 'Q': {
        const popped = ctmStack.pop();
        if (popped) ctm = popped;
        break;
      }
      case 'cm': {
        const nums = numbers();
        if (nums.length >= 6) {
          const [a, b, c, d, e, f] = nums.slice(-6) as [
            number,
            number,
            number,
            number,
            number,
            number,
          ];
          const next = multiply({ a, b, c, d, e, f }, ctm);
          if (isFiniteMatrix(next)) ctm = next;
        }
        break;
      }
      case 'BT':
        tm = IDENTITY;
        tlm = IDENTITY;
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
      case 'Tr': {
        const mode = Number(operands[operands.length - 1]);
        if (Number.isFinite(mode)) renderMode = mode;
        break;
      }
      case 'Tm': {
        const nums = numbers();
        if (nums.length >= 6) {
          const [a, b, c, d, e, f] = nums.slice(-6) as [
            number,
            number,
            number,
            number,
            number,
            number,
          ];
          const next = { a, b, c, d, e, f };
          if (isFiniteMatrix(next)) {
            tm = next;
            tlm = next;
          }
        }
        break;
      }
      case 'Td':
      case 'TD': {
        const nums = numbers();
        if (nums.length >= 2) {
          const tx = nums[nums.length - 2]!;
          const ty = nums[nums.length - 1]!;
          const next = multiply({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }, tlm);
          if (isFiniteMatrix(next)) {
            tlm = next;
            tm = next;
          }
          if (token === 'TD') leading = -ty;
        }
        break;
      }
      case 'T*': {
        const next = multiply({ a: 1, b: 0, c: 0, d: 1, e: 0, f: -leading }, tlm);
        if (isFiniteMatrix(next)) {
          tlm = next;
          tm = next;
        }
        break;
      }
      case "'":
      case '"': {
        const next = multiply({ a: 1, b: 0, c: 0, d: 1, e: 0, f: -leading }, tlm);
        if (isFiniteMatrix(next)) {
          tlm = next;
          tm = next;
        }
        emit();
        break;
      }
      case 'Tj':
      case 'TJ':
        emit();
        break;
      case 'Do': {
        const name = operands[operands.length - 1];
        if (!walkXObject(ctx, resources, name, ctm, depth)) reliable = false;
        break;
      }
      default:
        break;
    }
    operands.length = 0;
  }

  return reliable;
}

/**
 * Entra en un XObject invocado con `Do`. Las imágenes se ignoran a propósito
 * (ver la cabecera del módulo); los formularios se recorren con su `/Matrix`
 * compuesta. Un XObject que no se puede resolver devuelve `false`: puede
 * contener el texto que estamos buscando y no lo sabemos.
 */
function walkXObject(
  ctx: WalkContext,
  resources: PDFDict | null,
  name: string | undefined,
  ctm: Matrix,
  depth: number,
): boolean {
  if (name === undefined || !name.startsWith('/')) return false;
  if (depth >= MAX_XOBJECT_DEPTH) return false;
  if (!resources) return false;

  const xobjects = asDict(ctx.pdfDoc, resources.get(PDFName.of('XObject')));
  if (!xobjects) return false;

  const key = PDFName.of(name.slice(1));
  const ref = xobjects.get(key);
  const refKey = ref instanceof PDFRef ? ref.toString() : null;
  const stream = resolve(ctx.pdfDoc, ref);
  if (!(stream instanceof PDFRawStream)) return false;

  const subtype = stream.dict.get(PDFName.of('Subtype'));
  if (subtype === PDFName.of('Image')) return true; // se dibuja debajo, a propósito
  if (subtype !== PDFName.of('Form')) return false;

  if (refKey !== null) {
    if (ctx.visited.has(refKey)) return true; // ya recorrido: no es un fallo
    ctx.visited.add(refKey);
  }

  const decoded = decodeStream(ctx, stream);
  if (decoded === null) return false;

  const formMatrix = readMatrix(ctx.pdfDoc, stream.dict.get(PDFName.of('Matrix')));
  const formResources =
    asDict(ctx.pdfDoc, stream.dict.get(PDFName.of('Resources'))) ?? resources;

  return walkContent(ctx, decoded, formResources, multiply(formMatrix, ctm), depth + 1);
}

function resolve(pdfDoc: PDFDocument, value: unknown): unknown {
  return value instanceof PDFRef ? pdfDoc.context.lookup(value) : value;
}

function asDict(pdfDoc: PDFDocument, value: unknown): PDFDict | null {
  const resolved = resolve(pdfDoc, value);
  return resolved instanceof PDFDict ? resolved : null;
}

/** `/Matrix [a b c d e f]` de un Form XObject; identidad si falta o es inválida. */
function readMatrix(pdfDoc: PDFDocument, value: unknown): Matrix {
  const resolved = resolve(pdfDoc, value);
  if (!(resolved instanceof PDFArray) || resolved.size() !== 6) return IDENTITY;
  const nums = resolved.asArray().map((entry) => {
    const n = resolve(pdfDoc, entry);
    return typeof (n as { asNumber?: () => number }).asNumber === 'function'
      ? (n as { asNumber: () => number }).asNumber()
      : Number.NaN;
  });
  const [a, b, c, d, e, f] = nums as [number, number, number, number, number, number];
  const matrix = { a, b, c, d, e, f };
  return isFiniteMatrix(matrix) ? matrix : IDENTITY;
}

/** Descomprime un stream descontándolo del presupuesto de la página. */
function decodeStream(ctx: WalkContext, stream: PDFRawStream): string | null {
  try {
    const bytes = decodePDFRawStream(stream).decode();
    if (bytes.length > ctx.bytesLeft) {
      ctx.bytesLeft = 0;
      return null;
    }
    ctx.bytesLeft -= bytes.length;
    return new TextDecoder('latin1').decode(bytes);
  } catch {
    return null;
  }
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

/** Los content streams de una página, sin concatenar y sin descomprimir aún. */
function pageStreams(pdfDoc: PDFDocument, pageIndex: number): unknown[] {
  const page = pdfDoc.getPages()[pageIndex];
  if (!page) return [];
  const resolved = resolve(pdfDoc, page.node.get(PDFName.of('Contents')));
  if (resolved instanceof PDFArray) return resolved.asArray();
  return resolved === undefined ? [] : [resolved];
}

/**
 * Bandas de texto de todas las páginas. Nunca lanza: la página que no se pueda
 * recorrer entera se devuelve en `unanalyzedPages` y quien coloca vuelve al
 * comportamiento anterior a que esto existiera.
 */
export function readTextBands(pdfDoc: PDFDocument): TextBandsResult {
  const bands: TextBand[] = [];
  const unanalyzedPages: number[] = [];
  const pageCount = pdfDoc.getPageCount();

  for (let page = 0; page < pageCount; page++) {
    try {
      const result = readPageBands(pdfDoc, page);
      if (result === null) unanalyzedPages.push(page);
      else bands.push(...result);
    } catch {
      unanalyzedPages.push(page);
    }
  }
  return { bands, unanalyzedPages };
}

/** Bandas de UNA página, o `null` si el recorrido no es de fiar. */
function readPageBands(pdfDoc: PDFDocument, page: number): TextBand[] | null {
  const pdfPage = pdfDoc.getPages()[page];
  if (!pdfPage) return null;

  const ctx: WalkContext = {
    pdfDoc,
    page,
    bands: [],
    bytesLeft: MAX_CONTENT_BYTES_PER_PAGE,
    visited: new Set(),
  };
  const resources = asDict(pdfDoc, pdfPage.node.get(PDFName.of('Resources')));

  let reliable = true;
  for (const entry of pageStreams(pdfDoc, page)) {
    const stream = resolve(pdfDoc, entry);
    if (!(stream instanceof PDFRawStream)) {
      reliable = false;
      continue;
    }
    const decoded = decodeStream(ctx, stream);
    if (decoded === null) {
      reliable = false;
      continue;
    }
    if (!walkContent(ctx, decoded, resources, IDENTITY, 0)) reliable = false;
  }
  if (!reliable) return null;

  // Una banda fuera del papel significa que nuestro modelo de la página es
  // falso (una transformación que no supimos seguir). Descartarla en silencio
  // dejaría el resto de bandas —igual de sospechosas— pasando por buenas.
  const box = pdfPage.getMediaBox();
  const bottom = box.y - PAGE_BOUNDS_TOLERANCE_PT;
  const top = box.y + box.height + PAGE_BOUNDS_TOLERANCE_PT;
  for (const band of ctx.bands) {
    if (band.y < bottom || band.y + band.h > top) return null;
  }

  return mergeBands(ctx.bands);
}
