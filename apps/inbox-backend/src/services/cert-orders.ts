import { randomUUID } from 'node:crypto';
/**
 * Orquestación de compra de certificado (F9.0c + persistencia F9.2).
 *
 *   crear orden (PENDING_PAYMENT) → preparar pago PayPhone (PVP Asociado)
 *   → cliente paga → confirmar → si aprueba: crear solicitud en Signare (SUBMITTED).
 *
 * LOPDP: los archivos de identidad/biometría NO se guardan en la BD; van a una
 * bóveda cifrada (R2 en prod) y se PURGAN tras enviarlos a Signare. El store
 * persiste solo el ciclo de vida + PII de contacto (sin archivos).
 */
import {
  ASOCIADO_PRICING_PLANS,
  type CreateCertRequestInput,
  type SignareClient,
} from '@firma-ec/signare-client';
import type { PayphoneClient } from './payphone.js';

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'SUBMITTED'
  | 'PAYMENT_FAILED'
  | 'SUBMIT_FAILED';

export interface CertOrder {
  id: string;
  status: OrderStatus;
  pvp: string;
  paymentId: string | null;
  paymentUrl: string | null;
  certCode: string | null;
  createdAt: string;
}

type CertFile = CreateCertRequestInput['files'][number];
type CertInputNoFiles = Omit<CreateCertRequestInput, 'files' | 'idempotencyKey'>;

export interface CreateCheckoutInput {
  cert: Omit<CreateCertRequestInput, 'idempotencyKey'>;
}

// ─── Abstracciones persistencia (fakes in-memory; Prisma/R2 en F9.2/F9.3) ───

export interface StoredOrder {
  id: string;
  status: OrderStatus;
  pvp: string;
  email: string;
  pricingPlanId: number;
  certInput: CertInputNoFiles;
  filesRef: string | null;
  paymentId: string | null;
  paymentUrl: string | null;
  certCode: string | null;
  createdAt: string;
}

export interface CertOrderStore {
  create(o: StoredOrder): Promise<void>;
  get(id: string): Promise<StoredOrder | null>;
  update(id: string, patch: Partial<StoredOrder>): Promise<void>;
  addEvent(id: string, type: string, payload: unknown): Promise<void>;
}

export interface CertFileVault {
  put(orderId: string, files: CertFile[]): Promise<string>;
  get(ref: string): Promise<CertFile[]>;
  purge(ref: string): Promise<void>;
}

export class InMemoryCertOrderStore implements CertOrderStore {
  private readonly rows = new Map<string, StoredOrder>();
  async create(o: StoredOrder): Promise<void> {
    this.rows.set(o.id, { ...o });
  }
  async get(id: string): Promise<StoredOrder | null> {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }
  async update(id: string, patch: Partial<StoredOrder>): Promise<void> {
    const r = this.rows.get(id);
    if (r) this.rows.set(id, { ...r, ...patch });
  }
  async addEvent(_id: string, _type: string, _payload: unknown): Promise<void> {
    /* in-memory: eventos no-op (los tests verifican estado, no trail) */
  }
}

export class InMemoryCertFileVault implements CertFileVault {
  private readonly blobs = new Map<string, CertFile[]>();
  async put(orderId: string, files: CertFile[]): Promise<string> {
    const ref = `mem://${orderId}`;
    this.blobs.set(ref, files);
    return ref;
  }
  async get(ref: string): Promise<CertFile[]> {
    const f = this.blobs.get(ref);
    if (!f) throw new OrderError('files_purged_or_missing', 410);
    return f;
  }
  async purge(ref: string): Promise<void> {
    this.blobs.delete(ref);
  }
}

/** PVP Asociado (con IVA) para un plan de costo, por periodo+duración. */
export function pvpAsociadoFor(periodType: string, duration: number): string | null {
  return (
    ASOCIADO_PRICING_PLANS.find((p) => p.periodType === periodType && p.duration === duration)
      ?.total ?? null
  );
}

