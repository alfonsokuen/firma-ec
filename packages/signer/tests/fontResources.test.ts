/**
 * fontResources.test.ts — cubre la resolución `/Resources /Font/<nombre>` →
 * `FontDecoder`, su enganche al walker de `textBands.ts` vía `textObserver`, y
 * sobre todo el invariante de privacidad: el texto decodificado solo puede
 * salir por el sink transitorio del observador, nunca por el valor de retorno
 * de `readTextBands`.
 */
import { type PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

import {
  MAX_FONTS_PER_DOC,
  MAX_TOUNICODE_BYTES,
  createFontResourceCache,
} from '../src/fontResources.js';
import { type PageDecodeStats, type TextRunObserver, readTextBands } from '../src/textBands.js';

/** Una línea capturada por un `TextRunObserver` de prueba. */
interface CapturedLine {
  page: number;
  x: number | undefined;
  y: number;
  h: number;
  codePoints: number[];
}

/** Observador de prueba: junta cada línea en un array, nunca convierte a string. */
function collectingObserver(): { observer: TextRunObserver; lines: CapturedLine[] } {
  const lines: CapturedLine[] = [];
  let current: CapturedLine | null = null;
  const observer: TextRunObserver = {
    beginLine(page, x, y, h) {
      current = { page, x, y, h, codePoints: [] };
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

/**
 * PDF de una página con UN font dict manual en `/Resources /Font/<fontKey>` y
 * el content stream que decida la prueba. `fontDict` se construye con
 * `doc.context.obj(...)` para poder fijar `/Encoding`/`/ToUnicode` a mano —
 * `embedFont` no permite un `/Encoding` con `/Differences` arbitrario.
 */
async function pdfWithFont(
  content: string,
  fontKey: string,
  buildFontDict: (doc: PDFDocument) => PDFDict,
): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(content)));
  const fontRef = doc.context.register(buildFontDict(doc));
  const resources = doc.context.obj({ Font: doc.context.obj({ [fontKey]: fontRef }) });
  page.node.set(PDFName.of('Resources'), resources);
  return PDFDocument.load(await doc.save());
}

function simpleWinAnsiWithDifferences(doc: PDFDocument): PDFDict {
  return doc.context.obj({
    Type: 'Font',
    Subtype: 'Type1',
    BaseFont: 'Helvetica',
    Encoding: doc.context.obj({
      Type: 'Encoding',
      BaseEncoding: 'WinAnsiEncoding',
      // 0x41 ('A') se redefine a 'ntilde': sin /Differences saldría como 'A'
      // (0x41), con ella tiene que salir como 0xF1 (ñ).
      Differences: [0x41, 'ntilde'],
    }),
  });
}

function type0WithToUnicode(doc: PDFDocument, cmapText: string): PDFDict {
  const cmapStream = doc.context.register(doc.context.stream(new TextEncoder().encode(cmapText)));
  return doc.context.obj({
    Type: 'Font',
    Subtype: 'Type0',
    BaseFont: 'CustomIdentityH',
    Encoding: 'Identity-H',
    ToUnicode: cmapStream,
  });
}

describe('createFontResourceCache — fuente simple WinAnsi + /Differences', () => {
  it('el observador recibe los code points esperados, en la posición esperada', async () => {
    const doc = await pdfWithFont(
      'BT /F1 12 Tf 1 0 0 1 50 500 Tm (AB) Tj ET',
      'F1',
      simpleWinAnsiWithDifferences,
    );
    const { observer, lines } = collectingObserver();

    const { bands, unanalyzedPages } = readTextBands(doc, { textObserver: observer });

    expect(unanalyzedPages).toEqual([]);
    expect(bands.length).toBeGreaterThan(0);
    expect(lines).toHaveLength(1);
    // 'A' (0x41) → redefinido por /Differences a 'ntilde' (0xF1); 'B' (0x42)
    // sigue en el subconjunto ASCII de la base WinAnsi.
    expect(lines[0]!.codePoints).toEqual([0xf1, 0x42]);
    expect(lines[0]!.page).toBe(0);
    // La MISMA geometría que ya calcula `emit()` para la banda: la línea
    // decodificada no inventa su propia posición.
    const band = bands[0]!;
    expect(lines[0]!.y).toBeCloseTo(band.y, 5);
    expect(lines[0]!.h).toBeCloseTo(band.h, 5);
  });
});

describe('createFontResourceCache — Type0 Identity-H con /ToUnicode', () => {
  it('el observador recibe los code points del CMap embebido', async () => {
    const cmap = '2 beginbfchar\n<0001> <0041>\n<0002> <0042>\nendbfchar';
    const doc = await pdfWithFont('BT /F2 12 Tf 1 0 0 1 60 400 Tm <00010002> Tj ET', 'F2', (d) =>
      type0WithToUnicode(d, cmap),
    );
    const { observer, lines } = collectingObserver();

    const { unanalyzedPages } = readTextBands(doc, { textObserver: observer });

    expect(unanalyzedPages).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.codePoints).toEqual([0x41, 0x42]);
  });
});

