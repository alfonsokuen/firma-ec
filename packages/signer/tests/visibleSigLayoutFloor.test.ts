/**
 * El suelo de layout de la estampa, y su espejo en el motor de colocacion.
 *
 * `autoPlacement.ts` no importa `visibleSig.ts` a proposito -- arrastraria
 * `qrcode` al worker de pre-vuelo, que no renderiza nada-- asi que duplica el
 * numero. Este test existe para que los dos no puedan divergir en silencio: si
 * alguien toca el layout de la estampa, aqui salta y hay que mover el espejo.
 */
import { describe, expect, it } from 'vitest';

import { MIN_LEGIBLE_SIG_WIDTH, MIN_VISIBLE_SIG_WIDTH } from '../src/visibleSig.js';

describe('suelo de legibilidad de la estampa', () => {
  it('vale 78 pt, que es lo que `autoPlacement.ts` duplica como MIN_LEGIBLE_SIG_WIDTH', () => {
    expect(MIN_LEGIBLE_SIG_WIDTH).toBe(78);
  });

  it('es MAYOR que el minimo del validador: pasar la validacion no es ser legible', () => {
    // Justo la confusion que costo el defecto: un rect de 43 pt pasa
    // `validateVisibleSig` (30x30) y aun asi se firma sin un solo dato del
    // firmante, porque el bloque de texto cae fuera del BBox.
    expect(MIN_LEGIBLE_SIG_WIDTH).toBeGreaterThan(MIN_VISIBLE_SIG_WIDTH);
  });
});
