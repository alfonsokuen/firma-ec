import { UanatacaError } from './client.js';
import type { AuthResponse } from './types.js';

export interface UanatacaCredentials {
  username: string;
  password: string;
}

export interface TokenManagerOptions {
  /** Base del servicio de AUTH (dominio uanatacaec.com, distinto del de la API). */
  authBaseUrl: string;
  /** Credenciales del distribuidor (inyectadas desde el secret manager, nunca hardcodeadas). */
  credentials: UanatacaCredentials;
  fetchImpl?: typeof fetch | undefined;
  /**
   * Segundos que se restan al `expires_in` para renovar ANTES de que el token
   * caduque (cubre latencia de red y el costo de un POST con archivos). Default 30.
   */
  refreshMarginSeconds?: number | undefined;
  /** Reloj inyectable (ms). Default Date.now. Facilita tests deterministas. */
  now?: (() => number) | undefined;
}

/**
 * Gestiona el JWT de Uanataca (expires_in ~305s). Cachea el token en memoria
 * (NUNCA lo persiste) y lo renueva on-demand con un margen de seguridad.
 * Serializa los logins concurrentes en una sola petición en vuelo.
 */
export class UanatacaTokenManager {
  private readonly authUrl: string;
  private readonly credentials: UanatacaCredentials;
  private readonly f: typeof fetch;
  private readonly marginMs: number;
  private readonly now: () => number;

  private token: string | null = null;
  private expiresAtMs = 0;
  private inFlight: Promise<string> | null = null;

  constructor(opts: TokenManagerOptions) {
    this.authUrl = `${opts.authBaseUrl.replace(/\/$/, '')}/piccolos/auth/login`;
    this.credentials = opts.credentials;
    this.f = opts.fetchImpl ?? globalThis.fetch;
    this.marginMs = (opts.refreshMarginSeconds ?? 30) * 1000;
    this.now = opts.now ?? Date.now;
  }

  /** Devuelve un token válido, renovándolo si está por caducar. */
  async getToken(): Promise<string> {
    if (this.token !== null && this.now() < this.expiresAtMs) {
      return this.token;
    }
    if (this.inFlight !== null) return this.inFlight;
    this.inFlight = this.login().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * Invalida el token cacheado (p.ej. tras recibir 401). Limpia también la
   * promesa en vuelo para que el próximo getToken fuerce un login fresco y no
   * reutilice un token recién rechazado.
   */
  invalidate(): void {
    this.token = null;
    this.expiresAtMs = 0;
    this.inFlight = null;
  }

  private async login(): Promise<string> {
    const res = await this.f(this.authUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(this.credentials),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '<cuerpo no legible>');
      throw new UanatacaError(`Uanataca auth HTTP ${res.status}`, res.status, body);
    }
    const data = (await res.json()) as AuthResponse;
    if (!data.access_token || typeof data.expires_in !== 'number') {
      throw new UanatacaError(
        'Uanataca auth: respuesta sin access_token/expires_in',
        res.status,
        data,
      );
    }
    this.token = data.access_token;
    this.expiresAtMs = this.now() + Math.max(0, data.expires_in * 1000 - this.marginMs);
    return this.token;
  }
}
