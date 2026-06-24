import { UanatacaError } from './client.js';
import type { UanatacaClient } from './client.js';
import { UanatacaTokenManager } from './token-manager.js';
import type { UanatacaCredentials } from './token-manager.js';
import type {
  CertificateRequest,
  CreateCertificateRequestInput,
  CreateCertificateRequestResult,
  ListCertificateRequestsQuery,
  Product,
  StakeholderProduct,
  UanatacaEnv,
} from './types.js';

export interface UanatacaDomains {
  /** Base del servicio de AUTH (login). */
  authBaseUrl: string;
  /** Base de la API (products, balance, certificateRequests, ...); en prod incluye /api. */
  apiBaseUrl: string;
}

/**
 * Dominios por ambiente. URLs PÚBLICAS del proveedor (no son secreto).
 * OJO: el dominio de AUTH (uanatacaec.com) es distinto del de la API (uanataca.ec).
 * Fuente: contrato Precompra v1.1.
 */
export const UANATACA_DOMAINS: Record<UanatacaEnv, UanatacaDomains> = {
  prod: {
    authBaseUrl: 'https://distribuidores.uanatacaec.com',
    apiBaseUrl: 'https://distribuidores.uanataca.ec/api',
  },
  test: {
    authBaseUrl: 'https://api-test.uanatacaec.com',
    apiBaseUrl: 'https://distribuidores.test.uanataca.appshandler.com',
  },
};

export interface UanatacaHttpOptions {
  /** Ambiente: resuelve los dominios de UANATACA_DOMAINS. Default 'test'. */
  env?: UanatacaEnv | undefined;
  /** Override explícito de dominios (precede a `env`). */
  domains?: UanatacaDomains | undefined;
  /** Credenciales del distribuidor (inyectadas desde el secret manager). */
  credentials: UanatacaCredentials;
  fetchImpl?: typeof fetch | undefined;
  refreshMarginSeconds?: number | undefined;
}

/** Adapter HTTP real del Módulo Precompra de Uanataca. */
export class UanatacaHttpClient implements UanatacaClient {
  private readonly api: string;
  private readonly f: typeof fetch;
  private readonly tokens: UanatacaTokenManager;

  constructor(opts: UanatacaHttpOptions) {
    const domains = opts.domains ?? UANATACA_DOMAINS[opts.env ?? 'test'];
    this.api = domains.apiBaseUrl.replace(/\/$/, '');
    this.f = opts.fetchImpl ?? globalThis.fetch;
    this.tokens = new UanatacaTokenManager({
      authBaseUrl: domains.authBaseUrl,
      credentials: opts.credentials,
      fetchImpl: opts.fetchImpl,
      refreshMarginSeconds: opts.refreshMarginSeconds,
    });
  }

  async listProducts(): Promise<Product[]> {
    return this.get<Product[]>('/products');
  }

  async listStakeholderProducts(stakeholderUuid: string): Promise<StakeholderProduct[]> {
    return this.get<StakeholderProduct[]>(
      `/stakeholderProducts/${encodeURIComponent(stakeholderUuid)}`,
    );
  }

  async getBalance(): Promise<number> {
    const raw = await this.get<unknown>('/uanacredits/balance');
    // Rechazar explícitamente null/objeto/'' (Number(null)===0 daría un falso "saldo 0").
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && raw.trim() !== '') {
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
    throw new UanatacaError('Uanataca balance: respuesta no numérica', undefined, raw);
  }

  async listCertificateRequests(
    query: ListCertificateRequestsQuery = {},
  ): Promise<CertificateRequest[]> {
    const qs = new URLSearchParams();
    if (query.q) qs.set('q', query.q);
    if (query.status) qs.set('status', query.status);
    if (query.uuid) qs.set('uuid', query.uuid);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.get<CertificateRequest[]>(`/certificateRequests${suffix}`);
  }

  async createCertificateRequest(
    input: CreateCertificateRequestInput,
  ): Promise<CreateCertificateRequestResult> {
    // idempotencyKey es LOCAL (Uanataca no la consume); no se envía en el body.
    const { idempotencyKey, ...payload } = input;
    void idempotencyKey;
    const headers = {
      ...(await this.authHeader()),
      'content-type': 'application/json',
      accept: 'application/json',
    };
    const url = `${this.api}/certificateRequests`;
    let res: Response;
    try {
      res = await this.f(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    } catch (e) {
      // El POST salió pero la red falló antes de la respuesta: Uanataca PUDO procesarlo
      // y descontar saldo. NO reintentar a ciegas → reconciliar por identificación.
      throw new UanatacaError(
        `Uanataca crear solicitud: fallo de red (${String(e)})`,
        undefined,
        e,
        true,
      );
    }
    if (res.status !== 201) {
      const body = await res.text().catch(() => '<cuerpo no legible>');
      // 5xx: el servidor recibió el POST y pudo haber cobrado; 4xx: rechazo pre-cargo.
      const mayHaveCharged = res.status >= 500;
      throw new UanatacaError(
        `Uanataca crear solicitud HTTP ${res.status}`,
        res.status,
        body,
        mayHaveCharged,
      );
    }
    const location = res.headers.get('location');
    const uuid = location !== null ? extractUuid(location) : null;
    return { uuid, location, locationMissing: uuid === null };
  }

  private async authHeader(): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await this.tokens.getToken()}` };
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.f(`${this.api}${path}`, {
      headers: { ...(await this.authHeader()), accept: 'application/json' },
    });
    if (res.status === 401) {
      // el token pudo expirar entre getToken y el request: invalida y reintenta UNA vez.
      this.tokens.invalidate();
      const retry = await this.f(`${this.api}${path}`, {
        headers: { ...(await this.authHeader()), accept: 'application/json' },
      });
      if (retry.status === 401) {
        // El token recién renovado también es rechazado: NO es transitorio
        // (credenciales/permisos). Invalida para no servir ese token desde caché.
        this.tokens.invalidate();
        const body = await retry.text().catch(() => '<cuerpo no legible>');
        throw new UanatacaError(
          'Uanataca HTTP 401 tras renovar token (credenciales o permisos)',
          401,
          body,
        );
      }
      return this.json<T>(retry);
    }
    return this.json<T>(res);
  }

  private async json<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const body = await res.text().catch(() => '<cuerpo no legible>');
      throw new UanatacaError(`Uanataca HTTP ${res.status}`, res.status, body);
    }
    return (await res.json()) as T;
  }
}

/** Extrae el uuid del último segmento de un header Location (absoluto o relativo). */
function extractUuid(location: string): string | null {
  let path = location;
  try {
    path = new URL(location).pathname;
  } catch {
    // Location relativo o malformado: usar el string crudo y partirlo igual.
    path = location;
  }
  const last = path.split('/').filter(Boolean).pop() ?? '';
  const noQuery = last.split('?')[0] ?? '';
  const trimmed = noQuery.split('#')[0] ?? '';
  return trimmed.length > 0 ? trimmed : null;
}