describe('presupuesto de /ToUnicode — 2 MB degrada a todo-unmapped SIN tocar las bandas', () => {
  it('coverage baja y las bandas quedan idénticas a las de sin-observador', async () => {
    // CMap sintéticamente gigante: relleno de bfchar irrelevantes hasta pasar
    // el tope de 1 MB de `fontResources.ts`, más el par que sí nos importa.
    const filler = Array.from(
      { length: 80_000 },
      (_, i) => `<${(0x1000 + i).toString(16).padStart(4, '0')}> <0058>`,
    ).join('\n');
    const cmap = `beginbfchar\n<0001> <0041>\n${filler}\nendbfchar`;
    expect(new TextEncoder().encode(cmap).length).toBeGreaterThan(1_000_000);

    const content = 'BT /F2 12 Tf 1 0 0 1 60 400 Tm <0001> Tj ET';
    const doc = await pdfWithFont(content, 'F2', (d) => type0WithToUnicode(d, cmap));

    const plain = readTextBands(doc);
    const { observer, lines } = collectingObserver();
    const decodeStats: PageDecodeStats[] = [];
    const withObserver = readTextBands(doc, {
      textObserver: observer,
      onPageDecodeStats: (stats) => decodeStats.push(stats),
    });

    // La fuente pasada de tamaño decodifica TODO sin mapear: se ve en el sink
    // (solo llega el sentinela) y en la cobertura reportada.
    expect(lines).toHaveLength(1);
    expect(lines[0]!.codePoints.every((cp) => cp === -1)).toBe(true);
    expect(decodeStats).toHaveLength(1);
    expect(decodeStats[0]!.coverage).toBeLessThan(1);

    // Y las bandas —lo único que consume hoy la colocación— no se mueven ni un
    // punto por culpa de una fuente que no se pudo leer.
    expect(withObserver.bands).toEqual(plain.bands);
    expect(withObserver.unanalyzedPages).toEqual(plain.unanalyzedPages);
  });
});

