/**
 * columnSignatureBlock.test.ts — el bloque de firma a DOS COLUMNAS.
 *
 * Defecto reproducido en produccion (0.23.2) sobre un contrato real de dos
 * firmantes: la estampa se ancla a la columna izquierda pero conserva el ancho
 * por defecto (240 pt) y su borde derecho invade el hueco reservado al
 * COFIRMANTE. Nadie se da cuenta porque no pisa texto: se mete en el espacio
 * en blanco onde el otro tiene que firmar.
 *
 * Y hay una segunda mitad peor: `mergeBands` ordena por `y` sin criterio de
 * desempate, asi que con dos columnas en la MISMA linea base gana la que el
 * content stream emitio primero. Dos documentos visualmente identicos, salidos
 * de generadores distintos, se colocan en columnas distintas.
 *
 * Las medidas de las coordenadas salen del contrato real (pdfminer):
 * columna izquierda x=113.7 (nombre) / 140.1 (empresa), derecha x=344.4 / 362.8,
 * lineas base y=231.4 y y=219.1, pagina A4 595.32 x 841.92.
 */
import { PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { analyzePdfForPlacement } from '../src/analyzePdf.js';
import { type AutoPlacement, GAP, computeAutoPlacement } from '../src/autoPlacement.js';

const A4: [number, number] = [595.32, 841.92];

/** Una linea de texto en posicion absoluta. El orden del array ES el orden de emision. */
interface Line {
  x: number;
  y: number;
  text: string;
  size?: number;
}

function stream(lines: readonly Line[]): string {
  return lines
    .map((l) => `BT /F1 ${l.size ?? 10} Tf 1 0 0 1 ${l.x} ${l.y} Tm (${l.text}) Tj ET`)
    .join('\n');
}

async function buildPdf(lines: readonly Line[], size: [number, number] = A4): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(size);
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(stream(lines))));
  const font = doc.context.obj({
    Type: 'Font',
    Subtype: 'Type1',
    BaseFont: 'Helvetica',
    Encoding: 'WinAnsiEncoding',
  });
  page.node.set(
    PDFName.of('Resources'),
    doc.context.obj({ Font: doc.context.obj({ F1: doc.context.register(font) }) }),
  );
  return PDFDocument.load(await doc.save()).then((d) => d.save());
}

async function place(
  lines: readonly Line[],
  size: [number, number] = A4,
  existing: ReadonlyArray<{ page: number; x: number; y: number; w: number; h: number }> = [],
  boxW?: number,
): Promise<AutoPlacement> {
  const a = await analyzePdfForPlacement(await buildPdf(lines, size));
  return computeAutoPlacement({
    ...(boxW !== undefined ? { boxW } : {}),
    geometry: a.geometry,
    // Las firmas previas se INYECTAN en vez de firmar el fixture de verdad:
    // lo que se prueba es la colocacion, y firmar de verdad metaria en el test
    // la cadena de certificados entera.
    existing: existing.length > 0 ? existing : a.existing,
    emptySigFields: a.emptySigFields,
    textBands: a.textBands,
    unanalyzedPages: a.unanalyzedPages,
  });
}

/** `EDGE_MARGIN` del motor, replicado aqui: no se exporta y el test lo afirma. */
const EDGE_MARGIN_PT = 18;

/**
 * Como {@link place}, pero con una fuente SIN metricas de ninguna clase: ni
 * `/Widths` propio ni un `/BaseFont` que corresponda a una de las 14 estandar.
 * Sirve para comprobar que sin borde derecho estimado el motor vuelve al
 * comportamiento anterior al centrado en vez de inventarse un centro.
 */
async function placeSinMetricas(lines: readonly Line[]): Promise<AutoPlacement> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(A4);
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(stream(lines))));
  const font = doc.context.obj({
    Type: 'Font',
    Subtype: 'TrueType',
    BaseFont: 'ZZZZZZ+FuenteSinMetricas',
    Encoding: 'WinAnsiEncoding',
  });
  page.node.set(
    PDFName.of('Resources'),
    doc.context.obj({ Font: doc.context.obj({ F1: doc.context.register(font) }) }),
  );
  const bytes = await PDFDocument.load(await doc.save()).then((d) => d.save());
  const a = await analyzePdfForPlacement(bytes);
  return computeAutoPlacement({
    geometry: a.geometry,
    existing: a.existing,
    emptySigFields: a.emptySigFields,
    textBands: a.textBands,
    unanalyzedPages: a.unanalyzedPages,
  });
}

/**
 * Como {@link place}, pero con `/Rotate` en la pagina y/o UNA de las lineas
 * escrita con una fuente sin metricas de ninguna clase (indice
 * `lineaSinMetricas`, 0-based sobre `lines`).
 *
 * Las dos cosas juntas porque prueban la misma frontera desde dos lados: el
 * centrado solo opina cuando SABE, y aqui no sabe.
 */
async function placeVariante(
  lines: readonly Line[],
  rotate = 0,
  lineaSinMetricas?: number,
): Promise<AutoPlacement> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(A4);
  if (rotate !== 0) page.node.set(PDFName.of('Rotate'), doc.context.obj(rotate));
  const contenido = lines
    .map((l, i) => {
      const fuente = lineaSinMetricas === i ? '/F2' : '/F1';
      return `BT ${fuente} ${l.size ?? 10} Tf 1 0 0 1 ${l.x} ${l.y} Tm (${l.text}) Tj ET`;
    })
    .join(String.fromCharCode(10));
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(contenido)));
  const conMetricas = doc.context.register(
    doc.context.obj({
      Type: 'Font',
      Subtype: 'Type1',
      BaseFont: 'Helvetica',
      Encoding: 'WinAnsiEncoding',
    }),
  );
  const sinMetricas = doc.context.register(
    doc.context.obj({
      Type: 'Font',
      Subtype: 'TrueType',
      BaseFont: 'ZZZZZZ+SinMetricas',
      Encoding: 'WinAnsiEncoding',
    }),
  );
  page.node.set(
    PDFName.of('Resources'),
    doc.context.obj({ Font: doc.context.obj({ F1: conMetricas, F2: sinMetricas }) }),
  );
  const a = await analyzePdfForPlacement(
    await PDFDocument.load(await doc.save()).then((d) => d.save()),
  );
  return computeAutoPlacement({
    geometry: a.geometry,
    existing: a.existing,
    emptySigFields: a.emptySigFields,
    textBands: a.textBands,
    unanalyzedPages: a.unanalyzedPages,
  });
}

/** Varias paginas, cada una con sus lineas. Misma fuente y misma tecnica que `buildPdf`. */
async function buildPdfPages(
  pages: ReadonlyArray<readonly Line[]>,
  size: [number, number] = A4,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = doc.context.register(
    doc.context.obj({
      Type: 'Font',
      Subtype: 'Type1',
      BaseFont: 'Helvetica',
      Encoding: 'WinAnsiEncoding',
    }),
  );
  for (const lines of pages) {
    const page = doc.addPage(size);
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(stream(lines))));
    page.node.set(
      PDFName.of('Resources'),
      doc.context.obj({ Font: doc.context.obj({ F1: font }) }),
    );
  }
  return PDFDocument.load(await doc.save()).then((d) => d.save());
}

