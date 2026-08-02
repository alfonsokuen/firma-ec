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
  /**
   * Páginas sin una sola letra visible cuyo contenido es, en su mayor parte,
   * una imagen colocada: un escaneo. También entran en
   * {@link unanalyzedPages} — su texto existe, pero está en píxeles y este
   * módulo no lo ve.
   *
   * Se reportan aparte porque el MOTIVO importa: "no pude descomprimir el
   * stream" y "esto es un contrato escaneado" piden explicaciones distintas a
   * la persona, aunque hoy lleven a la misma decisión prudente.
   */
  imageOnlyPages: number[];
  /**
   * Páginas cuyo único texto va en modo invisible (`3 Tr` / `7 Tr`): la capa
   * OCR de un escaneo. Sin esto, una página así devuelve exactamente lo mismo
   * que una hoja en blanco. También entran en {@link unanalyzedPages}.
   */
  ocrOnlyPages: number[];
  /**
   * Cada página no analizada, con la CAUSA. {@link unanalyzedPages} se deriva de
   * aquí y se conserva por compatibilidad.
   *
   * Existe porque sin la causa no se puede saber si la ceguera es del documento
   * o nuestra — y al mirarla resultó ser nuestra: se recorría cada stream de
   * `/Contents` por separado, con su propia pila de estado, cuando la spec dice
   * que son uno solo concatenado.
   */
  unanalyzed: Array<{ page: number; reason: UnanalyzedReason }>;
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

/**
 * Cuántas veces más alta que la línea típica de la página tiene que ser una
 * línea para tratarla como MARCA DE AGUA y no como contenido.
 *
 * El módulo ya ignora imágenes y trazados a propósito —un membrete o una marca
 * de agua están puestos para que se dibuje encima—, pero una marca de agua
 * hecha con TEXTO se contaba como si fuera una cláusula. Medido sobre una carta
 * real del usuario: el logotipo "IDK MANAGER" cruzando el centro de la hoja
 * fundía cuerpo, hueco de firma y nombre del firmante en UNA banda de 397 pt.
 * El claro que el documento había reservado para la firma dejaba de existir, y
 * la estampa se iba al borde inferior de la página.
 *
 * Tres veces la mediana no lo alcanza ningún titular —un H1 anda por 1,5-2×—
 * y lo supera cualquier marca de agua, que vive en 5-8×. Se usa la MEDIANA y no
 * la media para que un solo logotipo enorme no arrastre el listón hacia sí
 * mismo. Cuando la página entera está compuesta a un solo cuerpo, la mediana ES
 * ese cuerpo y no se descarta nada.
 */
const WATERMARK_SIZE_RATIO = 3;

/** Holgura al comprobar que una banda cae dentro del papel. */
const PAGE_BOUNDS_TOLERANCE_PT = 2;

/**
 * Cuánto papel tiene que tapar la imagen, en una página SIN texto visible, para
 * llamarla escaneo. Un escaneo cubre la hoja entera; el umbral va holgado por
 * debajo para admitir márgenes blancos y escáneres que recortan.
 *
 * El riesgo de pasarse de bajo está acotado: la regla solo mira páginas donde
 * no hay una sola letra visible, así que un fondo o un membrete a toda página
 * —que siempre lleva texto encima— nunca la dispara.
 */
const MIN_SCAN_COVERAGE_RATIO = 0.5;

/**
 * Cuántas imágenes colocadas se guardan por página para medir la unión. Un
 * escaneo son una o cuatro imágenes grandes, así que el tope solo se alcanza en
 * páginas ilustradas —justo las que NO son escaneos—. Dicho a las claras: pasado
 * el tope se deja de contar papel tapado, y esa página no se declarará escaneo.
 */
const MAX_IMAGE_RECTS = 48;

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

/**
 * ¿Alguno de los operandos de esta operación de texto lleva tinta?
 *
 * Una cadena de solo espacios no dibuja nada, así que no puede estorbar a la
 * estampa. Distinguirlo NO es leer el documento: el tokenizador solo marca
 * blanco/no-blanco y jamás guarda un carácter.
 */
