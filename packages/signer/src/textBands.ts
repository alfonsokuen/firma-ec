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

import { PDFArray, PDFDict, type PDFDocument, PDFName, PDFRawStream, PDFRef } from 'pdf-lib';

import { decodeStreamBounded } from './boundedDecode.js';
import { type CodePointSink, UNMAPPED_CODE_POINT } from './fontDecode.js';
import { type FontResourceCache, createFontResourceCache } from './fontResources.js';

/** Intervalo vertical ocupado por texto en una página. `page` es 0-based. */
export interface TextBand {
  page: number;
  /** Borde inferior en espacio de usuario. */
  y: number;
  /** Alto en pt. */
  h: number;
  /**
   * Borde IZQUIERDO de la línea en espacio de usuario, si se pudo determinar.
   *
   * Las bandas ocupan el ancho visible completo a propósito —medir el ancho
   * real exige las métricas de la fuente incrustada—, pero dónde EMPIEZA la
   * línea sale gratis de la matriz de texto. Sirve para alinear la estampa con
   * el margen del bloque de firma en vez de centrarla en la hoja.
   */
  x?: number;
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
 * Recibe los code points de una línea de texto decodificada, para que la FASE
 * 3 (ancla de texto) busque "Firma"/"f)"/el nombre/la cédula sin que este
 * módulo tenga que conocerlos.
 *
 * `push` devuelve `void` A PROPÓSITO — igual que el sink de `fontDecode.ts`—:
 * los caracteres no pueden subir por la pila de retorno. Recibe también el
 * sentinela `UNMAPPED_CODE_POINT` (-1) de `fontDecode.ts` cuando un código no
 * se pudo mapear, tal cual lo entrega el decoder de fuente.
 */
export interface TextRunObserver {
  beginLine(page: number, x: number | undefined, y: number, h: number): void;
  push(codePoint: number): void;
  endLine(): void;
  /**
   * Se invoca cuando una página se descarta del análisis (ver
   * {@link UnanalyzedReason}), tanto si nunca llegó a producir una sola línea
   * como si el descarte ocurrió a mitad de recorrido. Sin esto, la ausencia
   * de líneas para la página N era indistinguible entre "esta página no
   * tiene ancla" y "no pude leerla" — la señal debe ser POSITIVA ("descarté
   * la página N"), nunca la ausencia de una entrada. Opcional: un observador
   * que no lo implementa sigue funcionando exactamente igual que antes.
   */
  discardPage?(page: number, reason: UnanalyzedReason): void;
  /**
   * Se invoca UNA vez por página cuando {@link MAX_DECODED_CODES_PER_PAGE} se
   * agota a mitad de la página. A diferencia de {@link discardPage}, la
   * página SIGUE analizada para BANDAS —el ancla es una mejora sobre ellas,
   * no un requisito, y truncar el texto no debe tirar la colocación por
   * bandas—; pero un consumidor que solo cablee el observador (la vía que
   * usa la FASE 3) necesita esta señal POSITIVA: sin ella, una página que se
   * corta a mitad de camino entregaba exactamente las mismas líneas que una
   * página agotada limpiamente, y "aquí no hay ancla" y "no llegué a mirar
   * el resto" son conclusiones opuestas. Medido: con el presupuesto agotado
   * a media página, el 37,5% del texto restante desaparecía sin que el
   * observador recibiera ni una señal. Opcional: un observador que no lo
   * implementa sigue funcionando exactamente igual que antes.
   */
  truncatePage?(page: number): void;
}

/** Cobertura de decodificación de UNA página, para el clasificador de confianza de la FASE 3. */
export interface PageDecodeStats {
  page: number;
  /**
   * `mappedCodes/totalCodes`. `null` cuando la página tenía operaciones de
   * texto pero no se pudo medir NADA de ellas (p.ej. el presupuesto se agotó
   * antes del primer code point, o el único intento de decodificar lanzó).
   * `1` solo cuando de verdad no había ninguna operación de texto que medir
   * — "no hay ancla" y "no pude leer" son decisiones opuestas para quien
   * consume esto, y antes compartían el mismo valor.
   */
  coverage: number | null;
  /** Se agotó {@link MAX_DECODED_CODES_PER_PAGE} antes de terminar la página. */
  scanIncomplete: boolean;
  /**
   * Cuántas veces `decoder.decode()` (una fuente o CMap ilegible del
   * documento, nunca un bug propio) lanzó en esta página. Solo el CONTADOR
   * sale de aquí — nunca el error ni su mensaje, que podría llevar bytes del
   * documento.
   */
  decodeErrors: number;
  /**
   * Cuántas veces `observer.push()` (la FASE 3, un bug NUESTRO, nunca del
   * documento) lanzó en esta página. Solo el CONTADOR — igual que
   * {@link decodeErrors}, nunca el mensaje: distinguir "el documento es
   * ilegible" de "nuestro código rompió" no exige guardar ni un byte de la
   * excepción.
   */
  observerErrors: number;
  /**
   * Motivo por el que la página se descartó del análisis, o `null` si se
   * analizó entera. Ver {@link TextRunObserver.discardPage}: mismo valor,
   * distinta vía de entrega.
   */
  pageRejected: UnanalyzedReason | null;
}

export interface ReadTextBandsOptions {
  /**
   * Sin esto, `readTextBands` se comporta exactamente igual que antes de que
   * existiera el ancla de texto: cero asignaciones nuevas, mismo camino byte a
   * byte. Con esto, además de las bandas, se decodifica el texto de cada línea
   * y se entrega al observador.
   */
  textObserver?: TextRunObserver;
  /** Se invoca una vez por página analizada, solo si hay {@link ReadTextBandsOptions.textObserver}. */
  onPageDecodeStats?: (stats: PageDecodeStats) => void;
}

/**
 * Alto mínimo atribuido a una línea cuando el tamaño de fuente no se pudo leer.
 * 12pt es el cuerpo habitual de un contrato; quedarse corto es peor que pasarse
 * porque deja pasar un solape.
 */
const FALLBACK_FONT_SIZE_PT = 12;

// Exportados SOLO para que los tests de mutación afirmen el número real en
// vez de duplicarlo como constante mágica (y quedar desalineados si cambia).
/** Tope de operadores procesados por página: corta en seco un stream patológico. */
export const MAX_OPERATORS_PER_PAGE = 200_000;

/**
 * Tope de bytes DESCOMPRIMIDOS por página. El tope de operadores acota el
 * recorrido, no la memoria: `decodePDFRawStream` infla el stream entero antes de
 * que veamos un solo token, y el pre-vuelo encadena hasta 50 documentos en el
 * hilo principal. 8 MB de content stream es un documento desmesurado; pasarse de
 * ahí se trata como "no analizable", no como "sin texto".
 */
export const MAX_CONTENT_BYTES_PER_PAGE = 8 * 1024 * 1024;

/** Profundidad máxima de Form XObjects anidados. */
const MAX_XOBJECT_DEPTH = 8;

/**
 * Tope de code points decodificados por página cuando hay `textObserver`. Una
 * página real anda en 2-4k; 50k es una hoja densa varias veces sobre sí misma.
 * Al agotarse se deja de decodificar texto para el ancla — las BANDAS no se
 * tocan, porque el ancla es una mejora sobre ellas, no un requisito.
 */
// Exportado SOLO para que los tests de mutación afirmen el número real en
// vez de duplicarlo como constante mágica (y quedar desalineados si cambia).
export const MAX_DECODED_CODES_PER_PAGE = 50_000;

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

/**
 * Una pieza del contenido de texto de UNA operación (`Tj`/`TJ`/`'`/`"`), en
 * el orden en que aparece:
 *  - `string`: los bytes crudos de un literal CON tinta.
 *  - `blank`: un literal vacío (`(blank)` en `tokenize()`) que, a nivel de
 *    TEXTO —a diferencia del nivel de BANDAS—, SÍ separa palabras: sin esto,
 *    `[(Firma)( )(del)( )(cliente)] TJ` llegaba al observador como
 *    "Firmadelcliente". Se entrega como un espacio real (0x20) DIRECTO al
 *    observador, sin pasar por el decoder de fuente: no son bytes reales del
 *    documento, así que no tiene sentido pedirle a una Type0 que los
 *    interprete con SU ancho de código — pasarlos como bytes de 1 byte a un
 *    decoder que espera pares de 2 rompía el espacio en Identity-H (caía en
 *    "código sobrante" y emitía el centinela de hueco en su lugar). Cuenta
 *    como MAPEADO en la cobertura: es tinta que sintetizamos A PROPÓSITO,
 *    nunca texto ilegible del documento.
 *  - `gap`: NO son bytes de una cadena, sino el desplazamiento numérico entre
 *    dos cadenas de un array `TJ` cuando supera {@link TJ_GAP_THRESHOLD_UNITS}
 *    — la forma en que muchos generadores simulan un espacio de palabra sin
 *    un glifo de espacio real. Se entrega como el centinela de "hueco"
 *    directo al observador, sin pasar por el decoder de fuente: no hay
 *    carácter que decodificar, solo la certeza de que ahí NO hay contigüidad.
 *    Cuenta como MAPEADO por la misma razón que `blank`: sabemos exactamente
 *    qué es, no es una letra del documento que no supimos leer.
 */
type TextRunPart = { kind: 'string'; bytes: Uint8Array } | { kind: 'blank' } | { kind: 'gap' };

/**
 * Umbral, en milésimas de unidad de espacio de texto (la misma escala que
 * usa el operador `TJ`), a partir del cual un desplazamiento NEGATIVO —que
 * mueve el siguiente glifo hacia la DERECHA, ISO 32000 §9.4.3— se interpreta
 * como un hueco de palabra y no como un simple ajuste de kerning. Los pares
 * de kerning legítimos rondan unas pocas decenas; un hueco de palabra
 * simulado por posicionamiento (en vez de con un glifo de espacio) suele
 * rondar 120-300. El valor es deliberadamente conservador —prefiere un falso
 * negativo (no cortar un kerning agresivo) a uno positivo (cortar palabras
 * de verdad)—, porque el coste de un falso positivo es solo un centinela de
 * más, mientras que el de un falso negativo ya estaba: pegar dos palabras.
 */
const TJ_GAP_THRESHOLD_UNITS = 120;

function isWhitespace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f' || ch === '\0';
}

