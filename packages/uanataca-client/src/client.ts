import type {
  CertificateRequest,
  CreateCertificateRequestInput,
  CreateCertificateRequestResult,
  ListCertificateRequestsQuery,
  Product,
  StakeholderProduct,
} from './types.js';

/**
 * Interfaz del cliente del Módulo Precompra de Uanataca.
 *
 * Permite construir y testear backend/colas/UI contra `FakeUanatacaClient`
 * sin tocar el API real (que descuenta Uanacréditos al crear una solicitud).
 *
 * CERO-CUSTODIA: NO hay método para descargar el .p12. Uanataca lo emite y lo
 * envía directo al correo del cliente; nuestro único acoplamiento al certificado
 * es detectar el estado `ISSUED`.
 */
export interface UanatacaClient {
  /** Catálogo global de productos. GET /products */
  listProducts(): Promise<Product[]>;

  /** Productos asignados a un stakeholder con su precio de costo. GET /stakeholderProducts/{uuid} */
  listStakeholderProducts(stakeholderUuid: string): Promise<StakeholderProduct[]>;

  /** Saldo disponible de Uanacréditos. GET /uanacredits/balance */
  getBalance(): Promise<number>;

  /** Lista/busca solicitudes (por texto, estado o uuid). GET /certificateRequests */
  listCertificateRequests(query?: ListCertificateRequestsQuery): Promise<CertificateRequest[]>;

  /**
   * Crea una solicitud de certificado. DESCUENTA Uanacréditos del lado de
   * Uanataca. Devuelve el uuid extraído del header Location del 201.
   */
  createCertificateRequest(
    input: CreateCertificateRequestInput,
  ): Promise<CreateCertificateRequestResult>;
}

/** Error de la integración Uanataca (transporte o reglas de negocio). */
export class UanatacaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
    /**
     * true si el fallo ocurrió DESPUÉS de enviar el POST de creación y el saldo
     * PUDO haberse consumido (red caída tras enviar, o 5xx del servidor). El
     * llamador DEBE reconciliar por `identification` en listCertificateRequests
     * ANTES de reintentar — nunca reenviar el POST a ciegas (doble cobro). Los
     * errores de lectura (GET), auth y 4xx dejan esto en false (no hubo cargo).
     */
    readonly mayHaveCharged: boolean = false,
  ) {
    super(message);
    this.name = 'UanatacaError';
  }
}