async function placePages(
  pages: ReadonlyArray<readonly Line[]>,
  size: [number, number],
  existing: ReadonlyArray<{ page: number; x: number; y: number; w: number; h: number }>,
): Promise<AutoPlacement> {
  const a = await analyzePdfForPlacement(await buildPdfPages(pages, size));
  return computeAutoPlacement({
    geometry: a.geometry,
    existing: existing.length > 0 ? existing : a.existing,
    emptySigFields: a.emptySigFields,
    textBands: a.textBands,
    unanalyzedPages: a.unanalyzedPages,
  });
}

/** Como {@link PARRAFO} pero sangrado a 40: mueve el margen del texto de la pagina. */
const PARRAFO_SANGRADO_40: readonly Line[] = [
  { x: 40, y: 465.4, text: 'Y en prueba de conformidad, ambas partes leen el presente' },
  { x: 40, y: 452.0, text: 'documento, que se extiende por duplicado ejemplar, y' },
  { x: 40, y: 438.6, text: 'encontrandolo conforme lo firman en el lugar y fecha indicados.' },
];

/** Parrafo de cierre, identico en todos los fixtures: es quien crea el hueco reservado. */
const PARRAFO: readonly Line[] = [
  { x: 62.9, y: 465.4, text: 'Y en prueba de conformidad, ambas partes leen el presente' },
  { x: 62.9, y: 452.0, text: 'documento, que se extiende por duplicado ejemplar, y' },
  { x: 62.9, y: 438.6, text: 'encontrandolo conforme lo firman en el lugar y fecha indicados.' },
];

// Las dos columnas del contrato real, como piezas separadas para poder
// permutar el ORDEN DE EMISION sin tocar una sola coordenada.
const COL_IZQ: readonly Line[] = [
  { x: 113.7, y: 231.4, text: 'FIRMANTE UNO PEREZ' },
  { x: 140.1, y: 219.1, text: 'EMPRESA UNO SA' },
];
const COL_DCHA: readonly Line[] = [
  { x: 344.4, y: 231.4, text: 'FIRMANTE DOS GOMEZ' },
  { x: 362.8, y: 219.1, text: 'EMPRESA DOS CIA LTDA' },
];

/** Donde empieza la columna del cofirmante: cota dura que la estampa no debe cruzar. */
const ARRANQUE_COL_DCHA = 344.4;

describe('bloque de firma a dos columnas', () => {
  it('la estampa no invade el hueco del cofirmante (columna izquierda emitida primero)', async () => {
    const p = await place([...PARRAFO, ...COL_IZQ, ...COL_DCHA]);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    expect(p.x + p.w).toBeLessThanOrEqual(ARRANQUE_COL_DCHA - GAP / 2 + 0.01);
  });

  it('la estampa no invade el hueco del cofirmante (columna derecha emitida primero)', async () => {
    const p = await place([...PARRAFO, ...COL_DCHA, ...COL_IZQ]);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    expect(p.x + p.w).toBeLessThanOrEqual(ARRANQUE_COL_DCHA - GAP / 2 + 0.01);
  });

  it('una columna con una linea MAS que la otra sigue sin invadir', async () => {
    // El bloque asimetrico: la empresa lleva RUC y la persona natural no. La
    // linea extra es la mas baja del bloque, y de ella sale la `x` de la banda
    // fusionada -- o sea, el ancla se va a la columna DERECHA. Sin este caso,
    // el arreglo parecia bueno anclando a la izquierda de pura casualidad.
    const p = await place([
      ...PARRAFO,
      ...COL_IZQ,
      ...COL_DCHA,
      { x: 362.8, y: 206.8, text: 'RUC 1790012345001' },
    ]);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    expect(p.x + p.w).toBeLessThanOrEqual(ARRANQUE_COL_DCHA - GAP / 2 + 0.01);
  });

  it('el orden de emision del content stream no cambia donde cae la estampa', async () => {
    const izq = await place([...PARRAFO, ...COL_IZQ, ...COL_DCHA]);
    const dcha = await place([...PARRAFO, ...COL_DCHA, ...COL_IZQ]);
    expect(dcha).toEqual(izq);
  });
});

describe('guardas que no dependen de haber detectado columnas', () => {
  it('con dos textos en la misma línea, el orden de emisión tampoco decide el ancla', async () => {
    // Aqui NO hay columnas (117 pt de separacion, por debajo del umbral), asi
    // que el recorte no entra y quien sostiene el determinismo es solo el
    // desempate por `x` de `mergeBands`. Sin el, la `x` de la banda sale de lo
    // que el generador dibujara primero: 62,9 o 180.
    const etiquetaPrimero: readonly Line[] = [
      { x: 62.9, y: 231.4, text: 'Firma:' },
      { x: 180, y: 231.4, text: 'FIRMANTE UNO PEREZ' },
      { x: 62.9, y: 219.1, text: 'Cargo:' },
      { x: 180, y: 219.1, text: 'Gerente General' },
    ];
    const valorPrimero: readonly Line[] = [
      { x: 180, y: 219.1, text: 'Gerente General' },
      { x: 180, y: 231.4, text: 'FIRMANTE UNO PEREZ' },
      { x: 62.9, y: 219.1, text: 'Cargo:' },
      { x: 62.9, y: 231.4, text: 'Firma:' },
    ];
    const a = await place([...PARRAFO, ...etiquetaPrimero]);
    const b = await place([...PARRAFO, ...valorPrimero]);
    expect(b).toEqual(a);
  });

  it('un bloque pegado al borde no se pasa de la cota al acotarlo', async () => {
    // La columna arranca en x=5, por dentro de EDGE_MARGIN (18): la caja se
    // empuja a 18 DESPUES de calcular el hueco disponible. Si el hueco se
    // midiera desde 5, sobrarian esos 13 pt y volverian a ser invasion. Una
    // cota calculada donde la caja no va a estar no es una cota.
    const p = await place([
      ...PARRAFO,
      { x: 5, y: 231.4, text: 'FIRMANTE UNO PEREZ' },
      { x: 250, y: 231.4, text: 'FIRMANTE DOS GOMEZ' },
      { x: 5, y: 219.1, text: 'EMPRESA UNO SA' },
      { x: 250, y: 219.1, text: 'EMPRESA DOS CIA LTDA' },
    ]);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    expect(p.x + p.w).toBeLessThanOrEqual(250 - GAP / 2 + 0.01);
  });
});

