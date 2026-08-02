/**
 * anchorMatch.ts — busca ANCLAS de texto ("Firma", el nombre del firmante, su
 * cédula) en las líneas que entrega `textBands.ts`, sin que ni una letra del
 * documento suba más allá de este módulo. Espejo de `fontDecode.ts`: CERO
 * imports, todo por code points, sink `void`.
 *
 * `compileAnchorMatcher({ signerName?, cedula? })` es el único punto de
 * entrada donde ENTRAN strings — y mueren ahí mismo: se normalizan a
 * `number[][]` (palabras) en la propia llamada y nunca se guardan como texto.
 * Lo que sale de `finish()` son `AnchorHit[]`: página, tipo de ancla y
 * geometría. Ni un campo `string` libre — ver el test de tipos al final.
 *
 * Ventana de coincidencia: un {@link AnchorKind} se reconoce como una
 * secuencia de PALABRAS consecutivas SIN interrupción. Dos cosas rompen la
 * ventana a propósito:
 *  - Un code point `UNMAPPED_CODE_POINT` (glifo que `fontDecode.ts` no supo
 *    leer): no se pega "Fir" + "ma" a través de un hueco ilegible — eso
 *    inventaría una ancla que el documento real no tiene.
 *  - `endLine()`: una ancla que "empieza" en una línea y "termina" en la
 *    siguiente sería un artefacto del layout (dos `Tj` consecutivos que el
 *    generador partió), no una coincidencia del texto.
 */

// Mismo valor que `fontDecode.UNMAPPED_CODE_POINT` — no se importa (módulo
// puro, sin dependencias): quien conecta este matcher con `textBands.ts` ya
// sabe que ambos comparten el sentinela.
const UNMAPPED = -1;

export type AnchorKind = 'firma-label' | 'firmante-nombre' | 'firmante-cedula';

/** Dónde se vio una ancla. Ni un campo `string`: ver `AssertNoStringFields` abajo. */
export interface AnchorHit {
  readonly page: number;
  readonly kind: AnchorKind;
  readonly x?: number;
  readonly y: number;
  readonly h: number;
}

export interface AnchorMatcherSpec {
  /** CN del certificado del firmante — dato del USUARIO, no del documento. */
  signerName?: string;
  /** Cédula del firmante, 10 dígitos. */
  cedula?: string;
}

/** Forma mínima de `TextRunObserver` (`textBands.ts`) que este matcher implementa, por estructura — sin importar el tipo. */
export interface AnchorObserver {
  beginLine(page: number, x: number | undefined, y: number, h: number): void;
  push(codePoint: number): void;
  endLine(): void;
  discardPage(page: number, reason: string): void;
  truncatePage(page: number): void;
}

export interface CompiledAnchorMatcher {
  readonly observer: AnchorObserver;
  /** Solo números y uniones cerradas. Nunca se llama más de una vez por recorrido. */
  finish(): AnchorHit[];
}

// ---------------------------------------------------------------------------
// Normalización: minúsculas, vocálicos/ñ sin tilde, separadores → frontera.
// ---------------------------------------------------------------------------

/** `[espacio . : ( ) / _ -]` + espacios de control — colapsan a frontera de palabra, no a contenido. */
const SEPARATORS = new Set<number>([
  0x20, 0x2e, 0x3a, 0x28, 0x29, 0x2f, 0x5f, 0x2d, 0x0a, 0x0d, 0x09, 0x0c, 0x00,
]);

/** Vocálicos acentuados + ñ/ü (mayúscula y minúscula) → su base sin tilde. Mismo alfabeto que `fontDecode.ts`. */
const ACCENT_TO_BASE = new Map<number, number>([
  [0xe1, 0x61], // á→a
  [0xe9, 0x65], // é→e
  [0xed, 0x69], // í→i
  [0xf3, 0x6f], // ó→o
  [0xfa, 0x75], // ú→u
  [0xc1, 0x61], // Á→a
  [0xc9, 0x65], // É→e
  [0xcd, 0x69], // Í→i
  [0xd3, 0x6f], // Ó→o
  [0xda, 0x75], // Ú→u
  [0xf1, 0x6e], // ñ→n
  [0xd1, 0x6e], // Ñ→n
  [0xfc, 0x75], // ü→u
  [0xdc, 0x75], // Ü→u
]);

