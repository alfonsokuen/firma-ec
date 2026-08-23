/**
 * Versión de la app, mostrada al usuario en el pie y en "Acerca de", y usada
 * en la telemetría de los workers.
 *
 * NO se escribe a mano: la inyecta el build desde `apps/pwa/package.json`
 * (`__APP_VERSION__`, armado en `appVersion.ts` y declarado en el `define` de
 * `vite.config.ts` y de los dos `vitest.config.ts`). Bumpear `package.json` es
 * el único gesto necesario — no hay una segunda fuente que pueda quedarse atrás.
 */
declare const __APP_VERSION__: string;

export const APP_VERSION: string = __APP_VERSION__;