interface TokenizeResult {
  tokens: string[];
  /** `false` si hubo que cortar: el recorrido ya no cubre la página entera. */
  complete: boolean;
  /**
   * Bytes crudos (aún CON escapes/hex sin resolver) de cada token `(str)`, EN
   * EL MISMO ORDEN en que aparecen. Solo se llena cuando `capture` es `true` —
   * sin observador, cero asignaciones nuevas respecto al camino de siempre.
   */
  rawStrings?: Uint8Array[];
  /**
   * `true` únicamente cuando `complete` es `false` PORQUE se alcanzó
   * {@link MAX_OPERATORS_PER_PAGE} — nunca por un literal sin cerrar o una
   * imagen en línea sin su `EI`, que son corrupción real del stream, no
   * presupuesto. `walkContent` lo usa para poner `ctx.budgetExhaustedBy`.
   */
  exhaustedOperatorBudget?: boolean;
}

/**
 * Bytes de un literal PDF `(...)` YA des-escapado: `\n \r \t \b \f \( \) \\`,
 * octal `\ddd` (1-3 dígitos) y la continuación de línea `\<salto>` (sin byte).
 * Cualquier otra barra invertida se ignora y el carácter siguiente pasa
 * literal (ISO 32000 §7.3.4.2). Nunca lanza: un escape corrupto degrada a
 * "byte tal cual", no interrumpe el des-escapado.
 */