function hasInk(operands: readonly string[]): boolean {
  return operands.includes('(str)');
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
      // Se mira UNA sola cosa del contenido: si tiene algo que no sea espacio.
      // Eso no es leer el texto —no se guarda ni un carácter, no se distingue
      // una letra de otra— y es lo que separa una línea del contrato de un
      // párrafo vacío. Word emite los párrafos en blanco como cadenas de
      // espacios, y sin esta distinción cada uno dejaba una banda de texto
      // fantasma: el hueco que el documento reserva para la firma se llenaba de
      // obstáculos invisibles y la estampa se iba al borde de la hoja.
      let hasInk = false;
      while (i < n && depth > 0) {
        const c = content[i]!;
        if (c === '\\') {
          hasInk = true;
          i++;
        } else if (c === '(') {
          depth++;
          hasInk = true;
        } else if (c === ')') {
          depth--;
        } else if (!isWhitespace(c)) {
          hasInk = true;
        }
        i++;
      }
      if (depth > 0) return { tokens, complete: false };
      tokens.push(hasInk ? '(str)' : '(blank)');
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
  /**
   * Dónde acabó cada imagen colocada. Se anota en el `Do` de cada Image
   * XObject, donde la CTM ya compuesta dice exactamente qué trozo de papel
   * tapa: no hace falta rasterizar nada. Se guardan los rectángulos y no un
   * área acumulada porque lo que importa es la UNIÓN — siete copias del mismo
   * dibujo en el mismo sitio tapan lo que una.
   */
  imageRects: PlacedRect[];
  /** Hubo texto, pero en modo invisible (`3 Tr` / `7 Tr`): capa OCR. */
  sawInvisibleText: boolean;
  /** Refs de Form XObject en la pila de recursión ACTUAL: corta los ciclos. */
  visited: Set<string>;
}

/** Lo que `q` guarda y `Q` devuelve. */
interface GraphicsState {
  ctm: Matrix;
  fontSize: number;
  leading: number;
  renderMode: number;
}

/** Caja alineada a los ejes, en coordenadas de página. */
interface PlacedRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
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
  // `q`/`Q` salvan el estado gráfico ENTERO, no solo la matriz: el tamaño de
  // fuente, el interlineado y el modo de render también viven ahí. Restaurar
  // solo la CTM deja que un `3 Tr` metido en un q…Q —la forma canónica de una
  // capa OCR— se derrame sobre el texto de verdad que venga después.
  const stateStack: GraphicsState[] = [];
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
    if (renderMode === 3 || renderMode === 7) {
      // No cuenta como banda, pero SÍ se deja constancia: una página cuyo único
      // texto es invisible es un escaneo con OCR encima, y sin esta marca
      // devolvía lo mismo que una hoja en blanco.
      ctx.sawInvisibleText = true;
      return;
    }
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
      token === '(blank)' ||
      token === '[' ||
      token === ']'
    ) {
      operands.push(token);
      continue;
    }

    switch (token) {
      case 'q':
        stateStack.push({ ctm, fontSize, leading, renderMode });
        break;
      case 'Q': {
        const popped = stateStack.pop();
        // `Q` sin su `q` significa que el stream no es el que creemos estar
        // leyendo. Seguir con el estado actual sería inventarse el resto.
        if (!popped) {
          reliable = false;
          break;
        }
        ({ ctm, fontSize, leading, renderMode } = popped);
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
        if (hasInk(operands)) emit();
        break;
      }
      case 'Tj':
      case 'TJ':
        // Una operación cuyo único contenido son espacios no deja tinta: no es un
        // obstáculo para la estampa, es un párrafo vacío.
        if (hasInk(operands)) emit();
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
  if (subtype === PDFName.of('Image')) {
    // Sigue sin estorbar al texto (se dibuja debajo, a propósito), pero se
    // apunta DÓNDE cae: una imagen que cubre la hoja entera en una página sin
    // texto no es un membrete, es un escaneo.
    const rect = placedUnitSquare(ctm);
    if (rect && ctx.imageRects.length < MAX_IMAGE_RECTS) ctx.imageRects.push(rect);
    return true;
  }
  if (subtype !== PDFName.of('Form')) return false;

  // La marca vale para la RAMA que se está abriendo, no para la página entera:
  // un mismo formulario colocado dos veces —un membrete, un pie, una casilla—
  // es reutilización legítima y su segunda copia también trae texto. Tratarla
  // como un ciclo la perdía en silencio y la página seguía dándose por
  // analizada entera.
  if (refKey !== null) {
    if (ctx.visited.has(refKey)) return false; // ciclo de verdad: no es fiable
    ctx.visited.add(refKey);
  }
  try {
    const decoded = decodeStream(ctx, stream);
    if (decoded === null) return false;

    const formMatrix = readMatrix(ctx.pdfDoc, stream.dict.get(PDFName.of('Matrix')));
    const formResources =
      asDict(ctx.pdfDoc, stream.dict.get(PDFName.of('Resources'))) ?? resources;

    return walkContent(ctx, decoded, formResources, multiply(formMatrix, ctm), depth + 1);
  } finally {
    if (refKey !== null) ctx.visited.delete(refKey);
  }
}

