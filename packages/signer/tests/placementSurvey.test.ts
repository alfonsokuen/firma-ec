/**
 * La encuesta de colocación: lo que se vio al buscar sitio, no solo el sitio.
 *
 * El buscador anterior recorría candidatos y devolvía el primero. Sabía cuántos
 * había, a qué distancia estaba el segundo y cuánto aire quedaba alrededor del
 * elegido — y lo tiraba todo. Aquí se fija que eso se conserva, porque es la
 * diferencia entre "cabía en un hueco justo" y "cabía en medio folio en blanco",
 * y esa diferencia es la que decidirá a quién se le enseña una vista previa
 * antes de pedirle el PIN.
 *
 * Lo que estos tests NO afirman: que la encuesta cambie dónde cae la estampa.
 * No lo hace, a propósito. Las dos tablas congeladas de `textBandsPlacement`
 * son la prueba de que el ganador es exactamente el de antes.
 */

import { describe, expect, it } from 'vitest';

import { computeAutoPlacement } from '../src/autoPlacement.js';
import type { PageGeometry } from '../src/pageGeometry.js';
import type { TextBand } from '../src/textBands.js';

/** Una A4 vertical sin recorte, que es el caso del 99 % del corpus. */
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

/** Franja de texto de ancho completo entre dos alturas. */
function band(page: number, from: number, to: number): TextBand {
  return { page, y: from, h: to - from };
}

function place(geometry: PageGeometry[], textBands: TextBand[]) {
  return computeAutoPlacement({ geometry, existing: [], textBands, unanalyzedPages: [] });
}

describe('cuántos huecos había', () => {
  it('un claro único entre dos párrafos se cuenta UNA vez, no cuatro', () => {
    // Del claro 300–400 salen cuatro posiciones válidas: anclada al párrafo de
    // abajo o al de arriba, y centrada o pegada al margen. Son la misma mancha
    // de papel vista cuatro veces. Contarlas por separado le diría al
    // clasificador "había sitio de sobra" justo donde apenas había uno.
    const r = place([a4()], [band(0, 0, 300), band(0, 400, 842)]);

    expect(r.status).toBe('ok');
    expect(r.status === 'ok' && r.survey?.slots).toBe(1);
    expect(r.status === 'ok' && r.survey?.margin).toBeNull();
  });

  it('dos claros separados son dos huecos, y el margen mide lo que los separa', () => {
    // Claros en 300–400 y en 600–700. El ganador es el de abajo (la firma va
    // abajo); el segundo está 300 pt más arriba. Ese salto es el margen.
    const r = place([a4()], [band(0, 0, 300), band(0, 400, 600), band(0, 700, 842)]);

    expect(r.status).toBe('ok');
    expect(r.status === 'ok' && r.survey?.slots).toBe(2);
    expect(r.status === 'ok' && r.survey?.margin?.axis).toBe('vertical');
    // Del borde superior del párrafo bajo (307) al del párrafo de en medio
    // (607): 300 pt exactos.
    expect(r.status === 'ok' && r.survey?.margin?.delta).toBeCloseTo(300, 1);
  });

  it('una hoja con dos líneas arriba deja muchos huecos, no uno', () => {
    const r = place([a4()], [band(0, 800, 842)]);

    expect(r.status).toBe('ok');
    expect(r.status === 'ok' && (r.survey?.slots ?? 0)).toBeGreaterThan(1);
  });
});

describe('cuánto aire quedaba alrededor', () => {
  it('el claro justo deja una holgura al ras del mínimo', () => {
    // Claro de 300 a 400 = 100 pt para un cuadro de 72. La estampa se ancla
    // justo encima del párrafo de abajo, así que su holgura es la mínima que
    // el buscador exige: GAP/2 = 7.
    const r = place([a4()], [band(0, 0, 300), band(0, 400, 842)]);

    expect(r.status === 'ok' && r.survey?.clearance).toBeCloseTo(7, 3);
  });

  it('media hoja en blanco deja una holgura muy superior a la mínima', () => {
    const r = place([a4()], [band(0, 500, 842)]);

    const clearance = r.status === 'ok' ? (r.survey?.clearance ?? 0) : 0;
    // La estampa cae al pie (v = 18, alto 72) y el texto empieza en 500: son
    // 410 pt de papel entre una cosa y la otra.
    expect(clearance).toBeGreaterThan(100);
  });
});

describe('cuando no cabe, dónde SÍ cabía', () => {
  it('ofrece la página anterior en vez de dejar un callejón sin salida', () => {
    // Última hoja escrita de arriba abajo; la anterior, casi limpia.
    const r = place([a4(0), a4(1)], [band(1, 0, 842), band(0, 700, 842)]);

    expect(r.status).toBe('needs_review');
    expect(r.status === 'needs_review' && r.reason).toBe('no_free_slot');
    expect(r.status === 'needs_review' && r.survey?.slots).toBe(0);
    expect(r.status === 'needs_review' && r.survey?.alsoFits).toEqual([0]);
  });

  it('la página que no tiene sitio nunca se ofrece a sí misma', () => {
    const r = place([a4(0), a4(1)], [band(1, 0, 842)]);

    expect(r.status).toBe('needs_review');
    expect(r.status === 'needs_review' && r.survey?.alsoFits).not.toContain(1);
  });

  it('si no cabe en ninguna parte, la lista va vacía y no inventa una salida', () => {
    const r = place([a4(0), a4(1)], [band(0, 0, 842), band(1, 0, 842)]);

    expect(r.status).toBe('needs_review');
    expect(r.status === 'needs_review' && r.survey?.alsoFits).toEqual([]);
  });
});

describe('lo que no se buscó no se cuenta', () => {
  it('el pie de una hoja en blanco no trae encuesta: no hubo candidatos que comparar', () => {
    const r = place([a4()], []);

    expect(r.status === 'ok' && r.source).toBe('default-footer');
    expect(r.status === 'ok' && r.survey).toBeUndefined();
  });

  it('un campo de firma declarado por el documento tampoco: lo eligió el documento', () => {
    const r = computeAutoPlacement({
      geometry: [a4()],
      existing: [],
      emptySigFields: [{ page: 0, x: 100, y: 100, w: 200, h: 60 }],
      textBands: [band(0, 0, 300)],
      unanalyzedPages: [],
    });

    expect(r.status === 'ok' && r.source).toBe('empty-field');
    expect(r.status === 'ok' && r.survey).toBeUndefined();
  });
});

describe('el anti-solape encuesta igual que el hueco libre', () => {
  it('una firma previa deja hueco, y la encuesta lo describe', () => {
    const r = computeAutoPlacement({
      geometry: [a4()],
      existing: [{ page: 0, x: 300, y: 700, w: 240, h: 72 }],
      textBands: [],
      unanalyzedPages: [],
    });

    expect(r.status === 'ok' && r.source).toBe('anti-overlap');
    expect(r.status === 'ok' && (r.survey?.slots ?? 0)).toBeGreaterThan(0);
    expect(r.status === 'ok' && (r.survey?.clearance ?? 0)).toBeGreaterThanOrEqual(7);
  });
});