function unescapeLiteral(raw: string): Uint8Array {
  const out: number[] = [];
  let i = 0;
  const n = raw.length;
  while (i < n) {
    const ch = raw[i]!;
    if (ch !== '\\') {
      out.push(ch.charCodeAt(0) & 0xff);
      i++;
      continue;
    }
    i++;
    if (i >= n) break; // barra invertida colgando al final del literal
    const esc = raw[i]!;
    if (esc === 'n') {
      out.push(0x0a);
      i++;
    } else if (esc === 'r') {
      out.push(0x0d);
      i++;
    } else if (esc === 't') {
      out.push(0x09);
      i++;
    } else if (esc === 'b') {
      out.push(0x08);
      i++;
    } else if (esc === 'f') {
      out.push(0x0c);
      i++;
    } else if (esc === '(' || esc === ')' || esc === '\\') {
      out.push(esc.charCodeAt(0));
      i++;
    } else if (esc === '\n') {
      i++; // continuación de línea: no deja byte
    } else if (esc === '\r') {
      i++;
      if (raw[i] === '\n') i++;
    } else if (esc >= '0' && esc <= '7') {
      let val = 0;
      let digits = 0;
      while (digits < 3 && i < n && raw[i]! >= '0' && raw[i]! <= '7') {
        val = val * 8 + (raw.charCodeAt(i) - 0x30);
        i++;
        digits++;
      }
      out.push(val & 0xff);
    } else {
      out.push(esc.charCodeAt(0) & 0xff);
      i++;
    }
  }
  return new Uint8Array(out);
}

/** Bytes de un literal hex `<...>`. Dígito impar final se completa con `0` (ISO 32000 §7.3.4.3). Nunca lanza. */
function hexToBytes(raw: string): Uint8Array {
  const clean = raw.replace(/[^0-9A-Fa-f]/g, '');
  const padded = clean.length % 2 === 0 ? clean : clean + '0';
  const out = new Uint8Array(padded.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(padded.slice(i * 2, i * 2 + 2), 16);
    out[i] = Number.isFinite(byte) ? byte : 0;
  }
  return out;
}

/**
 * Trocea un content stream en tokens, saltándose lo que no importa: las cadenas
 * `(...)` y `<...>` se colapsan a un marcador, porque su CONTENIDO es el texto
 * del documento y aquí no se lee jamás. Los datos binarios de una imagen en
 * línea (`BI … ID … EI`) se saltan enteros: un `(` suelto dentro del binario
 * se comía el resto del stream y la página salía muda.
 *
 * `capture` solo lo activa el llamador cuando hay un `textObserver`: en ese
 * caso, además del marcador, se guardan los bytes crudos del literal en
 * {@link TokenizeResult.rawStrings}. Sin `capture`, ni se mira esa rama —el
 * camino byte a byte es idéntico al de antes de que el ancla existiera.
 */
