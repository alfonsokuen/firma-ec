/**
 * Cliente PWA del módulo certs (F9.0b). Llama al backend (mismo host que inbox).
 * Hoy contra FakeSignareClient en el backend; sin estado sensible en el cliente.
 */
import { getInboxBase } from './inboxApi.ts';

export interface CertPlan {
  id: number;
  titulo: string;
  periodo: string;
  duracion: number;
  pvp: string;
  moneda: string;
  // Solo presentes en vista operador (?view=operator); NO en la respuesta pública.
  costoMayorista?: string;
  margen?: string;
}

export class CertsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'CertsApiError';
  }
}

export async function fetchPlanes(personNature = 'natural'): Promise<CertPlan[]> {
  const url = `${getInboxBase()}/api/certificados/planes?personNature=${encodeURIComponent(personNature)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new CertsApiError(`HTTP ${res.status}`, res.status);
  return (await res.json()) as CertPlan[];
}

export interface CertFileInput {
  name: 'citizenDoc' | 'lifeTest' | 'photo';
  contentType: 'image/jpeg' | 'image/png';
  contentB64: string;
  fileName?: string;
}

export interface CheckoutInput {
  pricingPlanId: number;
  email: string;
  properties: Record<string, string>;
  files: CertFileInput[];
  acceptedWill: true;
  acceptedContract: true;
}

export interface CheckoutResult {
  orderId: string;
  urlPago: string;
  pvp: string;
}

export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  const res = await fetch(`${getInboxBase()}/api/certificados/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ personNature: 'natural', ...input }),
  });
  if (!res.ok) throw new CertsApiError(`HTTP ${res.status}`, res.status);
  return (await res.json()) as CheckoutResult;
}

/** Lee un File como base64 (sin el prefijo data:). */
export async function fileToB64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0);
  return btoa(bin);
}