/**
 * Dónde cae una imagen colocada con esta CTM. Un Image XObject se dibuja
 * siempre en el cuadrado unidad, así que basta transformar sus cuatro esquinas
 * y quedarse con la caja que las contiene. Para una imagen girada esa caja
 * sobra un poco — se prefiere sobrar a quedarse corto: quedarse corto significa
 * no reconocer un escaneo.
 */
function placedUnitSquare(ctm: Matrix): PlacedRect | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [u, v] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    xs.push(ctm.a * u + ctm.c * v + ctm.e);
    ys.push(ctm.b * u + ctm.d * v + ctm.f);
  }
  if (![...xs, ...ys].every(Number.isFinite)) return null;
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * Papel realmente tapado (pt²) por un conjunto de rectángulos, recortados antes
 * contra la hoja. Es la UNIÓN, no la suma: dibujos solapados, teselados o
 * repetidos tapan una sola vez, y lo que cae fuera del papel no tapa nada.
 *
 * Se resuelve comprimiendo coordenadas: las aristas parten la hoja en celdas
 * que, o están enteras dentro de algún rectángulo, o enteras fuera.
 */
function unionArea(rects: readonly PlacedRect[], box: PlacedRect): number {
  const clipped: PlacedRect[] = [];
  for (const r of rects) {
    const x0 = Math.max(r.x0, box.x0);
    const y0 = Math.max(r.y0, box.y0);
    const x1 = Math.min(r.x1, box.x1);
    const y1 = Math.min(r.y1, box.y1);
    if (x1 > x0 && y1 > y0) clipped.push({ x0, y0, x1, y1 });
  }
  if (clipped.length === 0) return 0;

  const xs = [...new Set(clipped.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
  const ys = [...new Set(clipped.flatMap((r) => [r.y0, r.y1]))].sort((a, b) => a - b);

  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const [xa, xb] = [xs[i] as number, xs[i + 1] as number];
    for (let j = 0; j + 1 < ys.length; j++) {
      const [ya, yb] = [ys[j] as number, ys[j + 1] as number];
      const covered = clipped.some((r) => r.x0 <= xa && xb <= r.x1 && r.y0 <= ya && yb <= r.y1);
      if (covered) area += (xb - xa) * (yb - ya);
    }
  }
  return area;
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
  const imageOnlyPages: number[] = [];
  const ocrOnlyPages: number[] = [];
  const unanalyzed: Array<{ page: number; reason: UnanalyzedReason }> = [];
  const pageCount = pdfDoc.getPageCount();

  for (let page = 0; page < pageCount; page++) {
    try {
      const result = readPageBands(pdfDoc, page);
      if (isFailure(result)) {
        unanalyzedPages.push(page);
        unanalyzed.push({ page, reason: result.failure });
        continue;
      }
      if (result.imageOnly) imageOnlyPages.push(page);
      if (result.ocrOnly) ocrOnlyPages.push(page);
      // Un escaneo NO es una hoja en blanco: sus letras existen —en píxeles, o
      // en una capa invisible— y este módulo no las ve. Entra donde entran las
      // páginas que no se pudieron mirar, pero seamos exactos sobre lo que eso
      // consigue HOY: una página sin bandas ya iba al pie por defecto, así que
      // la colocación no se mueve ni un punto. Lo que aporta es el MOTIVO —"no
      // pude descomprimir" y "esto es un contrato escaneado" piden decisiones
      // distintas— y quien lo consuma será el clasificador de confianza.
      if (result.imageOnly || result.ocrOnly) unanalyzedPages.push(page);
      else bands.push(...result.bands);
    } catch {
      // Una excepción inesperada del recorrido: no se sabe qué la causó, y
      // decir 'stream_undecodable' sería inventarse un diagnóstico.
      unanalyzedPages.push(page);
      unanalyzed.push({ page, reason: 'unbalanced_state' });
    }
  }
  return { bands, unanalyzedPages, imageOnlyPages, ocrOnlyPages, unanalyzed };
}

/**
 * Qué se pudo ver en UNA página. `null` si el recorrido no es de fiar; si lo
 * es, las bandas más las dos formas de ceguera que este lector sabe reconocer
 * en sí mismo.
 */
interface PageScan {
  bands: TextBand[];
  /** Sin texto visible y con la hoja mayormente tapada por una imagen. */
  imageOnly: boolean;
  /** Sin texto visible, pero había texto en modo invisible. */
  ocrOnly: boolean;
}

/**
 * Por qué no se pudo recorrer una página.
 *
 * Antes todas las causas eran el mismo `null`, y "no pude descomprimir el
 * stream" acababa contado igual que "el documento pide un giro que no supe
 * seguir". Sin el motivo no se puede saber si la ceguera es del PDF o nuestra
 * — y resultó ser nuestra.
 */
export type UnanalyzedReason =
  /** Un stream de contenido que no se pudo resolver o descomprimir. */
  | 'stream_undecodable'
  /** `Q` sin su `q`, o la pila de estado descuadrada de otro modo. */
  | 'unbalanced_state'
  /** Se agotó el presupuesto de tokens o de bytes de la página. */
  | 'budget_exhausted'
  /** Una banda cayó fuera del papel: el modelo de la página no es el real. */
  | 'band_out_of_bounds'
  /** La página no existe en el documento. */
  | 'page_missing';

interface PageFailure {
  failure: UnanalyzedReason;
}

function isFailure(r: PageScan | PageFailure): r is PageFailure {
  return 'failure' in r;
}

/**
 * Une los streams de una página en uno solo.
 *
 * El salto de línea no es cosmético: sin él, el último token de un stream y el
 * primero del siguiente se pegan y forman un operador que no existe. La spec
 * (ISO 32000 §7.8.2) lo exige por eso mismo.
 */
function concatWithNewline(parts: readonly string[]): string {
  return parts.length === 1 ? parts[0]! : parts.join('\n');
}

/**
 * Quita las líneas desproporcionadamente altas de una página: marcas de agua,
 * logotipos compuestos con texto, sellos de fondo. Ver
 * {@link WATERMARK_SIZE_RATIO} para el porqué y la medición que lo motivó.
 *
 * Con menos de tres líneas no se descarta nada: la mediana de una o dos no
 * dice cuál es el cuerpo normal de la página, y un documento de dos líneas
 * grandes es un documento de dos líneas grandes, no una marca de agua.
 */
function withoutWatermark(bands: readonly TextBand[]): TextBand[] {
  if (bands.length < 3) return [...bands];
  const heights = bands.map((b) => b.h).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)]!;
  if (!(median > 0)) return [...bands];
  const cap = median * WATERMARK_SIZE_RATIO;
  const kept = bands.filter((b) => b.h <= cap);
  // Si el filtro se lleva la página entera, el supuesto era falso: lo que
  // parecía marca de agua era el contenido. Se prefiere no tocar nada antes que
  // devolver una hoja en blanco que la colocación leería como "sitio libre".
  return kept.length > 0 ? kept : [...bands];
}