describe('control: bloques de UNA sola columna — la estampa se CENTRA sobre el bloque', () => {
  /**
   * Valores CONGELADOS. Nacieron midiendo el motor antes del recorte por
   * columnas (entonces afirmaban "no se mueve nada") y se RE-MIDIERON al
   * centrar la estampa sobre el firmante, que es un cambio deliberado de
   * producto: una firma se pone SOBRE el nombre, no a su izquierda.
   *
   * Cada fila lleva la aritmetica que la explica, y toda es comprobable a
   * mano: el ancho de cada linea sale de los anchos AFM de Helvetica a 10 pt
   * (`standardFontWidths.ts`) y el centro es el punto medio de la union
   * `[min x, max end]` de la columna. La caja se centra ahi; si asi se sale de
   * `[margen del texto, cota derecha]` se DESPLAZA hasta la cota que la
   * aprieta, conservando el ancho; solo si ni desplazada cabe, se encoge.
   *
   * El margen del texto de estos fixtures es 62,9 (lo pone `PARRAFO`), y eso
   * hace que cuatro de las siete filas vuelvan EXACTAMENTE al valor de antes
   * del centrado: un bloque apoyado en el margen izquierdo no se puede centrar
   * sin salirse de la reticula, asi que no se centra. Verificado con pymupdf
   * sobre el fixture renderizado: ninguna caja pisa texto.
   *
   * Lo que estas filas siguen impidiendo: que detectar columnas re-ancle o
   * encoja un bloque de un solo firmante mas de lo que el centrado justifica.
   */
  const CASOS: ReadonlyArray<{
    nombre: string;
    lineas: readonly Line[];
    esperado: { x: number; y: number; w: number };
  }> = [
    {
      // Union [62,9 .. 175,13] -> centro 119,015; centrada, la caja de 240
      // arrancaria en -0,99, muy por delante del margen del texto (62,9). Se
      // desplaza hasta el, y el resultado coincide EXACTAMENTE con el de antes
      // del centrado: sobre un bloque pegado al margen izquierdo esta feature
      // es un no-op, y esta fila lo deja escrito.
      nombre: 'U1 margen izquierdo',
      lineas: [
        { x: 62.9, y: 231.4, text: 'FIRMANTE UNO PEREZ' },
        { x: 62.9, y: 219.1, text: 'EMPRESA UNO SA' },
      ],
      esperado: { x: 62.9, y: 246.9, w: 240 },
    },
    {
      // Union [200 .. 326,23] -> centro 263,115; cabe entera, w sigue en 240.
      // Antes: x=226 (el arranque de la linea mas baja), centrada en 346.
      nombre: 'U2 sangrado',
      lineas: [
        { x: 200, y: 243.7, text: 'El Arrendatario' },
        { x: 214, y: 231.4, text: 'FIRMANTE UNO PEREZ' },
        { x: 226, y: 219.1, text: 'EMPRESA UNO SA' },
      ],
      esperado: { x: 143.115, y: 259.2, w: 240 },
    },
    {
      // Dispara el detector de columnas (dos arranques en la misma linea base,
      // separados 277 pt) y NO debe costar nada: la cota derecha cae en 340 y
      // la caja ya terminaba en 302.9. Es el caso que demuestra que la
      // seguridad viene de que la ACCION sea inofensiva, no de afinar el
      // detector.
      // La primera "columna" son las ETIQUETAS ("Nombre:" 62,9..101,24) y su
      // centro cae en 82,07, a solo 19 pt del margen del texto: la caja se
      // desplaza hasta el margen y queda igual que antes del centrado.
      //
      // Es la fila que mide el COSTE de que el motor no distinga etiqueta de
      // valor desde los arranques de linea (la misma limitacion que ya
      // documenta `columnSplit`) -- pero con la regla de desplazamiento ese
      // coste ya no se paga en ancho: la version que encogia simetrica dejaba
      // aqui 128,14 pt de caja sobre la etiqueta.
      nombre: 'U4 etiqueta y valor en la misma linea',
      lineas: [
        { x: 62.9, y: 231.4, text: 'Nombre:' },
        { x: 340, y: 231.4, text: 'FIRMANTE UNO PEREZ' },
        { x: 62.9, y: 219.1, text: 'Cargo:' },
        { x: 340, y: 219.1, text: 'Gerente General' },
      ],
      esperado: { x: 62.9, y: 246.9, w: 240 },
    },
    {
      // Mismo caso que U4: la primera columna es "Quito, Ecuador"
      // (62,9..129,60), centro 96,25, y la caja se desplaza al margen del
      // texto sin perder ancho.
      nombre: 'U5 ciudad y fecha en la misma linea',
      lineas: [
        { x: 62.9, y: 231.4, text: 'Quito, Ecuador' },
        { x: 430, y: 231.4, text: '26 de agosto de 2026' },
      ],
      esperado: { x: 62.9, y: 246.9, w: 240 },
    },
    {
      // ARMA LA REGLA DE LINEA BASE. Un solo firmante, dos lineas, y sus
      // arranques separados 237 pt -- mas que muchas columnas de verdad. Lo
      // unico que impide leerlo como dos columnas es que cada arranque esta
      // en una linea base DISTINTA. Si alguien afloja esa condicion, este
      // caso se parte y la estampa encoge sin motivo.
      // Sin columnas (lineas base distintas), la union es la del BLOQUE entero:
      // [62,9 .. 386,12] -> centro 224,51, caja de 240 desde 104,51.
      nombre: 'U7 dos lineas lejanas en lineas base distintas',
      lineas: [
        { x: 300, y: 231.4, text: 'EL ARRENDADOR' },
        { x: 62.9, y: 219.1, text: 'FIRMANTE UNO PEREZ' },
      ],
      esperado: { x: 104.51, y: 246.9, w: 240 },
    },
    {
      // ARMA EL UMBRAL. Etiqueta y valor comparten linea base con 117 pt de
      // separacion: por debajo de COLUMN_SPLIT_PT, asi que NO son columnas y
      // la estampa conserva sus 240. Es el unico caso del corpus donde el
      // umbral decide algo; bajarlo a 100 lo parte y encoge la caja a 110.
      // Como NO son columnas, la union cubre etiqueta Y valor
      // ([62,9 .. 292,23] -> centro 177,565). Centrada arrancaria en 57,565,
      // 5,3 pt por delante del margen del texto: se desplaza a 62,9 y queda a
      // 5,3 pt de su centro ideal, con el ancho intacto.
      nombre: 'U8 etiqueta y valor con separacion moderada',
      lineas: [
        { x: 62.9, y: 231.4, text: 'Firma:' },
        { x: 180, y: 231.4, text: 'FIRMANTE UNO PEREZ' },
        { x: 62.9, y: 219.1, text: 'Cargo:' },
        { x: 180, y: 219.1, text: 'Gerente General' },
      ],
      esperado: { x: 62.9, y: 246.9, w: 240 },
    },
    {
      // El falso positivo mas peligroso: un solo firmante con el bloque
      // CENTRADO. Un detector que agrupe arranques por distancia horizontal lo
      // parte en dos y encoge la estampa; el criterio de linea base compartida
      // no, porque aqui cada linea tiene UN solo arranque.
      // El caso que mas gana con el cambio: union [235 .. 347,23] -> centro
      // 291,115 y la caja de 240 desde 171,115, justo encima del bloque. Antes
      // arrancaba en 252 (el sangrado de la linea mas baja) y quedaba centrada
      // en 372, casi un ancho entero a la derecha del firmante.
      nombre: 'U6 centrado tres lineas',
      lineas: [
        { x: 240, y: 243.7, text: 'EL ARRENDADOR' },
        { x: 235, y: 231.4, text: 'FIRMANTE UNO PEREZ' },
        { x: 252, y: 219.1, text: 'EMPRESA UNO SA' },
      ],
      esperado: { x: 171.115, y: 259.2, w: 240 },
    },
  ];

  for (const caso of CASOS) {
    it(`${caso.nombre}: colocacion sin cambios`, async () => {
      const p = await place([...PARRAFO, ...caso.lineas]);
      expect(p.status).toBe('ok');
      if (p.status !== 'ok') return;
      expect(p.x).toBeCloseTo(caso.esperado.x, 5);
      expect(p.y).toBeCloseTo(caso.esperado.y, 5);
      expect(p.w).toBeCloseTo(caso.esperado.w, 5);
    });
  }
});

