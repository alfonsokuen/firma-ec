/**
 * Tests del checkout (F9.0c): orden → PayPhone → al aprobar crea solicitud Signare.
 * Aislado: Fastify mínimo + FakeSignareClient + FakePayphoneClient.
 */
import { FakeSignareClient } from '@firma-ec/signare-client';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import certsRoutes from '../src/routes/certs.js';
import { FakePayphoneClient } from '../src/services/payphone.js';

function validBody(): Record<string, unknown> {
  return {
    personNature: 'natural',
    pricingPlanId: 9003, // "1 año" (costo 14.50 → PVP Asociado 23.60)
    email: 'juan@example.com',
    properties: {
      idType: 'citizen',
      idNumber: '0102030405',
      fingerPrintId: 'A1B2C3',
      names: 'Juan Carlos',
      surNames: 'Perez Lopez',
      country: 'EC',
      province: 'Guayas',
      city: 'Guayaquil',
      homeAddress: 'Av Siempre Viva 123',
      phoneExtension: '593',
      phoneNumber: '0991234567',
      requestorEmail: 'juan@example.com',
    },
    files: [
      {
        name: 'lifeTest',
        contentType: 'image/jpeg',
        contentB64: Buffer.from('x').toString('base64'),
      },
    ],
    acceptedWill: true,
    acceptedContract: true,
  };
}

async function build(approve = true): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(certsRoutes, {
    signare: new FakeSignareClient(),
    payphone: new FakePayphoneClient({ approve }),
  });
  await app.ready();
  return app;
}

describe('checkout (F9.0c)', () => {
  it('crea orden y devuelve urlPago + PVP Asociado (23.60)', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/certificados/checkout',
      payload: validBody(),
    });
    expect(res.statusCode).toBe(201);
    const b = res.json() as { orderId: string; urlPago: string; pvp: string };
    expect(b.pvp).toBe('23.60');
    expect(b.urlPago).toContain('payphone');
    expect(b.orderId).toBeTruthy();
  });

  it('pago aprobado → orden SUBMITTED con certCode', async () => {
    const app = await build(true);
    const created = (
      await app.inject({ method: 'POST', url: '/api/certificados/checkout', payload: validBody() })
    ).json() as { orderId: string };
    const res = await app.inject({
      method: 'POST',
      url: `/api/certificados/checkout/${created.orderId}/confirm`,
    });
    expect(res.statusCode).toBe(200);
    const order = res.json() as { status: string; certCode: string | null };
    expect(order.status).toBe('SUBMITTED');
    expect(order.certCode).toMatch(/^CR\d{12}$/);
  });

  it('pago rechazado → PAYMENT_FAILED, sin certCode', async () => {
    const app = await build(false);
    const created = (
      await app.inject({ method: 'POST', url: '/api/certificados/checkout', payload: validBody() })
    ).json() as { orderId: string };
    const res = await app.inject({
      method: 'POST',
      url: `/api/certificados/checkout/${created.orderId}/confirm`,
    });
    const order = res.json() as { status: string; certCode: string | null };
    expect(order.status).toBe('PAYMENT_FAILED');
    expect(order.certCode).toBeNull();
  });

  it('confirmar es idempotente (no doble emisión)', async () => {
    const app = await build(true);
    const created = (
      await app.inject({ method: 'POST', url: '/api/certificados/checkout', payload: validBody() })
    ).json() as { orderId: string };
    const r1 = (
      await app.inject({
        method: 'POST',
        url: `/api/certificados/checkout/${created.orderId}/confirm`,
      })
    ).json() as { certCode: string };
    const r2 = (
      await app.inject({
        method: 'POST',
        url: `/api/certificados/checkout/${created.orderId}/confirm`,
      })
    ).json() as { certCode: string };
    expect(r1.certCode).toBe(r2.certCode);
  });

  it('confirmar orden inexistente = 404', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/certificados/checkout/nope/confirm',
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET estado de la orden', async () => {
    const app = await build();
    const created = (
      await app.inject({ method: 'POST', url: '/api/certificados/checkout', payload: validBody() })
    ).json() as { orderId: string };
    const res = await app.inject({
      method: 'GET',
      url: `/api/certificados/checkout/${created.orderId}`,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe('PENDING_PAYMENT');
  });
});
