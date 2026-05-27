import type { PricingPlan } from './types.js';

/**
 * ⚠️ SNAPSHOT DESACTUALIZADO. Planes tier "Asociado" capturados del portal el
 * 2026-05-26 vía GET /api/cert/public/pricing-plans/nature?acronym=Asociado.
 * Los precios de la cuenta de Leandro fueron ACTUALIZADOS después (ver
 * `COSTOS_ACTUALES`). Conservado solo como referencia histórica de la forma
 * del DTO + ids de plan (345-351). En runtime usar SIEMPRE listPricingPlans().
 */
export const ASOCIADO_PRICING_PLANS: readonly PricingPlan[] = [
  plan(345, '7 días AS', '8.00', '1.04', '6.96', 'DAYS', 7),
  plan(346, 'One Shot AS', '12.30', '1.60', '10.70', 'MONTHS', 1),
  plan(347, '1 año AS', '23.60', '3.08', '20.52', 'YEARS', 1),
  plan(348, '2 años AS', '35.90', '4.68', '31.22', 'YEARS', 2),
  plan(349, '3 años AS', '52.40', '6.83', '45.57', 'YEARS', 3),
  plan(350, '4 años AS', '64.70', '8.44', '56.26', 'YEARS', 4),
  plan(351, '5 años AS', '75.50', '9.85', '65.65', 'YEARS', 5),
] as const;

/**
 * COSTO ACTUAL que paga firmar.ec (precios de la cuenta de Leandro,
 * ACTUALIZADOS 2026-05-26, IVA 15% incluido). Reemplazan al snapshot
 * `ASOCIADO_PRICING_PLANS` que quedó desactualizado.
 *
 * ⚠️ Es el COSTO de adquisición; el PVP al público se fija ARRIBA de esto
 * (cubriendo además la comisión de pasarela — ver pricing-calc.ts) y debe ser
 * uniforme por método de pago (Art.50 LODC).
 *
 * Los `id` de plan reales vienen del API en runtime vía listPricingPlans().
 */
export interface CostoActual {
  code: string; // 7D | 1m | 1A..5A
  periodType: 'DAYS' | 'MONTHS' | 'YEARS';
  duration: number;
  /** total con IVA incluido (USD) */
  total: string;
}

export const COSTOS_ACTUALES: readonly CostoActual[] = [
  { code: '7D', periodType: 'DAYS', duration: 7, total: '5.50' },
  { code: '1m', periodType: 'MONTHS', duration: 1, total: '8.75' },
  { code: '1A', periodType: 'YEARS', duration: 1, total: '14.50' },
  { code: '2A', periodType: 'YEARS', duration: 2, total: '22.00' },
  { code: '3A', periodType: 'YEARS', duration: 3, total: '33.00' },
  { code: '4A', periodType: 'YEARS', duration: 4, total: '38.85' },
  { code: '5A', periodType: 'YEARS', duration: 5, total: '47.65' },
] as const;

function plan(
  id: number,
  title: string,
  total: string,
  vat: string,
  taxableAmount: string,
  periodType: string,
  duration: number,
): PricingPlan {
  return {
    id,
    title,
    price: total,
    total,
    vat,
    taxableAmount,
    periodType,
    status: 'ACTIVE',
    duration,
    includeVat: true,
    acronymCompany: 'Asociado',
  };
}

/**
 * Lo que el API de NUESTRA cuenta (Leandro) devuelve como planes: el COSTO
 * (`COSTOS_ACTUALES`) en forma de PricingPlan, con ids sintéticos estables
 * (los ids reales llegan en runtime vía listPricingPlans). El módulo certs
 * mapea cada uno a su PVP "Asociado". IVA 15% incluido → base = total/1.15.
 */
export const COSTO_PRICING_PLANS: readonly PricingPlan[] = COSTOS_ACTUALES.map((c, i) => {
  const total = Number(c.total);
  const taxable = Math.round((total / 1.15) * 100) / 100;
  const vat = Math.round((total - taxable) * 100) / 100;
  return {
    id: 9001 + i,
    title: `${c.code} (costo)`,
    price: c.total,
    total: c.total,
    vat: vat.toFixed(2),
    taxableAmount: taxable.toFixed(2),
    periodType: c.periodType,
    status: 'ACTIVE',
    duration: c.duration,
    includeVat: true,
    acronymCompany: 'Distribuidor',
  };
});
