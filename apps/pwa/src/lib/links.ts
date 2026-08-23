/**
 * links.ts — URLs de salida del modo guiado (tienda + WhatsApp).
 *
 * `STORE_URL`/`storeLink` se REUTILIZAN de `storeLink.ts` (fuente única de
 * verdad ya consumida por DownloadResult/Footer/Header) — no se duplica el
 * origen.
 *
 * `WHATSAPP_URL` es el ÚNICO origen de un número de WhatsApp en la PWA: TODA
 * superficie de firmar.ec (ayuda del modo guiado, ayuda de certificado,
 * patrocinio) apunta a la línea de la instancia Evolution `firmarec`
 * — `ownerJid 593993995618@s.whatsapp.net`, perfil "Firmar Ec" — que es la
 * atendida de cara al cliente y la misma que ya usan el landing
 * (`apps/landing/src/lib/contact.ts`) y la tienda.
 *
 * NO usar la línea corporativa de IDKMANAGER aquí: hasta 2026-07-29 este
 * fallback apuntaba ahí y desviaba a los clientes de soporte del modo guiado
 * al WhatsApp corporativo (y personal de un dev). Cualquier consumidor de un
 * número debe importar de este módulo — no re-escribir el literal.
 */
import { STORE_URL, storeLink } from './storeLink.ts';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export { STORE_URL, storeLink };

/** Línea de cara al cliente de firmar.ec (instancia Evolution `firmarec`). */
export const SUPPORT_WHATSAPP_NUMBER = '593993995618';

/**
 * Normaliza el override `VITE_WHATSAPP_URL` a una base usable como href.
 *
 * Se exporta —y no se deja en línea— porque es la ÚNICA forma de probar las
 * tres formas que la env toma en un build real: Vite inlina `import.meta.env`
 * como un objeto literal en tiempo de build, y bajo Vitest cada módulo recibe
 * su propia copia, así que un test no puede alterar la env que lee este módulo.
 * `WHATSAPP_URL` es exactamente `resolveWhatsappBase(env[...])`: no hay lógica
 * que exista solo en el helper, probarlo es probar la ruta de producción.
 *
 * `||` y no `??`: el Dockerfile declara el ARG vacío por defecto, así que el
 * bundle de producción lleva literalmente `{VITE_WHATSAPP_URL:""}` — un string
 * vacío debe caer al default, no dejar el enlace de WhatsApp SIN DESTINO (un
 * href relativo que reabre la propia PWA, sin error visible para nadie).
 *
 * El `?text=` lo aporta SIEMPRE el caller (depende del idioma y de la superficie),
 * así que a un override que ya traiga query se le descarta: `…?text=a` + `?text=b`
 * produce una URL que WhatsApp abre con el mensaje corrompido. Se corta con
 * `replace` y no con `.split('?')[0]`: el acceso indexado es `string | undefined`
 * bajo `noUncheckedIndexedAccess` (tsconfig.base.json) y rompía el typecheck.
 */
export function resolveWhatsappBase(rawOverride: string | undefined): string {
  const override = rawOverride?.trim();
  return (override || `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}`)
    .replace(/\?.*$/, '')
    .replace(/\/+$/, '');
}

export const WHATSAPP_URL = resolveWhatsappBase(env['VITE_WHATSAPP_URL']);

/** Enlace de WhatsApp con mensaje pre-rellenado (ya traducido por el caller). */
export function whatsappLink(text: string): string {
  return `${WHATSAPP_URL}?text=${encodeURIComponent(text)}`;
}
