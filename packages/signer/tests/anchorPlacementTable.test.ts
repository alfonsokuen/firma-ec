/**
 * anchorPlacementTable.test.ts — TERCERA tabla congelada, `CURRENT_WITH_ANCHORS`.
 *
 * Las dos tablas de `textBandsPlacement.test.ts` (`LEGACY_WITHOUT_BANDS`,
 * `CURRENT_WITH_BANDS`) NO se tocan — están congeladas sobre el corpus real y
 * ninguna de sus entradas depende de si hay `anchorSpec` (la FASE 3 es
 * puramente opt-in, ver `autoPlacement.ts`: "sin `anchor` ⇒ comportamiento
 * IDÉNTICO"). Por eso esta tabla usa fixtures SINTÉTICOS con texto de ancla
 * conocido — el corpus real no trae un nombre/cédula que podamos verificar, y
 * "Firma" aparece o no por azar en documentos que no controlamos.
 *
 * Cada fixture se calcula DOS veces: `BASELINE_SIN_ANCLA` (el pipeline de la
 * FASE 2, `anchor` ausente) y `CURRENT_WITH_ANCHORS` (con `anchorSpec`
 * conectado de punta a punta: `analyzePdfForPlacement` → `computeAnchorPlacement`
 * → `computeAutoPlacement`). El delta entre las dos tablas se cuenta y se
 * explica ENTRADA A ENTRADA, igual que las 10 diferencias que documenta
 * `CURRENT_WITH_BANDS` sobre `LEGACY_WITHOUT_BANDS`.
 */
import { PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { analyzePdfForPlacement } from '../src/analyzePdf.js';
import { computeAnchorPlacement } from '../src/anchorPlacement.js';
import { type AnchorPlacementHint, computeAutoPlacement } from '../src/autoPlacement.js';

interface Fixture {
  name: string;
  content: string;
  signerName?: string;
  cedula?: string;
}

/** PDF de una página con un solo font WinAnsi, contenido escrito a mano. */
async function buildPdf(content: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 792]); // angosto A PROPÓSITO — ver anchorPlacement.test.ts.
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(content)));
  const font = doc.context.obj({
    Type: 'Font',
    Subtype: 'Type1',
    BaseFont: 'Helvetica',
    Encoding: 'WinAnsiEncoding',
  });
  const resources = doc.context.obj({ Font: doc.context.obj({ F1: doc.context.register(font) }) });
  page.node.set(PDFName.of('Resources'), resources);
  return PDFDocument.load(await doc.save()).then((d) => d.save());
}

const FIXTURES: Fixture[] = [
  {
    // Cláusula que CITA el nombre a media página, y el bloque de firma real
    // (con el mismo nombre repetido) abajo del todo. El ancla debe elegir el
    // bloque de ABAJO, no la mención de la cláusula — mismo criterio que
    // `anchorPlacement.test.ts`.
    name: 'nombre-en-clausula-y-firma-abajo',
    content:
      'BT /F1 12 Tf 1 0 0 1 20 500 Tm (El Sr. Juan Perez declara lo siguiente) Tj ET ' +
      'BT /F1 12 Tf 1 0 0 1 20 40 Tm (Firma: Juan Perez) Tj ET',
    signerName: 'Juan Perez',
  },
  {
    // Solo una etiqueta genérica "Firma", sin nombre/cédula que la respalde.
    name: 'solo-etiqueta-generica',
    content:
      'BT /F1 12 Tf 1 0 0 1 20 500 Tm (Contrato de servicios) Tj ET ' +
      'BT /F1 12 Tf 1 0 0 1 20 40 Tm (Firma) Tj ET',
  },
  {
    // Contrato bipartito: dos "Firma" genéricas, sin nombre en ningún sitio.
    name: 'bipartito-ambiguo',
    content:
      'BT /F1 12 Tf 1 0 0 1 20 400 Tm (Firma) Tj ET ' +
      'BT /F1 12 Tf 1 0 0 1 20 40 Tm (Firma) Tj ET',
  },
  {
    // Cédula con etiqueta partida "C.I." + los 10 dígitos, justo debajo del
    // párrafo — no hay signerName, solo cedula.
    name: 'solo-cedula-con-etiqueta',
    content:
      'BT /F1 12 Tf 1 0 0 1 20 500 Tm (Contrato de arrendamiento) Tj ET ' +
      'BT /F1 12 Tf 1 0 0 1 20 40 Tm (C.I. 0912345678) Tj ET',
    cedula: '0912345678',
  },
  {
    // Sin ninguna ancla en el texto: ni "Firma", ni el nombre, ni la cédula.
    // El pipeline con ancla debe comportarse IDÉNTICO al de sin ancla.
    name: 'sin-ninguna-ancla',
    content: 'BT /F1 12 Tf 1 0 0 1 20 500 Tm (Clausula primera del contrato) Tj ET',
    signerName: 'Maria Lopez',
    cedula: '0912345678',
  },
];

