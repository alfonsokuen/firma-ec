/**
 * fontDecode.ts — bytes de cadena PDF → code points Unicode, SOLO por callback.
 *
 * firmar.ec firma enteramente en el dispositivo: ningún carácter del documento
 * puede llegar a un log, a un `Error`, a un objeto serializable ni a la red.
 * Este módulo decodifica las cadenas de un content stream (`/Encoding` de una
 * fuente simple, o el CMap `/ToUnicode` de una Type0) para alimentar un
 * matcher de ventana deslizante que las CONSUME y las tira. Por eso el sink
 * devuelve `void` a propósito: los caracteres no pueden subir por la pila de
 * retorno, y ningún tipo exportado de este módulo tiene un campo `string`.
 *
 * Qué NO hace este módulo:
 *  - No decodifica CIDFonts con una CMap predefinida no-Identity (p.ej.
 *    `UniGB-UCS2-H`). Esas fuentes exigen la tabla de la CMap predefinida, que
 *    no se embebe en el PDF y este módulo no trae consigo. El llamador debe
 *    contar esas operaciones de texto como no mapeadas (ilegibles), igual que
 *    un glifo fuera del subconjunto soportado.
 */

export const UNMAPPED_CODE_POINT = -1;

/** El sink devuelve void A PROPÓSITO: los caracteres no pueden subir por la pila de retorno. */
export type CodePointSink = (codePoint: number) => void;

/** Solo contadores. Ningún campo string: es un invariante de privacidad con test propio. */
export interface DecodeOutcome {
  readonly codes: number;
  readonly mapped: number;
  /**
   * `true` únicamente cuando `decode` se detuvo por falta de presupuesto
   * (`maxCodes`) antes de procesar `bytes` entero. Ausente (no `false`)
   * cuando no aplica, para que un `toEqual` contra un `DecodeOutcome` sin
   * presupuesto no tenga que conocer este campo.
   */
  readonly truncated?: boolean;
}

export interface FontDecoder {
  /**
   * `bytes` = bytes crudos de UNA cadena PDF (ya des-escapada). Ignora
   * cualquier valor que devuelva el sink.
   *
   * `maxCodes`, si se da, es el TOPE de code points que este `decode` puede
   * entregar al sink en esta llamada. Sin él, `decode` consume `bytes`
   * entero pase lo que pase — eso es lo que dejaba que un literal `Tj` de
   * 2 MB entregara 2.000.000 de code points al observador con un
   * presupuesto de página declarado de 50.000: el presupuesto se miraba
   * ENTRE cadenas, nunca DENTRO de una. Al agotarse `maxCodes` a mitad de
   * `bytes`, `decode` corta ahí mismo y marca `truncated: true`.
   */
  decode(bytes: Uint8Array, sink: CodePointSink, maxCodes?: number): DecodeOutcome;
}

export type BaseEncoding = 'WinAnsi' | 'MacRoman' | 'Standard';

// ---------------------------------------------------------------------------
// Fuentes simples (Type1/TrueType con /Encoding)
// ---------------------------------------------------------------------------

/**
 * Subconjunto de glifos que este módulo sabe reconocer. Cualquier otro código
 * — tildes raras, símbolos, glifos de otra escritura — se emite como
 * {@link UNMAPPED_CODE_POINT}: es ilegible para nosotros, no un error, y el
 * sentinela existe para que el matcher de ventana deslizante no pegue "Juan" y
 * "Pérez" a través de un hueco que en el PDF real no estaba.
 */
const ASCII_ALLOWED = new Set<string>();
for (let c = 0x41; c <= 0x5a; c++) ASCII_ALLOWED.add(String.fromCharCode(c)); // A-Z
for (let c = 0x61; c <= 0x7a; c++) ASCII_ALLOWED.add(String.fromCharCode(c)); // a-z
for (let c = 0x30; c <= 0x39; c++) ASCII_ALLOWED.add(String.fromCharCode(c)); // 0-9
for (const ch of [' ', '.', ':', '(', ')', '/', '_', '-']) ASCII_ALLOWED.add(ch);

/**
 * Código → code point de los vocálicos/ñ/ü en WinAnsiEncoding. WinAnsi es
 * Latin-1 en este rango, contrastado contra la tabla `WinAnsiEncoding` de
 * `pdfjs-dist` (node_modules/pdfjs-dist/build/pdf.worker.mjs).
 */