describe('lo que el recorte NO debe hacer, y lo que todavia no sabe hacer', () => {
  it('nunca estrecha hasta dejar la estampa sin un solo dato del firmante', async () => {
    // Bloque cuya primera columna arranca muy a la derecha (200) mientras el
    // corte cae en 250: el hueco de columna son 43 pt. Recortar hasta ahi
    // produce un rect que PASA la validacion (30x30) y aun asi se firma mudo,
    // porque el bloque de nombre/cedula/fecha arranca en un x fijo y el BBox
    // lo recorta entero. Cambiar "estampa en el hueco del otro" por "estampa
    // sin firmante" es empeorar, y encima en silencio.
    const p = await place([
      ...PARRAFO,
      { x: 40, y: 231.4, text: 'EL ARRENDADOR' },
      { x: 250, y: 231.4, text: 'EL ARRENDATARIO' },
      { x: 200, y: 219.1, text: 'FIRMANTE UNO PEREZ' },
    ]);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    // 78 = el suelo de layout (ver `visibleSigLayoutFloor.test.ts`).
    expect(p.w).toBeGreaterThanOrEqual(78);
  });

  it('LIMITACION: con 4 columnas juntas el detector no dispara y se invade igual', async () => {
    // Cuatro firmantes lado a lado (contratante / contratista / dos testigos)
    // dejan 117 pt entre arranques: por debajo del umbral, asi que no se
    // detectan columnas y la caja sale con los 240 de siempre, invadiendo.
    //
    // No se arregla bajando el umbral: 117 pt es EXACTAMENTE la separacion del
    // control U8 (etiqueta y valor de un solo firmante), asi que desde los
    // arranques de linea los dos casos son indistinguibles por distancia. Este
    // test afirma la limitacion en vez de dejarla muda: el dia que alguien la
    // cierre --contando arranques por fila, o por regularidad del espaciado--
    // este test se cae y obliga a decidir a proposito.
    const p = await place([
      ...PARRAFO,
      { x: 62.9, y: 231.4, text: 'FIRMANTE UNO' },
      { x: 180, y: 231.4, text: 'FIRMANTE DOS' },
      { x: 300, y: 231.4, text: 'FIRMANTE TRES' },
      { x: 420, y: 231.4, text: 'FIRMANTE CUATRO' },
    ]);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    expect(p.w).toBeCloseTo(240, 5);
  });

  it('COSTE ACEPTADO: un solo firmante con el valor a media distancia SI se estrecha', async () => {
    // El valor arranca a 167 pt del ancla: por encima del umbral, asi que se
    // lee como dos columnas en un documento que no tenia nada roto y la
    // estampa se estrecha a su "columna" (230 - GAP/2 - 62,9 = 160,1). El
    // centro de esa columna --las ETIQUETAS-- cae en 82,07 y centrar la caja
    // ahi la sacaria por delante del margen del texto, asi que se desplaza a
    // 62,9: exactamente el mismo rect que antes del centrado. Congelado para
    // que el coste siga siendo visible y siga siendo SOLO el del recorte.
    const p = await place([
      ...PARRAFO,
      { x: 62.9, y: 231.4, text: 'Nombre:' },
      { x: 230, y: 231.4, text: 'FIRMANTE UNO PEREZ' },
      { x: 62.9, y: 219.1, text: 'Cargo:' },
      { x: 230, y: 219.1, text: 'Gerente General' },
    ]);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    expect(p.x).toBeCloseTo(62.9, 5);
    expect(p.w).toBeCloseTo(230 - GAP / 2 - 62.9, 5);
    // Y sigue sin cruzar a la columna del valor.
    expect(p.x + p.w).toBeLessThanOrEqual(230 - GAP / 2 + 0.01);
  });
});

describe('el umbral de columna viaja entre tamaños de página', () => {
  /** A5 vertical. La mitad de ancho que A4, y las columnas caben en menos sitio. */
  const A5: [number, number] = [419.53, 595.28];

  it('A5: dos columnas separadas 145 pt siguen sin invadir', async () => {
    // 145 pt cae POR DEBAJO del umbral absoluto de 150, así que con un valor
    // fijo el detector callaba y la caja de 240 invadía 95 pt el hueco del
    // cofirmante. Es el caso que obliga a que el umbral sea relativo al ancho
    // de la página: en A5 la fracción baja a ~105 y sí lo caza.
    const p = await place(
      [
        { x: 40, y: 330, text: 'Y en prueba de conformidad ambas partes firman' },
        { x: 40, y: 316, text: 'el presente documento por duplicado ejemplar.' },
        { x: 40, y: 150, text: 'FIRMANTE UNO PEREZ' },
        { x: 185, y: 150, text: 'FIRMANTE DOS GOMEZ' },
        { x: 40, y: 137, text: 'EMPRESA UNO SA' },
        { x: 185, y: 137, text: 'EMPRESA DOS CIA LTDA' },
      ],
      A5,
    );
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    expect(p.x + p.w).toBeLessThanOrEqual(185 - GAP / 2 + 0.01);
  });
});

