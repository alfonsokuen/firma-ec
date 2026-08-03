/**
 * textBandsAnchor.test.ts — fixtures RICOS para el enganche texto↔geometría
 * de `textBands.ts` (`decodeTextRun`, `walkContent`, `tokenize`).
 *
 * Los 8 fixtures de `fontResources.test.ts`/`textBandsPlacement.test.ts` que
 * ya existían llevaban UNA sola cadena por página, así que `rawStrings[0]`
 * siempre acertaba y varias mutaciones sobrevivían sin que ningún test lo
 * notara (contador de cursor sin avanzar, `Q` sin restaurar la fuente,
 * presupuesto que no corta, cobertura que miente). Este archivo prueba
 * documentos con VARIAS cadenas por página, `q`/`Q` alternando dos fuentes,
 * hex, octal, paréntesis escapado, y `(blank)` mezclado con tinta en el
 * mismo `TJ` — y afirma el resultado EXACTO, no solo "no lanzó".
 */
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { UNMAPPED_CODE_POINT } from '../src/fontDecode.js';
import {
  MAX_DECODED_CODES_PER_PAGE,
  type TextRunObserver,
  readTextBands,
} from '../src/textBands.js';

interface CapturedLine {
  x: number | undefined;
  y: number;
  h: number;
  codePoints: number[];
}

function collectingObserver(): { observer: TextRunObserver; lines: CapturedLine[] } {
  const lines: CapturedLine[] = [];
  let current: CapturedLine | null = null;
  const observer: TextRunObserver = {
    beginLine(_page, x, y, h) {
      current = { x, y, h, codePoints: [] };
    },
    push(cp) {
      current?.codePoints.push(cp);
    },
    endLine() {
      if (current) lines.push(current);
      current = null;
    },
  };
  return { observer, lines };
}

/** PDF de una página con DOS font dicts manuales (`/F1`, `/F2`) y el content stream dado. */
async function pdfWithTwoFonts(
  content: string,
  f2Differences: Array<number | string>,
): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(content)));

  const f1 = doc.context.obj({
    Type: 'Font',
    Subtype: 'Type1',
    BaseFont: 'Helvetica',
    Encoding: 'WinAnsiEncoding',
  });
  const f2 = doc.context.obj({
    Type: 'Font',
    Subtype: 'Type1',
    BaseFont: 'Helvetica',
    Encoding: doc.context.obj({
      Type: 'Encoding',
      BaseEncoding: 'WinAnsiEncoding',
      Differences: f2Differences,
    }),
  });
  const resources = doc.context.obj({
    Font: doc.context.obj({ F1: doc.context.register(f1), F2: doc.context.register(f2) }),
  });
  page.node.set(PDFName.of('Resources'), resources);
  return PDFDocument.load(await doc.save());
}

/** PDF de una página con UN solo font dict WinAnsi puro (sin /Differences). */
async function pdfWithPlainFont(content: string): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(content)));
  const font = doc.context.obj({
    Type: 'Font',
    Subtype: 'Type1',
    BaseFont: 'Helvetica',
    Encoding: 'WinAnsiEncoding',
  });
  const resources = doc.context.obj({ Font: doc.context.obj({ F1: doc.context.register(font) }) });
  page.node.set(PDFName.of('Resources'), resources);
  return PDFDocument.load(await doc.save());
}

describe('varias cadenas por página, q/Q alternando DOS fuentes', () => {
  it('strCursor avanza y Q restaura la fuente — 3 líneas, cada una con su propio font/posición', async () => {
    // F2 remapea 'C' (0x43), 'E' (0x45) y 'F' (0x46) a 'ntilde' — si `Q` no
    // restaurara `fontName`, la 3ª línea ("EF", que debería volver a F1)
    // saldría con la tabla de F2 y mostraría ntilde en vez de E/F. Y si
    // `strCursor` no avanzara, las 3 líneas reusarían los bytes de la
    // PRIMERA cadena ("AB") — ver el fixture original de la mutación #1.
    const content = [
      'BT',
      '/F1 12 Tf 1 0 0 1 50 700 Tm (AB) Tj',
      'q',
      '/F2 12 Tf 1 0 0 1 80 650 Tm (CD) Tj',
      'Q',
      '1 0 0 1 110 600 Tm (EF) Tj',
      'ET',
    ].join('\n');
    const doc = await pdfWithTwoFonts(content, [0x43, 'ntilde', 0x45, 'ntilde', 0x46, 'ntilde']);
    const { observer, lines } = collectingObserver();

    const { bands, unanalyzedPages } = readTextBands(doc, { textObserver: observer });

    expect(unanalyzedPages).toEqual([]);
    expect(lines).toHaveLength(3);
    expect(lines[0]!.codePoints).toEqual([0x41, 0x42]); // "AB" con F1: identidad
    expect(lines[1]!.codePoints).toEqual([0xf1, 0x44]); // "CD" con F2: C→ntilde, D intacta
    expect(lines[2]!.codePoints).toEqual([0x45, 0x46]); // "EF" con F1 tras Q: identidad

    // Mutación #8 (x forzado a 0): cada línea trae la x real de su Tm, y
    // coincide con la banda geométrica que ya calculaba `emit()`.
    expect(lines[0]!.x).toBeCloseTo(50, 5);
    expect(lines[1]!.x).toBeCloseTo(80, 5);
    expect(lines[2]!.x).toBeCloseTo(110, 5);
    expect(bands).toHaveLength(3);
    const bandsByY = [...bands].sort((a, b) => b.y - a.y);
    expect(lines.map((l) => l.x)).toEqual(bandsByY.map((b) => b.x));
  });
});

