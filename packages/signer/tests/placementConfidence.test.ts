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

import { analyzePdfForPlacement } from '../src/analyzePdf.js';
import { computeAutoPlacement } from '../src/autoPlacement.js';
import type { PageGeometry } from '../src/pageGeometry.js';
import { type ClassifyPlacementOpts, classifyPlacement } from '../src/placementConfidence.js';
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
    const veredictos = await Promise.all(
      Object.keys(CORPUS).map((name) => classifyFixture(name)),
    );
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
    const veredictos = await Promise.all(
      Object.keys(CORPUS).map((name) => classifyFixture(name)),
    );
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
function conAnalisisLimpio(o: Partial<ClassifyPlacementOpts> & Pick<ClassifyPlacementOpts, 'placement' | 'geometry'>) {
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
      const v = conAnalisisLimpio({ placement, geometry: [geo], textBands: [{ page: 0, y, h: 60 }] });
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
