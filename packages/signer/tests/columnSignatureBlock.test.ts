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

describe('control: bloques de UNA sola columna no deben moverse', () => {
  /**
   * Valores CONGELADOS midiendo el motor ANTES del arreglo. No son un adorno:
   * el riesgo real de detectar columnas es re-anclar o encoger un bloque de un
   * solo firmante, y estas cinco filas son las que lo impiden. Si el arreglo
   * mueve una sola, es una regresion, no una mejora.
   */
  const CASOS: ReadonlyArray<{
    nombre: string;
    lineas: readonly Line[];
    esperado: { x: number; y: number; w: number };
  }> = [
    {
      nombre: 'U1 margen izquierdo',
      lineas: [
        { x: 62.9, y: 231.4, text: 'FIRMANTE UNO PEREZ' },
        { x: 62.9, y: 219.1, text: 'EMPRESA UNO SA' },
      ],
      esperado: { x: 62.9, y: 246.9, w: 240 },
    },
    {
      nombre: 'U2 sangrado',
      lineas: [
        { x: 200, y: 243.7, text: 'El Arrendatario' },
        { x: 214, y: 231.4, text: 'FIRMANTE UNO PEREZ' },
        { x: 226, y: 219.1, text: 'EMPRESA UNO SA' },
      ],
      esperado: { x: 226, y: 259.2, w: 240 },
    },
    {
      // Dispara el detector de columnas (dos arranques en la misma linea base,
      // separados 277 pt) y NO debe costar nada: la cota derecha cae en 340 y
      // la caja ya terminaba en 302.9. Es el caso que demuestra que la
      // seguridad viene de que la ACCION sea inofensiva, no de afinar el
      // detector.
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
      nombre: 'U7 dos lineas lejanas en lineas base distintas',
      lineas: [
        { x: 300, y: 231.4, text: 'EL ARRENDADOR' },
        { x: 62.9, y: 219.1, text: 'FIRMANTE UNO PEREZ' },
      ],
      esperado: { x: 62.9, y: 246.9, w: 240 },
    },
    {
      // ARMA EL UMBRAL. Etiqueta y valor comparten linea base con 117 pt de
      // separacion: por debajo de COLUMN_SPLIT_PT, asi que NO son columnas y
      // la estampa conserva sus 240. Es el unico caso del corpus donde el
      // umbral decide algo; bajarlo a 100 lo parte y encoge la caja a 110.
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
      nombre: 'U6 centrado tres lineas',
      lineas: [
        { x: 240, y: 243.7, text: 'EL ARRENDADOR' },
        { x: 235, y: 231.4, text: 'FIRMANTE UNO PEREZ' },
        { x: 252, y: 219.1, text: 'EMPRESA UNO SA' },
      ],
      esperado: { x: 252, y: 259.2, w: 240 },
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
    // El valor arranca a 167 pt del ancla: por encima del umbral y por debajo
    // de `boxW + GAP/2` (247), asi que el recorte ocurre en un documento que
    // no tenia nada roto y la estampa sale mas estrecha (el nombre puede
    // truncarse). Se acepta porque a esa distancia es indistinguible de dos
    // columnas de verdad, y de los dos errores posibles este es el barato.
    // Congelado para que el coste sea visible y no una sorpresa.
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
    expect(p.x).toBeCloseTo(RAYA_IZQ_X, 1);
    expect(p.x).toBeGreaterThan(18);
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
    expect(p.x).toBeCloseTo(RAYA_IZQ_X, 1);
    expect(p.x + p.w).toBeLessThanOrEqual(RAYA_DCHA_X - GAP / 2 + 0.01);
    // Recortada, pero por encima del suelo legible del layout (78).
    expect(p.w).toBeGreaterThanOrEqual(78);
  });

  it('con un ancho ELEGIDO por la persona (hint del lote) no se recorta', async () => {
    // El ancho explicito es una decision de quien firma; el motor no la pisa
    // ni siquiera cuando invade: exactamente el criterio de `placeOnLastPage`.
    const p = await place(BLOQUE_ESTRECHO, A4, FIRMA_PREVIA, 240);
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;
    expect(p.w).toBe(240);
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
    expect(p.x).toBeCloseTo(82, 1);
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
    expect(p.x).toBeCloseTo(140.1, 1);
  });
});
