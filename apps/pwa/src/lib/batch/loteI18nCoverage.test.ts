import { describe, expect, it } from 'vitest';
import { ui } from '../i18n.svelte';
import type { PlacementSource } from './preflight';

/**
 * Red-first para el hallazgo del QA post-merge (2026-08-02): sourceLabel
 * degradaba a '' en vez del código crudo cuando faltaba una clave, y
 * PlacementSource creció a 6 variantes mientras el mapa i18n se quedó en 4
 * ('reserved-gap' y 'text-anchor' faltaban). Este test hace que agregar una
 * fuente nueva sin su traducción sea un rojo, no un silencio en producción.
 */
const ALL_SOURCES: readonly PlacementSource[] = [
  'empty-field',
  'anti-overlap',
  'default-footer',
  'free-space',
  'reserved-gap',
  'text-anchor',
];

describe('cobertura i18n de PlacementSource', () => {
  for (const source of ALL_SOURCES) {
    for (const lang of ['es', 'en'] as const) {
      it(`lote.review.source.${source} existe en ${lang}`, () => {
        const key = `lote.review.source.${source}` as const;
        const value = (ui[lang] as Record<string, string | undefined>)[key];
        expect(value).toBeDefined();
        expect(value?.length).toBeGreaterThan(0);
      });
    }
  }
});