const WIN_ANSI_ACCENTS: ReadonlyArray<readonly [number, number]> = [
  [0xe1, 0xe1], // aacute
  [0xe9, 0xe9], // eacute
  [0xed, 0xed], // iacute
  [0xf3, 0xf3], // oacute
  [0xfa, 0xfa], // uacute
  [0xc1, 0xc1], // Aacute
  [0xc9, 0xc9], // Eacute
  [0xcd, 0xcd], // Iacute
  [0xd3, 0xd3], // Oacute
  [0xda, 0xda], // Uacute
  [0xf1, 0xf1], // ntilde
  [0xd1, 0xd1], // Ntilde
  [0xfc, 0xfc], // udieresis
  [0xdc, 0xdc], // Udieresis
];

/**
 * Código → code point de los vocálicos/ñ/ü en MacRomanEncoding. Tabla propia,
 * NO Latin-1. Contrastada contra `MacRomanEncoding` de `pdfjs-dist`
 * (node_modules/pdfjs-dist/build/pdf.worker.mjs), no contra memoria.
 */
const MAC_ROMAN_ACCENTS: ReadonlyArray<readonly [number, number]> = [
  [0x87, 0xe1], // aacute
  [0x8e, 0xe9], // eacute
  [0x92, 0xed], // iacute
  [0x97, 0xf3], // oacute
  [0x9c, 0xfa], // uacute
  [0xe7, 0xc1], // Aacute
  [0x83, 0xc9], // Eacute
  [0xea, 0xcd], // Iacute
  [0xee, 0xd3], // Oacute
  [0xf2, 0xda], // Uacute
  [0x96, 0xf1], // ntilde
  [0x84, 0xd1], // Ntilde
  [0x9f, 0xfc], // udieresis
  [0x86, 0xdc], // Udieresis
];

/** Nombres de glifo AGL soportados en `/Differences`, con su code point. */
function buildAglTable(): Map<string, number> {
  const table = new Map<string, number>();
  for (let c = 0x41; c <= 0x5a; c++) table.set(String.fromCharCode(c), c); // A..Z
  for (let c = 0x61; c <= 0x7a; c++) table.set(String.fromCharCode(c), c); // a..z
  const digitNames = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  digitNames.forEach((name, i) => table.set(name, 0x30 + i));
  table.set('space', 0x20);
  table.set('period', 0x2e);
  table.set('colon', 0x3a);
  table.set('parenleft', 0x28);
  table.set('parenright', 0x29);
  table.set('slash', 0x2f);
  table.set('underscore', 0x5f);
  table.set('hyphen', 0x2d);
  const accentNames: ReadonlyArray<readonly [string, number]> = [
    ['aacute', 0xe1],
    ['eacute', 0xe9],
    ['iacute', 0xed],
    ['oacute', 0xf3],
    ['uacute', 0xfa],
    ['Aacute', 0xc1],
    ['Eacute', 0xc9],
    ['Iacute', 0xcd],
    ['Oacute', 0xd3],
    ['Uacute', 0xda],
    ['ntilde', 0xf1],
    ['Ntilde', 0xd1],
    ['udieresis', 0xfc],
    ['Udieresis', 0xdc],
  ];
  for (const [name, cp] of accentNames) table.set(name, cp);
  return table;
}

const AGL_TABLE = buildAglTable();

/** Tabla base código→code point para un `/Encoding` sin `/Differences`. */
function buildBaseTable(encoding: BaseEncoding): Map<number, number> {
  const table = new Map<number, number>();
  for (let code = 0x20; code <= 0x7e; code++) {
    const ch = String.fromCharCode(code);
    if (ASCII_ALLOWED.has(ch)) table.set(code, code);
  }
  const accents =
    encoding === 'WinAnsi' ? WIN_ANSI_ACCENTS : encoding === 'MacRoman' ? MAC_ROMAN_ACCENTS : null;
  // StandardEncoding no tiene vocálicos precompuestos en su rango alto: los
  // acentos de una fuente Standard solo llegan vía /Differences.
  if (accents) for (const [code, cp] of accents) table.set(code, cp);
  return table;
}

/**
 * Aplica `/Differences` sobre la tabla base, en el sitio: `[code, ...names,
 * code, ...names]`. Un nombre fuera de {@link AGL_TABLE} redefine el código a
 * "sin mapear" — NO hereda lo que hubiera en la tabla base, porque el propio
 * PDF está diciendo que ese código ya no es lo que la base decía.
 */