describe('MAX_TOUNICODE_BYTES — 200 KB SIGUE mapeando (mutación #4: el techo no puede ser demasiado bajo)', () => {
  it('una CMap real de ~200 KB —por encima del viejo tope de 64 KB— decodifica con normalidad, no degrada', async () => {
    // El tope viejo (64 KB) descartaba CMaps de subconjuntos CJK/no
    // reducidos legítimas, y la medición que lo justificaba (303 s para una
    // CMap de 990 KB) resultó ser por la falta de `MAX_TOTAL_MAP_ENTRIES`,
    // no por el tamaño en bytes en sí — ver el comentario de
    // `fontResources.ts`. Este test fija el LÍMITE INFERIOR real del techo:
    // 200 KB debe seguir cabiendo. Si alguien lo endurece de vuelta a algo
    // cercano a `512 B` (mutación #4 de la ronda de revisión), este test cae.
    expect(MAX_TOUNICODE_BYTES).toBeGreaterThanOrEqual(200 * 1024);

    const filler = Array.from(
      { length: 11_500 },
      (_, i) => `<${(0x1000 + i).toString(16).padStart(4, '0')}> <0058>`,
    ).join('\n');
    const cmap = `beginbfchar\n<0001> <0041>\n${filler}\nendbfchar`;
    const cmapSize = new TextEncoder().encode(cmap).length;
    expect(cmapSize).toBeGreaterThan(150 * 1024);
    expect(cmapSize).toBeLessThan(MAX_TOUNICODE_BYTES);

    const content = 'BT /F2 12 Tf 1 0 0 1 60 400 Tm <0001> Tj ET';
    const doc = await pdfWithFont(content, 'F2', (d) => type0WithToUnicode(d, cmap));
    const { observer, lines } = collectingObserver();

    readTextBands(doc, { textObserver: observer });

    expect(lines).toHaveLength(1);
    // 0x0001 → 0x0041 ('A'), tomado del PRIMER `bfchar`: si el techo hubiera
    // cortado la CMap, esta fuente degradaría a todo-unmapped y saldría -1.
    expect(lines[0]!.codePoints).toEqual([0x41]);
  });
});

describe('caché de fuentes a nivel de documento', () => {
  it('el mismo ref de fuente usado en 3 páginas se resuelve al MISMO decoder (no se reparsea)', async () => {
    const doc = await PDFDocument.create();
    const fontRef = doc.context.register(simpleWinAnsiWithDifferences(doc));
    const resourcesDict = doc.context.obj({ Font: doc.context.obj({ F1: fontRef }) }) as PDFDict;

    for (let i = 0; i < 3; i++) {
      const page = doc.addPage([300, 300]);
      page.node.set(
        PDFName.of('Contents'),
        doc.context.register(doc.context.stream('BT /F1 12 Tf 1 0 0 1 10 10 Tm (A) Tj ET')),
      );
      page.node.set(PDFName.of('Resources'), resourcesDict);
    }
    const loaded = await PDFDocument.load(await doc.save());

    const cache = createFontResourceCache(loaded);
    const loadedResources = loaded.getPages().map((p) => {
      const dict = p.node.get(PDFName.of('Resources'));
      return loaded.context.lookup(dict);
    });
    const decoders = loadedResources.map((r) => cache.resolveFont(r as PDFDict, '/F1'));

    // Referencialmente el MISMO objeto decoder las 3 veces: la caché por
    // `PDFRef` evitó reparsear la fuente en cada página.
    expect(decoders[0]).toBe(decoders[1]);
    expect(decoders[1]).toBe(decoders[2]);
  });
});

