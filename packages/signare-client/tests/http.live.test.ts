/**
 * Test de integración EN VIVO contra el API real de Signare.
 * Gated por env SIGNARE_LIVE=1 — en CI/normal se SALTA (no red, no flakiness).
 *
 *   SIGNARE_LIVE=1 pnpm --filter @firma-ec/signare-client test
 *
 * Solo toca el endpoint PÚBLICO de planes (sin auth, sin costo). NUNCA creación.
 */
import { describe, expect, it } from 'vitest';
import { SignareHttpClient } from '../src/index.js';

const LIVE = process.env.SIGNARE_LIVE === '1';

describe.skipIf(!LIVE)('SignareHttpClient (live, público)', () => {
  it('listPricingPlans devuelve el tier Asociado real', async () => {
    const c = new SignareHttpClient();
    const plans = await c.listPricingPlans('natural', 'Asociado');
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.find((p) => p.title.includes('1 año'))?.total).toBeTruthy();
  });
});
