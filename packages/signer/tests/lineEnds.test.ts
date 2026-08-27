/**
 * lineEnds.test.ts — el estimador de FIN de linea (`LineStart.end`).
 *
 * El recorredor de `textBands.ts` siempre supo donde EMPIEZA una linea; donde
 * TERMINA hacia falta sumar los anchos de glifo de la fuente vigente. Sin ese
 * borde derecho la estampa solo puede apoyarse en el margen izquierdo del
 * bloque de firma, y medido en produccion (0.23.4, 8 documentos reales) eso la
 * dejaba entre 35 y 88 pt a la derecha del centro del nombre del firmante.
 *
 * Las cifras que se afirman aqui son COMPROBABLES a mano: los anchos AFM de
 * Helvetica ('A' = 667/1000 em) y los `/Widths` que el propio fixture declara.
 */
import { PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { createFontWidthCache } from '../src/fontWidths.js';
import { standardWidth } from '../src/standardFontWidths.js';
import { advanceOfOperands, stringAdvance } from '../src/textAdvance.js';
import { type TextBand, readTextBands } from '../src/textBands.js';

const A4: [number, number] = [595.32, 841.92];

/** Fuente Type1 estandar: sin `/Widths`, las metricas salen de la tabla AFM. */
const HELVETICA = {
  Type: 'Font',
  Subtype: 'Type1',
  BaseFont: 'Helvetica',
  Encoding: 'WinAnsiEncoding',
};

/** Fuente simple CON `/Widths`: 'A' = 1000, 'B' = 500, resto `/MissingWidth`. */
const CON_WIDTHS = {
  Type: 'Font',
  Subtype: 'Type1',
  BaseFont: 'AAAAAA+Inventada',
  Encoding: 'WinAnsiEncoding',
  FirstChar: 65,
  LastChar: 66,
  Widths: [1000, 500],
};

/** Type0/Identity-H: CID 1 = 500, CID 2 = 600, resto `/DW` = 250. */
const TYPE0 = {
  Type: 'Font',
  Subtype: 'Type0',
  BaseFont: 'BBBBBB+Inventada',
  Encoding: 'Identity-H',
  DescendantFonts: [
    {
      Type: 'Font',
      Subtype: 'CIDFontType2',
      BaseFont: 'BBBBBB+Inventada',
      CIDSystemInfo: { Registry: 'Adobe', Ordering: 'Identity', Supplement: 0 },
      DW: 250,
      W: [1, [500, 600]],
    },
  ],
};

/** Bandas de la unica pagina de un PDF armado con `content` y esas fuentes. */
async function bandsOf(
  content: string,
  fonts: Readonly<Record<string, unknown>> = { F1: HELVETICA },
  size: [number, number] = A4,
): Promise<TextBand[]> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(size);
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(content)));
  const fontEntries: Record<string, unknown> = {};
  for (const [name, dict] of Object.entries(fonts)) {
    fontEntries[name] = doc.context.register(doc.context.obj(dict as never));
  }
  page.node.set(
    PDFName.of('Resources'),
    doc.context.obj({ Font: doc.context.obj(fontEntries as never) }),
  );
  const reloaded = await PDFDocument.load(await doc.save());
  return readTextBands(reloaded).bands;
}

/** El `end` de la unica linea de la banda que arranca en `x`. */
function endAt(bands: readonly TextBand[], x: number): number | undefined {
  for (const b of bands) {
    for (const s of b.starts ?? []) {
      if (Math.abs(s.x - x) < 0.5) return s.end;
    }
  }
  return undefined;
}

