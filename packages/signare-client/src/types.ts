/**
 * Tipos del API ArgosData/Signare (Montran), namespace `/api/cert`.
 *
 * Fuente: recon read-only del portal mayorista `signare.argosdata.com.ec`
 * (cuenta "Asociado") + OpenAPI `/api/cert/v3/api-docs` capturado 2026-05-26.
 * Doc: docs/superpowers/specs/2026-05-26-firma-ec-F9-emision-certificados-argosdata-design.md
 *
 * Donde el campo proviene del API real va marcado [real]; lo inferido va [inferido].
 */

/** Naturaleza de la persona (de `config/person-nature`). [real] */
export type PersonNature = 'natural' | 'legalRepresentative';

/** periodType visto en certificate-requests. [real] */
export type PeriodType = 'DAYS' | 'MONTHS' | 'YEARS' | 'NOT_APPLY';

/**
 * Estados observados en `certificate-requests`. [real: COMPLETE, WAITING_KEYSTORE, REJECTED]
 * El resto son [inferido] del flujo del PDF y se confirmarán al observar más registros.
 */
export type CertRequestStatus =
  | 'CREATED'
  | 'WAITING_KEYSTORE' // ≈ "ingreso de clave" del PDF (§13)
  | 'IN_REVIEW'
  | 'COMPLETE'
  | 'REJECTED'
  | 'REVOKED';

/**
 * Campos personales del solicitante. Claves = `name` del schema dinámico
 * `GET /api/cert/config/certificate-request`. [real]
 * Patrones de validación (regex) documentados junto a cada campo.
 */
export interface NaturalPersonProperties {
  idType: 'citizen'; // radio, único valor visto [real]
  idNumber: string; // cédula  ^[0-9]{10}$
  fingerPrintId: string; // código dactilar  ^[A-Z0-9]{6,10}$
  idRuc?: string | undefined; // RUC opcional  ^[0-9]{13}$
  names: string; // ^[a-zA-ZÀ-ſ_ ]+$  (≤50)
  surNames: string;
  country: string; // select (catálogo /api/cert/countries)
  province: string;
  city: string;
  homeAddress: string;
  phoneExtension: string; // select (ej. "593")
  phoneNumber: string; // ^[0-9]{10}$
  requestorEmail: string;
}

export interface LegalRepresentativeProperties extends NaturalPersonProperties {
  position: string;
  companyName: string;
  companySocialReason: string;
  /** RUC de la empresa  ^[0-9]{10}001$ (sobreescribe idRuc de natural) */
  idRuc: string;
  companyRup: string;
}

export type CertRequestProperties =
  | NaturalPersonProperties
  | LegalRepresentativeProperties;

/** Documento adjunto a la solicitud (imágenes ≤5MB; pdf para registro mercantil). [real] */
export interface CertRequestFile {
  /** name del documentConfig: citizenDoc | lifeTest | photo | docMercantileRegistry | authLetter */
  name: string;
  /** mime: image/jpeg | image/png | application/pdf */
  contentType: string;
  /** contenido base64 o binario según adapter */
  content: Uint8Array | string;
  fileName?: string;
}

/**
 * Payload de creación. Espejo de `CertificateRequestCreationDTO` del OpenAPI. [real]
 * Nota CSR: el DTO acepta `csrContent`/`csrFile` → keypair generado en cliente,
 * se envía solo el CSR (la llave privada nunca sale del navegador). Pendiente
 * confirmar con Montran que el flujo operador admite CSR (hoy usan keystore).
 */
export interface CreateCertRequestInput {
  personNature: PersonNature;
  pricingPlanId: number; // id de PricingPlan (ej. 347 = "1 año AS")
  email: string;
  properties: CertRequestProperties;
  files: CertRequestFile[];
  acceptedWill: boolean;
  acceptedContract: boolean;
  /** false en flujo operador (allowFaceLiveness=false + national-registry/bypass) */
  faceLiveness?: boolean;
  /** Modo CSR: si se provee, NO se genera keystore en Signare. */
  csrContent?: string;
  couponCode?: string;
  /** Idempotencia para evitar doble emisión (= doble cobro mayorista). [inferido] */
  idempotencyKey?: string;
}

/** Info de pago (`PaymentInformationDTO`). [real] */
export interface PaymentInformation {
  paymentId: number | null;
  transactionReference: string | null;
  authorizationCode: string | null;
  amount: string | null;
  status: string | null;
  statusDetail: string | null;
  coupon: string | null;
}

/** Registro de solicitud (`CertificateRequestDTO`). [real] */
export interface CertRequest {
  certificateRequestId: number;
  certificateId: number | null;
  certCode: string; // formato CR<AAAAMMDD><seq>
  status: CertRequestStatus | string;
  cost: string; // centavos como string (ej. "2360")
  periodType: PeriodType | string;
  duration: string;
  email: string | null;
  idNumber: string | null;
  registerDate: string;
  /** scores biométricos */
  score: number | null;
  similarity: number | null;
  reason: string | null;
  manualVerification: boolean;
  automaticVerification: boolean;
  needPayment: boolean;
  paymentUrl: string | null;
  paymentInformation: PaymentInformation | null;
  personNature: PersonNature | string | null;
  physicalToken: boolean;
}

/** Certificado emitido (`CertificateResponse`). [real] */
export interface CertificateInfo {
  id: number;
  certificateIdAssociated: number | null;
  subjectDN: string;
  issuerDN: string;
  notValidBefore: string;
  notValidAfter: string;
  serialNumber: string;
  status: string;
  personNature: string;
  idNumber: string;
  email: string;
  renewalStatus: string | null;
  renewalCertCode: string | null;
  renewalCondition: boolean;
}

/** Plan de precio (`PricingPlanDTO`). [real] precios = tier mayorista "Asociado". */
export interface PricingPlan {
  id: number;
  title: string; // ej. "1 año AS"
  price: string; // total con IVA
  vat: string;
  taxableAmount: string;
  total: string;
  periodType: PeriodType | string;
  status: 'ACTIVE' | string;
  duration: number;
  includeVat: boolean;
  acronymCompany: string; // "Asociado"
}

/** Página estilo Spring Data. [real] */
export interface Page<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
  first: boolean;
  last: boolean;
}

export interface CreateCertRequestResult {
  certificateRequestId: number;
  certCode: string;
  status: CertRequestStatus | string;
  needPayment: boolean;
  paymentUrl: string | null;
}