function applyDifferences(
  table: Map<number, number>,
  differences: ReadonlyArray<number | string> | undefined,
): void {
  if (!differences) return;
  let code: number | null = null;
  for (const entry of differences) {
    if (typeof entry === 'number') {
      code = Number.isFinite(entry) ? Math.trunc(entry) : null;
      continue;
    }
    if (code === null) continue; // nombre sin código previo: entrada inválida, se ignora
    const cp = AGL_TABLE.get(entry);
    if (cp !== undefined) table.set(code, cp);
    else table.delete(code);
    code++;
  }
}

export function createSimpleFontDecoder(spec: {
  baseEncoding?: BaseEncoding;
  differences?: ReadonlyArray<number | string>;
}): FontDecoder {
  const table = buildBaseTable(spec.baseEncoding ?? 'Standard');
  applyDifferences(table, spec.differences);

  return {
    decode(bytes: Uint8Array, sink: CodePointSink, maxCodes?: number): DecodeOutcome {
      const limit = maxCodes === undefined ? bytes.length : Math.min(bytes.length, maxCodes);
      let mapped = 0;
      for (let i = 0; i < limit; i++) {
        const cp = table.get(bytes[i] as number);
        if (cp !== undefined) {
          sink(cp);
          mapped++;
        } else {
          sink(UNMAPPED_CODE_POINT);
        }
      }
      return limit < bytes.length ? { codes: limit, mapped, truncated: true } : { codes: limit, mapped };
    },
  };
}

// ---------------------------------------------------------------------------
// Type0 / Identity-H con /ToUnicode
// ---------------------------------------------------------------------------

/** Longitud de código asumida cuando la CMap no trae `/begincodespacerange`. */
const DEFAULT_CODE_LENGTH = 2;

/** Tope de entradas expandidas por un `bfrange`: una CMap adversaria no puede colgar el parseo. */
const MAX_RANGE_SIZE = 0x10000;

/**
 * Tope de entradas TOTALES escritas en el mapa, sumando TODOS los `bfchar` y
 * `bfrange` del CMap. `MAX_RANGE_SIZE` por sí solo no bastaba: nada impedía
 * encadenar miles de bloques `bfrange`, cada uno bajo su propio tope
 * individual, para acumular un número de escrituras arbitrario. Medido:
 * 52.105 rangos × 65.536 entradas cada uno = 3,4e9 llamadas a `map.set`. El
 * mismo valor que `MAX_RANGE_SIZE` basta como techo agregado: un subconjunto
 * de fuente embebido legítimo no necesita más entradas que un solo rango
 * lleno, y de sobra cubre cualquier documento real.
 */
// Exportado SOLO para que los tests de mutación afirmen el número real en
// vez de duplicarlo como constante mágica (y quedar desalineados si cambia).
export const MAX_TOTAL_MAP_ENTRIES = MAX_RANGE_SIZE;

type CMapToken = { kind: 'hex'; hex: string } | { kind: 'open' } | { kind: 'close' };

/** Trocea un bloque `begin…end` en tokens hex y corchetes. Nunca lanza. */
function tokenizeCMapBlock(block: string): CMapToken[] {
  const tokens: CMapToken[] = [];
  const re = /<([0-9A-Fa-f]*)>|(\[)|(\])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    if (m[1] !== undefined) tokens.push({ kind: 'hex', hex: m[1] });
    else if (m[2]) tokens.push({ kind: 'open' });
    else tokens.push({ kind: 'close' });
  }
  return tokens;
}

/** Hex → entero, o `null` si el token está vacío/corrupto. Nunca lanza. */
function hexToNumber(hex: string): number | null {
  if (hex.length === 0) return null;
  const n = Number.parseInt(hex, 16);
  return Number.isFinite(n) ? n : null;
}

/**
 * Hex UTF-16BE → unidades de 16 bits. Longitud impar de dígitos hex (byte
 * suelto) se completa con un `0` final en vez de lanzar: es CMap malformada,
 * no motivo para tirar la decodificación entera.
 */
function hexToUnits(hex: string): number[] {
  const padded = hex.length % 4 === 0 ? hex : hex.padEnd(hex.length + (4 - (hex.length % 4)), '0');
  const units: number[] = [];
  for (let i = 0; i + 4 <= padded.length; i += 4) {
    const unit = Number.parseInt(padded.slice(i, i + 4), 16);
    if (Number.isFinite(unit)) units.push(unit);
  }
  return units;
}

