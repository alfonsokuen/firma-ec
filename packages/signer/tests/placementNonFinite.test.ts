/**
 * Geometría imposible: lo que pasa cuando el documento miente sobre su tamaño.
 *
 * Los tres fallos que fija este fichero salieron de una revisión doble, y los
 * tres son la misma idea vista desde ángulos distintos: **cuando no se sabe
 * algo, el sistema elegía la lectura optimista**.
 *
 *  - Un rect con `NaN` aprobaba TODAS las compuertas, incluida la última antes
 *    de firmar, porque toda comparación `<`/`>` con `NaN` es `false`. Era el
 *    único valor que no rechazaba nadie.
 *  - Una hoja de 10^11 pt hacía que el barrido de alturas construyera un array
 *    de miles de millones de entradas y lanzara `RangeError` — en una función
 *    cuyo contrato dice "nunca lanza" y cuyo llamador se lo cree, así que se
 *    llevaba por delante los 50 documentos del lote, no uno.
 *  - Un hueco encontrado y luego rechazado se reportaba como `no_free_slot`,
 *    que la pantalla traduce a "no queda espacio en blanco". Se mandaba a la
 *    persona a buscar sitio cuando el problema era otro.
 *
 * Ninguno lo dispara un PDF legítimo. Todos los dispara un PDF que alguien te
 * manda para que lo firmes, que es exactamente el modelo de amenaza.
 */

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { computeAutoPlacement } from '../src/autoPlacement.js';
import type { PageGeometry } from '../src/pageGeometry.js';
import { classifyPlacement } from '../src/placementConfidence.js';
import { validateVisibleSig } from '../src/visibleSig.js';

function geo(over: Partial<PageGeometry> = {}): PageGeometry {
  return {
    page: 0,
    mediaW: 595,
    mediaH: 842,
    mediaX: 0,
    mediaY: 0,
    visX: 0,
    visY: 0,
    visW: 595,
    visH: 842,
    rotate: 0,
    ...over,
  };
}

describe('un rect no finito no puede pasar por bueno', () => {
  it('la colocación lo aparta en vez de devolverlo con status ok', () => {
    // MediaBox de ancho infinito: el centrado del pie da `NaN`, y `NaN` pasa
    // todos los `<` y `>` de la validación.
    const roto = geo({ mediaW: Number.POSITIVE_INFINITY, visW: Number.POSITIVE_INFINITY });
    const r = computeAutoPlacement({ geometry: [roto], existing: [], textBands: [] });

    expect(r.status).toBe('needs_review');
    expect(r.status === 'needs_review' && r.reason).toContain('rect_not_finite');
  });

  it('y la compuerta FINAL de firma también lo rechaza, no solo el pre-vuelo', async () => {
    // Esta es la que importa: si el pre-vuelo fallara, aquí es donde el widget
    // con coordenadas basura entraría en un PDF de verdad.
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]);

    expect(() =>
      validateVisibleSig(pdf, { page: 0, x: Number.NaN, y: 18, width: 240, height: 72 }),
    ).toThrowError(/non-finite/i);
  });

  it('un documento así jamás sale con confianza alta', () => {
    const roto = geo({ mediaW: Number.POSITIVE_INFINITY, visW: Number.POSITIVE_INFINITY });
    const placement = computeAutoPlacement({ geometry: [roto], existing: [], textBands: [] });
    const v = classifyPlacement({
      placement,
      geometry: [roto],
      textBands: [],
      unanalyzedPages: [],
      imageOnlyPages: [],
      ocrOnlyPages: [],
    });

    // El único documento que había que enseñar sí o sí salía 'alta'.
    expect(v.level).toBe('baja');
  });
});

describe('una hoja descomunal no puede tumbar el lote entero', () => {
  for (const mediaH of [1e9, 1e11, 1e300, Number.POSITIVE_INFINITY]) {
    it(`alto ${mediaH} devuelve un estado, no una excepción`, () => {
      // Con una firma previa y sin bandas se entra en el barrido histórico, que
      // avanza a saltos de `h + GAP`: es el bucle que crecía sin cota.
      const alta = geo({ mediaH, visH: mediaH });
      const inicio = Date.now();
      const r = computeAutoPlacement({
        geometry: [alta],
        existing: [{ page: 0, x: 18, y: 18, w: 200, h: 60 }],
        textBands: [],
      });

      expect(r.status === 'ok' || r.status === 'needs_review').toBe(true);
      // No es solo que no lance: tampoco puede tardar. 11,6 millones de alturas
      // eran 110 ms por documento — sin lanzar, y con 50 en el lote.
      expect(Date.now() - inicio).toBeLessThan(1000);
    });
  }
});

describe('el motivo dice lo que pasó, no lo primero que había a mano', () => {
  it('un hueco encontrado y rechazado NO se reporta como "no queda espacio"', () => {
    // Cuadro por debajo del mínimo de legibilidad: el hueco existe, se
    // encuentra, y lo que falla es el rect. Antes esto salía `no_free_slot` →
    // "no queda espacio en blanco donde no tape el texto", que manda a la
    // persona a buscar algo que sí estaba ahí.
    const r = computeAutoPlacement({
      geometry: [geo()],
      existing: [],
      textBands: [{ page: 0, y: 500, h: 200 }],
      boxW: 20,
      boxH: 20,
    });

    expect(r.status).toBe('needs_review');
    expect(r.status === 'needs_review' && r.reason).not.toBe('no_free_slot');
    expect(r.status === 'needs_review' && r.reason).toMatch(/^free_space_/);
  });

  it('y `no_free_slot` queda para cuando de verdad no cabía ni un hueco', () => {
    const r = computeAutoPlacement({
      geometry: [geo()],
      existing: [],
      textBands: [{ page: 0, y: 0, h: 842 }],
    });

    expect(r.status === 'needs_review' && r.reason).toBe('no_free_slot');
    expect(r.status === 'needs_review' && r.survey?.slots).toBe(0);
  });
});
