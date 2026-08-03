/**
 * Red-first: antes de que el e2e del colocador manual del lote
 * (`tests/e2e/firmar-lote-colocador-manual.spec.ts`) confíe en
 * `buildNoFreeSlotPdf()` para producir una fila `needs_review` de verdad,
 * este test lo verifica contra el pipeline REAL de una sola vez, en Node —
 * sin navegador. Si una futura afinación del algoritmo de colocación deja de
 * rechazar esta forma de documento, esto falla aquí, rápido, en vez de que el
 * e2e se vuelva flaky por construcción (el botón "Firmar este a mano" nunca
 * aparecería, y el test fallaría con un timeout de Playwright sin decir por
 * qué).
 */
import { describe, expect, it } from 'vitest';
import { buildNoFreeSlotPdf } from './noFreeSlotPdf';
import { analyzeForPreflight } from './preflight-core';

describe('buildNoFreeSlotPdf', () => {
  it('sale needs_review / no_free_slot contra el pipeline real de colocación', async () => {
    const bytes = await buildNoFreeSlotPdf();
    const outcome = await analyzeForPreflight(bytes);

    expect(outcome.status).toBe('needs_review');
    expect(outcome.reason).toBe('no_free_slot');
    expect(outcome.placement).toBeUndefined();
    expect(outcome.pageCount).toBe(1);
  });
});
