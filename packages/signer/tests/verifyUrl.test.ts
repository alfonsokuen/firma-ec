/**
 * Invariante del QR impreso en cada PDF firmado.
 *
 * Este test existe porque la URL del QR vive DENTRO de documentos ya emitidos:
 * si alguien cambia el literal, todos los PDF firmados hasta hoy aterrizan en
 * la portada con 200. Nadie lo vería. Lo señaló un panel de revisión el
 * 2026-09-02 como la URL más consecuente y menos vigilada del sistema.
 *
 * Lo que este test CONGELA es el literal y su estructura. Lo que NO comprueba,
 * a propósito, es que la ruta exista en el router: eso ya lo gatea
 * `apps/landing/scripts/check-announced-urls.mjs` en el build de la landing,
 * que aborta el despliegue si `/verificar` desaparece de `App.svelte`. La
 * primera versión de este test duplicaba ese extractor por regex, y la
 * revisión demostró que daba verde falso cuando la clave existía pero apuntaba
 * a la portada: un duplicado que no añade cobertura solo añade una tercera
 * fuente de verdad. Que la ruta apunte al VERIFICADOR sigue sin guarda; solo
 * un e2e que cargue `#/verificar?h=<hex>` y vea el banner lo cerrará.
 */
import { describe, expect, it } from 'vitest';
import { VERIFY_QR_BASE, VERIFY_ROUTE, buildVerifyQrUrl } from '../src/verifyUrl.js';

describe('la URL del QR impreso en cada PDF firmado', () => {
  it('es EXACTAMENTE la que llevan los documentos ya emitidos', () => {
    // Si este test enrojece porque cambiaste el valor: PARA. No es un literal
    // que se pueda "actualizar". Está impreso en PDF que ya circulan. Solo se
    // puede cambiar añadiendo antes un alias/redirección que conserve el viejo.
    expect(VERIFY_QR_BASE).toBe('https://app.firmar.ec/#/verificar');
  });

  it('la ruta que nombra es la constante compartida, no otra copia', () => {
    expect(VERIFY_ROUTE).toBe('/verificar');
    expect(VERIFY_QR_BASE.endsWith(`#${VERIFY_ROUTE}`)).toBe(true);
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
