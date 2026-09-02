/**
 * La URL que va impresa en el QR de CADA PDF firmado.
 *
 * Es la dirección más consecuente del sistema: no vive en una página que se
 * pueda corregir, vive dentro de documentos ya emitidos, para siempre. Si la
 * ruta `#/verificar` del router de la PWA se renombra sin conservar esta, el
 * QR de todos los PDF firmados hasta hoy aterriza en la portada con un 200 que
 * ningún monitor ve.
 *
 * Por eso vive aquí, en UN sitio, y no como literal repetido en `pades.ts` e
 * `incrementalUpdate.ts` (así estaba hasta el 2026-09-02, y un panel de
 * revisión lo señaló como la URL sin guarda más peligrosa del repo). El test
 * `tests/verifyUrl.test.ts` fija dos cosas: que este valor no cambia, y que
 * la ruta que nombra sigue existiendo en el router.
 *
 * Contexto histórico: los PDF firmados entre F3 y F6.2 llevaban el apex
 * (`firmar.ec`), que la landing redirige con un script inline. Desde F6.3 el
 * QR codifica la PWA directamente para que el escáner aterrice en la ruta.
 */
export const VERIFY_QR_BASE = 'https://app.firmar.ec/#/verificar';

/** URL completa del QR para un PDF cuyo hash (sha256, 12 hex) es `hashHex`. */
export function buildVerifyQrUrl(hashHex: string): string {
  return `${VERIFY_QR_BASE}?h=${hashHex}`;
}
