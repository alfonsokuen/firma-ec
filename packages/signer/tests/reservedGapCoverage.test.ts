import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
/**
 * reservedGapCoverage — que la fuente `reserved-gap` la EJERZA el motor.
 *
 * Los tres tests de `placementConfidence.test.ts` construyen `source:
 * 'reserved-gap'` a mano, así que nadie ejercita la detección. Medido por un
 * revisor: con `inReservedGap = false` cableado, los 152 tests de colocación
 * seguían verdes — el corpus de fixtures del repo no produce ni una colocación
 * de esta fuente, y sus mutantes sobreviven.
 *
 * Los 25 documentos reales que sí la producen NO pueden entrar aquí: son
 * contratos, una demanda de divorcio y cédulas de personas. Así que se
 * reconstruye la GEOMETRÍA medida sobre ellos —claro de 98-135 pt, bloque de
 * 1-3 líneas y ≤48 pt de alto— con documentos sintéticos, y se recorre la
 * tubería de verdad: `analyzePdfForPlacement` → `computeAutoPlacement`.
 */
import { describe, expect, it } from 'vitest';
import { analyzePdfForPlacement } from '../src/analyzePdf.js';
import { computeAutoPlacement } from '../src/autoPlacement.js';
import { classifyPlacement } from '../src/placementConfidence.js';

/** Renglones en las alturas dadas. El texto es de relleno y da igual cuál sea. */
async function paginaCon(lineas: readonly number[], extra?: (p: any, f: any) => void) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const y of lineas) {
    page.drawText('Lorem ipsum dolor sit amet consectetur adipiscing elit', {
      x: 72,
      y,
      size: 11,
      font,
      color: rgb(0, 0, 0),
    });
  }
  extra?.(page, font);
  return new Uint8Array(await doc.save());
}

async function colocar(bytes: Uint8Array) {
  const a = await analyzePdfForPlacement(bytes);
  const placement = computeAutoPlacement({
    geometry: a.geometry,
    existing: a.existing,
    emptySigFields: a.emptySigFields,
    textBands: a.textBands,
    ...(a.failure ? { failure: a.failure } : {}),
  });
  const confidence = classifyPlacement({
    placement,
    geometry: a.geometry,
    textBands: a.textBands,
    unanalyzedPages: a.unanalyzedPages,
    imageOnlyPages: a.imageOnlyPages,
    ocrOnlyPages: a.ocrOnlyPages,
  });
  return { placement, confidence };
}

/** Párrafo arriba, claro, bloque de firma de dos renglones, número de página. */
const CARTA = [
  700, 682, 664, 646, 628, 610, 592, 574, 556, 538, 520, 502, 484, 466, 448, 430, 412, 394, 376,
  358, 340, 230, 212, 30,
];

describe('la fuente reserved-gap la produce el MOTOR, no el test', () => {
  it('una carta con hueco reservado sale por esa fuente', async () => {
    // Sin este aserto, `inReservedGap` puede cablearse a `false` y toda la
    // suite sigue verde: es lo que un revisor midió y lo que este test cierra.
    const { placement } = await colocar(await paginaCon(CARTA));
    expect(placement.status).toBe('ok');
    if (placement.status !== 'ok') return;
    expect(placement.source).toBe('reserved-gap');
    // La estampa va ENCIMA del bloque de firma, no debajo: ese fue el bug que
    // motivó saltarse la franja de pie.
    expect(placement.y).toBeGreaterThan(242);
    expect(placement.y + placement.h).toBeLessThan(340);
  });

  it('sin claro suficiente NO se reclama la fuente', async () => {
    // El otro lado: texto corrido hasta abajo, sin hueco que reservar. Si esto
    // también saliera `reserved-gap`, la fuente no significaría nada.
    const corrido = Array.from({ length: 40 }, (_, i) => 700 - i * 18);
    const { placement } = await colocar(await paginaCon(corrido));
    if (placement.status === 'ok') expect(placement.source).not.toBe('reserved-gap');
  });

  it('un claro enorme a media hoja SIGUE emitiendo alguna duda', async () => {
    // El caso refutado por los dos revisores: `reservedGapV` no comprueba que el
    // hueco sea un área de firma —solo que no haya bandas—, así que un salto de
    // sección lo reclama igual. Mientras eso siga abierto, lo que este test
    // sujeta es que la exención NO lo dejó mudo: tiene que salir con motivo.
    const salto = [780, 762, 744, 726, 708, 690, 300, 282, 264, 246, 30];
    const { placement, confidence } = await colocar(await paginaCon(salto));
    expect(placement.status).toBe('ok');
    expect(confidence.reasons.length).toBeGreaterThan(0);
    expect(confidence.level).not.toBe('alta');
  });
});
