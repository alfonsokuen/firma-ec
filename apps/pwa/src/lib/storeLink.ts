/**
 * URL de la tienda de certificados (tienda.firmar.ec) para los CTA cruzados
 * firma→tienda (renovar/comprar). Overridable en build con VITE_STORE_URL
 * (p.ej. apuntar a QA); default = tienda pública. Sin barra final para componer.
 * Acceso guardado a `import.meta.env` (mismo patrón que main.ts con VITE_REDIRECT_HOME),
 * para no depender de la augmentación de tipos de Vite.
 */
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const STORE_URL = (env['VITE_STORE_URL'] ?? 'https://tienda.firmar.ec').replace(/\/+$/, '');

/** Enlace a la tienda con atribución UTM (origen = PWA). `medium` = superficie. */
export function storeLink(medium: string): string {
  return `${STORE_URL}/?utm_source=firmar_pwa&utm_medium=${encodeURIComponent(medium)}`;
}
