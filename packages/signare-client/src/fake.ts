import { SignareError } from './client.js';
import type { SignareClient } from './client.js';
import { COSTO_PRICING_PLANS } from './pricing.js';
import type {
  CertRequest,
  CertificateInfo,
  CreateCertRequestInput,
  CreateCertRequestResult,
  Page,
  PricingPlan,
} from './types.js';

/**
 * Implementación falsa, determinista y en memoria del SignareClient.
 * Permite construir y testear UI/backend/colas SIN tocar el API real
 * (que cobra saldo mayorista y dispara Registro Civil / prueba de vida).
 *
 * Reproduce las transiciones de estado del flujo: CREATED → WAITING_KEYSTORE
 * → COMPLETE, y rechazos. NO hace red.
 */
export class FakeSignareClient implements SignareClient {
  private seq = 0;
  private readonly requests = new Map<string, CertRequest>();
  private readonly idempotency = new Map<string, string>();

  constructor(
    private readonly opts: {
      plans?: readonly PricingPlan[];
      /** fuerza el resultado de la siguiente creación (para testear rechazos) */
      nextOutcome?: 'COMPLETE' | 'REJECTED' | 'WAITING_KEYSTORE';
      /** p12 a devolver en downloadP12 */
      p12?: Uint8Array;
    } = {},
  ) {}

  async listPricingPlans(_personNature: string, _acronym?: string): Promise<PricingPlan[]> {
    return [...(this.opts.plans ?? COSTO_PRICING_PLANS)];
  }

  async createCertificateRequest(
    input: CreateCertRequestInput,
  ): Promise<CreateCertRequestResult> {
    if (input.idempotencyKey && this.idempotency.has(input.idempotencyKey)) {
      const existing = this.requests.get(this.idempotency.get(input.idempotencyKey)!)!;
      return toResult(existing);
    }

    const plan = (this.opts.plans ?? COSTO_PRICING_PLANS).find(
      (p) => p.id === input.pricingPlanId,
    );
    if (!plan) {
      throw new SignareError(`pricingPlanId ${input.pricingPlanId} no existe`, 400);
    }

    this.seq += 1;
    const certCode = `CR${dateStamp()}${String(this.seq).padStart(4, '0')}`;
    const status = this.opts.nextOutcome ?? 'WAITING_KEYSTORE';
    const cost = String(Math.round(Number(plan.total) * 100));

    const req: CertRequest = {
      certificateRequestId: 40000 + this.seq,
      certificateId: status === 'COMPLETE' ? 50000 + this.seq : null,
      certCode,
      status,
      cost,
      periodType: plan.periodType,
      duration: String(plan.duration),
      email: input.email,
      idNumber: 'idNumber' in input.properties ? input.properties.idNumber : null,
      registerDate: new Date().toISOString(),
      score: status === 'REJECTED' ? 0.1 : 0.99,
      similarity: status === 'REJECTED' ? 0.2 : 0.98,
      reason: status === 'REJECTED' ? 'FAKE_REJECT' : null,
      manualVerification: false,
      automaticVerification: status !== 'REJECTED',
      needPayment: true,
      paymentUrl: `https://fake.paymentez/checkout/${certCode}`,
      paymentInformation: null,
      personNature: input.personNature,
      physicalToken: false,
    };

    this.requests.set(certCode, req);
    if (input.idempotencyKey) this.idempotency.set(input.idempotencyKey, certCode);
    return toResult(req);
  }

  async listCertificateRequests(page = 0, pageSize = 12): Promise<Page<CertRequest>> {
    return paginate([...this.requests.values()], page, pageSize);
  }

  async getCertificateRequest(certCode: string): Promise<CertRequest> {
    const r = this.requests.get(certCode);
    if (!r) throw new SignareError(`certCode ${certCode} no encontrado`, 404);
    return r;
  }

  async listCertificates(page = 0, pageSize = 12): Promise<Page<CertificateInfo>> {
    const issued = [...this.requests.values()]
      .filter((r) => r.status === 'COMPLETE')
      .map<CertificateInfo>((r) => ({
        id: r.certificateId ?? 0,
        certificateIdAssociated: r.certificateId,
        subjectDN: `CN=${r.idNumber ?? 'NN'}`,
        issuerDN: 'CN=ArgosData CA (FAKE)',
        notValidBefore: r.registerDate,
        notValidAfter: r.registerDate,
        serialNumber: r.certCode,
        status: 'ACTIVE',
        personNature: String(r.personNature ?? 'natural'),
        idNumber: r.idNumber ?? '',
        email: r.email ?? '',
        renewalStatus: null,
        renewalCertCode: null,
        renewalCondition: false,
      }));
    return paginate(issued, page, pageSize);
  }

  async downloadP12(certCode: string): Promise<Uint8Array> {
    const r = this.requests.get(certCode);
    if (!r) throw new SignareError(`certCode ${certCode} no encontrado`, 404);
    if (r.status !== 'COMPLETE') {
      throw new SignareError(`certCode ${certCode} no está COMPLETE (${r.status})`, 409);
    }
    return this.opts.p12 ?? new Uint8Array([0x30, 0x82]); // prefijo PKCS#12 dummy
  }

  /** helper de test: avanza una solicitud a COMPLETE (simula webhook). */
  markComplete(certCode: string): void {
    const r = this.requests.get(certCode);
    if (!r) throw new SignareError(`certCode ${certCode} no encontrado`, 404);
    r.status = 'COMPLETE';
    r.certificateId = 50000 + r.certificateRequestId;
    r.needPayment = false;
  }
}

function toResult(r: CertRequest): CreateCertRequestResult {
  return {
    certificateRequestId: r.certificateRequestId,
    certCode: r.certCode,
    status: r.status,
    needPayment: r.needPayment,
    paymentUrl: r.paymentUrl,
  };
}

function paginate<T>(all: T[], page: number, size: number): Page<T> {
  const start = page * size;
  const content = all.slice(start, start + size);
  const totalPages = Math.max(1, Math.ceil(all.length / size));
  return {
    content,
    totalElements: all.length,
    totalPages,
    number: page,
    size,
    first: page === 0,
    last: page >= totalPages - 1,
  };
}

function dateStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
