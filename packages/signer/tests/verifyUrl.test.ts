/**
 * Invariante del QR impreso en cada PDF firmado.
 *
 * Este test existe porque la URL del QR vive DENTRO de documentos ya emitidos:
 * si la ruta deja de existir en el router de la PWA, o si alguien cambia el
 * literal, todos los PDF firmados hasta hoy aterrizan en la portada con 200.
 * Nadie lo vería. Lo señaló un panel de revisión el 2026-09-02 como la URL
 * más consecuente y menos vigilada del sistema.
 *
 * Lee el router REAL (`apps/pwa/src/App.svelte`) en vez de copiar su lista
 * de rutas: copiarla sería otra fuente de verdad que nadie mantiene. Si el
 * formato del router cambia, el extractor aborta con mensaje en vez de pasar
 * en verde sin comprobar nada.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERIFY_QR_BASE, buildVerifyQrUrl } from '../src/verifyUrl.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_SVELTE = join(HERE, '../../../apps/pwa/src/App.svelte');

/** Rutas hash del router, extraídas de su fichero real con anclas de seguridad. */
function routerRoutes(): Set<string> {
  const src = readFileSync(APP_SVELTE, 'utf8');
  const i = src.indexOf('const routes');
  const j = src.indexOf("'*':", i);
  if (i === -1 || j === -1) {
    throw new Error(
      `No encontré la tabla de rutas en ${APP_SVELTE}. Cambió el formato del router: arregla este extractor.`,
    );
  }
  const rutas = new Set([...src.slice(i, j).matchAll(/^\s*'(\/[^']*)':/gm)].map((m) => m[1]));
  for (const conocida of ['/', '/firmar', '/validar-certificado']) {
    if (!rutas.has(conocida)) {
      throw new Error(
        `El extractor no encontró "${conocida}" en el router. Cambió el formato: arregla este extractor.`,
      );
    }
  }
  return rutas;
}

describe('la URL del QR impreso en cada PDF firmado', () => {
  it('es EXACTAMENTE la que llevan los documentos ya emitidos', () => {
    // Si este test enrojece porque cambiaste el valor: PARA. No es un literal
    // que se pueda "actualizar". Está impreso en PDF que ya circulan. Solo se
    // puede cambiar añadiendo antes un alias/redirección que conserve el viejo.
    expect(VERIFY_QR_BASE).toBe('https://app.firmar.ec/#/verificar');
  });

  it('apunta a una ruta que EXISTE en el router de la PWA', () => {
    const ruta = VERIFY_QR_BASE.slice(VERIFY_QR_BASE.indexOf('#') + 1);
    const rutas = routerRoutes();
    expect(
      rutas.has(ruta),
      `La ruta "${ruta}" del QR no está en el router. Todos los PDF firmados caerían en la portada.`,
    ).toBe(true);
  });

  it('construye la URL completa con el hash de 12 hex', () => {
    expect(buildVerifyQrUrl('abc123def456')).toBe(
      'https://app.firmar.ec/#/verificar?h=abc123def456',
    );
    expect(buildVerifyQrUrl('abc123def456')).toMatch(
      /^https:\/\/app\.firmar\.ec\/#\/verificar\?h=[0-9a-f]{12}$/,
    );
  });
});