function tokenize(content: string, capture: boolean): TokenizeResult {
  const tokens: string[] = [];
  const rawStrings: Uint8Array[] | undefined = capture ? [] : undefined;
  // `exactOptionalPropertyTypes` no deja asignar `rawStrings: undefined` a una
  // propiedad opcional: se omite del todo cuando no hay captura.
  const finish = (complete: boolean, exhaustedOperatorBudget = false): TokenizeResult => {
    const base = rawStrings ? { tokens, complete, rawStrings } : { tokens, complete };
    return exhaustedOperatorBudget ? { ...base, exhaustedOperatorBudget: true } : base;
  };
  let i = 0;
  const n = content.length;

  while (i < n) {
    if (tokens.length >= MAX_OPERATORS_PER_PAGE) return finish(false, true);
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
      // descarta. Nunca se guarda su contenido salvo que `capture` lo pida.
      let depth = 1;
      i++;
      const start = i;
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
      if (depth > 0) return finish(false);
      tokens.push(hasInk ? '(str)' : '(blank)');
      if (rawStrings && hasInk) rawStrings.push(unescapeLiteral(content.slice(start, i - 1)));
      continue;
    }
    if (ch === '<' && content[i + 1] !== '<') {
      const start = i + 1;
      while (i < n && content[i] !== '>') i++;
      const hexInner = content.slice(start, i);
      // Un literal hex `<>` (o solo separadores) no tiene ni un dígito: es
      // una cadena VACÍA, igual que `()`, no texto ilegible. El literal
      // `(...)` ya distinguía blanco/tinta con `hasInk`; este siempre se
      // marcaba `(str)` sin mirar su contenido — `coverage: null` pasaba a
      // significar dos cosas a la vez ("no pude medir" Y "cadena vacía").
      const hasHexInk = /[0-9A-Fa-f]/.test(hexInner);
      if (hasHexInk) {
        if (rawStrings) rawStrings.push(hexToBytes(hexInner));
        tokens.push('(str)');
      } else {
        tokens.push('(blank)');
      }
      i++;
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
      if (end === null) return finish(false);
      i = end;
      tokens.push('EI');
    }
  }

  return finish(true);
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
  /** Solo presente cuando el llamador pidió el ancla de texto (FASE 2/3). */
  textObserver?: TextRunObserver;
  /** Caché de fuentes del documento; vive tanto como `textObserver`. */
  fontCache?: FontResourceCache;
  /** Code points que aún se pueden decodificar en esta página. Ver {@link MAX_DECODED_CODES_PER_PAGE}. */
  decodedCodesLeft: number;
  /** Se agotó el presupuesto de decode antes de terminar la página. */
  decodeIncomplete: boolean;
  /** Para `PageDecodeStats.coverage`: códigos vistos y códigos mapeados en la página. */
  decodedCodesTotal: number;
  decodedCodesMapped: number;
  /** Cuenta para `PageDecodeStats.decodeErrors`: solo el NÚMERO, nunca el error. */
  decodeErrors: number;
  /** Cuenta para `PageDecodeStats.observerErrors`: solo el NÚMERO, nunca el error. */
  observerErrors: number;
  /**
   * Hubo al menos una operación de texto con tinta en la página (se intentó
   * decodificarla, aunque no se midiera nada). Distingue "no hay ancla" de
   * "no pude medir el ancla que sí había" en `PageDecodeStats.coverage`.
   */
  hadTextOps: boolean;
  /**
   * Ya se le avisó a `textObserver.truncatePage` en esta página. Sin esta
   * marca, cada operación de texto que encontrara el presupuesto de
   * code points agotado dispararía otra llamada — la señal debe salir UNA
   * vez, no una por cada `Tj`/`TJ` restante de la página.
   */
  truncateNotified: boolean;
  /**
   * Por qué se agotó un presupuesto de la página, cuando eso es lo que hizo
   * que `walkContent`/`decodeStream` devolvieran "no fiable": `'operators'`
   * (tope de tokens, `MAX_OPERATORS_PER_PAGE`) o `'bytes'` (tope de bytes
   * descomprimidos, `MAX_CONTENT_BYTES_PER_PAGE`). `undefined` cuando el
   * corte fue por una razón ESTRUCTURAL (stream corrupto, `Q` sin `q`) y no
   * por presupuesto — esa distinción es la que faltaba: antes, rebasar
   * cualquiera de los dos topes se reportaba con la MISMA razón que un PDF
   * de verdad corrupto (`unbalanced_state`/`stream_undecodable`), así que la
   * única señal pensada para separar "el documento está mal" de "nuestro
   * techo es bajo" mentía justo en los dos casos donde el techo es nuestro.
   */
  budgetExhaustedBy?: 'operators' | 'bytes';
}

/** Lo que `q` guarda y `Q` devuelve. */
interface GraphicsState {
  ctm: Matrix;
  fontSize: number;
  leading: number;
  renderMode: number;
  /** Operando de `Tf` tal cual (p.ej. `"/F1"`); estado gráfico, sobrevive a `q`/`Q`. */
  fontName: string | undefined;
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
  // `capture` solo se activa con observador: sin él, `rawStrings` queda
  // `undefined` y no se hace NINGUNA asignación nueva respecto al camino de
  // siempre (mismo contrato que `fontDecode.ts`: sin sink, sin trabajo extra).
  const capture = Boolean(ctx.textObserver);
  const { tokens, complete, rawStrings, exhaustedOperatorBudget } = tokenize(content, capture);
  let reliable = complete;
  if (exhaustedOperatorBudget) ctx.budgetExhaustedBy = 'operators';

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
  let fontName: string | undefined;
  const operands: string[] = [];
  // Piezas de texto (cadenas y huecos) acumuladas desde el último operador,
  // en el MISMO orden en que aparecieron. `null` cuando no hay observador:
  // así el camino sin captura no reserva ni un array por operación de texto.
  const operandStrings: TextRunPart[] | null = capture ? [] : null;
  let strCursor = 0;

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
    const y = eff.f - extent * 0.25;
    const h = extent * 1.1;
    ctx.bands.push({ page: ctx.page, y, h, x: eff.e });

