import { SignareError } from './client.js';
import type { SignareClient } from './client.js';
import type {
  CertRequest,
  CertificateInfo,
  CreateCertRequestInput,
  CreateCertRequestResult,
  Page,
  PricingPlan,
} from './types.js';

/**
 * Adapter HTTP real contra `https://api.argosdata.com.ec/api/cert`.
 *
 * ⚠️ ESTADO: parcial. Los endpoints PÚBLICOS (pricing-plans) funcionan sin auth.
 * Los endpoints autenticados requieren resolver con Montran el acceso M2M:
 * el portal usa OAuth2 authorization_code (client_id=api-gateway) → cookie de
 * sesión (NO Bearer). Para server-to-server hace falta un cliente
 * `client_credentials` dedicado. Hasta entonces, `auth` se inyecta como un
 * proveedor de headers (cookie o bearer) que el integrador resuelve afuera.
 *
 * El `POST` de creación NO aparece en el OpenAPI capturado (grupo de gestión);
 * su path/shape se confirma observando una solicitud real del operador. Por eso
 * `createCertificateRequest` está marcado como NOT_IMPLEMENTED a propósito.
 */
export interface SignareAuthProvider {
  /** Devuelve headers de auth (ej. { Cookie } o { Authorization }). */
  headers(): Promise<Record<string, string>>;
}

export interface SignareHttpOptions {
  baseUrl?: string; // default https://api.argosdata.com.ec
  auth?: SignareAuthProvider;
  acronym?: string; // tier mayorista, default "Asociado"
  fetchImpl?: typeof fetch;
}

export class SignareHttpClient implements SignareClient {
  private readonly base: string;
  private readonly api: string;
  private readonly acronym: string;
  private readonly auth: SignareAuthProvider | undefined;
  private readonly f: typeof fetch;

  constructor(opts: SignareHttpOptions = {}) {
    this.base = (opts.baseUrl ?? 'https://api.argosdata.com.ec').replace(/\/$/, '');
    this.api = `${this.base}/api/cert`;
    this.acronym = opts.acronym ?? 'Asociado';
    this.auth = opts.auth;
    this.f = opts.fetchImpl ?? globalThis.fetch;
  }

  // ✅ Verificado en vivo 2026-05-26: endpoint PÚBLICO (sin auth), responde 200
  // server-side. El tier real va por `acronym` (p.ej. "Asociado"); los costos de
  // distribuidor NO se exponen aquí (atados al contrato de la cuenta).
  async listPricingPlans(personNature: string, acronym = this.acronym): Promise<PricingPlan[]> {
    const url =
      `${this.api}/public/pricing-plans/nature` +
      `?personNature=${encodeURIComponent(personNature)}&acronym=${encodeURIComponent(acronym)}`;
    return this.json<PricingPlan[]>(await this.f(url, { headers: { accept: 'application/json' } }));
  }

  async listCertificateRequests(page = 0, pageSize = 12): Promise<Page<CertRequest>> {
    const url = `${this.api}/certificate-requests?currentPage=${page}&pageSize=${pageSize}`;
    return this.json<Page<CertRequest>>(await this.f(url, { headers: await this.authHeaders() }));
  }

  async listCertificates(page = 0, pageSize = 12): Promise<Page<CertificateInfo>> {
    const url = `${this.api}/certificates?currentPage=${page}&pageSize=${pageSize}`;
    return this.json<Page<CertificateInfo>>(await this.f(url, { headers: await this.authHeaders() }));
  }

  async getCertificateRequest(certCode: string): Promise<CertRequest> {
    const url = `${this.api}/public/certificate-requests/verify-certcode?certCode=${encodeURIComponent(certCode)}`;
    return this.json<CertRequest>(await this.f(url, { headers: { accept: 'application/json' } }));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createCertificateRequest(_input: CreateCertRequestInput): Promise<CreateCertRequestResult> {
    throw new SignareError(
      'createCertificateRequest: NOT_IMPLEMENTED — confirmar path/shape del POST real + auth M2M con Montran (ver doc F9 §9.1/§12.7)',
      501,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async downloadP12(_certCode: string): Promise<Uint8Array> {
    throw new SignareError(
      'downloadP12: NOT_IMPLEMENTED — confirmar endpoint de descarga + auth con Montran',
      501,
    );
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return { accept: 'application/json', ...(this.auth ? await this.auth.headers() : {}) };
  }

  private async json<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new SignareError(`Signare HTTP ${res.status}`, res.status, body);
    }
    return (await res.json()) as T;
  }
}
