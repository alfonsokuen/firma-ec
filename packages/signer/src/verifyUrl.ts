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
 * revisión lo señaló como la URL sin guarda más peligrosa del repo).
 *
 * Qué está guardado y dónde:
 *  - Que este literal no cambie: `tests/verifyUrl.test.ts` lo congela.
 *  - Que la ruta `VERIFY_ROUTE` exista en el router de la PWA: lo gatea
 *    `apps/landing/scripts/check-announced-urls.mjs` dentro del `pnpm build`
 *    de la landing, que corre en cada PR y en cada deploy y ABORTA si
 *    `/verificar` desaparece de `App.svelte`. Renombrar la ruta bloquea el
 *    despliegue entero, que es lo que debe pasar.
 *  - Lo que NO guarda nadie todavía: que la ruta apunte al verificador y no a
 *    otro componente. Eso solo lo ve un e2e que cargue `#/verificar?h=<hex>`
 *    y afirme el banner. Pendiente.
 *
 * Contexto histórico: los PDF firmados entre F3 y F6.2 llevaban el apex
 * (`firmar.ec`), que la landing redirige con un script inline en
 * `apps/landing/src/layouts/Base.astro`. Ese script no tiene guarda propia.
 */

/** Ruta hash del verificador en la PWA. La pieza que un renombrado rompería. */
export const VERIFY_ROUTE = '/verificar';

export const VERIFY_QR_BASE = `https://app.firmar.ec/#${VERIFY_ROUTE}`;

/** URL completa del QR para un PDF cuyo hash (sha256, 12 hex) es `hashHex`. */
export function buildVerifyQrUrl(hashHex: string): string {
  return `${VERIFY_QR_BASE}?h=${hashHex}`;
}
