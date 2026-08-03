/**
 * Implementación Prisma de CertOrderStore (F9.2). Persiste el ciclo de vida de
 * la orden + eventos (trail). NO guarda archivos (van a la bóveda R2, ver
 * CertFileVault). Usar en prod inyectándola al CertOrderService.
 */
import type { PrismaClient } from '@prisma/client';
import type { CertOrderStore, OrderStatus, StoredOrder } from './cert-orders.js';

type CertInput = StoredOrder['certInput'];

export class PrismaCertOrderStore implements CertOrderStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(o: StoredOrder): Promise<void> {
    await this.prisma.certOrder.create({
      data: {
        id: o.id,
        status: o.status,
        pvp: o.pvp,
        email: o.email,
        pricingPlanId: o.pricingPlanId,
        certInput: o.certInput as object,
        filesRef: o.filesRef,
        paymentId: o.paymentId,
        paymentUrl: o.paymentUrl,
        certCode: o.certCode,
      },
    });
  }

  async get(id: string): Promise<StoredOrder | null> {
    const r = await this.prisma.certOrder.findUnique({ where: { id } });
    if (!r) return null;
    return {
      id: r.id,
      status: r.status as OrderStatus,
      pvp: r.pvp.toString(),
      email: r.email,
      pricingPlanId: r.pricingPlanId,
      certInput: r.certInput as unknown as CertInput,
      filesRef: r.filesRef,
      paymentId: r.paymentId,
      paymentUrl: r.paymentUrl,
      certCode: r.certCode,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async update(id: string, patch: Partial<StoredOrder>): Promise<void> {
    await this.prisma.certOrder.update({
      where: { id },
      data: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.certCode !== undefined ? { certCode: patch.certCode } : {}),
        ...(patch.filesRef !== undefined ? { filesRef: patch.filesRef } : {}),
        ...(patch.paymentId !== undefined ? { paymentId: patch.paymentId } : {}),
      },
    });
  }

  async addEvent(orderId: string, type: string, payload: unknown): Promise<void> {
    await this.prisma.certOrderEvent.create({
      data: { orderId, type, payload: (payload ?? {}) as object },
    });
  }
}
