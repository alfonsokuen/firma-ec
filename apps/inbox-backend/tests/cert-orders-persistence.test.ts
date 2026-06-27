/**
 * F9.2 — persistencia. (1) PrismaCertOrderStore contra un Prisma falso.
 * (2) LOPDP: tras enviar a Signare, los archivos se purgan de la bóveda y
 *     filesRef queda en null.
 */
import { FakeSignareClient } from '@firma-ec/signare-client';
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  CertOrderService,
  InMemoryCertFileVault,
  InMemoryCertOrderStore,
  type CreateCheckoutInput,
  type StoredOrder,
} from '../src/services/cert-orders.js';
import { PrismaCertOrderStore } from '../src/services/cert-orders-prisma.js';
import { FakePayphoneClient } from '../src/services/payphone.js';

// ── Fake Prisma (solo lo que usa el store) ──
function fakePrisma(): { prisma: PrismaClient; events: unknown[] } {
  const rows = new Map<string, Record<string, unknown>>();
  const events: unknown[] = [];
  const prisma = {
    certOrder: {
      async create({ data }: { data: Record<string, unknown> }) {
        rows.set(data.id as string, {
          ...data,
          pvp: { toString: () => String(data.pvp) },
          createdAt: new Date(),
        });
        return data;
      },
      async findUnique({ where }: { where: { id: string } }) {
        return rows.get(where.id) ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const r = rows.get(where.id);
        if (r) rows.set(where.id, { ...r, ...data });
        return r;
      },
    },
    certOrderEvent: {
      async create({ data }: { data: unknown }) {
        events.push(data);
        return data;
      },
    },
  } as unknown as PrismaClient;
  return { prisma, events };
}

const sampleOrder: StoredOrder = {
  id: 'ord-1',
  status: 'PENDING_PAYMENT',
  pvp: '23.60',
  email: 'juan@example.com',
  pricingPlanId: 9003,
  certInput: {
    personNature: 'natural',
    pricingPlanId: 9003,
    email: 'juan@example.com',
    properties: {
      idType: 'citizen',
      idNumber: '0102030405',
      fingerPrintId: 'A1B2C3',
      names: 'Juan',
      surNames: 'Perez',
      country: 'EC',
      province: 'Guayas',
      city: 'GYE',
      homeAddress: 'Av 1',
      phoneExtension: '593',
      phoneNumber: '0991234567',
      requestorEmail: 'juan@example.com',
    },
    acceptedWill: true,
    acceptedContract: true,
    faceLiveness: false,
  },
  filesRef: 'mem://ord-1',
  paymentId: 'PP-1',
  paymentUrl: 'https://fake/p/1',
  certCode: null,
  createdAt: new Date().toISOString(),
};

describe('PrismaCertOrderStore', () => {
  it('create + get roundtrip', async () => {
    const { prisma } = fakePrisma();
    const store = new PrismaCertOrderStore(prisma);
    await store.create(sampleOrder);
    const got = await store.get('ord-1');
    expect(got?.email).toBe('juan@example.com');
    expect(got?.pvp).toBe('23.60');
    expect(got?.pricingPlanId).toBe(9003);
  });

  it('update + addEvent', async () => {
    const { prisma, events } = fakePrisma();
    const store = new PrismaCertOrderStore(prisma);
    await store.create(sampleOrder);
    await store.update('ord-1', { status: 'SUBMITTED', certCode: 'CR202605260001', filesRef: null });
    await store.addEvent('ord-1', 'SUBMITTED', { certCode: 'CR202605260001' });
    const got = await store.get('ord-1');
    expect(got?.status).toBe('SUBMITTED');
    expect(got?.certCode).toBe('CR202605260001');
    expect(got?.filesRef).toBeNull();
    expect(events).toHaveLength(1);
  });
});

describe('LOPDP: purga de archivos tras enviar a Signare', () => {
  it('vault queda vacío y filesRef = null tras SUBMITTED', async () => {
    const store = new InMemoryCertOrderStore();
    const vault = new InMemoryCertFileVault();
    const svc = new CertOrderService(new FakeSignareClient(), new FakePayphoneClient({ approve: true }), {
      store,
      vault,
    });
    const input: CreateCheckoutInput = {
      cert: {
        ...sampleOrder.certInput,
        files: [{ name: 'lifeTest', contentType: 'image/jpeg', content: new Uint8Array([1, 2, 3]) }],
      },
    };
    const { orderId } = await svc.createCheckout(input, '23.60');
    const before = await store.get(orderId);
    const ref = before?.filesRef ?? '';
    expect(await vault.get(ref)).toHaveLength(1); // archivos presentes antes de confirmar

    const order = await svc.confirmPayment(orderId);
    expect(order.status).toBe('SUBMITTED');

    const after = await store.get(orderId);
    expect(after?.filesRef).toBeNull(); // referencia anulada
    await expect(vault.get(ref)).rejects.toMatchObject({ status: 410 }); // purgado
  });
});
