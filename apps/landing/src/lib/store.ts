/**
 * URL de la tienda de certificados (tienda.firmar.ec) para los CTA cruzados
 * firma→tienda. Overridable en build con PUBLIC_STORE_URL (p.ej. apuntar a QA);
 * default = tienda pública. Normalizada sin barra final para componer rutas.
 * (Vite tipa `import.meta.env` con índice de string → acceso directo válido,
 * igual que `PUBLIC_CF_BEACON_TOKEN` en Analytics.astro.)
 */
export const STORE_URL = (import.meta.env.PUBLIC_STORE_URL ?? 'https://tienda.firmar.ec').replace(
  /\/+$/,
  '',
);

/** Enlace a la tienda con atribución UTM (origen = landing). `medium` = superficie. */
export function storeLink(medium: string): string {
  return `${STORE_URL}/?utm_source=landing&utm_medium=${encodeURIComponent(medium)}`;
}
