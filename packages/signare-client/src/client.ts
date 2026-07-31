import type {
  CertRequest,
  CertificateInfo,
  CreateCertRequestInput,
  CreateCertRequestResult,
  Page,
  PricingPlan,
} from './types.js';

/**
 * Interfaz del cliente Signare. Abstrae el API real para que UI/backend/colas
 * se construyan y testeen contra `FakeSignareClient` mientras se obtiene de
 * Montran el acceso M2M (OAuth client_credentials) para el adapter HTTP real.
 */
export interface SignareClient {
  /** GET /api/cert/public/pricing-plans/nature?personNature=&acronym= */
  listPricingPlans(personNature: string, acronym?: string): Promise<PricingPlan[]>;

  /** POST de creación (CertificateRequestCreationDTO). Consume saldo mayorista. */
  createCertificateRequest(input: CreateCertRequestInput): Promise<CreateCertRequestResult>;

  /** GET /api/cert/certificate-requests (paginado Spring) */
  listCertificateRequests(page?: number, pageSize?: number): Promise<Page<CertRequest>>;

  /** Estado de una solicitud por certCode (verify-certcode / find). */
  getCertificateRequest(certCode: string): Promise<CertRequest>;

  /** GET /api/cert/certificates (emitidos, paginado) */
  listCertificates(page?: number, pageSize?: number): Promise<Page<CertificateInfo>>;

  /** Descarga el .p12 emitido. Solo en modo keystore (no CSR). */
  downloadP12(certCode: string): Promise<Uint8Array>;
}

export class SignareError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'SignareError';
  }
}
