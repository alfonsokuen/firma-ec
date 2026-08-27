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

import { MAX_CID_WIDTH_ENTRIES, createFontWidthCache } from '../src/fontWidths.js';
import { standardFontKey, standardWidth } from '../src/standardFontWidths.js';
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

/**
 * Como {@link bandsOf} pero metiendo el texto dentro de un Form XObject
 * colocado con `Do`, para comprobar que el estado de texto se hereda.
 */
async function bandsOfForm(
  paginaAntes: string,
  contenidoForm: string,
  fonts: Readonly<Record<string, unknown>> = { F1: HELVETICA },
): Promise<TextBand[]> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(A4);
  const fontEntries: Record<string, unknown> = {};
  for (const [name, dict] of Object.entries(fonts)) {
    fontEntries[name] = doc.context.register(doc.context.obj(dict as never));
  }
  const recursos = doc.context.obj({ Font: doc.context.obj(fontEntries as never) });
  const form = doc.context.stream(contenidoForm, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, 595.32, 841.92],
    Resources: recursos,
  });
  const formRef = doc.context.register(form);
  page.node.set(
    PDFName.of('Contents'),
    doc.context.register(doc.context.stream(`${paginaAntes}\n/Fm0 Do`)),
  );
  page.node.set(
    PDFName.of('Resources'),
    doc.context.obj({
      Font: doc.context.obj(fontEntries as never),
      XObject: doc.context.obj({ Fm0: formRef }),
    }),
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
    // A(10) + espacio + A(10). El espacio (codigo 32) cae FUERA del `/Widths`
    // declarado (65..66), asi que vale `/MissingWidth`, que sin declarar es 0
    // (ISO 32000-1 §9.8.1). No se busca en la tabla AFM: ver el test de
    // "manda el documento" mas abajo.
    expect(endAt(base, 100)).toBeCloseTo(120, 3);

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

describe('lo que el estimador NO debe medir (segunda ronda de revision)', () => {
  it('con /Widths presente, un codigo fuera de rango vale /MissingWidth, nunca la tabla AFM', () => {
    // La fuente se llama Helvetica y trae `/Widths` de un subconjunto que solo
    // cubre 'A' y 'B'. Para la 'C' la Helvetica de Adobe dice 722, pero eso no
    // dice NADA sobre este documento: el subconjunto puede llevar cualquier
    // glifo en ese codigo. Un numero a un 100% de distancia con aspecto de
    // medida es peor que no medir.
    expect(standardWidth('Helvetica', 'C'.charCodeAt(0))).toBe(722);
  });

  it('…y el motor lo respeta: "C" mide /MissingWidth, no los 722 del AFM', async () => {
    const SUBCONJUNTO = {
      Type: 'Font',
      Subtype: 'TrueType',
      BaseFont: 'AAAAAA+Helvetica',
      Encoding: 'WinAnsiEncoding',
      FirstChar: 65,
      LastChar: 66,
      Widths: [1000, 500],
      FontDescriptor: { Type: 'FontDescriptor', FontName: 'AAAAAA+Helvetica', MissingWidth: 100 },
    };
    const bands = await bandsOf('BT /F1 10 Tf 1 0 0 1 100 700 Tm (AC) Tj ET', { F1: SUBCONJUNTO });
    // 1000 + 100 (MissingWidth), no 1000 + 722.
    expect(endAt(bands, 100)).toBeCloseTo(111, 3);
  });

  it('sin /MissingWidth declarado el codigo fuera de rango vale 0, no el AFM', async () => {
    const SUBCONJUNTO = {
      Type: 'Font',
      Subtype: 'TrueType',
      BaseFont: 'AAAAAA+Helvetica',
      Encoding: 'WinAnsiEncoding',
      FirstChar: 65,
      LastChar: 66,
      Widths: [1000, 500],
    };
    const bands = await bandsOf('BT /F1 10 Tf 1 0 0 1 100 700 Tm (AC) Tj ET', { F1: SUBCONJUNTO });
    expect(endAt(bands, 100)).toBeCloseTo(110, 3);
  });

  it('solo son alias validos las fuentes METRICAMENTE compatibles', () => {
    // Aceptadas: clones con las metricas de las estandar.
    expect(standardFontKey('ArialMT')).toBe('Helvetica');
    expect(standardFontKey('Arial-BoldMT')).toBe('Helvetica-Bold');
    expect(standardFontKey('LiberationSans')).toBe('Helvetica');
    expect(standardFontKey('TimesNewRomanPSMT')).toBe('Times-Roman');
    expect(standardFontKey('LiberationSerif-Italic')).toBe('Times-Italic');
    expect(standardFontKey('CourierNew')).toBe('Courier');
    expect(standardFontKey('ABCDEF+NimbusRomNo9L-Regu')).toBe('Times-Roman');
    // Rechazadas: se parecen, pero NO comparten metricas. Medido: Verdana sale
    // un 12% mas ancha que Helvetica y Georgia un 15% mas que Times.
    for (const nombre of [
      'Verdana',
      'Tahoma',
      'Calibri',
      'SegoeUI',
      'Georgia',
      'Cambria',
      'BookAntiqua',
      'Arial-Narrow',
      'ArialBlack',
      'ArialNarrow-Bold',
    ]) {
      expect(standardFontKey(nombre)).toBeNull();
    }
  });

  it('una Type3 no se mide: su /Widths no va en milesimas de em', async () => {
    // ISO 32000-1 §9.6.5: en una Type3 los anchos van en el espacio de glifo
    // que define `/FontMatrix`. Leerlos como milesimas daba 2,00 pt donde la
    // medida real de "AAAA" son 26,68.
    const TYPE3 = {
      Type: 'Font',
      Subtype: 'Type3',
      FontBBox: [0, 0, 750, 750],
      FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
      CharProcs: {},
      Encoding: { Type: 'Encoding', Differences: [65, 'a1'] },
      FirstChar: 65,
      LastChar: 65,
      Widths: [667],
    };
    const bands = await bandsOf('BT /F1 10 Tf 1 0 0 1 100 700 Tm (AAAA) Tj ET', { F1: TYPE3 });
    expect(endAt(bands, 100)).toBeUndefined();
  });

  it('una Type0 que no sea Identity-H no se mide: el codigo no es el CID', async () => {
    const conEncoding = (enc: unknown): Record<string, unknown> => ({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: 'BBBBBB+Inventada',
      Encoding: enc,
      DescendantFonts: [
        {
          Type: 'Font',
          Subtype: 'CIDFontType2',
          BaseFont: 'BBBBBB+Inventada',
          CIDSystemInfo: { Registry: 'Adobe', Ordering: 'Identity', Supplement: 0 },
          DW: 1000,
          W: [1, [500, 600]],
        },
      ],
    });
    for (const enc of ['Identity-V', 'UniGB-UCS2-H', 'UniJIS-UCS2-V']) {
      const bands = await bandsOf('BT /F1 10 Tf 1 0 0 1 100 700 Tm <00010002> Tj ET', {
        F1: conEncoding(enc),
      });
      expect(endAt(bands, 100)).toBeUndefined();
    }
  });

  it('un Tz de 0 o negativo deja la linea sin borde derecho', async () => {
    for (const tz of ['0', '-100']) {
      const bands = await bandsOf(`BT /F1 10 Tf ${tz} Tz 1 0 0 1 100 700 Tm (AAAA) Tj ET`);
      expect(endAt(bands, 100)).toBeUndefined();
    }
    // Y no "conserva la escala anterior": un Tz valido seguido de uno invalido
    // tampoco vale, porque el documento acaba de abandonar esa escala.
    const mixto = await bandsOf('BT /F1 10 Tf 50 Tz 1 0 0 1 100 700 Tm 0 Tz (AAAA) Tj ET');
    expect(endAt(mixto, 100)).toBeUndefined();
  });

  it('un Tf con tamano 0 o negativo deja la linea sin borde derecho', async () => {
    for (const size of ['0', '-10']) {
      const bands = await bandsOf(`BT /F1 12 Tf 1 0 0 1 100 700 Tm /F1 ${size} Tf (AAAA) Tj ET`);
      expect(endAt(bands, 100)).toBeUndefined();
    }
  });

  it('un Form XObject hereda el estado de texto de la pagina (Tz, Tc, Tw, Tf)', async () => {
    // ISO 32000-1 §8.10.1. Sin herencia, el Form arrancaba con Tz=100%, Tc=0,
    // Tw=0 y el tamano de respaldo (12 pt), asi que el avance salia medido con
    // un espaciado que el documento nunca uso.
    const conHerencia = await bandsOfForm(
      'BT /F1 10 Tf 50 Tz 2 Tc ET',
      'BT 1 0 0 1 100 700 Tm (AAAA) Tj ET',
    );
    // Helvetica 'A' = 667 -> (6,67 + 2) x 4 x 0,5 = 17,34.
    expect(endAt(conHerencia, 100)).toBeCloseTo(117.34, 2);
  });

  it('un /W con un rango enorme NO se expande: el CID mas alto se mide bien', async () => {
    // MUTACION que mata: volver a aplanar los rangos a un `Map` por CID. Con
    // el tope aplicado a claves expandidas, el CID 60000 caia fuera del mapa y
    // se resolvia con `/DW` (250) en vez de con su ancho real (500). Y de paso
    // costaba 129 MB medidos con 64 fuentes asi.
    const ANCHO = {
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: 'CCCCCC+Ancha',
      Encoding: 'Identity-H',
      DescendantFonts: [
        {
          Type: 'Font',
          Subtype: 'CIDFontType2',
          BaseFont: 'CCCCCC+Ancha',
          CIDSystemInfo: { Registry: 'Adobe', Ordering: 'Identity', Supplement: 0 },
          DW: 250,
          W: [0, 200000, 500],
        },
      ],
    };
    // CID 0xEA60 = 60000, dos veces: 2 x 500/1000 x 10 = 10.
    const bands = await bandsOf('BT /F1 10 Tf 1 0 0 1 100 700 Tm <EA60EA60> Tj ET', { F1: ANCHO });
    expect(endAt(bands, 100)).toBeCloseTo(110, 3);
  });

  it('un /W con mas intervalos de los que cabe el documento no se mide a medias', async () => {
    // El tope es TOTAL por documento y se cuenta en intervalos, no en CIDs.
    // Superarlo devuelve `null` para esa fuente entera: media tabla da medidas
    // correctas para unos codigos e inventadas para otros, sin distinguirlas.
    const W: number[] = [];
    for (let c = 0; c <= MAX_CID_WIDTH_ENTRIES; c++) W.push(c, c, 500);
    const DESBORDA = {
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: 'DDDDDD+Desborda',
      Encoding: 'Identity-H',
      DescendantFonts: [
        {
          Type: 'Font',
          Subtype: 'CIDFontType2',
          BaseFont: 'DDDDDD+Desborda',
          CIDSystemInfo: { Registry: 'Adobe', Ordering: 'Identity', Supplement: 0 },
          DW: 250,
          W,
        },
      ],
    };
    const bands = await bandsOf('BT /F1 10 Tf 1 0 0 1 100 700 Tm <00010002> Tj ET', {
      F1: DESBORDA,
    });
    expect(endAt(bands, 100)).toBeUndefined();
  });
});

describe('la tabla AFM cubre WinAnsi entero, no solo el ASCII', () => {
  /**
   * El tramo 128..159 de WinAnsi es donde vive la tipografia que aparece en
   * los nombres de verdad: comillas curvas, guion medio y largo, puntos
   * suspensivos. La primera version de la tabla lo dejaba ENTERO a cero —leia
   * la tabla de codificacion como si la clave fuera el byte, cuando es el code
   * point Unicode— y un solo apostrofo tipografico bastaba para dejar la linea
   * sin borde derecho. Con la union de la columna medida a medias, el centro
   * se corria decenas de puntos sin que nada avisara.
   *
   * Estos numeros ANCLAN LA PROCEDENCIA: son los `WX` de los AFM de Adobe para
   * esos glifos. Si alguien regenera la tabla con otro cruce y vuelve a
   * perderlos, esto se cae.
   */
  it('los glifos tipograficos de 128..159 tienen su ancho AFM', () => {
    expect(standardWidth('Helvetica', 128)).toBe(556); // Euro
    expect(standardWidth('Helvetica', 133)).toBe(1000); // ellipsis
    expect(standardWidth('Helvetica', 145)).toBe(222); // quoteleft
    expect(standardWidth('Helvetica', 146)).toBe(222); // quoteright
    expect(standardWidth('Helvetica', 147)).toBe(333); // quotedblleft
    expect(standardWidth('Helvetica', 148)).toBe(333); // quotedblright
    expect(standardWidth('Helvetica', 149)).toBe(350); // bullet
    expect(standardWidth('Helvetica', 150)).toBe(556); // endash
    expect(standardWidth('Helvetica', 151)).toBe(1000); // emdash
    expect(standardWidth('Helvetica', 159)).toBe(500); // ydieresis
    expect(standardWidth('Times-Roman', 146)).toBe(333);
    expect(standardWidth('Times-Roman', 151)).toBe(1000);
  });

  it('y los acentos de Latin-1 tambien, que es lo que lleva un nombre en espanol', () => {
    expect(standardWidth('Helvetica', 241)).toBe(556); // ntilde
    expect(standardWidth('Helvetica', 233)).toBe(556); // eacute
    expect(standardWidth('Times-Roman', 233)).toBe(444);
  });

  it('solo son desconocidos los codigos que WinAnsi deja sin glifo', () => {
    // 127 es DEL y 129/141/143/144/157 son los huecos sin asignar de CP1252.
    // Un `0` en la tabla significa "sin glifo", no "ancho cero".
    for (const code of [127, 129, 141, 143, 144, 157]) {
      expect(standardWidth('Helvetica', code)).toBeNull();
    }
    // Y el resto de 128..159 SI tiene ancho: la mutacion que devolvia `0` como
    // si fuera un ancho valido cambiaba justo esa frontera.
    for (let code = 128; code <= 159; code++) {
      if ([129, 141, 143, 144, 157].includes(code)) continue;
      expect(standardWidth('Helvetica', code)).toBeGreaterThan(0);
    }
  });

  it('un nombre con guion medio en Helvetica sin /Widths SI recibe borde derecho', async () => {
    // El modo de fallo real: el escape octal `\\226` es el guion medio (endash, 150) en
    // WinAnsi. Con la tabla recortada, esta linea se quedaba sin `end`.
    const bands = await bandsOf('BT /F1 10 Tf 1 0 0 1 100 700 Tm (A\\226A) Tj ET');
    // 667 + 556 + 667 = 1890 milesimas -> 18,90 pt.
    expect(endAt(bands, 100)).toBeCloseTo(118.9, 2);
  });
});

describe('formas del /W y del /Widths que las mutaciones destaparon', () => {
  it('/W en formato rango [cFirst cLast w] se lee como rango, no cae a /DW', async () => {
    // MUTACION que mata: romper la rama de rangos. El fallo seria MUDO —el
    // ancho cae a `/DW`, que es un numero perfectamente creible— asi que el
    // fixture separa los dos valores lo suficiente como para distinguirlos.
    const RANGO = {
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: 'EEEEEE+Rango',
      Encoding: 'Identity-H',
      DescendantFonts: [
        {
          Type: 'Font',
          Subtype: 'CIDFontType2',
          BaseFont: 'EEEEEE+Rango',
          CIDSystemInfo: { Registry: 'Adobe', Ordering: 'Identity', Supplement: 0 },
          DW: 250,
          W: [1, 2, 700],
        },
      ],
    };
    const bands = await bandsOf('BT /F1 10 Tf 1 0 0 1 100 700 Tm <00010002> Tj ET', { F1: RANGO });
    // 2 CIDs x 700/1000 x 10 = 14. Con `/DW` habrian sido 5.
    expect(endAt(bands, 100)).toBeCloseTo(114, 3);
  });

  it('sin /FirstChar el primer ancho de /Widths es el codigo 0, no el 32', async () => {
    // MUTACION que mata: asumir 32 como default de `/FirstChar`. ISO 32000-1
    // §9.6.2.1 no da default; el valor que hace consistente el array es 0, y
    // asumir 32 desplaza TODOS los anchos 32 posiciones — otro fallo mudo.
    const SIN_FIRSTCHAR: Record<string, unknown> = {
      Type: 'Font',
      Subtype: 'TrueType',
      BaseFont: 'FFFFFF+SinFirstChar',
      Encoding: 'WinAnsiEncoding',
      Widths: Array.from({ length: 96 }, (_, i) => (i === 65 ? 1000 : 10)),
    };
    const bands = await bandsOf('BT /F1 10 Tf 1 0 0 1 100 700 Tm (AA) Tj ET', {
      F1: SIN_FIRSTCHAR,
    });
    // 'A' es el codigo 65 y el array arranca en 0: 2 x 1000/1000 x 10 = 20.
    // Asumiendo `/FirstChar` 32 se leeria el indice 33, que vale 10 -> 0,2.
    expect(endAt(bands, 100)).toBeCloseTo(120, 3);
  });
});
