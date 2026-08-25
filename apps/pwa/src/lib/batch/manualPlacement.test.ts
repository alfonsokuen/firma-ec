import { describe, expect, it } from 'vitest';
import type { ExistingSigRect } from '../../ui/firma/smartPlacement.ts';
import {
  engineRotateFor,
  fromEnginePlacement,
  overlapsExistingSignature,
  toManualPlacement,
} from './manualPlacement';

describe('toManualPlacement — conversión de página 1-based → 0-based', () => {
  it('página 3 (lo que ve la persona: "página 3 de N") publica placement.page = 2', () => {
    // Éste es EL test no negociable de la fase: si alguien borra el `- 1` de
    // `toManualPlacement`, cada firma colocada a mano en el lote caería una
    // página después de donde la persona la vio.
    const result = toManualPlacement({ page: 3, x: 50, y: 60, w: 240, h: 72 });

    expect(result.page).toBe(2);
    expect(result).toEqual({ page: 2, x: 50, y: 60, width: 240, height: 72 });
  });

  it('página 1 (la primera, tal como la persona la cuenta) publica placement.page = 0', () => {
    const result = toManualPlacement({ page: 1, x: 0, y: 0, w: 240, h: 72 });
    expect(result.page).toBe(0);
  });

  it('convierte w/h (BoxPosition) a width/height (SignVisibleSigInput), no los deja pasar por accidente', () => {
    const result = toManualPlacement({ page: 1, x: 10, y: 20, w: 240, h: 72 });
    expect(result).toEqual({ page: 0, x: 10, y: 20, width: 240, height: 72 });
    expect('w' in result).toBe(false);
    expect('h' in result).toBe(false);
  });
});

describe('overlapsExistingSignature — aviso de solape del colocador manual', () => {
  const pos = { page: 2, x: 100, y: 100, w: 240, h: 72 }; // engine page 1 (0-based)

  it('dispara cuando el rect confirmado se solapa con una firma previa VISIBLE en la misma página', () => {
    const widgets: ExistingSigRect[] = [{ page: 1, x: 150, y: 120, w: 100, h: 40 }];
    expect(overlapsExistingSignature(pos, widgets)).toBe(true);
  });

  it('dispara con solape parcial (los rects no coinciden exactamente, solo se pisan)', () => {
    const widgets: ExistingSigRect[] = [{ page: 1, x: 320, y: 100, w: 60, h: 60 }];
    expect(overlapsExistingSignature(pos, widgets)).toBe(true);
  });

  it('calla cuando no hay ningún widget', () => {
    expect(overlapsExistingSignature(pos, [])).toBe(false);
  });

  it('calla cuando el widget está en OTRA página del mismo documento', () => {
    const widgets: ExistingSigRect[] = [{ page: 5, x: 100, y: 100, w: 240, h: 72 }];
    expect(overlapsExistingSignature(pos, widgets)).toBe(false);
  });

  it('calla cuando el widget está en la misma página pero lejos, sin tocarse', () => {
    const widgets: ExistingSigRect[] = [{ page: 1, x: 0, y: 0, w: 40, h: 40 }];
    expect(overlapsExistingSignature(pos, widgets)).toBe(false);
  });

  it('calla ante un widget degenerado (rect prácticamente invisible) aunque las coordenadas coincidan', () => {
    const widgets: ExistingSigRect[] = [{ page: 1, x: 100, y: 100, w: 0.2, h: 0.2 }];
    expect(overlapsExistingSignature(pos, widgets)).toBe(false);
  });
});

describe('fromEnginePlacement — conversión 0-based → 1-based (flujo de UNA firma)', () => {
  it('el rect 0-based del motor se muestra en la página 1-based que ve la persona', () => {
    // El gemelo del test no negociable de arriba, en el sentido contrario: si
    // alguien borra el `+ 1`, la caja aparecería una página ANTES de donde el
    // motor decidió, y la persona firmaría en la hoja equivocada creyendo que
    // se la colocaron bien.
    const pos = fromEnginePlacement({ page: 2, x: 50, y: 60, width: 240, height: 72 });

    expect(pos.page).toBe(3);
    expect(pos).toEqual({ page: 3, x: 50, y: 60, w: 240, h: 72 });
  });

  it('es la inversa exacta de toManualPlacement (ida y vuelta sin deriva)', () => {
    const original = { page: 4, x: 12.5, y: 700.25, w: 240, h: 72 };

    expect(fromEnginePlacement(toManualPlacement(original))).toEqual(original);
  });

  it('la primera página del motor (0) es la página 1 de la persona, no la 0', () => {
    expect(fromEnginePlacement({ page: 0, x: 0, y: 0, width: 10, height: 10 }).page).toBe(1);
  });
});

describe('engineRotateFor — el /Rotate solo vale para el rect EXACTO que midió el motor', () => {
  const engineBox = { page: 3, x: 50, y: 60, w: 240, h: 72 };

  it('propaga la rotación mientras la caja sea la del motor (mismo rect)', () => {
    expect(engineRotateFor({ ...engineBox, rotate: 90 }, engineBox)).toBe(90);
  });

  it('tolera ruido de coma flotante por debajo del epsilon', () => {
    expect(engineRotateFor({ ...engineBox, rotate: 90 }, { ...engineBox, x: 50.3 })).toBe(90);
  });

  it('NO la propaga si la persona movió la caja a otra página', () => {
    // La rotación describiría una hoja distinta y la estampa saldría de lado.
    expect(
      engineRotateFor({ ...engineBox, rotate: 90 }, { ...engineBox, page: 4 }),
    ).toBeUndefined();
  });

  it('NO la propaga si la caja se movió DENTRO de la misma página', () => {
    // El caso que la guarda por-página dejaba pasar (hallazgo del reviewer):
    // tras un arrastre el rect viene del viewport de pdf.js — en una página
    // girada ese espacio ya está rotado, y adjuntar el rotate del motor la
    // re-rotaría sobre un rect que no es el suyo.
    expect(engineRotateFor({ ...engineBox, rotate: 90 }, { ...engineBox, x: 120 })).toBeUndefined();
  });

  it('NO la propaga si la caja se redimensionó', () => {
    expect(engineRotateFor({ ...engineBox, rotate: 90 }, { ...engineBox, h: 54 })).toBeUndefined();
  });

  it('devuelve undefined cuando la página no tiene rotación declarada', () => {
    expect(engineRotateFor({ ...engineBox }, engineBox)).toBeUndefined();
  });

  it('devuelve undefined cuando la colocación no vino del motor', () => {
    expect(engineRotateFor(null, engineBox)).toBeUndefined();
  });

  it('propaga rotate: 0 como 0 y no lo confunde con "sin dato"', () => {
    // `0` es falsy: una comprobación con `if (meta.rotate)` lo tiraría. Hoy da
    // igual aguas abajo, pero el día que 0 y undefined diverjan, esto lo caza.
    expect(engineRotateFor({ ...engineBox, rotate: 0 }, engineBox)).toBe(0);
  });
});
