import { UanatacaError } from './client.js';
import type { UanatacaClient } from './client.js';
import type {
  CertificateRequest,
  CertificateRequestStatus,
  CreateCertificateRequestInput,
  CreateCertificateRequestResult,
  ListCertificateRequestsQuery,
  Product,
  StakeholderProduct,
} from './types.js';

const STAKEHOLDER_UUID = 'fake-stakeholder';

const DEFAULT_PRODUCTS: readonly Product[] = [
  {
    uuid: 'prod-natural-1a',
    code: 'PNAR001',
    name: 'Persona Natural Archivo 1 año',
    price: 30,
    certificateUuid: 'cert-natural',
    containerUuid: 'cont-archivo',
    validityUuid: 'val-1a',
    contificoCode: 'CT001',
    active: true,
    common: true,
  },
  {
    uuid: 'prod-natural-2a',
    code: 'PNAR002',
    name: 'Persona Natural Archivo 2 años',
    price: 45,
    certificateUuid: 'cert-natural',
    containerUuid: 'cont-archivo',
    validityUuid: 'val-2a',
    contificoCode: 'CT002',
    active: true,
    common: true,
  },
];

/**
 * Implementación falsa, determinista y en memoria del UanatacaClient.
 *
 * Reproduce las transiciones NEW → IN_VALIDATION → ISSUED (y rechazos) SIN red
 * ni descuento real de Uanacréditos. NO descarga .p12 (cero-custodia).
 */
export class FakeUanatacaClient implements UanatacaClient {
  private seq = 0;
  private balance: number;
  private readonly products: readonly Product[];
  private readonly requests = new Map<string, CertificateRequest>();
  private readonly idempotency = new Map<string, string>();

  constructor(
    private readonly opts: {
      products?: readonly Product[];
      initialBalance?: number;
      /** fuerza el estado inicial de la siguiente creación (default NEW). */
      nextStatus?: CertificateRequestStatus;
    } = {},
  ) {
    this.products = opts.products ?? DEFAULT_PRODUCTS;
    this.balance = opts.initialBalance ?? 1000;
  }

  async listProducts(): Promise<Product[]> {
    return [...this.products];
  }

  async listStakeholderProducts(_stakeholderUuid: string): Promise<StakeholderProduct[]> {
    return this.products.map((p) => ({
      uuid: `sp-${p.uuid}`,
      price: p.price,
      productUuid: p.uuid,
      stakeholderUuid: STAKEHOLDER_UUID,
      active: p.active,
    }));
  }

  async getBalance(): Promise<number> {
    return this.balance;
  }

  async createCertificateRequest(
    input: CreateCertificateRequestInput,
  ): Promise<CreateCertificateRequestResult> {
    if (input.idempotencyKey !== undefined) {
      const existing = this.idempotency.get(input.idempotencyKey);
      if (existing !== undefined) {
        return { uuid: existing, location: locationOf(existing), locationMissing: false };
      }
    }
    const product = this.products.find((p) => p.uuid === input.productUuid);
    if (product === undefined) {
      throw new UanatacaError(`productUuid ${input.productUuid} no existe`, 400);
    }
    if (this.balance < product.price) {
      throw new UanatacaError('Saldo de Uanacréditos insuficiente', 400);
    }
    this.balance -= product.price;
    this.seq += 1;
    const uuid = `fake-req-${String(this.seq).padStart(4, '0')}`;
    const status = this.opts.nextStatus ?? 'NEW';
    const req: CertificateRequest = {
      uuid,
      identificationType: input.identificationType,
      identification: input.identification,
      fingerprintCode: input.fingerprintCode ?? null,
      names: input.names,
      lastName1: input.lastName1,
      lastName2: input.lastName2 ?? null,
      email: input.email,
      status,
      uanatacaStatus: status,
      comments: null,
      productUuid: input.productUuid,
      stakeholderUuid: STAKEHOLDER_UUID,
      requestDate: new Date().toISOString(),
      approvedDate: null,
      renovation: false,
    };
    this.requests.set(uuid, req);
    if (input.idempotencyKey !== undefined) this.idempotency.set(input.idempotencyKey, uuid);
    return { uuid, location: locationOf(uuid), locationMissing: false };
  }

  async listCertificateRequests(
    query: ListCertificateRequestsQuery = {},
  ): Promise<CertificateRequest[]> {
    let all = [...this.requests.values()];
    if (query.uuid !== undefined) all = all.filter((r) => r.uuid === query.uuid);
    if (query.status !== undefined) all = all.filter((r) => r.status === query.status);
    if (query.q !== undefined) {
      const q = query.q.toLowerCase();
      all = all.filter(
        (r) =>
          r.identification.toLowerCase().includes(q) ||
          (r.email ?? '').toLowerCase().includes(q) ||
          r.names.toLowerCase().includes(q),
      );
    }
    return all;
  }

  // ---- helpers de test (simulan la evolución del lado de Uanataca) ----

  /** Avanza una solicitud a un estado dado (simula el progreso en Uanataca). */
  setStatus(uuid: string, status: CertificateRequestStatus): void {
    const r = this.requests.get(uuid);
    if (r === undefined) throw new UanatacaError(`uuid ${uuid} no encontrado`, 404);
    r.status = status;
    r.uanatacaStatus = status;
    if (status === 'ISSUED') r.approvedDate = new Date().toISOString();
  }
}

function locationOf(uuid: string): string {
  return `https://distribuidores.test.uanataca.appshandler.com/certificateRequests/${uuid}`;
}
