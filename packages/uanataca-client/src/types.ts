/**
 * Tipos del API "Módulo Precompra" de Uanataca Ecuador (Namirial), v1.1.
 *
 * Fuente: wiki Confluence "APIs de Integración Módulo Precompra v1.1"
 * (extraído 2026-06-24). Donde el campo proviene del contrato real va [real];
 * lo inferido del flujo va [inferido].
 *
 * MODELO CERO-CUSTODIA: Uanataca emite y ENVÍA el .p12 directo al correo del
 * cliente. Este paquete NO descarga ni custodia material criptográfico: no
 * existe (a propósito) ningún método downloadP12.
 */

/** Ambiente de la API. Selecciona el par de dominios (auth + api). */
export type UanatacaEnv = 'test' | 'prod';

/** Respuesta del login. [real] expires_in observado = 305 (~5 min). */
export interface AuthResponse {
  access_token: string;
  token_type: string; // "Bearer"
  expires_in: number; // segundos
}

/** Tipo de identificación del solicitante. [real] */
export type IdentificationType = 'CÉDULA' | 'PASAPORTE' | 'RUC';

/** Sexo del solicitante. [real] */
export type Sex = 'HOMBRE' | 'MUJER';

/**
 * Estados de una solicitud de certificado. [real]
 * NEW → IN_VALIDATION → UPDATE_REQUESTED → UPDATED → REJECTED → ISSUED → CANCELED
 */
export type CertificateRequestStatus =
  | 'NEW'
  | 'IN_VALIDATION'
  | 'UPDATE_REQUESTED'
  | 'UPDATED'
  | 'REJECTED'
  | 'ISSUED'
  | 'CANCELED';

/** Producto del catálogo global. GET /products [real] */
export interface Product {
  uuid: string;
  code: string;
  name: string;
  price: number;
  certificateUuid: string;
  /** distingue contenedor Archivo (.p12) vs Token físico. */
  containerUuid: string;
  validityUuid: string;
  contificoCode: string;
  active: boolean;
  common: boolean;
}

/** Producto asignado a un stakeholder (precio de COSTO). GET /stakeholderProducts/{uuid} [real] */
export interface StakeholderProduct {
  uuid: string;
  /** costo mayorista para nosotros (base del PVP con margen). */
  price: number;
  productUuid: string;
  stakeholderUuid: string;
  active: boolean;
}

/** Archivo adjunto en base64. [real] frontIdentification / backIdentification / selfie / ... */
export interface FilePayload {
  name: string;
  type: string; // mime: image/jpeg | image/png | application/pdf
  base64: string;
}

/**
 * Payload de creación de solicitud. POST /certificateRequests [real]
 *
 * El lanzamiento es solo persona natural / contenedor Archivo .p12. Los campos
 * de empresa (RL/ME) y tokenInfo (Token físico) se modelan opcionales por
 * completitud del contrato, pero el mapper de F0 solo arma persona natural.
 */
export interface CreateCertificateRequestInput {
  // Solicitante
  identificationType: IdentificationType;
  identification: string;
  /** requerido si identificationType = CÉDULA. */
  fingerprintCode?: string | undefined;
  names: string;
  lastName1: string;
  lastName2?: string | undefined;
  birthDate: string; // dd/MM/yyyy
  nationality: string;
  sex: Sex;
  phoneNumber: string;
  phoneNumber2?: string | undefined;
  email: string;
  email2?: string | undefined;
  province: string;
  city: string;
  address: string;
  // Producto
  productUuid: string;
  offerUuid?: string | undefined;
  // Empresa (RL/ME) — fuera del alcance del lanzamiento, modelado por completitud
  ruc?: string | undefined;
  company?: string | undefined;
  department?: string | undefined;
  position?: string | undefined;
  reason?: string | undefined;
  // Archivos (base64). Para persona natural los tres primeros son obligatorios.
  frontIdentification: FilePayload;
  backIdentification: FilePayload;
  selfie: FilePayload;
  rucFile?: FilePayload | undefined;
  additionalFile?: FilePayload | undefined;
  /**
   * Idempotencia LOCAL (lock por orden del integrador). OJO: el API de Uanataca
   * NO la consume (no deduplica server-side). NO se envía en el body — gobierna
   * el lock de nuestro lado. La recuperación real ante 500/timeout se hace
   * buscando por `identification` en listCertificateRequests. [inferido]
   */
  idempotencyKey?: string | undefined;
}

/** Resultado de crear una solicitud. El POST devuelve 201 + header Location. */
export interface CreateCertificateRequestResult {
  /** uuid extraído del header Location. null si el 201 no trajo Location parseable. */
  uuid: string | null;
  /** Location crudo del 201, para diagnóstico/reconciliación. */
  location: string | null;
  /**
   * true si Uanataca respondió 201 pero SIN Location parseable. En ese caso el
   * saldo PUDO haberse consumido: el llamador DEBE reconciliar por identificación,
   * NO reintentar el POST a ciegas.
   */
  locationMissing: boolean;
}

/** Registro de solicitud devuelto por GET /certificateRequests. [real] (subconjunto tipado) */
export interface CertificateRequest {
  uuid: string;
  identificationType: string;
  identification: string;
  fingerprintCode: string | null;
  names: string;
  lastName1: string;
  lastName2: string | null;
  email: string | null;
  status: CertificateRequestStatus | string;
  uanatacaStatus: string | null;
  comments: string | null;
  productUuid: string | null;
  stakeholderUuid: string | null;
  requestDate: string | null;
  approvedDate: string | null;
  renovation: boolean;
}

/** Filtros de búsqueda de solicitudes. GET /certificateRequests?q=&status=&uuid= */
export interface ListCertificateRequestsQuery {
  q?: string | undefined;
  status?: CertificateRequestStatus | string | undefined;
  uuid?: string | undefined;
}