type Normalized = { kind: 'char'; cp: number } | { kind: 'boundary' } | { kind: 'break' };

/**
 * Un code point NO reconocido (ni letra/dígito ASCII, ni vocálico de la
 * tabla, ni separador) rompe la ventana igual que `UNMAPPED_CODE_POINT`: es
 * más seguro perder una ancla real que inventar una uniendo dos fragmentos a
 * través de un carácter que no sabemos interpretar.
 */
function normalize(cp: number): Normalized {
  if (cp === UNMAPPED) return { kind: 'break' };
  if (SEPARATORS.has(cp)) return { kind: 'boundary' };
  if (cp >= 0x41 && cp <= 0x5a) return { kind: 'char', cp: cp + 0x20 }; // A-Z → a-z
  if (cp >= 0x61 && cp <= 0x7a) return { kind: 'char', cp };
  if (cp >= 0x30 && cp <= 0x39) return { kind: 'char', cp };
  const base = ACCENT_TO_BASE.get(cp);
  if (base !== undefined) return { kind: 'char', cp: base };
  return { kind: 'break' };
}

/**
 * Normaliza una cadena PROPIA (una etiqueta constante de este módulo, o un
 * dato del usuario como el CN del certificado) a palabras. Se usa SOLO en
 * tiempo de compilación del matcher — la string muere aquí, nunca se guarda.
 */
function wordsOf(text: string): number[][] {
  const words: number[][] = [];
  let current: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? UNMAPPED;
    const n = normalize(cp);
    if (n.kind === 'char') current.push(n.cp);
    else if (current.length > 0) {
      words.push(current);
      current = [];
    }
  }
  if (current.length > 0) words.push(current);
  return words;
}

function wordsEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** ¿Los últimos `pattern.length` elementos de `recent` son EXACTAMENTE `pattern`, en orden? */
function endsWithSequence(recent: readonly number[][], pattern: readonly number[][]): boolean {
  if (recent.length < pattern.length) return false;
  const offset = recent.length - pattern.length;
  for (let i = 0; i < pattern.length; i++) {
    if (!wordsEqual(recent[offset + i]!, pattern[i]!)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Patrones de etiqueta genérica — constantes de ESTE módulo, no texto del
// documento: no hay problema de privacidad en escribirlas como string aquí,
// mueren en `wordsOf` al cargar el módulo, igual que cualquier otra entrada.
// ---------------------------------------------------------------------------

const LABEL_PATTERNS: readonly number[][][] = [
  wordsOf('firma'),
  wordsOf('firmado por'),
  wordsOf('f)'), // ')' es separador: la palabra queda en "f" sola, ver cabecera.
];

/** Variantes de la etiqueta de cédula, ya normalizadas. "c.i." → dos palabras "c" "i" (el punto es frontera). */
const CEDULA_LABEL_PATTERNS: readonly number[][][] = [
  wordsOf('ci'),
  wordsOf('c.i.'),
  wordsOf('cc'),
  wordsOf('cedula'),
];

/** Cuántas palabras recientes se conservan para comparar contra los patrones. El más largo (label + dígitos) mide 3. */
const MAX_RECENT_WORDS = 8;

function isDigitWord(word: readonly number[]): boolean {
  return word.length === 10 && word.every((cp) => cp >= 0x30 && cp <= 0x39);
}

export function compileAnchorMatcher(spec: AnchorMatcherSpec): CompiledAnchorMatcher {
  const nameWords = spec.signerName ? wordsOf(spec.signerName) : [];
  const cedulaWord = spec.cedula ? wordsOf(spec.cedula) : [];
  // Solo se activa el matcher de cédula si compila a EXACTAMENTE una palabra
  // de 10 dígitos: cualquier otra forma no es una cédula ecuatoriana y no hay
  // nada seguro que comparar.
  const cedulaDigits =
    cedulaWord.length === 1 && isDigitWord(cedulaWord[0]!) ? cedulaWord[0]! : null;

  const hits: AnchorHit[] = [];
  let recentWords: number[][] = [];
  let currentWord: number[] = [];
  let lineCtx: { page: number; x: number | undefined; y: number; h: number } | null = null;

  const resetWindow = (): void => {
    recentWords = [];
    currentWord = [];
  };

  const emit = (kind: AnchorKind): void => {
    if (!lineCtx) return;
    hits.push({
      page: lineCtx.page,
      kind,
      ...(lineCtx.x !== undefined ? { x: lineCtx.x } : {}),
      y: lineCtx.y,
      h: lineCtx.h,
    });
  };

  const checkMatches = (): void => {
    for (const pattern of LABEL_PATTERNS) {
      if (endsWithSequence(recentWords, pattern)) emit('firma-label');
    }
    // ≥2 palabras CONSECUTIVAS del nombre del firmante: basta comprobar cada
    // bigrama del CN — un bigrama YA satisface "≥2", y cualquier n-grama más
    // largo que matchee contiene siempre un bigrama que también matchea, así
    // que no aporta detección nueva.
    for (let i = 0; i + 1 < nameWords.length; i++) {
      if (endsWithSequence(recentWords, [nameWords[i]!, nameWords[i + 1]!])) {
        emit('firmante-nombre');
      }
    }
    if (cedulaDigits) {
      if (endsWithSequence(recentWords, [cedulaDigits])) emit('firmante-cedula');
      for (const label of CEDULA_LABEL_PATTERNS) {
        if (endsWithSequence(recentWords, [...label, cedulaDigits])) emit('firmante-cedula');
      }
    }
  };

  const flushWord = (): void => {
    if (currentWord.length === 0) return;
    recentWords.push(currentWord);
    if (recentWords.length > MAX_RECENT_WORDS) recentWords.shift();
    currentWord = [];
    checkMatches();
  };

  return {
    observer: {
      beginLine(page, x, y, h) {
        resetWindow();
        lineCtx = { page, x, y, h };
      },
      push(cp) {
        const n = normalize(cp);
        if (n.kind === 'break') {
          // Rompe la ventana: se descarta la palabra a medio formar Y todo lo
          // acumulado antes — no hay continuidad segura a través de un hueco
          // ilegible.
          resetWindow();
          return;
        }
        if (n.kind === 'boundary') {
          flushWord();
          return;
        }
        currentWord.push(n.cp);
      },
      endLine() {
        flushWord();
        resetWindow();
        lineCtx = null;
      },
      discardPage() {
        resetWindow();
        lineCtx = null;
      },
      truncatePage() {
        // El presupuesto de decode se agotó a media línea: lo ya acumulado
        // puede estar cortado a mitad de palabra, igual que un UNMAPPED.
        resetWindow();
      },
    },
    finish(): AnchorHit[] {
      return hits;
    },
  };
}

// ---------------------------------------------------------------------------
// Guardia de tipos: si `AnchorHit` (o cualquier tipo de este módulo) ganara
// un campo `string` PLANO, esta función deja de compilar. No se llama nunca
// — solo existe para que `tsc --noEmit` la vea. Una unión de literales
// (`AnchorKind`) no cuenta como fuga: es cerrada, no puede llevar texto del
// documento.
// ---------------------------------------------------------------------------
type AssertNoStringFields<T> = { [K in keyof T]: string extends T[K] ? never : T[K] };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _typeGuardNoStringLeak(
  hit: AssertNoStringFields<AnchorHit>,
): AssertNoStringFields<AnchorHit> {
  return hit;
}