describe('literales hex, octal y paréntesis escapado', () => {
  it('<...> hex decodifica igual que el literal equivalente', async () => {
    const doc = await pdfWithPlainFont('BT /F1 12 Tf 1 0 0 1 50 700 Tm <48656C6C6F> Tj ET');
    const { observer, lines } = collectingObserver();
    readTextBands(doc, { textObserver: observer });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.codePoints).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
  });

  it('escape octal \\102\\103 decodifica a B C', async () => {
    const doc = await pdfWithPlainFont('BT /F1 12 Tf 1 0 0 1 50 700 Tm (\\102\\103) Tj ET');
    const { observer, lines } = collectingObserver();
    readTextBands(doc, { textObserver: observer });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.codePoints).toEqual([0x42, 0x43]); // "BC"
  });

  it('paréntesis escapado \\) no cierra el literal antes de tiempo', async () => {
    const doc = await pdfWithPlainFont('BT /F1 12 Tf 1 0 0 1 50 700 Tm (A\\)B) Tj ET');
    const { observer, lines } = collectingObserver();
    const { unanalyzedPages } = readTextBands(doc, { textObserver: observer });
    expect(unanalyzedPages).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.codePoints).toEqual([0x41, 0x29, 0x42]); // "A)B"
  });
});

describe('P1 — cadenas en blanco dentro de un TJ separan palabras, no las pegan', () => {
  it('[(Firma)( )(del)( )(cliente)] TJ decodifica CON espacios, no "Firmadelcliente"', async () => {
    const doc = await pdfWithPlainFont(
      'BT /F1 12 Tf 1 0 0 1 50 700 Tm [(Firma)( )(del)( )(cliente)] TJ ET',
    );
    const { observer, lines } = collectingObserver();
    readTextBands(doc, { textObserver: observer });

    expect(lines).toHaveLength(1);
    const text = String.fromCharCode(...lines[0]!.codePoints.filter((cp) => cp >= 0));
    expect(text).toBe('Firma del cliente');
  });
});

describe('P1 — desplazamiento numérico grande en TJ emite un centinela de hueco', () => {
  it('un salto de -300 (supera el umbral) separa dos palabras con UNMAPPED_CODE_POINT', async () => {
    const doc = await pdfWithPlainFont(
      'BT /F1 12 Tf 1 0 0 1 50 700 Tm [(Word1) -300 (Word2)] TJ ET',
    );
    const { observer, lines } = collectingObserver();
    readTextBands(doc, { textObserver: observer });

    expect(lines).toHaveLength(1);
    const idx = lines[0]!.codePoints.indexOf(UNMAPPED_CODE_POINT);
    expect(idx).toBeGreaterThan(0); // hay un hueco EN MEDIO
    expect(idx).toBeLessThan(lines[0]!.codePoints.length - 1);
  });

  it('un ajuste de kerning normal (-20) NO se confunde con un hueco de palabra', async () => {
    const doc = await pdfWithPlainFont('BT /F1 12 Tf 1 0 0 1 50 700 Tm [(Wo) -20 (rd)] TJ ET');
    const { observer, lines } = collectingObserver();
    readTextBands(doc, { textObserver: observer });

    expect(lines).toHaveLength(1);
    // Sin centinela: "Word" decodifica limpio, sin -1 en medio.
    expect(lines[0]!.codePoints).toEqual([0x57, 0x6f, 0x72, 0x64]);
  });
});