describe('estimador de fin de linea — la cuenta pura', () => {
  const widths1000 = {
    codeLength: 1 as const,
    widthOf: (code: number) => (code === 65 ? 1000 : code === 32 ? 250 : 500),
  };
  const base = { fontSize: 10, charSpacing: 0, wordSpacing: 0, horizScale: 1 };

  it('suma ancho x tamano: "AB" a 10 pt = 1000/1000*10 + 500/1000*10 = 15', () => {
    expect(stringAdvance(new Uint8Array([65, 66]), widths1000, base)).toBeCloseTo(15, 6);
  });

  it('Tc suma UNA vez por glifo, no por byte de la cadena entera', () => {
    const adv = stringAdvance(new Uint8Array([65, 66]), widths1000, { ...base, charSpacing: 2 });
    expect(adv).toBeCloseTo(19, 6);
  });

  it('Tw solo toca al byte 32, y solo en fuentes de UN byte', () => {
    const conEspacio = stringAdvance(new Uint8Array([65, 32, 65]), widths1000, {
      ...base,
      wordSpacing: 4,
    });
    // 10 + 2.5 + 10 de glifos, + 4 del unico espacio.
    expect(conEspacio).toBeCloseTo(26.5, 6);
    const dosBytes = { codeLength: 2 as const, widthOf: () => 1000 };
    // El mismo 32 dentro de una Type0 NO es un espacio: sin `Tw`.
    expect(
      stringAdvance(new Uint8Array([0, 32]), dosBytes, { ...base, wordSpacing: 4 }),
    ).toBeCloseTo(10, 6);
  });

  it('Tz escala el avance completo, incluidos Tc y los ajustes de TJ', () => {
    const ops = [
      { kind: 'string' as const, bytes: new Uint8Array([65, 65]) },
      { kind: 'adjust' as const, value: -1000 },
    ];
    // (10 + 10 + 10) * 0.5
    expect(advanceOfOperands(ops, widths1000, { ...base, horizScale: 0.5 })).toBeCloseTo(15, 6);
  });

  it('un ajuste de TJ RESTA: positivo mueve el texto a la izquierda', () => {
    const ops = [
      { kind: 'string' as const, bytes: new Uint8Array([65]) },
      { kind: 'adjust' as const, value: 500 },
      { kind: 'string' as const, bytes: new Uint8Array([65]) },
    ];
    expect(advanceOfOperands(ops, widths1000, base)).toBeCloseTo(15, 6);
  });

  it('un codigo sin ancho conocido devuelve null, no un avance corto', () => {
    const parcial = { codeLength: 1 as const, widthOf: (c: number) => (c === 65 ? 1000 : null) };
    expect(stringAdvance(new Uint8Array([65, 66]), parcial, base)).toBeNull();
  });

  it('una Type0 con longitud IMPAR no se mide: la CMap no es de 2 bytes', () => {
    const dosBytes = { codeLength: 2 as const, widthOf: () => 1000 };
    expect(stringAdvance(new Uint8Array([0, 65, 0]), dosBytes, base)).toBeNull();
  });
});

