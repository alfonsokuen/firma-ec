/**
 * Modelo de negocio firmar.ec: COMPRA al costo de la cuenta (Leandro actualizado,
 * `COSTOS_ACTUALES`) y VENDE al precio "Asociado" (`ASOCIADO_PRICING_PLANS`).
 *
 * Margen neto CONFIRMADO (2026-05-26): de la venta se resta IVA + comisión
 * PayPhone; del costo se acredita su IVA. Ver `netMargin` en pricing-calc.ts.
 */
import { ASOCIADO_PRICING_PLANS, COSTOS_ACTUALES } from './pricing.js';
import { PAYPHONE_DEFAULT, type GatewayFees, netMargin } from './pricing-calc.js';

export interface MarginRow {
  code: string; // 7D | 1m | 1A..5A
  costo: number; // lo que paga firmar.ec (con IVA)
  pvp: number; // precio Asociado al público (con IVA)
  margen: number; // margen neto (venta − IVA − PayPhone − costo + IVA costo)
  margenPct: number; // margen / costo
}

/** Tabla de márgenes vendiendo al precio Asociado. */
export function marginTableAsociado(fees: GatewayFees = PAYPHONE_DEFAULT): MarginRow[] {
  return COSTOS_ACTUALES.map((c) => {
    const plan = ASOCIADO_PRICING_PLANS.find(
      (p) => p.periodType === c.periodType && p.duration === c.duration,
    );
    if (!plan) throw new Error(`sin precio Asociado para ${c.code}`);
    const costo = Number(c.total);
    const pvp = Number(plan.total);
    const margen = netMargin(pvp, costo, fees);
    return {
      code: c.code,
      costo,
      pvp,
      margen,
      margenPct: Math.round((margen / costo) * 1000) / 10,
    };
  });
}
