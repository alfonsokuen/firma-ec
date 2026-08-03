/**
 * Calculadora de PVP que trata la comisión de la pasarela (PayPhone) como costo.
 *
 * PayPhone: comisión = `rate` (default 5%) + IVA sobre la comisión (default 15%)
 * → deducción efectiva = rate * (1 + iva). Con 5% + 15% = 5.75% del monto cobrado.
 *
 * NO incluye PVP fijos: el margen objetivo es decisión comercial. Estas funciones
 * solo hacen la aritmética para que el PVP cubra costo distribuidor + comisión + margen.
 */

export interface GatewayFees {
  /** comisión de la pasarela sobre el monto (0.05 = 5%) */
  rate: number;
  /** IVA sobre la comisión (0.15 = 15%) */
  iva: number;
}

/** PayPhone EC por defecto: 5% + IVA 15% → 5.75% efectivo. Confirmar con contrato. */
export const PAYPHONE_DEFAULT: GatewayFees = { rate: 0.05, iva: 0.15 };

/** Fracción del monto que retiene la pasarela (ej. 0.0575). */
export function gatewayCutFraction(f: GatewayFees = PAYPHONE_DEFAULT): number {
  return f.rate * (1 + f.iva);
}

/** Neto que recibe firmar.ec tras la comisión, dado un PVP. */
export function netAfterGateway(pvp: number, f: GatewayFees = PAYPHONE_DEFAULT): number {
  return round2(pvp * (1 - gatewayCutFraction(f)));
}

/** Ganancia (neto − costo distribuidor) dado un PVP. */
export function profitAtPvp(
  pvp: number,
  distributorCost: number,
  f: GatewayFees = PAYPHONE_DEFAULT,
): number {
  return round2(netAfterGateway(pvp, f) - distributorCost);
}

/** PVP necesario para obtener una ganancia objetivo (USD) tras comisión. */
export function pvpForProfit(
  distributorCost: number,
  targetProfit: number,
  f: GatewayFees = PAYPHONE_DEFAULT,
): number {
  return round2((distributorCost + targetProfit) / (1 - gatewayCutFraction(f)));
}

/** PVP necesario para un markup % sobre el costo (margen = costo*pct), tras comisión. */
export function pvpForMarkup(
  distributorCost: number,
  markupPct: number,
  f: GatewayFees = PAYPHONE_DEFAULT,
): number {
  return pvpForProfit(distributorCost, round2(distributorCost * markupPct), f);
}

// ───────────────────────────────────────────────────────────────────────────
// Modelo con IVA pass-through (margen REAL tras liquidar IVA con el SRI).
//
// El IVA cobrado al cliente NO es ingreso: se remite al SRI. El IVA pagado en
// el costo (factura de ArgosData) y en la comisión PayPhone es crédito tributario.
// Por eso el margen real se calcula sobre las BASES sin IVA.
//
//   ganancia_real = PVP/(1+iva) − costo/(1+iva) − PVP*rate
//                 = PVP*(1/(1+iva) − rate) − costo/(1+iva)
//
// Asume que firmar.ec es contribuyente formal de IVA (acredita el IVA pagado).
// Los precios de costo y el PVP se manejan CON IVA incluido.
// ───────────────────────────────────────────────────────────────────────────

/** Factor efectivo sobre el PVP tras IVA + comisión (ej. 0.81957). */
export function netRealFactor(f: GatewayFees = PAYPHONE_DEFAULT): number {
  return 1 / (1 + f.iva) - f.rate;
}

/** Ganancia REAL (tras liquidar IVA) dado un PVP y el costo (ambos con IVA incl.). */
export function profitWithIva(
  pvp: number,
  costWithIva: number,
  f: GatewayFees = PAYPHONE_DEFAULT,
): number {
  return round2(pvp * netRealFactor(f) - costWithIva / (1 + f.iva));
}

/** PVP (con IVA incl.) necesario para una ganancia real objetivo. */
export function pvpForProfitWithIva(
  costWithIva: number,
  targetProfit: number,
  f: GatewayFees = PAYPHONE_DEFAULT,
): number {
  return round2((targetProfit + costWithIva / (1 + f.iva)) / netRealFactor(f));
}

/**
 * Margen neto CONFIRMADO (modelo del usuario, 2026-05-26):
 *   margen = venta − IVA_venta − comisiónPayPhone − costo + IVA_costo(crédito)
 *          = venta·(1 − iva/(1+iva) − rate·(1+iva)) − costo/(1+iva)
 *
 * Ambos precios traen IVA incluido. Se acredita el IVA del costo (crédito
 * tributario); la comisión PayPhone se descuenta completa (5%+IVA) del depósito.
 * NO acredita el IVA de la comisión PayPhone (si se quisiera, ver profitWithIva).
 *
 * Con iva=0.15, rate=0.05 → factorVenta ≈ 0.81207, costo/1.15.
 */
export function netMargin(venta: number, costo: number, f: GatewayFees = PAYPHONE_DEFAULT): number {
  const ventaFactor = 1 - f.iva / (1 + f.iva) - f.rate * (1 + f.iva);
  return round2(venta * ventaFactor - costo / (1 + f.iva));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
