/**
 * Tests del módulo certs (F9.0b). Monta SOLO el plugin certsRoutes en una
 * instancia Fastify mínima con un FakeSignareClient — aislado del server real
 * (sin prisma/redis/r2). Valida contrato HTTP + validación zod + flujo.
 */
import { FakeSignareClient } from '@firma-ec/signare-client';
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import certsRoutes from '../src/routes/certs.js';

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    personNature: 'natural',
    pricingPlanId: 9003, // "1 año" en COSTO_PRICING_PLANS
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
    ...overrides,
  };
}

async function build(signare = new FakeSignareClient()): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(certsRoutes, { signare });
  await app.ready();
  return app;
}

describe('certs routes (F9.0b, fake)', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await build();
  });

  it('GET /planes público: SOLO PVP, sin filtrar costo ni margen', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/certificados/planes' });
    expect(res.statusCode).toBe(200);
    const plans = res.json() as Array<Record<string, unknown>>;
    const anio = plans.find((p) => p.id === 9003);
    expect(anio?.pvp).toBe('23.60');
    expect(anio?.costoMayorista).toBeUndefined(); // NO se filtra al cliente
    expect(anio?.margen).toBeUndefined();
  });

  it('GET /planes?view=operator: incluye costo + margen', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/certificados/planes?view=operator' });
    expect(res.statusCode).toBe(200);
    const plans = res.json() as Array<{
      id: number;
      costoMayorista?: string;
      pvp: string;
      margen?: string;
    }>;
    const anio = plans.find((p) => p.id === 9003);
    expect(anio?.costoMayorista).toBe('14.50');
    expect(anio?.pvp).toBe('23.60');
    expect(anio?.margen).toBe('6.56'); // neto tras IVA + PayPhone, acreditando IVA costo
  });

  it('POST crea solicitud y devuelve 201 + certCode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/certificados/solicitudes',
      payload: validBody(),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { certCode: string; estado: string; requierePago: boolean };
    expect(body.certCode).toMatch(/^CR\d{12}$/);
    expect(body.requierePago).toBe(true);
  });

  it('POST rechaza cédula inválida (400 zod)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/certificados/solicitudes',
      payload: validBody({
        properties: { ...(validBody().properties as object), idNumber: '123' },
      }),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('validation');
  });

  it('POST exige aceptar will y contrato', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/certificados/solicitudes',
      payload: validBody({ acceptedContract: false }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST rechaza archivo vacío (400 file_size)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/certificados/solicitudes',
      payload: validBody({
        files: [{ name: 'lifeTest', contentType: 'image/jpeg', contentB64: '' }],
      }),
    });
    // contentB64 '' falla en zod (min 1) antes de llegar a file_size
    expect(res.statusCode).toBe(400);
  });

  it('GET estado por certCode tras crear', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/certificados/solicitudes',
      payload: validBody(),
    });
    const { certCode } = created.json() as { certCode: string };
    const res = await app.inject({
      method: 'GET',
      url: `/api/certificados/solicitudes/${certCode}`,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { certCode: string }).certCode).toBe(certCode);
  });

  it('GET estado de certCode inexistente = 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/certificados/solicitudes/CR000000000000',
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET lista paginada', async () => {
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/certificados/solicitudes',
        payload: validBody(),
      });
    }
    const res = await app.inject({
      method: 'GET',
      url: '/api/certificados/solicitudes?page=0&size=12',
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { totalElements: number }).totalElements).toBe(3);
  });
});