describe('MAX_FONTS_PER_DOC cuenta también los font dicts DIRECTOS (HIGH-1)', () => {
  it('el tope se agota igual sin PDFRef, y el MISMO dict da el MISMO decoder', async () => {
    // Antes de HIGH-1 la caché indexaba por `PDFRef.toString()`: un font
    // dict DIRECTO (sin `context.register()`, como los que crea este test)
    // daba `ref === null`, así que ni se cacheaba NI contaba para el tope —
    // `resolveFont` lo reparseaba en CADA llamada y `MAX_FONTS_PER_DOC` nunca
    // actuaba sobre él. La caché ahora indexa por el `PDFDict` en sí
    // (`WeakMap`), que cubre los dos casos.
    const doc = await PDFDocument.create();
    const cache = createFontResourceCache(doc);

    // Cada iteración crea un font dict DIRECTO nuevo — nunca `.register()`,
    // así que `getFontDict` siempre devuelve `ref: null` para todos ellos.
    const resourcesList: PDFDict[] = [];
    for (let i = 0; i < MAX_FONTS_PER_DOC + 6; i++) {
      const fontDict = simpleWinAnsiWithDifferences(doc); // /Differences: 0x41 → ntilde
      resourcesList.push(doc.context.obj({ Font: doc.context.obj({ F1: fontDict }) }) as PDFDict);
    }

    const decoders = resourcesList.map((r) => cache.resolveFont(r, '/F1'));
    const decodeOne = (decoder: (typeof decoders)[number]): number[] => {
      const cps: number[] = [];
      decoder.decode(new Uint8Array([0x41]), (cp) => cps.push(cp));
      return cps;
    };

    // Dentro del tope: la fuente se resolvió de verdad (0x41 → 0xF1 por
    // /Differences), no todo-unmapped.
    for (let i = 0; i < MAX_FONTS_PER_DOC; i++) {
      expect(decodeOne(decoders[i]!)).toEqual([0xf1]);
    }
    // Pasado el tope: degrada a todo-unmapped, INCLUSO siendo dicts
    // directos sin `PDFRef` — esto es justo lo que la caché vieja se saltaba.
    for (let i = MAX_FONTS_PER_DOC; i < resourcesList.length; i++) {
      expect(decodeOne(decoders[i]!)).toEqual([-1]);
    }

    // El MISMO dict consultado otra vez da el MISMO objeto decoder — la
    // caché por `WeakMap<PDFDict, …>` funciona también para el caso directo.
    const again = cache.resolveFont(resourcesList[0]!, '/F1');
    expect(again).toBe(decoders[0]);
  });
});

describe('MAX_FONTS_PER_DOC — el tope tiene que ser un número RAZONABLE (mutación #5)', () => {
  // El test de arriba deriva el TAMAÑO DE SU PROPIO BUCLE de
  // `MAX_FONTS_PER_DOC` (`for (let i = 0; i < MAX_FONTS_PER_DOC + 6; i++)`):
  // si el tope se desactivara (p.ej. `Number.MAX_SAFE_INTEGER`), ese mismo
  // bucle intenta crear miles de billones de font dicts y el PROCESO muere
  // por falta de memoria — medido: `vitest` lo reporta como "Worker exited
  // unexpectedly", sin una sola línea `FAIL`, indistinguible de un timeout
  // de infraestructura. Esta aserción es independiente de cualquier bucle:
  // afirma el número en sí, así que cae en rojo LIMPIO ante la misma mutación.
  it('el tope está fijado por ARRIBA: un documento adversario no puede forzar miles de parseos', () => {
    expect(MAX_FONTS_PER_DOC).toBeGreaterThan(0);
    expect(MAX_FONTS_PER_DOC).toBeLessThanOrEqual(1000);
  });

  it('con un tamaño de fuentes ACOTADO a mano (nunca derivado del tope), pasado el límite degrada de verdad', async () => {
    const doc = await PDFDocument.create();
    const cache = createFontResourceCache(doc);
    // `bound` está acotado con `Math.min`: pase lo que pase con la
    // constante, este bucle JAMÁS intenta crear más de 210 dicts — a
    // diferencia del test de arriba, esta prueba no puede volver a caer en
    // OOM por una mutación futura del valor.
    const bound = Math.min(MAX_FONTS_PER_DOC, 200);
    const resourcesList: PDFDict[] = [];
    for (let i = 0; i < bound + 10; i++) {
      const fontDict = simpleWinAnsiWithDifferences(doc);
      resourcesList.push(doc.context.obj({ Font: doc.context.obj({ F1: fontDict }) }) as PDFDict);
    }
    const decoders = resourcesList.map((r) => cache.resolveFont(r, '/F1'));
    const decodeOne = (decoder: (typeof decoders)[number]): number[] => {
      const cps: number[] = [];
      decoder.decode(new Uint8Array([0x41]), (cp) => cps.push(cp));
      return cps;
    };

    if (MAX_FONTS_PER_DOC > 200) {
      // El tope real excede lo que este test se permite construir sin
      // arriesgar memoria: no hay degradación que observar AQUÍ (la prueba
      // de arriba, con el tope real, sí la cubre) — se documenta en vez de
      // fingir cobertura.
      return;
    }
    for (let i = 0; i < MAX_FONTS_PER_DOC; i++) {
      expect(decodeOne(decoders[i]!)).toEqual([0xf1]);
    }
    for (let i = MAX_FONTS_PER_DOC; i < resourcesList.length; i++) {
      expect(decodeOne(decoders[i]!)).toEqual([-1]);
    }
  });
});

