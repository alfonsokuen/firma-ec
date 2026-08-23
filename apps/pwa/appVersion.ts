import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * appVersion.ts — ÚNICA fuente de verdad de la versión de la PWA para las
 * herramientas de build (Vite y Vitest).
 *
 * `apps/pwa/package.json` manda; `src/lib/version.ts` solo consume el `define`
 * que se arma aquí. Antes `APP_VERSION` era una constante escrita a mano y el
 * bump eran dos gestos independientes, así que se desincronizaba: el release
 * 0.22.5 salió a producción mostrando "versión 0.22.4" en el pie, y ya había
 * pasado antes (commit `b1a71da`). Con la inyección no hay dos números que
 * puedan divergir — solo hay uno.
 *
 * Vive fuera de `src/` a propósito: es código de Node para los ficheros de
 * configuración, no del bundle (`tsconfig.json` solo incluye `src/**`).
 */
const APP_VERSION_DEFINE = '__APP_VERSION__';

/** Lee la versión declarada en `apps/pwa/package.json`. Falla fuerte si falta. */
function readPwaVersion(): string {
  const pkgPath = resolve(import.meta.dirname, 'package.json');
  const { version } = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
  // Sin versión el bundle mostraría `undefined` al usuario: mejor romper el build.
  if (!version) throw new Error(`${pkgPath} no declara "version"`);
  return version;
}

/** Bloque `define` listo para Vite/Vitest. */
export function appVersionDefine(): Record<string, string> {
  return { [APP_VERSION_DEFINE]: JSON.stringify(readPwaVersion()) };
}
