import { describe, expect, it } from 'vitest';
import type { ExistingSigRect } from '../../ui/firma/smartPlacement.ts';
import { overlapsExistingSignature, toManualPlacement } from './manualPlacement';

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
