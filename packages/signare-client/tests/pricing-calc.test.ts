import { describe, expect, it } from 'vitest';
import {
  PAYPHONE_DEFAULT,
  gatewayCutFraction,
  netAfterGateway,
  profitAtPvp,
  pvpForProfit,
} from '../src/index.js';

describe('pricing-calc (comisión PayPhone como costo)', () => {
  it('PayPhone 5% + IVA 15% = 5.75% efectivo', () => {
    expect(gatewayCutFraction(PAYPHONE_DEFAULT)).toBeCloseTo(0.0575, 5);
  });

  it('neto tras comisión = PVP * 0.9425', () => {
    expect(netAfterGateway(100)).toBeCloseTo(94.25, 2);
  });

  it('ganancia a un PVP dado descuenta comisión y costo', () => {
    // costo 14.50 (1 año), PVP 24.90 → neto 23.47 → ganancia ~8.97
    expect(profitAtPvp(24.9, 14.5)).toBeCloseTo(8.97, 2);
  });

  it('pvpForProfit invierte la fórmula', () => {
    const pvp = pvpForProfit(14.5, 9); // costo 14.50, ganancia objetivo 9
    expect(profitAtPvp(pvp, 14.5)).toBeCloseTo(9, 1);
  });

  it('redondea a 2 decimales', () => {
    expect(Number.isInteger(netAfterGateway(33) * 100)).toBe(true);
  });
});