async function computeBaseline(f: Fixture): Promise<string> {
  const bytes = await buildPdf(f.content);
  const analysis = await analyzePdfForPlacement(bytes);
  const placement = computeAutoPlacement({
    geometry: analysis.geometry,
    existing: analysis.existing,
    emptySigFields: analysis.emptySigFields,
    textBands: analysis.textBands,
    unanalyzedPages: analysis.unanalyzedPages,
  });
  return describePlacement(placement);
}

async function computeWithAnchor(f: Fixture): Promise<string> {
  const bytes = await buildPdf(f.content);
  const anchorSpec = {
    ...(f.signerName ? { signerName: f.signerName } : {}),
    ...(f.cedula ? { cedula: f.cedula } : {}),
  };
  const analysis = await analyzePdfForPlacement(bytes, { anchorSpec });
  const choice = analysis.anchors
    ? computeAnchorPlacement(analysis.anchors.hits, analysis.geometry)
    : undefined;
  const anchor: AnchorPlacementHint | undefined = choice
    ? {
        page: choice.page,
        preferredV: choice.preferredV,
        preferredU: choice.preferredU,
        kind: choice.kind,
      }
    : undefined;
  const placement = computeAutoPlacement({
    geometry: analysis.geometry,
    existing: analysis.existing,
    emptySigFields: analysis.emptySigFields,
    textBands: analysis.textBands,
    unanalyzedPages: analysis.unanalyzedPages,
    ...(anchor ? { anchor } : {}),
  });
  return describePlacement(placement);
}

function describePlacement(p: ReturnType<typeof computeAutoPlacement>): string {
  return p.status === 'ok'
    ? `ok p${p.page} x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} ${p.source}${p.anchorKind ? `(${p.anchorKind})` : ''}`
    : `REVIEW p${p.page} ${p.reason}`;
}

/**
 * Tabla congelada SIN ancla (`anchorSpec` ausente) — el pipeline de la FASE 2
 * tal cual, sobre estos mismos fixtures sintéticos. Referencia para medir el
 * delta que introduce el ancla.
 */
const BASELINE_SIN_ANCLA: Record<string, string> = {
  'nombre-en-clausula-y-firma-abajo': 'ok p0 x=30.0 y=57.2 free-space',
  'solo-etiqueta-generica': 'ok p0 x=30.0 y=57.2 free-space',
  'bipartito-ambiguo': 'ok p0 x=30.0 y=57.2 free-space',
  'solo-cedula-con-etiqueta': 'ok p0 x=30.0 y=57.2 free-space',
  'sin-ninguna-ancla': 'ok p0 x=30.0 y=18.0 free-space',
};