export class CertOrderService {
  private readonly store: CertOrderStore;
  private readonly vault: CertFileVault;

  constructor(
    private readonly signare: SignareClient,
    private readonly payphone: PayphoneClient,
    deps: { store?: CertOrderStore; vault?: CertFileVault } = {},
  ) {
    this.store = deps.store ?? new InMemoryCertOrderStore();
    this.vault = deps.vault ?? new InMemoryCertFileVault();
  }

  async createCheckout(
    input: CreateCheckoutInput,
    pvp: string,
  ): Promise<{ orderId: string; paymentUrl: string; pvp: string }> {
    const id = randomUUID();
    const amountCents = Math.round(Number(pvp) * 100);
    const { files, ...certNoFiles } = input.cert;
    const filesRef = await this.vault.put(id, files);
    const prep = await this.payphone.prepare({
      amount: amountCents,
      tax: amountCents - Math.round(amountCents / 1.15), // IVA incluido en el PVP
      clientTransactionId: id,
      reference: `Certificado firmar.ec ${id.slice(0, 8)}`,
    });
    await this.store.create({
      id,
      status: 'PENDING_PAYMENT',
      pvp,
      email: certNoFiles.email,
      pricingPlanId: certNoFiles.pricingPlanId,
      certInput: certNoFiles,
      filesRef,
      paymentId: prep.paymentId,
      paymentUrl: prep.paymentUrl,
      certCode: null,
      createdAt: new Date().toISOString(),
    });
    await this.store.addEvent(id, 'CHECKOUT_CREATED', { pvp, paymentId: prep.paymentId });
    return { orderId: id, paymentUrl: prep.paymentUrl, pvp };
  }

  async confirmPayment(orderId: string): Promise<CertOrder> {
    const order = await this.store.get(orderId);
    if (!order) throw new OrderError('order_not_found', 404);
    if (order.status === 'SUBMITTED') return toPublic(order);

    const conf = await this.payphone.confirm(order.paymentId ?? '', orderId);
    if (!conf.approved) {
      await this.store.update(orderId, { status: 'PAYMENT_FAILED' });
      await this.store.addEvent(orderId, 'PAYMENT_FAILED', { message: conf.message });
      return toPublic({ ...order, status: 'PAYMENT_FAILED' });
    }
    await this.store.update(orderId, { status: 'PAID' });
    await this.store.addEvent(orderId, 'PAID', { ref: conf.transactionReference });

    try {
      const files = order.filesRef ? await this.vault.get(order.filesRef) : [];
      const res = await this.signare.createCertificateRequest({
        ...order.certInput,
        files,
        idempotencyKey: orderId,
      });
      await this.store.update(orderId, { status: 'SUBMITTED', certCode: res.certCode });
      await this.store.addEvent(orderId, 'SUBMITTED', { certCode: res.certCode });
      // LOPDP: purga de archivos tras enviarlos a la ACE.
      if (order.filesRef) {
        await this.vault.purge(order.filesRef);
        await this.store.update(orderId, { filesRef: null });
      }
      return toPublic({ ...order, status: 'SUBMITTED', certCode: res.certCode });
    } catch {
      await this.store.update(orderId, { status: 'SUBMIT_FAILED' });
      await this.store.addEvent(orderId, 'SUBMIT_FAILED', {});
      return toPublic({ ...order, status: 'SUBMIT_FAILED' });
    }
  }

  async get(orderId: string): Promise<CertOrder | null> {
    const o = await this.store.get(orderId);
    return o ? toPublic(o) : null;
  }
}

export class OrderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'OrderError';
  }
}

function toPublic(o: StoredOrder): CertOrder {
  return {
    id: o.id,
    status: o.status,
    pvp: o.pvp,
    paymentId: o.paymentId,
    paymentUrl: o.paymentUrl,
    certCode: o.certCode,
    createdAt: o.createdAt,
  };
}