describe('segundo firmante: el documento ya trae una firma', () => {
  /**
   * La forma de un NDA real de dos partes: dos rayas de firma lado a lado, el
   * nombre de cada quien debajo, y la firma del PRIMER firmante ya puesta
   * sobre la raya de la DERECHA.
   *
   * Antes de este arreglo la estampa del segundo se iba a `x = 18` --el borde
   * de la hoja-- y al pie de la pagina, porque un documento con firma previa
   * entra por el anti-solape y alli nadie miraba el bloque de firma. La
   * correccion existia desde que se midio ese defecto, pero estaba encerrada
   * tras `anchor !== undefined`, y en produccion el unico `anchor` es el hint
   * de propagacion del LOTE: no alcanzaba nunca a la firma individual, que es
   * justo donde ocurre el caso.
   */
  const RAYA_IZQ_X = 103;
  const BLOQUE: readonly Line[] = [
    { x: 62.9, y: 400, text: 'Y en prueba de conformidad ambas partes firman el presente' },
    { x: 62.9, y: 386, text: 'documento por duplicado ejemplar en el lugar y fecha indicados.' },
    { x: RAYA_IZQ_X, y: 211.7, text: '_______________________________' },
    { x: 343.9, y: 211.7, text: '_______________________________' },
    { x: 139.2, y: 195.2, text: 'FIRMANTE UNO PEREZ' },
    { x: 382.4, y: 195.2, text: 'FIRMANTE DOS GOMEZ' },
    { x: 148.9, y: 181.8, text: 'C.I. 0000000000' },
    { x: 377.8, y: 181.8, text: 'C.I. 1111111111' },
  ];
  /** La firma que ya esta puesta, sobre la raya derecha. */
  const FIRMA_PREVIA = [{ page: 0, x: 353, y: 220, w: 110, h: 36 }];

  it('la estampa se alinea con la raya libre, no con el borde de la hoja', async () => {
    const p = await place(BLOQUE, A4, FIRMA_PREVIA);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    // Lo que importa: la `x` sale del bloque de firma. `EDGE_MARGIN` (18) es la
    // respuesta de "no supe donde ponerla".
    //
    // Desde el centrado ya no coincide con el arranque de la raya: la caja va
    // CENTRADA sobre la columna izquierda entera (raya 103..264,24, nombre
    // 139,2..251,43, cedula 148,9..218,89 -> union [103 .. 264,24], centro
    // 189,18). El ancho se recorta antes a la columna del cofirmante
    // (343,9 - GAP/2 - 103 = 233,9), asi que arranca en 189,18 - 116,95 =
    // 72,23 -- por delante del margen del texto (62,9), o sea CENTRADA de
    // verdad, sin desplazar. Verificado con pymupdf sobre el fixture: el
    // centro cae a 0,00 pt del centro real y no pisa ni texto ni la firma
    // previa.
    expect(p.x).toBeCloseTo(72.23, 1);
    expect(p.w).toBeCloseTo(233.9, 1);
    expect(p.x + p.w / 2).toBeCloseTo(189.18, 1);
    expect(p.x).toBeGreaterThan(EDGE_MARGIN_PT);
  });

  it('se apoya junto a su raya, en vez de flotar por encima de la firma ajena', async () => {
    // `reservedGapV` razona por franjas de pagina completa: la firma previa
    // del OTRO firmante (u 353..463) levantaba el suelo del hueco para todo el
    // ancho y la estampa quedaba ~40 pt por encima de su raya, mientras la del
    // primero si se apoyaba en la suya. Con el hueco recalculado sobre los
    // obstaculos de LA COLUMNA, la caja baja a top-de-raya + GAP/2.
    //
    // La frontera que separa "se apoya" de "flota": el TOP de la firma previa
    // (y=256). Flotar es quedar por encima de el; apoyarse es quedar por
    // debajo, pegado a la raya.
    const p = await place(BLOQUE, A4, FIRMA_PREVIA);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    const topFirmaPrevia = FIRMA_PREVIA[0]!.y + FIRMA_PREVIA[0]!.h;
    expect(p.y).toBeLessThan(topFirmaPrevia);
  });

  it('no se estampa encima de la firma que ya estaba', async () => {
    const p = await place(BLOQUE, A4, FIRMA_PREVIA);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    const solapa =
      p.x < FIRMA_PREVIA[0]!.x + FIRMA_PREVIA[0]!.w &&
      p.x + p.w > FIRMA_PREVIA[0]!.x &&
      p.y < FIRMA_PREVIA[0]!.y + FIRMA_PREVIA[0]!.h &&
      p.y + p.h > FIRMA_PREVIA[0]!.y;
    expect(solapa).toBe(false);
  });
});

describe('segundo firmante: la columna del cofirmante queda mas cerca que el ancho por defecto', () => {
  /**
   * El mismo NDA de arriba salia bien de casualidad: 103 + 240 = 343 contra
   * una raya vecina en 343,9 -- 0,9 pt de margen que ningun test miraba. En
   * un contrato real con la firma del primero ya puesta, el nombre del
   * cofirmante arrancaba en 275,6 y la estampa (63,9 + 240) colgaba 28 pt
   * encima de el: el camino con firma previa NO pasaba por el recorte de
   * columna que ya tenia el camino sin firmas (`placeOnLastPage`).
   */
  const RAYA_IZQ_X = 103;
  const RAYA_DCHA_X = 300;
  const BLOQUE_ESTRECHO: readonly Line[] = [
    { x: 62.9, y: 400, text: 'Y en prueba de conformidad ambas partes firman el presente' },
    { x: 62.9, y: 386, text: 'documento por duplicado ejemplar en el lugar y fecha indicados.' },
    { x: RAYA_IZQ_X, y: 211.7, text: '________________________' },
    { x: RAYA_DCHA_X, y: 211.7, text: '________________________' },
    { x: 125, y: 195.2, text: 'FIRMANTE UNO PEREZ' },
    { x: 330, y: 195.2, text: 'FIRMANTE DOS GOMEZ' },
    { x: 135, y: 181.8, text: 'C.I. 0000000000' },
    { x: 340, y: 181.8, text: 'C.I. 1111111111' },
  ];
  const FIRMA_PREVIA = [{ page: 0, x: 353, y: 220, w: 110, h: 36 }];

  it('con el ancho por defecto, la estampa se recorta a su columna', async () => {
    const p = await place(BLOQUE_ESTRECHO, A4, FIRMA_PREVIA);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    // Centrada sobre su columna (union [103 .. 236,44], centro 169,72), no
    // apoyada en el arranque de la raya. El ancho es el de la columna
    // (300 - GAP/2 - 103 = 190) y la caja cabe centrada: 169,72 - 95 = 74,72,
    // por delante del margen del texto. Su borde derecho, 264,72, se queda a
    // 28 pt de la cota de la columna vecina.
    expect(p.x).toBeCloseTo(74.72, 1);
    expect(p.w).toBeCloseTo(190, 1);
    expect(p.x + p.w).toBeLessThanOrEqual(RAYA_DCHA_X - GAP / 2 + 0.01);
    // Muy por encima del suelo legible del layout (78).
    expect(p.w).toBeGreaterThanOrEqual(78);
  });

  it('con un ancho ELEGIDO por la persona (hint del lote) no se recorta', async () => {
    // El ancho explicito es una decision de quien firma; el motor no la pisa
    // ni siquiera cuando invade: exactamente el criterio de `placeOnLastPage`.
    const p = await place(BLOQUE_ESTRECHO, A4, FIRMA_PREVIA, 240);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    expect(p.w).toBeCloseTo(240, 5);
    // Ni se recorta NI se centra: el ancla vuelve a ser `bloque.u`, la `x` de
    // la linea mas baja del bloque. Sin afirmar tambien la `x`, un centrado
    // que se colara en este camino pasaria desapercibido -- el ancho no lo
    // delata, porque con la columna sin detectar la caja cabe entera.
    expect(p.x).toBeCloseTo(RAYA_IZQ_X, 1);
  });

  it('con el bloque asimetrico, el ancla sigue en la PRIMERA columna aunque haya firma previa', async () => {
    // El mismo caso que ya cubria el camino sin firmas ("una columna con una
    // linea MAS que la otra"): la linea extra es la mas baja del bloque y de
    // ella sale la `x` de la banda fusionada, o sea, la columna DERECHA. En el
    // anti-solape se anclaba a `bloque.u` a secas y la estampa caia ENTERA
    // sobre el cofirmante con `status:'ok'` (medido por la QA dual: 232,9 pt
    // de invasion). La firma previa va sobre la columna derecha, que es donde
    // ya firmo el otro.
    const p = await place(
      [...PARRAFO, ...COL_IZQ, ...COL_DCHA, { x: 362.8, y: 206.8, text: 'RUC 1790012345001' }],
      A4,
      [{ page: 0, x: 353, y: 250, w: 110, h: 36 }],
    );
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    expect(p.x).toBeLessThan(ARRANQUE_COL_DCHA);
    expect(p.x + p.w).toBeLessThanOrEqual(ARRANQUE_COL_DCHA - GAP / 2 + 0.01);
  });

  it('con la columna vecina a 0,9 pt del ancho por defecto tampoco la roza', async () => {
    // La forma exacta del NDA real: la raya del cofirmante en 343,9.
    const NDA: readonly Line[] = BLOQUE_ESTRECHO.map((l) =>
      l.x === RAYA_DCHA_X ? { ...l, x: 343.9 } : l,
    );
    const p = await place(NDA, A4, FIRMA_PREVIA);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    expect(p.x + p.w).toBeLessThanOrEqual(343.9 - GAP / 2 + 0.01);
  });
});

