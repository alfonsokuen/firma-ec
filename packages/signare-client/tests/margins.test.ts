import { describe, expect, it } from 'vitest';
import { marginTableAsociado, netMargin } from '../src/index.js';

describe('netMargin (venta − IVA − PayPhone − costo + IVA costo)', () => {
  it('1 año: venta 23.60, costo 14.50 → 6.56', () => {
    expect(netMargin(23.6, 14.5)).toBeCloseTo(6.56, 2);
  });
  it('7 días: venta 8.00, costo 5.50 → 1.71', () => {
    expect(netMargin(8.0, 5.5)).toBeCloseTo(1.71, 2);
  });
  it('5 años: venta 75.50, costo 47.65 → 19.88', () => {
    expect(netMargin(75.5, 47.65)).toBeCloseTo(19.88, 2);
  });
});

describe('marginTableAsociado (compra costo Leandro, vende Asociado)', () => {
  const rows = marginTableAsociado();

  it('cubre los 7 planes', () => {
    expect(rows).toHaveLength(7);
  });

  it('1 año: costo 14.50, PVP 23.60, margen 6.56', () => {
    const a = rows.find((r) => r.code === '1A');
    expect(a?.costo).toBe(14.5);
    expect(a?.pvp).toBe(23.6);
    expect(a?.margen).toBeCloseTo(6.56, 2);
  });

  it('todos los márgenes son positivos', () => {
    for (const r of rows) expect(r.margen).toBeGreaterThan(0);
  });
});
