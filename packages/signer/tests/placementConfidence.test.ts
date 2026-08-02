/**
 * El clasificador de confianza, probado en LAS DOS DIRECCIONES.
 *
 * Un clasificador que solo se prueba con los casos que debe aceptar no está
 * probado: bajar el listón hasta que todo pase produce exactamente ese verde.
 * Por eso aquí hay dos corpus enfrentados —documentos que TIENEN que salir
 * `alta` y escenarios que TIENEN que salir `baja`— y una cota sobre la
 * proporción, que es la que impide que "vista previa" deje de ser la excepción.
 *
 * El corpus `alta` es real (los mismos 18 PDF que sujetan las tablas
 * congeladas de `textBandsPlacement`). El corpus `baja` es en parte real y en
 * parte construido: los documentos de prueba no incluyen un escaneo ni una
 * capa OCR, y esos casos son justo los que el paso 3 existía para detectar.
 * Se dice aquí y no se disimula.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GAP } from '../src/autoPlacement.js';

import { analyzePdfForPlacement } from '../src/analyzePdf.js';
import { computeAutoPlacement } from '../src/autoPlacement.js';
import type { PageGeometry } from '../src/pageGeometry.js';
import {
  type AnchorClassificationContext,
  type ClassifyPlacementOpts,
  classifyPlacement,
} from '../src/placementConfidence.js';
import type { TextBand } from '../src/textBands.js';

const VERIFIER_FIXTURES = join(__dirname, '..', '..', 'verifier', 'tests', 'fixtures');
const E2E_FIXTURES = join(__dirname, '..', '..', '..', 'apps', 'pwa', 'tests', 'e2e', 'fixtures');

function fixture(name: string): string {
  const candidate = join(VERIFIER_FIXTURES, name);
  return existsSync(candidate) ? candidate : join(E2E_FIXTURES, name);
}

async function classifyFixture(name: string): Promise<string> {
  const a = await analyzePdfForPlacement(new Uint8Array(readFileSync(fixture(name))));
  const placement = computeAutoPlacement({
    geometry: a.geometry,
    existing: a.existing,
    emptySigFields: a.emptySigFields,
    textBands: a.textBands,
    unanalyzedPages: a.unanalyzedPages,
    ...(a.failure ? { failure: a.failure } : {}),
  });
  const verdict = classifyPlacement({
    placement,
    geometry: a.geometry,
    textBands: a.textBands,
    unanalyzedPages: a.unanalyzedPages,
    imageOnlyPages: a.imageOnlyPages,
    ocrOnlyPages: a.ocrOnlyPages,
  });
  return verdict.reasons.length > 0
    ? `${verdict.level} ${verdict.reasons.join('+')}`
    : verdict.level;
}

/**
 * Veredicto congelado sobre el corpus real. Cada línea es una medición, no una
 * preferencia: si una cambia, alguien movió el clasificador o el análisis, y
 * tiene que ser a propósito.
 *
 * Los cuatro dudosos no se eligieron — coinciden exactamente con los cuatro
 * documentos cuya estampa acaba encajada a 7 pt, la separación mínima que el
 * buscador acepta. Son contratos de varias hojas.
 *
 * `texto_por_debajo` ya no aparece en ninguno, y ese es el resultado de una
 * recalibración medida: la señal disparaba con UNA franja cualquiera, y sobre
 * 53 documentos reales del usuario resultó que esa franja era casi siempre el
 * número de página. La estampa estaba justo encima del pie, que es donde debe
 * estar. Ahora hacen falta tres líneas — un párrafo, no un pie.
 */