describe('fila de firmas dentro de la franja del pie', () => {
  /** US Letter: la forma del formulario aduanero real. */
  const LETTER: [number, number] = [612, 792];

  it('cuenta como bloque de firma, no como numero de pagina', async () => {
    // "Firma del Contribuyente / Pagina 2 de 2 / Firma del Declarante" en la
    // misma linea base, a 19 pt del borde: dentro de la franja del pie que
    // `reservedGapV` ignora para no anclar a un numero de pagina aislado. Sin
    // distinguirla, no habia hueco reservado y la estampa caia CENTRADA sobre
    // el numero de pagina, entre las dos etiquetas de firma. Una banda del pie
    // que se parte en columnas es una fila de firmas.
    const p = await place(
      [
        { x: 48, y: 700, text: 'Detalle de Declaracion Aduanera Simplificada' },
        { x: 48, y: 230, text: 'Documentos de acompanamiento: factura comercial' },
        { x: 82, y: 19, text: 'Firma del Contribuyente' },
        // Fuente mas pequena y un punto mas abajo, como en el formulario real:
        // su banda queda por DEBAJO de las etiquetas dentro de la tolerancia de
        // fila. Sin ordenar la fila por `u`, el numero de pagina iba primero,
        // el corte 82->259 salia negativo y el ancla acababa en 259.
        { x: 259, y: 18, text: 'Pagina 2 de 2', size: 8 },
        { x: 408, y: 19, text: 'Firma del Declarante' },
      ],
      LETTER,
    );
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    expect(p.source).toBe('reserved-gap');
    // Sobre la etiqueta del contribuyente, sin cruzar el numero de pagina.
    // El ancho lo fija la columna (259 - GAP/2 - 82 = 170) y la caja cabe
    // CENTRADA sobre la etiqueta (82..188,71 -> centro 135,35): 135,35 - 85 =
    // 50,35, por delante del margen del texto de esta pagina (48). Aqui no
    // acota nadie: ni el margen ni la columna aprietan.
    expect(p.x).toBeCloseTo(50.35, 1);
    expect(p.w).toBeCloseTo(170, 1);
    expect(p.x + p.w / 2).toBeCloseTo(135.35, 1);
    expect(p.x + p.w).toBeLessThanOrEqual(259 - GAP / 2 + 0.01);
  });
});

describe('respaldo: firma previa en una pagina llena, bloque en la ultima', () => {
  it('la segunda firma va al bloque de la ultima pagina, no a needs_review', async () => {
    // La forma de un acta real: el primer firmante estampo en medio del texto
    // de una pagina sin hueco, y el bloque de firmas --con su columna libre--
    // esta en la ultima. Apuntar solo a "la pagina de la firma previa" dejaba
    // el documento apartado con `alsoFits` diciendo que en la ultima si cabia.
    const paginaLlena: Line[] = Array.from({ length: 64 }, (_, i) => ({
      x: 62.9,
      y: 780 - i * 12,
      text: `Linea ${i + 1} del cuerpo del acta, sin un solo hueco de 72 puntos.`,
    }));
    const paginaBloque: Line[] = [...PARRAFO, ...COL_IZQ, ...COL_DCHA];
    const p = await placePages([paginaLlena, paginaBloque], A4, [
      { page: 0, x: 200, y: 400, w: 110, h: 36 },
    ]);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    expect(p.page).toBe(1);
    expect(p.source).toBe('reserved-gap');
    // Centrada sobre la columna izquierda del bloque (union [113,7 .. 230,12],
    // centro 171,91), igual que el mismo bloque sin firma previa. El ancho es
    // el de la columna (344,4 - GAP/2 - 113,7 = 223,7 -> 197,3 desde el ancla
    // ya acotada), asi que arranca en 171,91 - 98,65 = 73,26.
    expect(p.x).toBeCloseTo(73.26, 1);
  });
});