describe('privacidad en runtime — el texto decodificado NUNCA sale por el valor de retorno', () => {
  const SENTINEL = 'CONFIDENCIALSECRETO';

  /** Codifica el centinela como bytes 1:1 en un `/Differences` ASCII, para leerlo con la fuente simple. */
  async function pdfWithSentinel(): Promise<PDFDocument> {
    const content = `BT /F1 12 Tf 1 0 0 1 40 700 Tm (${SENTINEL}) Tj ET`;
    return pdfWithFont(content, 'F1', (doc) =>
      doc.context.obj({
        Type: 'Font',
        Subtype: 'Type1',
        BaseFont: 'Helvetica',
        Encoding: 'WinAnsiEncoding',
      }),
    );
  }

  /** Ninguna subcadena de ≥4 chars del secreto puede aparecer en el JSON del valor. */
  function assertNoSentinelLeak(value: unknown, secret: string): void {
    const json = JSON.stringify(value);
    for (let i = 0; i + 4 <= secret.length; i++) {
      expect(json).not.toContain(secret.slice(i, i + 4));
    }
  }

  it('readTextBands y las estadísticas por página no contienen el centinela', async () => {
    const doc = await pdfWithSentinel();
    const { observer, lines } = collectingObserver();
    const stats: unknown[] = [];

    const result = readTextBands(doc, {
      textObserver: observer,
      onPageDecodeStats: (s) => stats.push(s),
    });

    // El observador SÍ vio el texto (es su trabajo transitorio) — lo probamos
    // reconstruyendo la cadena EN EL TEST, nunca dentro del módulo.
    const seen = String.fromCharCode(...lines[0]!.codePoints.filter((cp) => cp >= 0));
    expect(seen).toBe(SENTINEL);

    // Pero nada que el módulo DEVUELVE lo contiene.
    assertNoSentinelLeak(result, SENTINEL);
    assertNoSentinelLeak(stats, SENTINEL);
  });

  it('el propio checker de fuga SÍ caza una fuga plantada (si no, no prueba nada)', () => {
    const leaked = { note: `debug: texto fue "${SENTINEL}"` };
    expect(() => assertNoSentinelLeak(leaked, SENTINEL)).toThrow();
  });
});