describe('estimador de fin de linea — sobre el content stream', () => {
  it('Helvetica SIN /Widths cae a la tabla AFM: "AAAA" a 10 pt mide 4 x 6,67', () => {
    expect(standardWidth('Helvetica', 'A'.charCodeAt(0))).toBe(667);
  });

  it('un Tj de "AAAA" en Helvetica 10 pt termina en x + 26,68', async () => {
    const bands = await bandsOf('BT /F1 10 Tf 1 0 0 1 100 700 Tm (AAAA) Tj ET');
    expect(endAt(bands, 100)).toBeCloseTo(126.68, 2);
  });

  it('con /Widths propio manda el documento, no la tabla estandar', async () => {
    const bands = await bandsOf('BT /F1 10 Tf 1 0 0 1 100 700 Tm (AB) Tj ET', { F1: CON_WIDTHS });
    expect(endAt(bands, 100)).toBeCloseTo(115, 3);
  });

  it('TJ con ajustes: los desplazamientos entran en el borde derecho', async () => {
    const bands = await bandsOf('BT /F1 10 Tf 1 0 0 1 100 700 Tm [(AB) -1000 (A)] TJ ET', {
      F1: CON_WIDTHS,
    });
    // 10 + 5 (AB) + 10 (el hueco de -1000) + 10 (A)
    expect(endAt(bands, 100)).toBeCloseTo(135, 3);
  });

  it('Type0 con /W: los CID 1 y 2 miden 500 y 600 milesimas', async () => {
    const bands = await bandsOf('BT /F1 10 Tf 1 0 0 1 100 700 Tm <00010002> Tj ET', { F1: TYPE0 });
    expect(endAt(bands, 100)).toBeCloseTo(111, 3);
  });

  it('Type0 sin entrada en /W cae a /DW', async () => {
    const bands = await bandsOf('BT /F1 10 Tf 1 0 0 1 100 700 Tm <00090009> Tj ET', { F1: TYPE0 });
    expect(endAt(bands, 100)).toBeCloseTo(105, 3);
  });

  it('Tz, Tc y Tw del stream llegan al avance', async () => {
    const base = await bandsOf('BT /F1 10 Tf 1 0 0 1 100 700 Tm (A A) Tj ET', { F1: CON_WIDTHS });
    // A(10) + espacio(MissingWidth ausente -> AFM no aplica a esta fuente
    // inventada, asi que el espacio no se mide y no hay `end`).
    expect(endAt(base, 100)).toBeUndefined();

    const conTz = await bandsOf('BT /F1 10 Tf 50 Tz 1 0 0 1 100 700 Tm (AB) Tj ET', {
      F1: CON_WIDTHS,
    });
    expect(endAt(conTz, 100)).toBeCloseTo(107.5, 3);

    const conTc = await bandsOf('BT /F1 10 Tf 3 Tc 1 0 0 1 100 700 Tm (AB) Tj ET', {
      F1: CON_WIDTHS,
    });
    expect(endAt(conTc, 100)).toBeCloseTo(121, 3);

    const conTw = await bandsOf('BT /F1 10 Tf 7 Tw 1 0 0 1 100 700 Tm (A A) Tj ET');
    // Helvetica: A=667, espacio=278 -> 6,67 + 2,78 + 7 + 6,67
    expect(endAt(conTw, 100)).toBeCloseTo(123.12, 2);
  });

  it('varias operaciones en la MISMA linea acumulan: el borde es la suma, no el maximo', async () => {
    // Tres `Tj` seguidos sin mover la matriz de texto: el motor reporta la
    // misma `x` para los tres, asi que el borde derecho de la linea solo puede
    // salir de sumarlos en orden.
    const bands = await bandsOf('BT /F1 10 Tf 1 0 0 1 100 700 Tm (A) Tj (A) Tj (A) Tj ET', {
      F1: CON_WIDTHS,
    });
    expect(endAt(bands, 100)).toBeCloseTo(130, 3);
  });

  it('una cadena de solo espacios no deja banda pero SI mueve la pluma', async () => {
    const conBlanco = await bandsOf('BT /F1 10 Tf 1 0 0 1 100 700 Tm (   ) Tj (AAAA) Tj ET');
    // 3 espacios de Helvetica (278) = 8,34, mas los 26,68 de "AAAA".
    expect(endAt(conBlanco, 100)).toBeCloseTo(135.02, 2);
  });

  it('un Td REINICIA la cuenta: cada linea tiene su propio borde derecho', async () => {
    const bands = await bandsOf('BT /F1 10 Tf 1 0 0 1 100 700 Tm (AAAA) Tj 0 -20 Td (AA) Tj ET');
    // Las dos lineas arrancan en la misma x; se distinguen por su `y`.
    const porY = bands
      .flatMap((b) => b.starts ?? [])
      .filter((s) => Math.abs(s.x - 100) < 0.5)
      .sort((a, b) => b.y - a.y);
    expect(porY).toHaveLength(2);
    expect(porY[0]?.end).toBeCloseTo(126.68, 2);
    expect(porY[1]?.end).toBeCloseTo(113.34, 2);
  });

  it('al fusionar dos arranques iguales gana el borde derecho MAYOR', async () => {
    // MUTACION que mata: quedarse con el primer `end` visto en `pushStart`.
    // Dos `Tm` a la MISMA posicion producen dos arranques que la deduplicacion
    // por punto redondeado funde en uno; el borde derecho de esa linea es
    // donde acabo lo ULTIMO que se escribio, no lo primero.
    const bands = await bandsOf(
      'BT /F1 10 Tf 1 0 0 1 100 700 Tm (AA) Tj 1 0 0 1 100 700 Tm (AAAA) Tj ET',
    );
    const enX = bands.flatMap((b) => b.starts ?? []).filter((s) => Math.abs(s.x - 100) < 0.5);
    expect(enX).toHaveLength(1);
    expect(enX[0]?.end).toBeCloseTo(126.68, 2);
  });

  it('texto girado 90 grados no recibe borde derecho: el avance no mueve la x', async () => {
    const bands = await bandsOf('BT /F1 10 Tf 0 1 -1 0 100 700 Tm (AAAA) Tj ET');
    const conEnd = bands.flatMap((b) => b.starts ?? []).filter((s) => s.end !== undefined);
    expect(conEnd).toHaveLength(0);
  });

  it('texto ESPEJADO tampoco recibe borde derecho, ni con avance neto negativo', async () => {
    // MUTACION que mata: aflojar `eff.a > 0` a `eff.a !== 0`. Con la matriz
    // espejada (a = -1) el avance de glifo mueve la `x` hacia la IZQUIERDA;
    // un ajuste de `TJ` lo bastante grande vuelve el avance neto negativo y
    // el producto sale positivo, asi que la guarda de `end > x` sola no basta
    // -- se anotaria un borde derecho a 43 pt de un texto que crece al reves.
    const bands = await bandsOf('BT /F1 10 Tf -1 0 0 1 300 700 Tm [(A) 5000] TJ ET');
    const conEnd = bands.flatMap((b) => b.starts ?? []).filter((s) => s.end !== undefined);
    expect(conEnd).toHaveLength(0);
  });

  it('una fuente sin metricas de ninguna clase deja la linea sin borde derecho', async () => {
    const bands = await bandsOf('BT /F1 10 Tf 1 0 0 1 100 700 Tm (AAAA) Tj ET', {
      F1: { Type: 'Font', Subtype: 'TrueType', BaseFont: 'CCCCCC+Desconocida' },
    });
    expect(endAt(bands, 100)).toBeUndefined();
  });

  it('la cache de anchos no lanza con un /Font que no es un diccionario', async () => {
    const doc = await PDFDocument.create();
    const cache = createFontWidthCache(doc);
    expect(cache.resolveWidths(null, '/F1')).toBeNull();
    expect(cache.resolveWidths(doc.context.obj({}) as never, undefined)).toBeNull();
  });
});