describe('la estampa va CENTRADA sobre el firmante', () => {
  /**
   * El cambio de producto: una firma se pone SOBRE el nombre, no apoyada en su
   * margen izquierdo. Medido en produccion (0.23.4) sobre 8 documentos reales,
   * anclar al arranque del bloque dejaba la caja entre 35 y 88 pt a la derecha
   * del centro del nombre.
   *
   * Las coordenadas de los fixtures estan elegidas para que el centro salga
   * REDONDO y comprobable a mano con los anchos AFM de Helvetica a 10 pt:
   * "FIRMANTE UNO PEREZ" mide 112,23 pt y "EMPRESA UNO SA" 90,02 pt.
   */

  /** Carta de un firmante, con las dos lineas centradas ENTRE SI en x=313. */
  const CARTA_CENTRADA: readonly Line[] = [
    { x: 313 - 112.23 / 2, y: 231.4, text: 'FIRMANTE UNO PEREZ' },
    { x: 313 - 90.02 / 2, y: 219.1, text: 'EMPRESA UNO SA' },
  ];

  it('un firmante con dos lineas centradas: la caja queda centrada sobre la mas larga', async () => {
    const p = await place([...PARRAFO, ...CARTA_CENTRADA]);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    // Las dos lineas comparten centro, asi que el de la union ES el de la mas
    // larga. Tolerancia 2 pt, la misma con la que se acepto sobre los
    // documentos reales.
    expect(p.x + p.w / 2).toBeCloseTo(313, 1);
    expect(Math.abs(p.x + p.w / 2 - 313)).toBeLessThanOrEqual(2);
    // Cabe entera: el ancho no se toca.
    expect(p.w).toBeCloseTo(240, 5);
  });

  it('a dos columnas se centra sobre la PRIMERA, sin cruzar a la del cofirmante', async () => {
    const p = await place([...PARRAFO, ...COL_IZQ, ...COL_DCHA]);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    // Columna izquierda: nombre 113,7..225,93 y empresa 140,1..230,12 ->
    // union [113,7 .. 230,12], centro 171,91. La caja (197,3 de ancho, ya
    // recortada a la columna) cabe centrada ahi sin tocar ninguna cota.
    expect(p.x + p.w / 2).toBeCloseTo(171.91, 1);
    expect(p.x).toBeCloseTo(73.26, 1);
    expect(p.x + p.w).toBeLessThanOrEqual(ARRANQUE_COL_DCHA - GAP / 2 + 0.01);
  });

  it('el centro sale de la PRIMERA columna, no del bloque entero', async () => {
    // MUTACION que mata: si `columnCenterU` ignorara la frontera, la union
    // seria [113,7 .. 483,94] y el centro 298,8 -- dentro de la columna del
    // cofirmante. La cota derecha lo taparia a medias (la caja acabaria
    // recortada), pero el centro delata la mutacion sin ambiguedad.
    const p = await place([...PARRAFO, ...COL_IZQ, ...COL_DCHA]);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    expect(p.x + p.w / 2).toBeLessThan(ARRANQUE_COL_DCHA);
  });

  it('NDA con firma previa: la caja se centra sobre la raya libre, no en su arranque', async () => {
    const RAYA_IZQ_X = 103;
    const BLOQUE: readonly Line[] = [
      { x: 62.9, y: 400, text: 'Y en prueba de conformidad ambas partes firman el presente' },
      { x: 62.9, y: 386, text: 'documento por duplicado ejemplar en el lugar y fecha indicados.' },
      { x: RAYA_IZQ_X, y: 211.7, text: '_______________________________' },
      { x: 343.9, y: 211.7, text: '_______________________________' },
      { x: 139.2, y: 195.2, text: 'FIRMANTE UNO PEREZ' },
      { x: 382.4, y: 195.2, text: 'FIRMANTE DOS GOMEZ' },
      { x: 148.9, y: 181.8, text: 'C.I. 0000000000' },
      { x: 377.8, y: 181.8, text: 'C.I. 1111111111' },
    ];
    const p = await place(BLOQUE, A4, [{ page: 0, x: 353, y: 220, w: 110, h: 36 }]);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    // La raya izquierda va de 103 a 264,24 (31 guiones bajos de 5,2 pt cada
    // uno); es la linea mas larga de su columna, asi que manda en la union.
    // Su centro es 183,62 y el de la union entera (con nombre y cedula) 189,18.
    expect(p.x + p.w / 2).toBeCloseTo(189.18, 1);
    expect(p.x).toBeGreaterThan(EDGE_MARGIN_PT);
    expect(p.x).toBeCloseTo(72.23, 1);
    expect(p.x + p.w).toBeLessThanOrEqual(343.9 - GAP / 2 + 0.01);
  });

  it('con un ancho ELEGIDO por la persona no se centra ni se recorta', async () => {
    // MUTACION que mata: quitar el gate `widthIsDefault`. El hint de
    // propagacion del lote es una decision de quien firma y el motor no la
    // pisa, ni para centrar.
    const p = await place([...PARRAFO, ...COL_IZQ, ...COL_DCHA], A4, [], 240);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    expect(p.w).toBeCloseTo(240, 5);
    // Y con el ancho explicito tampoco se busca la columna: el ancla vuelve a
    // ser `bloque.u`, la `x` de la linea mas baja (140,1), exactamente como
    // antes de que existiera ni el recorte ni el centrado.
    expect(p.x).toBeCloseTo(140.1, 1);
  });

  it('un bloque por delante del margen desplaza la caja, no la encoge', async () => {
    // El bloque arranca en x=20, por delante del margen de `PARRAFO` (62,9),
    // asi que el margen del texto de la pagina es 20 y la caja se desplaza
    // ahi conservando sus 240 -- que es justo lo que hacia antes del centrado.
    const p = await place([...PARRAFO, { x: 20, y: 231.4, text: 'FIRMANTE' }]);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    expect(p.x).toBeCloseTo(20, 1);
    expect(p.w).toBeCloseTo(240, 5);
  });

  it('sin borde derecho estimado en ninguna linea, la colocacion es la de antes', async () => {
    // MUTACION que mata: inventarse un `end` cuando la fuente no tiene
    // metricas. El fixture usa una TrueType sin `/Widths` y con un `/BaseFont`
    // que no es ninguna de las 14 estandar: no hay de donde sacar el avance,
    // asi que `LineStart.end` no existe y el motor NO opina sobre el centro.
    const p = await placeSinMetricas([
      ...PARRAFO,
      { x: 62.9, y: 231.4, text: 'FIRMANTE UNO PEREZ' },
      { x: 62.9, y: 219.1, text: 'EMPRESA UNO SA' },
    ]);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    // Exactamente la fila U1 de antes del centrado.
    expect(p.x).toBeCloseTo(62.9, 5);
    expect(p.w).toBeCloseTo(240, 5);
  });
});

