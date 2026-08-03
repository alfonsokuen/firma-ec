import { describe, expect, it } from 'vitest';
import {
  COSTO_PRICING_PLANS,
  type CreateCertRequestInput,
  FakeSignareClient,
  type NaturalPersonProperties,
  SignareError,
} from '../src/index.js';

/** id sintético del plan "1 año" en COSTO_PRICING_PLANS (7D,1m,1A → índice 2). */
const PLAN_1A = 9003;

const naturalProps: NaturalPersonProperties = {
  idType: 'citizen',
  idNumber: '0102030405',
  fingerPrintId: 'A1B2C3',
  names: 'Juan Carlos',
  surNames: 'Perez Lopez',
  country: 'EC',
  province: 'Guayas',
  city: 'Guayaquil',
  homeAddress: 'Av. Siempre Viva 123',
  phoneExtension: '593',
  phoneNumber: '0991234567',
  requestorEmail: 'juan@example.com',
};

function input(overrides: Partial<CreateCertRequestInput> = {}): CreateCertRequestInput {
  return {
    personNature: 'natural',
    pricingPlanId: PLAN_1A,
    email: 'juan@example.com',
    properties: naturalProps,
    files: [{ name: 'lifeTest', contentType: 'image/jpeg', content: new Uint8Array([1, 2, 3]) }],
    acceptedWill: true,
    acceptedContract: true,
    faceLiveness: false,
    ...overrides,
  };
}

describe('FakeSignareClient', () => {
  it('lista los planes de COSTO de nuestra cuenta', async () => {
    const c = new FakeSignareClient();
    const plans = await c.listPricingPlans('natural');
    expect(plans).toHaveLength(COSTO_PRICING_PLANS.length);
    expect(plans.find((p) => p.id === PLAN_1A)?.total).toBe('14.50');
  });

  it('crea una solicitud con certCode y estado WAITING_KEYSTORE por defecto', async () => {
    const c = new FakeSignareClient();
    const res = await c.createCertificateRequest(input());
    expect(res.certCode).toMatch(/^CR\d{8}\d{4}$/);
    expect(res.status).toBe('WAITING_KEYSTORE');
    expect(res.needPayment).toBe(true);
    expect(res.paymentUrl).toContain(res.certCode);
  });

  it('respeta idempotencyKey: dos creaciones devuelven el mismo certCode', async () => {
    const c = new FakeSignareClient();
    const a = await c.createCertificateRequest(input({ idempotencyKey: 'k1' }));
    const b = await c.createCertificateRequest(input({ idempotencyKey: 'k1' }));
    expect(a.certCode).toBe(b.certCode);
    const page = await c.listCertificateRequests();
    expect(page.totalElements).toBe(1);
  });

  it('rechaza pricingPlanId inexistente', async () => {
    const c = new FakeSignareClient();
    await expect(c.createCertificateRequest(input({ pricingPlanId: 9999 }))).rejects.toBeInstanceOf(
      SignareError,
    );
  });

  it('downloadP12 falla si no está COMPLETE y funciona tras markComplete', async () => {
    const c = new FakeSignareClient();
    const res = await c.createCertificateRequest(input());
    await expect(c.downloadP12(res.certCode)).rejects.toMatchObject({ status: 409 });
    c.markComplete(res.certCode);
    const p12 = await c.downloadP12(res.certCode);
    expect(p12.length).toBeGreaterThan(0);
    const certs = await c.listCertificates();
    expect(certs.totalElements).toBe(1);
  });

  it('puede forzar rechazo via nextOutcome', async () => {
    const c = new FakeSignareClient({ nextOutcome: 'REJECTED' });
    const res = await c.createCertificateRequest(input());
    const req = await c.getCertificateRequest(res.certCode);
    expect(req.status).toBe('REJECTED');
    expect(req.reason).toBe('FAKE_REJECT');
  });

  it('pagina las solicitudes', async () => {
    const c = new FakeSignareClient();
    for (let i = 0; i < 15; i++) await c.createCertificateRequest(input());
    const p0 = await c.listCertificateRequests(0, 12);
    expect(p0.content).toHaveLength(12);
    expect(p0.first).toBe(true);
    expect(p0.last).toBe(false);
    const p1 = await c.listCertificateRequests(1, 12);
    expect(p1.content).toHaveLength(3);
    expect(p1.last).toBe(true);
  });
});
