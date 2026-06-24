import type { CertificateRequestStatus } from './types.js';

/** Estados terminales: ya no cambian, no requieren más polling. */
const TERMINAL: ReadonlySet<string> = new Set<CertificateRequestStatus>([
  'ISSUED',
  'REJECTED',
  'CANCELED',
]);

/** true si el estado es terminal (ISSUED / REJECTED / CANCELED). */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL.has(status);
}

/** ISSUED = certificado emitido y enviado por Uanataca al correo del cliente. */
export function isIssued(status: string): boolean {
  return status === 'ISSUED';
}

/** El cliente debe corregir y reenviar documentación (Uanataca pidió cambios). */
export function needsCustomerUpdate(status: string): boolean {
  return status === 'UPDATE_REQUESTED';
}
