/**
 * links.ts — URLs de salida del modo guiado (tienda + WhatsApp).
 *
 * `STORE_URL`/`storeLink` se REUTILIZAN de `storeLink.ts` (fuente única de
 * verdad ya consumida por DownloadResult/Footer/Header) — no se duplica el
 * origen.
 *
 * `WHATSAPP_URL` no tenía un origen centralizado: el único número real en el
 * repo es la línea IDKMANAGER `593958888193` (hardcodeada en
 * `routes/Home.svelte` y `ui/firma/DownloadResult.svelte` para contacto de
 * patrocinios). La reutilizamos como fallback NO inventado — mismo canal de
 * contacto real de la marca — pero la centralizamos aquí y la hacemos
 * overridable con `VITE_WHATSAPP_URL` (p.ej. una línea de soporte dedicada
 * de firmar.ec cuando exista). Cero hardcoding nuevo (Constitución Art. 2):
 * cualquier consumidor futuro de un número de WhatsApp debe importar de acá.
 */
import { STORE_URL, storeLink } from './storeLink.ts';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export { STORE_URL, storeLink };

export const WHATSAPP_URL = (env['VITE_WHATSAPP_URL'] ?? 'https://wa.me/593958888193').replace(
  /\/+$/,
  '',
);

/** Enlace de WhatsApp con mensaje pre-rellenado (ya traducido por el caller). */
export function whatsappLink(text: string): string {
  return `${WHATSAPP_URL}?text=${encodeURIComponent(text)}`;
}