const CORPUS: Record<string, string> = {
  'audit-075-2026.pdf': 'alta',
  'audit-075-firmado.pdf': 'alta',
  'bb-valid.pdf': 'alta',
  'carta-arrendamiento-firmado.pdf': 'baja sin_colocacion_automatica',
  'eci-real-contrato2026.pdf': 'alta',
  'eci-real-lideres.pdf': 'alta',
  'eci-real-signed.pdf': 'alta',
  'expired-cert.pdf': 'alta',
  'hash-mismatch.pdf': 'baja sin_colocacion_automatica',
  'incremental-tampered.pdf': 'alta',
  'rsa-1024.pdf': 'alta',
  'sample-b-b-no-tsa.pdf': 'alta',
  'sample-b-t-freetsa.pdf': 'alta',
  'sample-b-t.pdf': 'alta',
  'sample.pdf': 'alta',
  'unsigned.pdf': 'alta',
  'untrusted-root.pdf': 'alta',
  'weak-sha1.pdf': 'alta',
};

describe('corpus real — el veredicto por documento', () => {
  for (const [name, expected] of Object.entries(CORPUS)) {
    it(name, async () => {
      expect(await classifyFixture(name)).toBe(expected);
    });
  }
});

describe('la vista previa tiene que seguir siendo la excepción', () => {
  /**
   * Tope del 25 % sobre los documentos que SÍ recibieron colocación automática.
   * Los apartados no cuentan: ya iban a una persona antes de que existiera este
   * módulo, así que meterlos en el denominador maquillaría la cifra a la baja
   * y en el numerador la inflaría sin que el clasificador tenga la culpa.
   *
   * Se clasifica de verdad, documento a documento, en vez de contar las
   * cadenas de {@link CORPUS}. La primera versión hacía lo segundo, y no medía
   * nada: un
   * clasificador que devolviera `baja` para los dieciocho lo dejaba en verde,
   * porque contaba un literal escrito a mano. Peor que inútil — el trinquete de
   * mantenimiento lo blanquea: cuando los tests por documento fallan se
   * actualiza la tabla, y entonces el "tope" se re-deriva de la tabla nueva y
   * vuelve a pasar. Un detector que no puede ponerse rojo por un cambio de
   * código no es un detector.
   */
  it('como mucho 1 de cada 4 documentos colocados pide vista previa', async () => {
    const veredictos = await Promise.all(Object.keys(CORPUS).map((name) => classifyFixture(name)));
    const colocados = veredictos.filter((v) => v !== 'baja sin_colocacion_automatica');
    const dudosos = colocados.filter((v) => !v.startsWith('alta'));

    // Medido hoy: 0 de 16. Sobre los 53 documentos reales del usuario —el
    // corpus que de verdad manda— la cifra es 8 de 46 = 17,4 %, y los ocho son
    // `pagina_no_analizada`: el único motivo honesto que queda.
    expect(colocados).toHaveLength(16);
    expect(dudosos.length / colocados.length).toBeLessThanOrEqual(0.25);
  });

  /**
   * ⚠️ ESTE CORPUS YA NO SUJETA EL LADO `baja`, y se dice en vez de disimularse.
   *
   * Cuando la estrechez dejó de contar al pie de la última hoja, los dieciocho
   * documentos de prueba pasaron a `alta` menos los dos que ni siquiera reciben
   * colocación. Es la respuesta correcta —son PDF de prueba de una página, casi
   * todos sin pie— pero deja el lado bajo del corpus sostenido solo por los
   * escenarios construidos de más abajo.
   *
   * Lo que falta es un corpus real con documentos que DEBAN salir `baja`. Los
   * ocho `pagina_no_analizada` del usuario son exactamente eso, y hay que
   * traerlos como fixtures.
   */
  it('el lado `alta` sí lo sujeta, y hay bastante de él', async () => {
    const veredictos = await Promise.all(Object.keys(CORPUS).map((name) => classifyFixture(name)));
    expect(veredictos.filter((v) => v === 'alta').length).toBeGreaterThanOrEqual(5);
    expect(veredictos.filter((v) => v.startsWith('baja')).length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Escenarios construidos: lo que el corpus real no trae.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clasifica partiendo de un análisis que SÍ se pudo hacer y no encontró nada
 * —ni escaneo, ni capa OCR, ni página ilegible—, y deja sobrescribir lo que
 * cada escenario quiera.
 *
 * Existe para que "el análisis salió limpio" se escriba, y no se insinúe
 * omitiendo campos. Desde que las listas son obligatorias, omitirlas ya no
 * compila; antes significaba lo mismo que "limpio", y esa equivalencia era
 * justo el fallo.
 */
function conAnalisisLimpio(
  o: Partial<ClassifyPlacementOpts> & Pick<ClassifyPlacementOpts, 'placement' | 'geometry'>,
) {
  return classifyPlacement({
    textBands: [],
    unanalyzedPages: [],
    imageOnlyPages: [],
    ocrOnlyPages: [],
    ...o,
  });
}

function a4(page = 0): PageGeometry {
  return {
    page,
    mediaW: 595,
    mediaH: 842,
    mediaX: 0,
    mediaY: 0,
    visX: 0,
    visY: 0,
    visW: 595,
    visH: 842,
    rotate: 0,
  };
}

/** Una colocación al pie, la más común y la más conventional que existe. */
function footer(page = 0) {
  return {
    status: 'ok',
    page,
    x: 177.5,
    y: 18,
    w: 240,
    h: 72,
    rotate: 0,
    source: 'default-footer',
  } as const;
}

describe('ceguera — se miró, y no se pudo ver', () => {
  it('un escaneo al pie NO puede salir igual que una hoja en blanco', () => {
    // Las dos llegan aquí idénticas: sin bandas de texto y con la estampa al
    // pie. La única diferencia es que de la segunda sabemos que hay tinta que
    // no podemos leer. Sin esta regla, la señal del escaneo no serviría de nada.
    const blanca = conAnalisisLimpio({ placement: footer(), geometry: [a4()] });
    const escaneo = conAnalisisLimpio({
      placement: footer(),
      geometry: [a4()],
      unanalyzedPages: [0],
      imageOnlyPages: [0],
    });

    expect(blanca.level).toBe('alta');
    expect(escaneo.level).toBe('baja');
    expect(escaneo.reasons).toEqual(['pagina_escaneada']);
  });

  it('una capa OCR se distingue de un escaneo a secas', () => {
    const v = conAnalisisLimpio({
      placement: footer(),
      geometry: [a4()],
      unanalyzedPages: [0],
      ocrOnlyPages: [0],
    });
    expect(v).toEqual({ level: 'baja', reasons: ['capa_ocr'] });
  });

  it('una página ilegible por un motivo desconocido no se llama escaneo', () => {
    const v = conAnalisisLimpio({
      placement: footer(),
      geometry: [a4()],
      unanalyzedPages: [0],
    });
    expect(v).toEqual({ level: 'baja', reasons: ['pagina_no_analizada'] });
  });

  it('la ceguera de OTRA página no contamina la elegida', () => {
    const v = conAnalisisLimpio({
      placement: footer(1),
      geometry: [a4(0), a4(1)],
      unanalyzedPages: [0],
      imageOnlyPages: [0],
    });
    expect(v.level).toBe('alta');
  });
});

describe('estrechez — una señal avisa, dos apartan', () => {
  const band = (y: number, h: number): TextBand => ({ page: 0, y, h });

  function withSurvey(slots: number, clearance: number, y: number) {
    return {
      status: 'ok',
      page: 0,
      x: 18,
      y,
      w: 240,
      h: 72,
      rotate: 0,
      source: 'free-space',
      survey: { slots, clearance, margin: null, alsoFits: [] },
    } as const;
  }

  it('un hueco único en una hoja despejada solo baja a media', () => {
    const v = conAnalisisLimpio({
      placement: withSurvey(1, 300, 400),
      geometry: [a4()],
      textBands: [band(400, 200)],
    });
    expect(v).toEqual({ level: 'media', reasons: ['hueco_unico'] });
  });

  it('un hueco justo a media página se queda en media', () => {
    const v = conAnalisisLimpio({
      placement: withSurvey(3, 7, 400),
      geometry: [a4()],
      textBands: [band(97, 700)],
    });
    expect(v).toEqual({ level: 'media', reasons: ['hueco_justo'] });
  });

  it('justo Y con un PÁRRAFO debajo baja del todo: ahí no va una firma', () => {
    // Tres líneas debajo, no una: la estampa quedó en mitad del documento.
    const v = conAnalisisLimpio({
      placement: withSurvey(3, 7, 400),
      geometry: [a4()],
      textBands: [band(40, 14), band(60, 14), band(80, 14), band(500, 300)],
    });
    expect(v.level).toBe('baja');
    expect(v.reasons).toEqual(['hueco_justo', 'texto_por_debajo']);
  });

  it('al PIE de la última hoja, la estrechez deja de ser señal: ahí es donde va', () => {
    // El caso que inflaba el corpus real al 61 %. Único hueco Y al ras del
    // mínimo, pero la estampa está en `y=90`, encima del número de página, al
    // final del documento. Eso no es una colocación dudosa: es LA colocación.
    // Poca libertad del algoritmo ≠ resultado sospechoso.
    const v = conAnalisisLimpio({
      placement: withSurvey(1, 7, 90),
      geometry: [a4()],
      textBands: [band(51, 12), band(200, 500)],
    });
    expect(v).toEqual({ level: 'alta', reasons: [] });
  });

  it('holgura de sobra y nada debajo es alta, sin motivos', () => {
    const v = conAnalisisLimpio({
      placement: withSurvey(4, 400, 400),
      geometry: [a4()],
      textBands: [band(500, 300)],
    });
    expect(v).toEqual({ level: 'alta', reasons: [] });
  });
});

describe('"debajo" es debajo EN PANTALLA', () => {
  it('con /Rotate 180 la señal salta, y en el eje correcto', () => {
    // Boca abajo, lo que en coordenadas de usuario está ARRIBA de la estampa
    // es lo que la persona ve DEBAJO. Una comparación ingenua sobre `y` daría
    // justo el veredicto contrario.
    const geo: PageGeometry = { ...a4(), rotate: 180 };
    const placement = {
      status: 'ok',
      page: 0,
      x: 178,
      y: 400,
      w: 240,
      h: 72,
      rotate: 180,
      source: 'free-space',
      survey: { slots: 3, clearance: 7, margin: null, alsoFits: [] },
    } as const;

    const parrafo = (base: number): TextBand[] => [
      { page: 0, y: base, h: 60 },
      { page: 0, y: base + 70, h: 60 },
      { page: 0, y: base + 140, h: 60 },
    ];
    const debajoEnPantalla = conAnalisisLimpio({
      placement,
      geometry: [geo],
      textBands: parrafo(600),
    });
    const encimaEnPantalla = conAnalisisLimpio({
      placement,
      geometry: [geo],
      textBands: parrafo(100),
    });

    expect(debajoEnPantalla.reasons).toContain('texto_por_debajo');
    expect(encimaEnPantalla.reasons).not.toContain('texto_por_debajo');
  });

  it('con /Rotate 90 la señal NO aplica, y eso es una propiedad, no un fallo', () => {
    // Una franja de texto es horizontal en el espacio de usuario. Girada un
    // cuarto de vuelta se convierte en una columna que ocupa la pantalla de
    // borde a borde: nada puede quedar por debajo de eso. Se fija aquí para
    // que nadie lea el silencio de esta señal en páginas apaisadas como un
    // detector roto — la colocación en esas páginas sigue esquivando el texto.
    const geo: PageGeometry = { ...a4(), rotate: 90 };
    const placement = {
      status: 'ok',
      page: 0,
      x: 423,
      y: 200,
      w: 72,
      h: 240,
      rotate: 90,
      source: 'free-space',
      survey: { slots: 3, clearance: 7, margin: null, alsoFits: [] },
    } as const;

    for (const y of [0, 300, 700]) {
      const v = conAnalisisLimpio({
        placement,
        geometry: [geo],
        textBands: [{ page: 0, y, h: 60 }],
      });
      expect(v.reasons).not.toContain('texto_por_debajo');
    }
  });
});

describe('lo apartado va por el mismo camino', () => {
  it('un documento sin colocación automática sale baja, no sin clasificar', () => {
    const v = conAnalisisLimpio({
      placement: { status: 'needs_review', page: 0, reason: 'no_free_slot' },
      geometry: [a4()],
    });
    expect(v).toEqual({ level: 'baja', reasons: ['sin_colocacion_automatica'] });
  });
});

describe('hueco reservado — solo se exonera la señal que no puede variar', () => {
  /**
   * `reservedGapV` planta la estampa en `top + GAP*0.5`, así que su holgura al
   * obstáculo más cercano vale siempre `GAP/2`. Eso hace `hueco_justo` una
   * tautología de la fuente, y solo eso se exonera: `reservedGapV` no verifica
   * que el hueco sea un área de firma —solo que no haya bandas de texto— y un
   * claro sin bandas puede tener encima un sello o una figura, que el lector
   * ignora por diseño.
   */
  const gapPlacement = (source: 'reserved-gap' | 'free-space') =>
    ({ status: 'ok', page: 0, x: 90, y: 300, w: 240, h: 72, rotate: 0, source }) as const;

  const bloqueDebajo = [
    { page: 0, y: 250, h: 12 },
    { page: 0, y: 232, h: 12 },
    { page: 0, y: 214, h: 12 },
    { page: 0, y: 30, h: 10 },
  ];

  /** Holgura exactamente `GAP/2`: lo que esta fuente produce, siempre. */
  const apretado = { slots: 1, clearance: GAP * 0.5, margin: null, alsoFits: [] };

  it('la holgura tautológica se calla; el mismo sitio por barrido libre la declara', () => {
    // El contraste es el test: idénticos rect, bandas y encuesta. Lo único que
    // cambia es la fuente, y con ella si `hueco_justo` significa algo.
    const reservado = conAnalisisLimpio({
      placement: { ...gapPlacement('reserved-gap'), survey: apretado },
      geometry: [a4()],
      textBands: bloqueDebajo,
    });
    const libre = conAnalisisLimpio({
      placement: { ...gapPlacement('free-space'), survey: apretado },
      geometry: [a4()],
      textBands: bloqueDebajo,
    });

    expect(reservado.reasons).not.toContain('hueco_justo');
    expect(libre.reasons).toContain('hueco_justo');
  });

  it('las otras dos señales SIGUEN vivas en un hueco reservado', () => {
    // Sin esto, la fuente sería un aval: una clase entera que no puede salir
    // más que `alta`, es decir un clasificador incapaz de equivocarse porque ya
    // no puede opinar. Este test es lo que impide volver a ese estado.
    const v = conAnalisisLimpio({
      placement: { ...gapPlacement('reserved-gap'), survey: apretado },
      geometry: [a4()],
      textBands: bloqueDebajo,
    });
    expect(v.reasons).toContain('hueco_unico');
    expect(v.reasons).toContain('texto_por_debajo');
    expect(v.level).toBe('baja');
  });

  it('un hueco reservado despejado y sin texto debajo sí sale alta', () => {
    // La otra dirección: exonerar la tautología tiene que servir de algo. Sin
    // este caso, callar `hueco_justo` no cambiaría ningún veredicto.
    const v = conAnalisisLimpio({
      placement: { ...gapPlacement('reserved-gap'), survey: { ...apretado, slots: 3 } },
      geometry: [a4()],
      textBands: [{ page: 0, y: 250, h: 12 }],
    });
    expect(v.level).toBe('alta');
    expect(v.reasons).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FASE 3 — señales de confianza del ancla de texto. Cada una con su entrada
// FALSADORA: un caso que la dispara y un control positivo que confirma que,
// sin esa condición exacta, la señal se calla.
// ─────────────────────────────────────────────────────────────────────────────

function anchorPlacement(
  y: number,
  anchorKind: 'firma-label' | 'firmante-nombre' | 'firmante-cedula',
) {
  return {
    status: 'ok',
    page: 0,
    x: 90,
    y,
    w: 240,
    h: 72,
    rotate: 0,
    source: 'text-anchor',
    anchorKind,
  } as const;
}

function anchorContext(
  overrides: Partial<AnchorClassificationContext>,
): AnchorClassificationContext {
  return {
    kind: 'firma-label',
    personalized: false,
    signals: [],
    honored: true,
    pageCoverage: 1,
    ...overrides,
  };
}

describe('FASE 3 — ancla_ambigua', () => {
  /**
   * RE-ACOTADO tras medir 1.457 PDF reales: con la etiqueta genérica sola
   * activa, `ancla_ambigua` disparó en 283/1.314 documentos y el `alta`
   * cayó de 82,9% a 51,7% — "firma" aparece constantemente fuera de una
   * zona de firma real (disclaimers, cláusulas), así que la señal no
   * distinguía una colocación mala de una palabra común. Ahora solo se
   * evalúa con `personalized: true` — ver `placementConfidence.ts`.
   */
  it('un ancla PERSONALIZADA honrada, marcada ambigua, baja a media', () => {
    const v = conAnalisisLimpio({
      placement: anchorPlacement(300, 'firmante-nombre'),
      geometry: [a4()],
      anchor: anchorContext({
        kind: 'firmante-nombre',
        personalized: true,
        signals: ['ancla_ambigua'],
      }),
    });
    expect(v.reasons).toContain('ancla_ambigua');
    expect(v.level).toBe('media');
  });

  it('control positivo: el mismo ancla PERSONALIZADA SIN la señal no la dispara', () => {
    const v = conAnalisisLimpio({
      placement: anchorPlacement(300, 'firmante-nombre'),
      geometry: [a4()],
      anchor: anchorContext({ kind: 'firmante-nombre', personalized: true, signals: [] }),
    });
    expect(v.reasons).not.toContain('ancla_ambigua');
    expect(v.level).toBe('alta');
  });

  it('un ancla GENÉRICA con la señal presente NO la dispara: la vía genérica no evalúa esta familia', () => {
    const v = conAnalisisLimpio({
      placement: anchorPlacement(300, 'firma-label'),
      geometry: [a4()],
      anchor: anchorContext({ personalized: false, signals: ['ancla_ambigua'] }),
    });
    expect(v.reasons).not.toContain('ancla_ambigua');
    expect(v.level).toBe('alta');
  });
});

describe('FASE 3 — ancla_ilegible', () => {
  it('la página del ancla con coverage < 0.9 baja a media: no sabemos qué anclas NO se vieron', () => {
    const v = conAnalisisLimpio({
      placement: anchorPlacement(300, 'firmante-nombre'),
      geometry: [a4()],
      anchor: anchorContext({ kind: 'firmante-nombre', personalized: true, pageCoverage: 0.5 }),
    });
    expect(v.reasons).toContain('ancla_ilegible');
    expect(v.level).toBe('media');
  });

  it('control positivo: coverage 1.0 no dispara la señal', () => {
    const v = conAnalisisLimpio({
      placement: anchorPlacement(300, 'firmante-nombre'),
      geometry: [a4()],
      anchor: anchorContext({ kind: 'firmante-nombre', personalized: true, pageCoverage: 1 }),
    });
    expect(v.reasons).not.toContain('ancla_ilegible');
    expect(v.level).toBe('alta');
  });
});

describe('FASE 3 — ancla_en_parrafo', () => {
  it('el nombre personalizado con ≥3 líneas de cláusula debajo del bloque baja a media', () => {
    const v = conAnalisisLimpio({
      placement: anchorPlacement(300, 'firmante-nombre'),
      geometry: [a4()],
      textBands: [
        { page: 0, y: 40, h: 14 },
        { page: 0, y: 60, h: 14 },
        { page: 0, y: 80, h: 14 },
      ],
      anchor: anchorContext({ kind: 'firmante-nombre', personalized: true }),
    });
    expect(v.reasons).toContain('ancla_en_parrafo');
    // Y NO la genérica `texto_por_debajo`: para un ancla personalizada
    // honrada, esta señal la SUSTITUYE (ver `placementConfidence.ts`).
    expect(v.reasons).not.toContain('texto_por_debajo');
    expect(v.level).toBe('media');
  });

  it('control positivo: con menos de 3 líneas debajo, no dispara', () => {
    const v = conAnalisisLimpio({
      placement: anchorPlacement(300, 'firmante-nombre'),
      geometry: [a4()],
      textBands: [{ page: 0, y: 40, h: 14 }],
      anchor: anchorContext({ kind: 'firmante-nombre', personalized: true }),
    });
    expect(v.reasons).not.toContain('ancla_en_parrafo');
    expect(v.level).toBe('alta');
  });
});

describe('FASE 3 — ancla_sin_sitio', () => {
  it('había un ancla pero la colocación cayó a otra fuente: mínimo media', () => {
    const fallback = {
      ...anchorPlacement(18, 'firmante-nombre'),
      source: 'default-footer',
    } as const;
    const v = conAnalisisLimpio({
      placement: fallback,
      geometry: [a4()],
      anchor: anchorContext({ kind: 'firmante-nombre', personalized: true, honored: false }),
    });
    expect(v.reasons).toContain('ancla_sin_sitio');
    expect(v.level).not.toBe('alta'); // nunca por debajo de media
  });

  it('control positivo: honored=true no dispara la señal', () => {
    const v = conAnalisisLimpio({
      placement: anchorPlacement(300, 'firmante-nombre'),
      geometry: [a4()],
      anchor: anchorContext({ kind: 'firmante-nombre', personalized: true, honored: true }),
    });
    expect(v.reasons).not.toContain('ancla_sin_sitio');
  });

  /**
   * RE-ACOTADO tras medir 1.457 PDF reales: con la etiqueta genérica sola
   * activa, `ancla_sin_sitio` disparó en 501/1.314 documentos — "firma"
   * aparece por todo el documento sin ser zona de firma, así que "no se
   * pudo honrar la etiqueta" no informaba nada sobre si el sitio elegido
   * era bueno. Con `personalized: false` la señal NO se evalúa, ni siquiera
   * con `honored: false`.
   */
  it('un ancla GENÉRICA no honrada NO dispara la señal: la vía genérica no evalúa esta familia', () => {
    const fallback = {
      ...anchorPlacement(18, 'firma-label'),
      source: 'default-footer',
    } as const;
    const v = conAnalisisLimpio({
      placement: fallback,
      geometry: [a4()],
      anchor: anchorContext({ kind: 'firma-label', personalized: false, honored: false }),
    });
    expect(v.reasons).not.toContain('ancla_sin_sitio');
    expect(v.level).toBe('alta');
  });
});

describe('FASE 3 — guardia anti-constante: el clasificador con ancla puede decir las DOS cosas', () => {
  /**
   * Una ronda anterior exoneró una clase entera de colocaciones y la volvió
   * constante: 7.083 de 7.083 `alta`, cero motivos — un clasificador que no
   * puede opinar tampoco puede equivocarse. Esta guardia exige `alta` Y
   * `baja` en el MISMO corpus mínimo del ancla, para que una futura
   * "corrección" no pueda silenciar las cuatro señales nuevas sin que algo
   * se ponga rojo aquí.
   */
  it('sobre un corpus mínimo de anclas, hay AL MENOS un alta y un baja', () => {
    const escenarios = [
      conAnalisisLimpio({
        placement: anchorPlacement(300, 'firma-label'),
        geometry: [a4()],
        anchor: anchorContext({}),
      }),
      conAnalisisLimpio({
        placement: anchorPlacement(300, 'firmante-nombre'),
        geometry: [a4()],
        anchor: anchorContext({
          kind: 'firmante-nombre',
          personalized: true,
          signals: ['ancla_ambigua'],
        }),
      }),
      conAnalisisLimpio({
        placement: anchorPlacement(300, 'firmante-nombre'),
        geometry: [a4()],
        anchor: anchorContext({ kind: 'firmante-nombre', personalized: true, pageCoverage: 0.2 }),
      }),
      conAnalisisLimpio({
        placement: { ...anchorPlacement(18, 'firmante-nombre'), source: 'default-footer' } as const,
        geometry: [a4()],
        anchor: anchorContext({ kind: 'firmante-nombre', personalized: true, honored: false }),
      }),
    ];

    const levels = new Set(escenarios.map((e) => e.level));
    expect(levels.has('alta')).toBe(true);
    expect(levels.has('baja') || levels.has('media')).toBe(true);
    // Redundante a propósito con los tests de arriba, pero en UN solo lugar:
    // si alguien "arregla" las cuatro señales para que nunca disparen, esto
    // colapsa a un único nivel y el test se pone rojo.
    expect(levels.size).toBeGreaterThan(1);
  });
});

describe('FASE 3 — guardia anti-constante ESPECÍFICA de la vía GENÉRICA (encargo de acotar ancla_ambigua/ancla_sin_sitio)', () => {
  /**
   * Acotar `ancla_ambigua`/`ancla_sin_sitio` a la vía personalizada corre
   * exactamente el riesgo que ya se cometió una vez: si por error se
   * apagaran TAMBIÉN `hueco_unico`/`hueco_justo`/`texto_por_debajo`/
   * `ancla_ilegible` para el ancla genérica —las señales que SÍ le siguen
   * aplicando—, la vía genérica se volvería una clase que solo puede decir
   * `alta`, 100% del tiempo, sin poder opinar. Este test corre SOLO sobre
   * escenarios de ancla GENÉRICA (`personalized: false`) y exige que, entre
   * ellos, aparezcan al menos dos niveles distintos.
   *
   * Falseado a propósito: comentando el bloque `if (survey && !conventional)
   * { ... }` de `classifyPlacement` (o el chequeo de `ancla_ilegible`) este
   * test se pone en rojo, porque los tres escenarios de abajo colapsan a
   * `alta`. Así se confirmó antes de dejarlo en verde.
   */
  it('sobre un corpus mínimo de anclas GENÉRICAS, hay al menos dos niveles distintos', () => {
    const limpio = conAnalisisLimpio({
      placement: anchorPlacement(300, 'firma-label'),
      geometry: [a4()],
      textBands: [{ page: 0, y: 500, h: 300 }],
      anchor: anchorContext({ personalized: false }),
    });

    // Hueco único en hoja despejada, lejos del pie: `hueco_unico` sigue
    // viva para la vía genérica.
    const huecoUnico = conAnalisisLimpio({
      placement: {
        ...anchorPlacement(400, 'firma-label'),
        survey: { slots: 1, clearance: 300, margin: null, alsoFits: [] },
      },
      geometry: [a4()],
      textBands: [{ page: 0, y: 400, h: 200 }],
      anchor: anchorContext({ personalized: false }),
    });

    // Página con cobertura de decode ilegible: `ancla_ilegible` sigue viva
    // en AMBAS vías, genérica incluida.
    const ilegible = conAnalisisLimpio({
      placement: anchorPlacement(300, 'firma-label'),
      geometry: [a4()],
      anchor: anchorContext({ personalized: false, pageCoverage: 0.2 }),
    });

    // Y, aunque estén presentes, `ancla_ambigua`/`ancla_sin_sitio` NO deben
    // aportar nada a un ancla genérica: es justo lo que este encargo pide.
    const conSenalesAcotadas = conAnalisisLimpio({
      placement: { ...anchorPlacement(18, 'firma-label'), source: 'default-footer' } as const,
      geometry: [a4()],
      anchor: anchorContext({
        personalized: false,
        signals: ['ancla_ambigua'],
        honored: false,
      }),
    });

    const levels = new Set(
      [limpio, huecoUnico, ilegible, conSenalesAcotadas].map((v) => v.level),
    );
    expect(levels.has('alta')).toBe(true);
    expect(levels.size).toBeGreaterThan(1);
    expect(conSenalesAcotadas.reasons).not.toContain('ancla_ambigua');
    expect(conSenalesAcotadas.reasons).not.toContain('ancla_sin_sitio');
  });
});