describe('la cota izquierda es el margen del TEXTO, no el del papel', () => {
  /**
   * DECISION del dueno del producto, no una consecuencia de la geometria.
   *
   * La primera version acotaba por `EDGE_MARGIN` (18 pt, el margen del papel)
   * y, para no perder el centro, encogia la caja SIMETRICA. Medido sobre los 8
   * documentos reales, eso dejaba 2 de ellos con la estampa tocando el borde
   * de la hoja y hasta 27 pt mas estrecha, descolgada de todo lo demas que hay
   * escrito. La regla nueva prefiere la reticula del documento: centrar >
   * conservar el ancho > conservar el centro.
   */

  /** El mismo bloque centrado, pero con el cuerpo del documento sangrado a 120. */
  const CUERPO_SANGRADO: readonly Line[] = [
    { x: 120, y: 465.4, text: 'Y en prueba de conformidad, ambas partes leen el presente' },
    { x: 120, y: 452.0, text: 'documento, que se extiende por duplicado ejemplar.' },
  ];

  it('la caja para en el margen del texto, no en el del papel', async () => {
    // MUTACION que mata: devolver `EDGE_MARGIN` en `pageTextLeftU`. El bloque
    // ([120 .. 232,23], centro 176,115) centrado con 240 de ancho arrancaria
    // en 56,115; con la cota del papel la caja se quedaria ahi, 64 pt por
    // delante de todo lo escrito en la pagina.
    const p = await place([...CUERPO_SANGRADO, { x: 120, y: 231.4, text: 'FIRMANTE UNO PEREZ' }]);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    expect(p.x).toBeCloseTo(120, 1);
    expect(p.x).toBeGreaterThan(EDGE_MARGIN_PT);
    // Y conserva el ancho: desplazar es preferible a encoger.
    expect(p.w).toBeCloseTo(240, 5);
  });

  it('desplazar gana a encoger: la caja no pierde ancho por descentrarse', async () => {
    // MUTACION que mata: volver a encoger simetrico
    // (`2*min(centro-izq, dcha-centro)`). Aqui daria 2*(176,115-120) = 112,23
    // en vez de 240.
    const p = await place([...CUERPO_SANGRADO, { x: 120, y: 231.4, text: 'FIRMANTE UNO PEREZ' }]);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    expect(p.w).toBeCloseTo(240, 5);
  });

  it('encoger es el ULTIMO recurso: solo cuando no cabe ni pegada a la cota', async () => {
    // Bloque a dos columnas cuyo hueco (cota derecha - margen del texto) es
    // menor que el ancho por defecto: 250 - GAP/2 - 40 = 203. La caja se
    // encoge a 203 y arranca en el margen del texto.
    const p = await place([
      ...PARRAFO_SANGRADO_40,
      { x: 40, y: 231.4, text: 'EL ARRENDADOR' },
      { x: 250, y: 231.4, text: 'EL ARRENDATARIO' },
      { x: 200, y: 219.1, text: 'FIRMANTE UNO PEREZ' },
    ]);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    expect(p.x).toBeCloseTo(40, 1);
    expect(p.w).toBeCloseTo(203, 1);
    expect(p.x + p.w).toBeLessThanOrEqual(250 - GAP / 2 + 0.01);
  });

  it('si ni encogiendo llega al suelo legible, manda el comportamiento de siempre', async () => {
    // MUTACION que mata: quitar el suelo `MIN_LEGIBLE_SIG_WIDTH`. Un documento
    // cuyo texto vive entero pegado al borde derecho deja un hueco de
    // 577,32 - 520 = 57,32 pt, por debajo del suelo de layout (78) donde la
    // estampa se firma MUDA porque el BBox recorta el bloque de datos entero.
    // Ahi se abandona el centrado y vuelve la alineacion de siempre.
    const p = await place([
      { x: 520, y: 465.4, text: 'Conforme' },
      { x: 520, y: 452.0, text: 'y firmado' },
      { x: 520, y: 231.4, text: 'FIRMANTE' },
    ]);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    // Sin centrar: el ancla de siempre, ya acotada a la pagina.
    expect(p.w).toBeCloseTo(240, 5);
    expect(p.x).toBeCloseTo(337.32, 1);
  });
});

describe('cuando el centrado NO tiene derecho a opinar', () => {
  /** El bloque centrado de U6: el que mas se mueve cuando el centrado actua. */
  const BLOQUE_CENTRADO: readonly Line[] = [
    ...PARRAFO,
    { x: 240, y: 243.7, text: 'EL ARRENDADOR' },
    { x: 235, y: 231.4, text: 'FIRMANTE UNO PEREZ' },
    { x: 252, y: 219.1, text: 'EMPRESA UNO SA' },
  ];

  it('con /Rotate 90 la colocacion no se mueve', async () => {
    // El gate `rotate in {0,180}` de `columnCenterU` existe porque con 90 o
    // 270 grados el borde derecho estimado —que vive en el eje X de la
    // PAGINA— deja de decir nada sobre la `u` canonica, y no basta con
    // confiar en que `seg.w` salga 0: el rect que se canonicaliza lleva
    // `h: 1`, y con 90 grados esa altura se filtra al eje `u`, asi que
    // `seg.w` sale 1 y una "guarda implicita" no gatearia nada.
    //
    // HONESTIDAD SOBRE LO QUE ESTE TEST PRUEBA: es un ancla de regresion, no
    // un cazador de esa mutacion. Medido al escribirlo, en una pagina rotada
    // `reservedGapV` no encuentra hueco reservado con ninguno de los layouts
    // que se probaron (source sale siempre `free-space`), asi que el camino
    // anclado al bloque —y con el, todo el centrado— ni se ejecuta: quitar el
    // gate no cambia el resultado. El gate se conserva igualmente porque un
    // documento rotado REAL si puede llegar ahi, y entonces el centro saldria
    // de sumar alturas. Queda anotado como no cubierto.
    const p = await placeVariante(BLOQUE_CENTRADO, 90);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    expect(p.x).toBeCloseTo(505.32, 1);
    expect(p.w).toBeCloseTo(72, 1);
  });

  it('con /Rotate 180 SI se centra: el eje horizontal sigue siendo horizontal', async () => {
    // El control del gate: 180 invierte el eje pero no lo cambia de sitio, y
    // canonicalizar el segmento entero lo resuelve. Un gate que rechazara
    // "cualquier rotacion" apagaria el centrado donde si vale.
    const p = await placeVariante(BLOQUE_CENTRADO, 180);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    expect(p.x).toBeCloseTo(18, 1);
    expect(p.w).toBeCloseTo(235, 1);
  });

  it('con evidencia PARCIAL no se centra: la colocacion es la de antes del centrado', async () => {
    // MUTACION que mata: en `columnCenterU`, saltarse los arranques sin `end`
    // en vez de abandonar. La union saldria corta por la derecha y el centro
    // se correria a la izquierda sin que nada avisara -- un centro sesgado se
    // ve igual que uno bueno.
    //
    // El fixture es el bloque centrado con la linea del NOMBRE (indice 4)
    // escrita en una fuente sin metricas: el resto de la columna si tiene
    // borde derecho. Reproducido en la revision con un documento real: la
    // unica diferencia era un guion medio en el nombre y la `x` se movia
    // 74 pt.
    const p = await placeVariante(BLOQUE_CENTRADO, 0, 4);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    // El ancla de siempre: la `x` de la linea mas baja del bloque.
    expect(p.x).toBeCloseTo(252, 1);
    expect(p.w).toBeCloseTo(240, 5);
  });

  it('control: el MISMO bloque con todas las lineas medidas SI se centra', async () => {
    const p = await placeVariante(BLOQUE_CENTRADO, 0);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    expect(p.x).toBeCloseTo(171.115, 1);
  });
});