/** Combina surrogate pairs UTF-16 en un solo code point. */
function combineSurrogates(units: readonly number[]): number[] {
  const cps: number[] = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i] as number;
    const next = units[i + 1];
    if (u >= 0xd800 && u <= 0xdbff && next !== undefined && next >= 0xdc00 && next <= 0xdfff) {
      cps.push(0x10000 + (u - 0xd800) * 0x400 + (next - 0xdc00));
      i++;
    } else {
      cps.push(u);
    }
  }
  return cps;
}

function hexToCodePoints(hex: string): number[] {
  return combineSurrogates(hexToUnits(hex));
}

/** Longitud (en bytes) de los códigos fuente de esta CMap. */
function deriveCodeLength(text: string): number {
  const csMatch = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text);
  if (csMatch) {
    const hexMatch = /<([0-9A-Fa-f]+)>/.exec(csMatch[1] as string);
    if (hexMatch) {
      const len = Math.ceil((hexMatch[1] as string).length / 2);
      if (len > 0) return len;
    }
  }
  // Sin codespacerange: se infiere de la longitud del primer código fuente
  // visto en bfchar/bfrange. Identity-H (el caso corriente) es 2 bytes.
  const anyBlock = /(?:beginbfchar|beginbfrange)([\s\S]*?)(?:endbfchar|endbfrange)/.exec(text);
  if (anyBlock) {
    const hexMatch = /<([0-9A-Fa-f]+)>/.exec(anyBlock[1] as string);
    if (hexMatch) {
      const len = Math.ceil((hexMatch[1] as string).length / 2);
      if (len > 0) return len;
    }
  }
  return DEFAULT_CODE_LENGTH;
}

/** Presupuesto de escrituras compartido entre `parseBfChar` y `parseBfRange`. */
interface MapBudget {
  remaining: number;
}

/** `true` si aún queda presupuesto; descuenta UNA escritura y hace el `set`. */
function setBounded(map: Map<number, number[]>, budget: MapBudget, code: number, cps: number[]): boolean {
  if (budget.remaining <= 0) return false;
  map.set(code, cps);
  budget.remaining--;
  return true;
}

function parseBfChar(text: string, map: Map<number, number[]>, budget: MapBudget): void {
  const blockRe = /beginbfchar([\s\S]*?)endbfchar/g;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRe.exec(text)) !== null) {
    if (budget.remaining <= 0) return;
    const tokens = tokenizeCMapBlock(blockMatch[1] as string);
    let i = 0;
    while (i + 1 < tokens.length) {
      const src = tokens[i] as CMapToken;
      const dst = tokens[i + 1] as CMapToken;
      i += 2;
      if (src.kind !== 'hex' || dst.kind !== 'hex') continue;
      const code = hexToNumber(src.hex);
      if (code === null) continue;
      const cps = hexToCodePoints(dst.hex);
      if (cps.length > 0 && !setBounded(map, budget, code, cps)) return;
    }
  }
}

function parseBfRange(text: string, map: Map<number, number[]>, budget: MapBudget): void {
  const blockRe = /beginbfrange([\s\S]*?)endbfrange/g;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRe.exec(text)) !== null) {
    if (budget.remaining <= 0) return;
    const tokens = tokenizeCMapBlock(blockMatch[1] as string);
    let i = 0;
    while (i < tokens.length) {
      if (budget.remaining <= 0) return;
      const loTok = tokens[i];
      const hiTok = tokens[i + 1];
      if (!loTok || loTok.kind !== 'hex' || !hiTok || hiTok.kind !== 'hex') {
        i++;
        continue;
      }
      const lo = hexToNumber(loTok.hex);
      const hi = hexToNumber(hiTok.hex);
      const next = tokens[i + 2];
      if (lo === null || hi === null || hi < lo || !next) {
        i += 2;
        continue;
      }
      if (next.kind === 'open') {
        // Forma array: `<lo> <hi> [<d1> <d2> …]`.
        let j = i + 3;
        const dstArr: string[] = [];
        while (j < tokens.length && (tokens[j] as CMapToken).kind === 'hex') {
          dstArr.push((tokens[j] as { kind: 'hex'; hex: string }).hex);
          j++;
        }
        if (tokens[j] && (tokens[j] as CMapToken).kind === 'close') j++;
        const count = Math.min(dstArr.length, hi - lo + 1, MAX_RANGE_SIZE);
        for (let k = 0; k < count; k++) {
          const cps = hexToCodePoints(dstArr[k] as string);
          if (cps.length > 0 && !setBounded(map, budget, lo + k, cps)) return;
        }
        i = j;
      } else if (next.kind === 'hex') {
        // Forma incremental: `<lo> <hi> <dst>` — se incrementa la unidad baja.
        const baseUnits = hexToUnits(next.hex);
        if (baseUnits.length > 0 && hi - lo + 1 <= MAX_RANGE_SIZE) {
          for (let code = lo; code <= hi; code++) {
            const units = baseUnits.slice();
            const lastIdx = units.length - 1;
            units[lastIdx] = ((units[lastIdx] as number) + (code - lo)) & 0xffff;
            const cps = combineSurrogates(units);
            if (cps.length > 0 && !setBounded(map, budget, code, cps)) return;
          }
        }
        i += 3;
      } else {
        i += 2;
      }
    }
  }
}