/**
 * Tabla congelada CON ancla. Dos de las cinco difieren de la línea base —eso
 * es exactamente lo que el ancla decide cuándo actuar— y se explica cada una.
 * En estos fixtures `reservedGapV` (el criterio SIN ancla, "el hueco que el
 * documento dejó encima del bloque final") y el ancla personalizada
 * coinciden en la MISMA altura `y=57.2` — ambos miran, por caminos distintos,
 * el mismo bloque de abajo. Lo que SÍ cambia, y es la parte medible:
 *
 *  - `x`: `free-space` centra la estampa en la hoja (`x=30.0`, `centeredU`);
 *    `text-anchor` la alinea con el MARGEN IZQUIERDO del bloque de ancla
 *    (`x=20.0`) — la persona firma sobre el margen de su nombre, no en medio
 *    del papel.
 *  - `source`: pasa de `free-space` (un hueco que resultó estar libre) a
 *    `text-anchor` (el documento DIJO dónde firmar) — información que antes
 *    no existía y que el clasificador de confianza usa para NO evaluar
 *    `hueco_unico`/`hueco_justo` en un ancla personalizada honrada (son la
 *    misma tautología estructural que `reserved-gap`, ver
 *    `placementConfidence.ts`).
 *
 * `solo-etiqueta-generica` y `bipartito-ambiguo` (ancla GENÉRICA, sin nombre
 * ni cédula) YA NO difieren de la línea base — y esa es la corrección medida
 * en el corpus real (1.458 PDFs), no una regresión de esta tabla. Antes de
 * este fix, la ancla genérica tenía prioridad INCONDICIONAL sobre
 * `free-space` (rama 2.5, eliminada): en estos dos fixtures `free-space` YA
 * encontraba el mismo hueco (`y=57.2`) por su cuenta, así que anteponer el
 * ancla no cerraba ningún documento sin colocación — solo desplazaba `x` de
 * 30.0 a 20.0 y cambiaba `source` a `text-anchor`, empujando la estampa más
 * cerca del propio texto del ancla y bajando la confianza `alta` medida de
 * 62,2% a 59,6% en los 1.315 documentos que ya se colocaban bien. Ahora la
 * ancla genérica es un RESCATE (`rescueWithGenericAnchor`, `autoPlacement.ts`)
 * que solo se prueba cuando el pipeline normal devuelve `no_free_slot` — aquí
 * `free-space` sí encuentra hueco, así que el rescate ni se invoca. Cubierto
 * end-to-end en `anchorRescue.test.ts`, que sí ejercita el caso donde
 * `free-space` falla y el rescate entra.
 *
 *  - `bipartito-ambiguo`: dos "Firma" genéricas SIN ningún dato personalizado
 *    en el documento. La POSICIÓN es la misma que `solo-etiqueta-generica`
 *    (mismo criterio de "bloque más bajo" de `free-space`), y
 *    `computeAnchorPlacement` sigue marcando la señal `ancla_ambigua` en
 *    `AnchorChoice.signals` (verificado en `anchorPlacement.test.ts`) — esa
 *    señal ya no tiene efecto en la posición porque el ancla genérica no
 *    llegó a intervenir aquí.
 *  - `sin-ninguna-ancla`: NINGUNA ancla en el texto (ni "Firma", ni el
 *    nombre, ni la cédula) ⇒ `computeAnchorPlacement` devuelve `undefined`,
 *    `computeAutoPlacement` no recibe `anchor`, y el resultado es EXACTO al
 *    de la línea base — la prueba de que el ancla nunca inventa un sitio que
 *    el documento no ofreció.
 */
const CURRENT_WITH_ANCHORS: Record<string, string> = {
  'nombre-en-clausula-y-firma-abajo': 'ok p0 x=20.0 y=57.2 text-anchor(firmante-nombre)',
  'solo-etiqueta-generica': 'ok p0 x=30.0 y=57.2 free-space',
  'bipartito-ambiguo': 'ok p0 x=30.0 y=57.2 free-space',
  'solo-cedula-con-etiqueta': 'ok p0 x=20.0 y=57.2 text-anchor(firmante-cedula)',
  'sin-ninguna-ancla': 'ok p0 x=30.0 y=18.0 free-space',
};

describe('BASELINE_SIN_ANCLA — el pipeline de la FASE 2, sin anchorSpec', () => {
  for (const f of FIXTURES) {
    it(f.name, async () => {
      expect(await computeBaseline(f)).toBe(BASELINE_SIN_ANCLA[f.name]);
    });
  }
});

describe('CURRENT_WITH_ANCHORS — de punta a punta con anchorSpec', () => {
  for (const f of FIXTURES) {
    it(f.name, async () => {
      expect(await computeWithAnchor(f)).toBe(CURRENT_WITH_ANCHORS[f.name]);
    });
  }
});

describe('el delta entre las dos tablas está medido y es el esperado', () => {
  it('difieren en exactamente 2 de 5 (anclas PERSONALIZADAS) — la genérica ya no preempta free-space', async () => {
    const distintos = Object.keys(CURRENT_WITH_ANCHORS).filter(
      (k) => CURRENT_WITH_ANCHORS[k] !== BASELINE_SIN_ANCLA[k],
    );
    expect(distintos.sort()).toEqual(
      ['nombre-en-clausula-y-firma-abajo', 'solo-cedula-con-etiqueta'].sort(),
    );
  });

  it('"sin-ninguna-ancla" es IDÉNTICO en las dos tablas: sin ancla en el texto, cero efecto', () => {
    expect(CURRENT_WITH_ANCHORS['sin-ninguna-ancla']).toBe(BASELINE_SIN_ANCLA['sin-ninguna-ancla']);
  });
});
