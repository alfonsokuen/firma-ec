import { UanatacaError } from './client.js';
import type { CreateCertificateRequestInput, FilePayload, Sex } from './types.js';

/** Datos de KYC de persona natural capturados por el storefront. */
export interface NaturalPersonKyc {
  identification: string; // cédula, 10 dígitos
  fingerprintCode: string; // código dactilar
  names: string;
  lastName1: string;
  lastName2?: string | undefined;
  birthDate: string; // dd/MM/yyyy
  nationality: string;
  sex: Sex;
  phoneNumber: string;
  email: string;
  province: string;
  city: string;
  address: string;
  productUuid: string;
  offerUuid?: string | undefined;
}

/** Archivos obligatorios de persona natural (ya en base64). */
export interface NaturalPersonFiles {
  frontIdentification: FilePayload;
  backIdentification: FilePayload;
  selfie: FilePayload;
}

const CEDULA = /^[0-9]{10}$/;
// Formato dactilar [inferido]; el exacto de Uanataca no está documentado.
const FINGERPRINT = /^[A-Za-z0-9]{6,12}$/;
const PHONE = /^[0-9]{10}$/;
const BIRTHDATE = /^\d{2}\/\d{2}\/\d{4}$/;
// Formato razonable; NO sustituye la verificación por OTP del backend antes de originar.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Charset base64 (estándar, con padding opcional). No decodifica: solo descarta basura evidente.
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Mapea el KYC de persona natural al payload de creación de Uanataca, validando
 * formato ANTES de gastar saldo (fail-closed barato). NO verifica la existencia
 * real del correo: esa verificación (OTP / doble opt-in) es responsabilidad del
 * backend y DEBE ocurrir antes de originar, porque el .p12 se entrega a ese correo.
 */
export function mapNaturalPersonToCreateInput(
  kyc: NaturalPersonKyc,
  files: NaturalPersonFiles,
  idempotencyKey?: string,
): CreateCertificateRequestInput {
  // Normalizar ANTES de validar: el usuario puede dejar espacios al pegar datos.
  const identification = kyc.identification.trim();
  const fingerprintCode = kyc.fingerprintCode.trim();
  const phoneNumber = kyc.phoneNumber.trim();
  const birthDate = kyc.birthDate.trim();
  const email = kyc.email.trim();
  const names = kyc.names.trim();
  const lastName1 = kyc.lastName1.trim();
  const lastName2 = kyc.lastName2?.trim();
  const nationality = kyc.nationality.trim();
  const province = kyc.province.trim();
  const city = kyc.city.trim();
  const address = kyc.address.trim();
  const productUuid = kyc.productUuid.trim();

  requireMatch('identification', identification, CEDULA);
  requireMatch('fingerprintCode', fingerprintCode, FINGERPRINT);
  requireMatch('phoneNumber', phoneNumber, PHONE);
  requireMatch('birthDate', birthDate, BIRTHDATE);
  requireMatch('email', email, EMAIL);
  requireNonEmpty('names', names);
  requireNonEmpty('lastName1', lastName1);
  requireNonEmpty('nationality', nationality);
  requireNonEmpty('province', province);
  requireNonEmpty('city', city);
  requireNonEmpty('address', address);
  requireNonEmpty('productUuid', productUuid);
  requireBase64('frontIdentification', files.frontIdentification);
  requireBase64('backIdentification', files.backIdentification);
  requireBase64('selfie', files.selfie);

  return {
    identificationType: 'CÉDULA',
    identification,
    fingerprintCode,
    names,
    lastName1,
    lastName2,
    birthDate,
    nationality,
    sex: kyc.sex,
    phoneNumber,
    email,
    province,
    city,
    address,
    productUuid,
    offerUuid: kyc.offerUuid,
    frontIdentification: files.frontIdentification,
    backIdentification: files.backIdentification,
    selfie: files.selfie,
    idempotencyKey,
  };
}

function requireMatch(field: string, value: string, re: RegExp): void {
  if (!re.test(value)) {
    throw new UanatacaError(`KYC inválido: ${field} no cumple el formato esperado`, 400);
  }
}

function requireNonEmpty(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw new UanatacaError(`KYC inválido: ${field} es obligatorio`, 400);
  }
}

function requireBase64(field: string, file: FilePayload): void {
  if (file.base64.length === 0) {
    throw new UanatacaError(`KYC inválido: archivo ${field} vacío`, 400);
  }
  if (!BASE64.test(file.base64)) {
    throw new UanatacaError(`KYC inválido: archivo ${field} no es base64 válido`, 400);
  }
}
