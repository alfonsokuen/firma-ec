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

async function buildPdf(lines: readonly Line[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(A4);
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

async function place(lines: readonly Line[]): Promise<AutoPlacement> {
  const a = await analyzePdfForPlacement(await buildPdf(lines));
  return computeAutoPlacement({
    geometry: a.geometry,
    existing: a.existing,
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

  it('el orden de emision del content stream no cambia donde cae la estampa', async () => {
    const izq = await place([...PARRAFO, ...COL_IZQ, ...COL_DCHA]);
    const dcha = await place([...PARRAFO, ...COL_DCHA, ...COL_IZQ]);
    expect(dcha).toEqual(izq);
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