describe('MAX_DECODED_CODES_PER_PAGE corta DENTRO de una sola cadena (HIGH-3)', () => {
  it('un literal más grande que el presupuesto se corta exactamente ahí, con scanIncomplete', async () => {
    // Antes del fix, un único `Tj` con más code points que el presupuesto
    // entregaba TODOS sus code points al observador de un tirón (medido:
    // 2.000.000 con un tope declarado de 50.000) porque el presupuesto solo
    // se miraba ENTRE cadenas, nunca DENTRO de `decode()`.
    const oversized = 'A'.repeat(MAX_DECODED_CODES_PER_PAGE + 5_000);
    const doc = await pdfWithPlainFont(`BT /F1 12 Tf 1 0 0 1 50 700 Tm (${oversized}) Tj ET`);
    const { observer, lines } = collectingObserver();
    const stats: Array<{ scanIncomplete: boolean; coverage: number | null }> = [];

    readTextBands(doc, {
      textObserver: observer,
      onPageDecodeStats: (s) => stats.push(s),
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]!.codePoints.length).toBe(MAX_DECODED_CODES_PER_PAGE);
    expect(stats).toHaveLength(1);
    expect(stats[0]!.scanIncomplete).toBe(true);
  });
});

describe('coverage: null cuando hubo texto pero nada se pudo medir (P0-a)', () => {
  it('presupuesto agotado a mitad de cadena: lo YA medido cuenta, scanIncomplete lo señala aparte', async () => {
    // Un literal más grande que el presupuesto corta DENTRO de `decode()`
    // (ver HIGH-3). Lo que sí se decodificó antes del corte es real —aquí
    // los 50.000 primeros caracteres son 'A', que mapean 1:1— así que
    // `coverage` refleja esa fracción correctamente; `scanIncomplete` es la
    // señal de que quedó contenido sin medir, NO se pisan una a la otra.
    const oversized = 'A'.repeat(MAX_DECODED_CODES_PER_PAGE + 5_000);
    const doc = await pdfWithPlainFont(`BT /F1 12 Tf 1 0 0 1 50 700 Tm (${oversized}) Tj ET`);
    const { observer } = collectingObserver();
    const stats: Array<{ scanIncomplete: boolean; coverage: number | null }> = [];

    readTextBands(doc, {
      textObserver: observer,
      onPageDecodeStats: (s) => stats.push(s),
    });

    expect(stats).toHaveLength(1);
    expect(stats[0]!.scanIncomplete).toBe(true);
    expect(stats[0]!.coverage).toBe(1); // lo medido (50.000 'A') mapeó perfecto
  });

  it('un fallo del OBSERVADOR antes de medir nada da coverage NULL, nunca 1 (el bug que motivó P0-a)', async () => {
    // Un observador cuyo `push` lanza en el PRIMER code point: `decode()`
    // nunca llega a devolver un `outcome`, así que `decodedCodesTotal` queda
    // en 0 para la página entera. Antes, `total === 0 ? 1 : …` reportaba
    // "coverage perfecta" — cuanto más fallaba, mejor se veía. La excepción
    // del observador además debe ser VISIBLE: se deja subir (no se traga
    // como un fallo de fuente) y la página termina en `unanalyzedPages`.
    const throwingObserver: TextRunObserver = {
      beginLine() {},
      push() {
        throw new Error('bug del observador, plantado por el test');
      },
      endLine() {},
    };
    const doc = await pdfWithPlainFont('BT /F1 12 Tf 1 0 0 1 50 700 Tm (Hola) Tj ET');
    const stats: Array<{ coverage: number | null; pageRejected: string | null }> = [];

    const { unanalyzedPages } = readTextBands(doc, {
      textObserver: throwingObserver,
      onPageDecodeStats: (s) => stats.push(s),
    });

    expect(unanalyzedPages).toEqual([0]); // visible: la página se marcó no analizada
    expect(stats).toHaveLength(1);
    expect(stats[0]!.coverage).toBeNull(); // nunca 1 para decir "no medí"
    expect(stats[0]!.pageRejected).not.toBeNull();
  });

  it('página sin ninguna operación de texto reporta coverage 1 (no ancla, no "no pude leer")', async () => {
    const doc = await pdfWithPlainFont('BT ET'); // BT/ET sin texto
    const { observer } = collectingObserver();
    const stats: Array<{ coverage: number | null }> = [];

    readTextBands(doc, { textObserver: observer, onPageDecodeStats: (s) => stats.push(s) });

    expect(stats).toHaveLength(1);
    expect(stats[0]!.coverage).toBe(1);
  });
});