function readPageBands(pdfDoc: PDFDocument, page: number): PageScan | PageFailure {
  const pdfPage = pdfDoc.getPages()[page];
  if (!pdfPage) return { failure: 'page_missing' };

  const ctx: WalkContext = {
    pdfDoc,
    page,
    bands: [],
    bytesLeft: MAX_CONTENT_BYTES_PER_PAGE,
    visited: new Set(),
    imageRects: [],
    sawInvisibleText: false,
  };
  const resources = asDict(pdfDoc, pdfPage.node.get(PDFName.of('Resources')));

  // `/Contents` puede ser un ARRAY de streams, y la spec (ISO 32000 §7.8.2) dice
  // que se traten como UNO SOLO concatenado. Recorrerlos por separado, cada uno
  // con su propia pila de estado, era el defecto: un editor que antepone o
  // apéndice contenido parte un `q` en un stream y su `Q` en el siguiente —un
  // patrón corriente, no exótico—, y ese `Q` huérfano marcaba la página entera
  // como no fiable. El documento estaba perfectamente bien; el lector no.
  const parts: string[] = [];
  for (const entry of pageStreams(pdfDoc, page)) {
    const stream = resolve(pdfDoc, entry);
    if (!(stream instanceof PDFRawStream)) return { failure: 'stream_undecodable' };
    const decoded = decodeStream(ctx, stream);
    if (decoded === null) return { failure: 'stream_undecodable' };
    parts.push(decoded);
  }
  // Separador obligatorio: sin él el último token de un stream y el primero del
  // siguiente se pegan y forman un operador que no existe.
  const joined = concatWithNewline(parts);
  if (!walkContent(ctx, joined, resources, IDENTITY, 0)) {
    return { failure: 'unbalanced_state' };
  }

  // Una banda fuera del papel significa que nuestro modelo de la página es
  // falso (una transformación que no supimos seguir). Descartarla en silencio
  // dejaría el resto de bandas —igual de sospechosas— pasando por buenas.
  const box = pdfPage.getMediaBox();
  const bottom = box.y - PAGE_BOUNDS_TOLERANCE_PT;
  const top = box.y + box.height + PAGE_BOUNDS_TOLERANCE_PT;
  for (const band of ctx.bands) {
    if (band.y < bottom || band.y + band.h > top) return { failure: 'band_out_of_bounds' };
  }

  // Las dos cegueras solo se declaran cuando NO hay una sola letra visible. Con
  // texto encima, una imagen a toda página es un fondo o un membrete y el
  // recorrido sirve: lo que se busca aquí es la página cuyo contenido entero se
  // nos escapa.
  const blank = ctx.bands.length === 0;
  const pageArea = box.width * box.height;
  const covered = blank
    ? unionArea(ctx.imageRects, {
        x0: box.x,
        y0: box.y,
        x1: box.x + box.width,
        y1: box.y + box.height,
      })
    : 0;
  const imageOnly = blank && pageArea > 0 && covered >= pageArea * MIN_SCAN_COVERAGE_RATIO;

  // El descarte va ANTES de fundir: una vez fundida, la marca de agua ya se
  // llevó por delante las bandas del texto de verdad que cruzaba.
  return {
    bands: mergeBands(withoutWatermark(ctx.bands)),
    imageOnly,
    ocrOnly: blank && ctx.sawInvisibleText,
  };
}
