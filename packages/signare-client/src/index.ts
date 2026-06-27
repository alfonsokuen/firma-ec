export * from './types.js';
export { SignareError } from './client.js';
export type { SignareClient } from './client.js';
export { FakeSignareClient } from './fake.js';
export { SignareHttpClient } from './http.js';
export type { SignareAuthProvider, SignareHttpOptions } from './http.js';
export { ASOCIADO_PRICING_PLANS, COSTOS_ACTUALES, COSTO_PRICING_PLANS } from './pricing.js';
export type { CostoActual } from './pricing.js';
export {
  PAYPHONE_DEFAULT,
  gatewayCutFraction,
  netAfterGateway,
  profitAtPvp,
  pvpForProfit,
  pvpForMarkup,
  netRealFactor,
  profitWithIva,
  pvpForProfitWithIva,
  netMargin,
} from './pricing-calc.js';
export type { GatewayFees } from './pricing-calc.js';
export { marginTableAsociado } from './margins.js';
export type { MarginRow } from './margins.js';