/**
 * Parsea una CMap `/ToUnicode` ya descomprimida. NUNCA lanza: cualquier fallo
 * inesperado degrada a "sin mapa" (todo unmapped), nunca interrumpe al
 * llamador con contenido del documento en la excepción.
 */
function parseToUnicodeCMap(cmap: Uint8Array): { codeLength: number; map: Map<number, number[]> } {
  try {
    const text = new TextDecoder('latin1').decode(cmap);
    const codeLength = deriveCodeLength(text);
    const map = new Map<number, number[]>();
    const budget: MapBudget = { remaining: MAX_TOTAL_MAP_ENTRIES };
    parseBfChar(text, map, budget);
    parseBfRange(text, map, budget);
    return { codeLength, map };
  } catch {
    // Mudo A PROPÓSITO: un fallo inesperado parseando la CMap podría llevar
    // en su mensaje bytes de un `/ToUnicode` corrupto — no hay dónde meterlo
    // sin arriesgar una fuga. Se degrada a "sin mapa" (todo unmapped).
    return { codeLength: DEFAULT_CODE_LENGTH, map: new Map() };
  }
}

/** cmap = bytes YA descomprimidos del stream /ToUnicode. Parsea SOLO bfchar y bfrange (ambas formas). Nunca lanza por contenido malformado: degrada a unmapped. */
export function createToUnicodeDecoder(cmap: Uint8Array): FontDecoder {
  const { codeLength, map } = parseToUnicodeCMap(cmap);

  return {
    decode(bytes: Uint8Array, sink: CodePointSink, maxCodes?: number): DecodeOutcome {
      let codes = 0;
      let mapped = 0;
      let i = 0;
      while (i < bytes.length) {
        if (maxCodes !== undefined && codes >= maxCodes) {
          return { codes, mapped, truncated: true };
        }
        const remaining = bytes.length - i;
        if (remaining < codeLength) {
          // Byte sobrante al final: 1 código unmapped, no un error.
          sink(UNMAPPED_CODE_POINT);
          codes++;
          break;
        }
        let code = 0;
        for (let k = 0; k < codeLength; k++) code = code * 256 + (bytes[i + k] as number);
        i += codeLength;
        codes++;
        const cps = map.get(code);
        if (cps && cps.length > 0) {
          for (const cp of cps) sink(cp);
          mapped++;
        } else {
          sink(UNMAPPED_CODE_POINT);
        }
      }
      return { codes, mapped };
    },
  };
}

// ---------------------------------------------------------------------------
// Cobertura agregada (para el clasificador de confianza)
// ---------------------------------------------------------------------------

export interface CoverageTracker {
  /** una op de texto (Tj/TJ/'/") = 1..n llamadas a decode agregadas por el llamador en un solo outcome */
  recordOp(outcome: DecodeOutcome): void;
  readonly ops: number;
  readonly mappedOps: number;
  /** mappedOps/ops; y 1 cuando ops === 0 (así "no hay texto" se lee como "no hay ancla", no como "no pude leer") */
  readonly decodeCoverage: number;
}

export function createCoverageTracker(): CoverageTracker {
  let ops = 0;
  let mappedOps = 0;

  return {
    recordOp(outcome: DecodeOutcome): void {
      ops++;
      // Una op con codes:0 (cadena vacía) cuenta como mapeada: no hubo nada
      // que leer, no hubo nada ilegible.
      if (outcome.mapped === outcome.codes) mappedOps++;
    },
    get ops(): number {
      return ops;
    },
    get mappedOps(): number {
      return mappedOps;
    },
    get decodeCoverage(): number {
      return ops === 0 ? 1 : mappedOps / ops;
    },
  };
}