describe('resolveFont: el catch SÍ atrapa un fallo real', () => {
  it('un /Subtype cuyo decodeText() lanza degrada a todo-unmapped sin tumbar el recorrido', async () => {
    // El fixture `Encoding: 42` de más abajo NO ejercita el `catch` de
    // `resolveFont` — ninguna rama de `buildSimpleFontDecoder`/`buildDecoder`
    // lanza ante esa forma, así que ese test pasaba "por construcción" sin
    // haber probado el `catch`. Aquí se fuerza un fallo REAL: se parchea
    // `PDFName.prototype.decodeText` para que lance únicamente cuando decodifica
    // un `/Subtype` con un valor centinela — `buildDecoder` llama a
    // `subtype.decodeText()` antes de elegir la rama simple/Type0, así que el
    // fallo ocurre exactamente donde el comentario del módulo dice que puede.
    const THROW_MARKER = 'ThrowOnDecodeTextMarker';
    const originalDecodeText = PDFName.prototype.decodeText;
    const spy = vi.spyOn(PDFName.prototype, 'decodeText').mockImplementation(function (
      this: PDFName,
    ) {
      const value = originalDecodeText.call(this);
      if (value === THROW_MARKER) throw new Error('fallo forzado por el test');
      return value;
    });
    try {
      const doc = await pdfWithFont('BT /F1 12 Tf 1 0 0 1 60 400 Tm (Hola) Tj ET', 'F1', (d) =>
        d.context.obj({
          Type: 'Font',
          Subtype: THROW_MARKER,
          BaseFont: 'Helvetica',
          Encoding: 'WinAnsiEncoding',
        }),
      );
      const plain = readTextBands(doc);
      const { observer, lines } = collectingObserver();

      const withObserver = readTextBands(doc, { textObserver: observer });

      // El `catch` de `resolveFont` atrapó el fallo real: las bandas no se tocan...
      expect(withObserver.bands).toEqual(plain.bands);
      expect(withObserver.unanalyzedPages).toEqual(plain.unanalyzedPages);
      // ...y el texto llega TODO sin mapear (decoder degradado), no vacío ni a medias.
      expect(lines).toHaveLength(1);
      expect(lines[0]!.codePoints).toEqual([-1, -1, -1, -1]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('un fallo de fuente jamás degrada las bandas', () => {
  it('un /Encoding con forma inesperada no revienta el recorrido: decoder todo-unmapped y bandas intactas', async () => {
    const doc = await pdfWithFont('BT /F1 12 Tf 1 0 0 1 60 400 Tm (Hola) Tj ET', 'F1', (d) =>
      d.context.obj({
        Type: 'Font',
        Subtype: 'Type1',
        BaseFont: 'Helvetica',
        // /Encoding apuntando a un número no es una forma válida del spec:
        // ni PDFName ni PDFDict. El resolver debe degradar, no lanzar.
        Encoding: 42,
      }),
    );
    const plain = readTextBands(doc);
    const { observer, lines } = collectingObserver();

    const withObserver = readTextBands(doc, { textObserver: observer });

    expect(withObserver.bands).toEqual(plain.bands);
    expect(withObserver.unanalyzedPages).toEqual(plain.unanalyzedPages);
    // La fuente no se pudo interpretar como esperábamos (`/Encoding: 42` no es
    // ni PDFName ni PDFDict), así que cae al default 'Standard' SIN
    // /Differences: el ASCII puro de "Hola" pasa 1:1 por la tabla base. Antes
    // esta aserción (`toBeGreaterThanOrEqual(0)`) era cierta para CUALQUIER
    // array, incluido uno vacío — no probaba que el fallback decodificara
    // nada. Se afirma el resultado EXACTO.
    expect(lines).toHaveLength(1);
    expect(lines[0]!.codePoints).toEqual([0x48, 0x6f, 0x6c, 0x61]); // H o l a
  });
});

describe('la opción vacía no activa el camino del observador', () => {
  it('{} y {onPageDecodeStats} SIN textObserver dan el mismo resultado que sin opciones', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 600]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('Cláusula primera', { x: 50, y: 500, size: 12, font });
    const loaded = await PDFDocument.load(await doc.save());

    // El test viejo comparaba `readTextBands(loaded)` con
    // `readTextBands(loaded, {})`: ambas llamadas toman la MISMA rama
    // (`options?.textObserver` es `undefined` en las dos), así que la
    // comparación era cierta por construcción y no probaba nada del guard.
    // Aquí se suma un tercer caso que SÍ podría tomar una rama distinta si el
    // guard estuviera mal escrito: `onPageDecodeStats` puesto pero SIN
    // `textObserver` — y se afirma que `onPageDecodeStats` jamás se invoca.
    const baseline = readTextBands(loaded);
    const withEmptyOptions = readTextBands(loaded, {});
    const statsCalls: unknown[] = [];
    const withStatsButNoObserver = readTextBands(loaded, {
      onPageDecodeStats: (s) => statsCalls.push(s),
    });

    expect(withEmptyOptions).toEqual(baseline);
    expect(withStatsButNoObserver).toEqual(baseline);
    expect(statsCalls).toEqual([]);
  });
});