    if (operandStrings && operandStrings.length > 0) {
      decodeTextRun(ctx, operandStrings, resources, fontName, eff.e, y, h);
    }
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
      if (rawStrings && token === '(str)') {
        // Alinea con `rawStrings`, que SOLO tiene una entrada por cada
        // `(str)` (los `(blank)` nunca escriben ahí) — ver `tokenize()`.
        const raw = rawStrings[strCursor];
        strCursor++;
        if (raw && operandStrings) operandStrings.push({ kind: 'string', bytes: raw });
      } else if (operandStrings && token === '(blank)') {
        // A nivel de BANDAS un párrafo vacío no cuenta (no dibuja tinta,
        // `hasInk` lo ignora); a nivel de TEXTO sí separa palabras — ver
        // {@link TextRunPart}.
        operandStrings.push({ kind: 'blank' });
      } else if (operandStrings && operandStrings.length > 0 && isNumber(token)) {
        // Un desplazamiento numérico DENTRO de un array `TJ` ya en curso
        // (ya se acumuló al menos una cadena para este operador): si es lo
        // bastante negativo, es un hueco de palabra simulado por
        // posicionamiento, no kerning. Ver {@link TJ_GAP_THRESHOLD_UNITS}.
        const value = Number(token);
        if (Number.isFinite(value) && value <= -TJ_GAP_THRESHOLD_UNITS) {
          operandStrings.push({ kind: 'gap' });
        }
      }
      continue;
    }

    switch (token) {
      case 'q':
        stateStack.push({ ctm, fontSize, leading, renderMode, fontName });
        break;
      case 'Q': {
        const popped = stateStack.pop();
        // `Q` sin su `q` significa que el stream no es el que creemos estar
        // leyendo. Seguir con el estado actual sería inventarse el resto.
        if (!popped) {
          reliable = false;
          break;
        }
        ({ ctm, fontSize, leading, renderMode, fontName } = popped);
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
        // `Tf` es `<fuente> <tamaño> Tf`: el operando anterior al tamaño es el
        // nombre de la fuente en `/Resources /Font`, tal cual aparece (con la
        // barra inicial). Es estado gráfico: sobrevive a `q`/`Q` igual que el
        // tamaño y el modo de render.
        const name = operands[operands.length - 2];
        if (typeof name === 'string' && name.startsWith('/')) fontName = name;
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
    if (operandStrings) operandStrings.length = 0;
  }

  return reliable;
}

/**
 * Marcador para distinguir, dentro del `catch` de `decoder.decode()`, una
 * excepción que vino del PROPIO `decode` (fuente/CMap ilegible del
 * documento — se traga y se cuenta) de una que vino del `sink`, es decir del
 * `observer.push` de la FASE 3 (un bug NUESTRO — debe subir, no esconderse
 * detrás del mismo contador que un documento adversario). `decode()` llama al
 * sink de forma síncrona, así que sin este marcador ambas caerían en el
 * mismo `catch` y serían indistinguibles.
 */
class ObserverFailure {
  constructor(readonly cause: unknown) {}
}

/**
 * Marca el presupuesto de code points agotado y avisa UNA sola vez al
 * observador (ver {@link TextRunObserver.truncatePage}). Antes esto solo
 * fijaba `ctx.decodeIncomplete`, que viaja únicamente por
 * `onPageDecodeStats` — una opción INDEPENDIENTE de `textObserver`: un
 * consumidor que solo cablea el observador (la vía real de la FASE 3) no
 * recibía señal alguna, y una página truncada a media hoja se leía
 * exactamente igual que una agotada limpiamente. `ctx.truncateNotified`
 * evita repetir el aviso por cada operación de texto que quede después del
 * corte.
 */
function markDecodeBudgetExhausted(ctx: WalkContext): void {
  ctx.decodeIncomplete = true;
  if (ctx.truncateNotified) return;
  ctx.truncateNotified = true;
  ctx.textObserver?.truncatePage?.(ctx.page);
}

/**
 * Decodifica las cadenas de UNA operación de texto (`Tj`/`TJ`/`'`/`"`) y las
 * entrega al observador con la MISMA geometría que ya calculó `emit()`.
 *
 * La banda geométrica ya se registró antes de llamar aquí, así que un fallo
 * de FUENTE (`fontResources.ts`/`fontDecode.ts` ante una CMap o un
 * `/Encoding` corrupto del documento) nunca puede tocarla: se cuenta en
 * `ctx.decodeErrors` y se sigue — el ancla es una mejora sobre las bandas,
 * nunca un requisito. Un fallo del OBSERVADOR (la FASE 3) es distinto: es un
 * bug propio, y por eso se deja subir sin atrapar — lo atrapa el `try/catch`
 * de página en `readPageBands`, que lo hace VISIBLE marcando la página como
 * no analizada en vez de fingir que coverage=1 porque "no hubo nada que
 * medir".
 */
function decodeTextRun(
  ctx: WalkContext,
  parts: readonly TextRunPart[],
  resources: PDFDict | null,
  fontName: string | undefined,
  x: number | undefined,
  y: number,
  h: number,
): void {
  const observer = ctx.textObserver;
  const fontCache = ctx.fontCache;
  if (!observer || !fontCache) return;
  ctx.hadTextOps = true;
  if (ctx.decodedCodesLeft <= 0) {
    markDecodeBudgetExhausted(ctx);
    return;
  }

  // `resolveFont` nunca lanza (contrato de `fontResources.ts`): cualquier
  // fuente ilegible ya llega degradada a "todo sin mapear".
  const decoder = fontCache.resolveFont(resources, fontName);
  // Envuelve `observer.push` UNA vez: si lanza, se re-envuelve en
  // `ObserverFailure` para poder distinguirlo, en el catch de abajo, de una
  // excepción del propio decoder.
  const sink: CodePointSink = (cp) => {
    try {
      observer.push(cp);
    } catch (err) {
      throw new ObserverFailure(err);
    }
  };

  observer.beginLine(ctx.page, x, y, h);
  try {
    for (const part of parts) {
      if (ctx.decodedCodesLeft <= 0) {
        markDecodeBudgetExhausted(ctx);
        break;
      }
      try {
        if (part.kind === 'gap') {
          // No son bytes de una cadena del documento: es el desplazamiento
          // numérico de un `TJ` diciendo "aquí hay un hueco". Se entrega el
          // centinela directo, sin pasar por el decoder de fuente. Cuenta
          // como MAPEADO (ver {@link TextRunPart}): es una separación que
          // NOSOTROS sintetizamos con certeza, no texto ilegible del
          // documento — contarlo como no-mapeado bajaba `coverage` por cada
          // separador de palabra que el propio módulo insertaba.
          sink(UNMAPPED_CODE_POINT);
          ctx.decodedCodesLeft -= 1;
          ctx.decodedCodesTotal += 1;
          ctx.decodedCodesMapped += 1;
          continue;
        }
        if (part.kind === 'blank') {
          // Un `(blank)` es un espacio real (ver {@link TextRunPart}), NUNCA
          // bytes del documento: se entrega directo, sin pasar por
          // `decoder.decode()`. Pasarlo como bytes rompía las Type0 —
          // `/ToUnicode` espera códigos de N bytes y un espacio sintético de
          // 1 byte caía en "código sobrante" y emitía el centinela de hueco
          // en vez del espacio que promete este comentario.
          sink(0x20);
          ctx.decodedCodesLeft -= 1;
          ctx.decodedCodesTotal += 1;
          ctx.decodedCodesMapped += 1;
          continue;
        }
        // El presupuesto restante se pasa DENTRO de decode(): sin esto, una
        // sola cadena de 2 MB entregaba sus 2.000.000 de code points al
        // observador de un tirón, sin que el tope de página (comprobado
        // solo ENTRE cadenas) tuviera ocasión de cortar.
        const outcome = decoder.decode(part.bytes, sink, ctx.decodedCodesLeft);
        // Se cuenta SIEMPRE que `decode` haya devuelto algo, incluso si el
        // presupuesto se agotó a mitad de esta cadena: lo decodificado hasta
        // el corte es real y no debe perderse.
        ctx.decodedCodesLeft -= outcome.codes;
        ctx.decodedCodesTotal += outcome.codes;
        ctx.decodedCodesMapped += outcome.mapped;
        if (outcome.truncated) {
          markDecodeBudgetExhausted(ctx);
          break;
        }
      } catch (err) {
        // NO se desenvuelve: `ObserverFailure` debe llegar marcada hasta
        // `readPageBands` para que la razón real ('observer_failure') no se
        // pierda un frame antes de servir. Antes `throw err.cause` tiraba la
        // marca y `readPageBands` caía al mismo 'unbalanced_state' que un
        // `Q` huérfano — un bug propio en `observer.push()` y un PDF
        // adversario terminaban indistinguibles.
        if (err instanceof ObserverFailure) throw err;
        // Mudo A PROPÓSITO: un decoder que lanza sobre una fuente/CMap
        // corrupta del documento no puede tumbar la página, y su mensaje
        // podría llevar bytes del documento — no hay dónde meterlo sin
        // arriesgar una fuga. Solo el CONTADOR sale de aquí.
        ctx.decodeErrors++;
      }
    }
  } finally {
    observer.endLine();
  }
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
    const formResources = asDict(ctx.pdfDoc, stream.dict.get(PDFName.of('Resources'))) ?? resources;

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

/**
 * Descomprime un stream descontándolo del presupuesto de la página. El tope
 * se aplica DURANTE la descompresión (ver `boundedDecode.ts`): un stream que
 * exceda `ctx.bytesLeft` nunca se infla entero en memoria, solo hasta un
 * byte más de lo que hacía falta para saber que no cabe.
 */
function decodeStream(ctx: WalkContext, stream: PDFRawStream): string | null {
  try {
    const bytes = decodeStreamBounded(stream, ctx.bytesLeft);
    if (bytes === null) {
      ctx.bytesLeft = 0;
      ctx.budgetExhaustedBy = 'bytes';
      return null;
    }
    ctx.bytesLeft -= bytes.length;
    return new TextDecoder('latin1').decode(bytes);
  } catch {
    // Mudo A PROPÓSITO: un content stream corrupto puede lanzar con bytes
    // del propio stream en el mensaje de la excepción. No hay dónde meterlo
    // sin arriesgar una fuga — la página se trata como no analizable.
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
export function readTextBands(
  pdfDoc: PDFDocument,
  options?: ReadTextBandsOptions,
): TextBandsResult {
  const bands: TextBand[] = [];
  const unanalyzedPages: number[] = [];
  const imageOnlyPages: number[] = [];
  const ocrOnlyPages: number[] = [];
  const unanalyzed: Array<{ page: number; reason: UnanalyzedReason }> = [];
  const pageCount = pdfDoc.getPageCount();
  // Caché a nivel de DOCUMENTO: una fuente referenciada desde cien páginas se
  // parsea una vez. Solo se crea si hay observador — sin él, cero coste.
  const fontCache = options?.textObserver ? createFontResourceCache(pdfDoc) : undefined;

  for (let page = 0; page < pageCount; page++) {
    try {
      const result = readPageBands(pdfDoc, page, options, fontCache);
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
      // Mudo A PROPÓSITO (sin binding): una excepción inesperada del
      // recorrido —incluida la que `readPageBands` deja subir a propósito
      // cuando el bug es del OBSERVADOR de la FASE 3, ver `decodeTextRun`—
      // podría llevar bytes del documento en su mensaje. `readPageBands` ya
      // reportó el motivo por las dos vías (`onPageDecodeStats`/
      // `discardPage`) antes de repropagar; aquí solo queda registrar el
      // fallo genérico: decir 'stream_undecodable' sería inventarse un
      // diagnóstico que no se puede afirmar sin haber visto la causa real.
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
  | 'page_missing'
  /**
   * `observer.push()` (la FASE 3) lanzó: un bug NUESTRO, no un documento
   * adversario. Antes se desenvolvía con `throw err.cause` y caía en el
   * mismo cajón que `unbalanced_state` — un `Q` huérfano y un bug propio en
   * el observador daban la MISMA razón. Ver `ObserverFailure`.
   */
  | 'observer_failure';

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

/**
 * Emite `onPageDecodeStats`, si hay observador, con la cobertura correcta:
 * `null` cuando hubo operaciones de texto pero no se midió ni un code point
 * (nunca `1` — eso decía "perfecto" de lo que en realidad es "no sé"), `1`
 * solo cuando de verdad no había ancla que buscar.
 */
function emitPageDecodeStats(
  options: ReadTextBandsOptions | undefined,
  ctx: Pick<
    WalkContext,
    | 'decodedCodesTotal'
    | 'decodedCodesMapped'
    | 'decodeIncomplete'
    | 'decodeErrors'
    | 'observerErrors'
    | 'hadTextOps'
  >,
  page: number,
  pageRejected: UnanalyzedReason | null,
): void {
  if (!options?.textObserver || !options.onPageDecodeStats) return;
  const coverage =
    ctx.decodedCodesTotal > 0
      ? ctx.decodedCodesMapped / ctx.decodedCodesTotal
      : ctx.hadTextOps
        ? null
        : 1;
  options.onPageDecodeStats({
    page,
    coverage,
    scanIncomplete: ctx.decodeIncomplete,
    decodeErrors: ctx.decodeErrors,
    observerErrors: ctx.observerErrors,
    pageRejected,
  });
}

function readPageBands(
  pdfDoc: PDFDocument,
  page: number,
  options?: ReadTextBandsOptions,
  fontCache?: FontResourceCache,
): PageScan | PageFailure {
  const pdfPage = pdfDoc.getPages()[page];
  if (!pdfPage) {
    // Sin `ctx` (la página ni existe): nada que medir, pero la señal de
    // rechazo debe salir igual, por las dos vías.
    emitPageDecodeStats(
      options,
      {
        decodedCodesTotal: 0,
        decodedCodesMapped: 0,
        decodeIncomplete: false,
        decodeErrors: 0,
        observerErrors: 0,
        hadTextOps: false,
      },
      page,
      'page_missing',
    );
    options?.textObserver?.discardPage?.(page, 'page_missing');
    return { failure: 'page_missing' };
  }

  const ctx: WalkContext = {
    pdfDoc,
    page,
    bands: [],
    bytesLeft: MAX_CONTENT_BYTES_PER_PAGE,
    visited: new Set(),
    imageRects: [],
    sawInvisibleText: false,
    ...(options?.textObserver ? { textObserver: options.textObserver } : {}),
    ...(fontCache ? { fontCache } : {}),
    decodedCodesLeft: MAX_DECODED_CODES_PER_PAGE,
    decodeIncomplete: false,
    decodedCodesTotal: 0,
    decodedCodesMapped: 0,
    decodeErrors: 0,
    observerErrors: 0,
    hadTextOps: false,
    truncateNotified: false,
  };
  const resources = asDict(pdfDoc, pdfPage.node.get(PDFName.of('Resources')));

  // Motivo de descarte, si lo hay. Se fija ANTES de cada `return`/`throw` de
  // fallo, para que el `finally` de abajo —que corre en TODOS los casos,
  // incluido el de una excepción que no atrapamos aquí (ver
  // `decodeTextRun`: un fallo del observador de la FASE 3 se deja subir a
  // propósito)— pueda reportar la MISMA razón por las dos vías: la señal de
  // `PageDecodeStats.pageRejected` y la de `TextRunObserver.discardPage`.
  let failureReason: UnanalyzedReason | null = null;
  try {
    // `/Contents` puede ser un ARRAY de streams, y la spec (ISO 32000 §7.8.2)
    // dice que se traten como UNO SOLO concatenado. Recorrerlos por separado,
    // cada uno con su propia pila de estado, era el defecto: un editor que
    // antepone o apéndice contenido parte un `q` en un stream y su `Q` en el
    // siguiente —un patrón corriente, no exótico—, y ese `Q` huérfano
    // marcaba la página entera como no fiable. El documento estaba
    // perfectamente bien; el lector no.
    const parts: string[] = [];
    for (const entry of pageStreams(pdfDoc, page)) {
      const stream = resolve(pdfDoc, entry);
      if (!(stream instanceof PDFRawStream)) {
        failureReason = 'stream_undecodable';
        return { failure: failureReason };
      }
      const decoded = decodeStream(ctx, stream);
      if (decoded === null) {
        // `ctx.budgetExhaustedBy` distingue "el stream es demasiado grande
        // para nuestro techo" (nuestro, ver `MAX_CONTENT_BYTES_PER_PAGE`) de
        // "el stream está corrupto" (del documento) — antes las dos caían en
        // 'stream_undecodable' y esa era justo la razón que se usa para
        // decidir si la ceguera es nuestra o del PDF.
        failureReason =
          ctx.budgetExhaustedBy === 'bytes' ? 'budget_exhausted' : 'stream_undecodable';
        return { failure: failureReason };
      }
      parts.push(decoded);
    }
    // Separador obligatorio: sin él el último token de un stream y el primero
    // del siguiente se pegan y forman un operador que no existe.
    const joined = concatWithNewline(parts);
    if (!walkContent(ctx, joined, resources, IDENTITY, 0)) {
      // Mismo razonamiento que arriba, para el tope de OPERADORES en vez del
      // de bytes: `ctx.budgetExhaustedBy === 'operators'` cuando `tokenize`
      // cortó por `MAX_OPERATORS_PER_PAGE`, nunca por un `Q` huérfano o un
      // literal sin cerrar.
      failureReason = ctx.budgetExhaustedBy ? 'budget_exhausted' : 'unbalanced_state';
      return { failure: failureReason };
    }

    // Una banda fuera del papel significa que nuestro modelo de la página es
    // falso (una transformación que no supimos seguir). Descartarla en
    // silencio dejaría el resto de bandas —igual de sospechosas— pasando por
    // buenas.
    const box = pdfPage.getMediaBox();
    const bottom = box.y - PAGE_BOUNDS_TOLERANCE_PT;
    const top = box.y + box.height + PAGE_BOUNDS_TOLERANCE_PT;
    for (const band of ctx.bands) {
      if (band.y < bottom || band.y + band.h > top) {
        failureReason = 'band_out_of_bounds';
        return { failure: failureReason };
      }
    }

    // Las dos cegueras solo se declaran cuando NO hay una sola letra visible.
    // Con texto encima, una imagen a toda página es un fondo o un membrete y
    // el recorrido sirve: lo que se busca aquí es la página cuyo contenido
    // entero se nos escapa.
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
  } catch (err) {
    if (err instanceof ObserverFailure) {
      // Un bug NUESTRO (el `observer.push()` de la FASE 3), no un documento
      // adversario: se DETIENE aquí — no sigue subiendo — con su propia
      // razón, distinguible de cualquier PDF corrupto real. Antes se
      // desenvolvía (`throw err.cause`) y caía en el mismo 'unbalanced_state'
      // que un `Q` huérfano; ahora la marca sobrevive hasta este punto.
      ctx.observerErrors++;
      failureReason = 'observer_failure';
      return { failure: failureReason };
    }
    // Cualquier otra excepción inesperada del recorrido: se marca visible
    // con el mejor motivo disponible y se REPROPAGA — no se traga aquí. El
    // `catch` de página en `readTextBands` decide qué hacer con el documento
    // completo; este nivel solo se asegura de que la razón quede registrada
    // antes de que la excepción siga subiendo.
    failureReason ??= 'unbalanced_state';
    throw err;
  } finally {
    emitPageDecodeStats(options, ctx, page, failureReason);
    if (failureReason) options?.textObserver?.discardPage?.(page, failureReason);
  }
}
