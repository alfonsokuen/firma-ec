/**
 * version.test.ts — la versión que ve el usuario NO puede divergir de package.json.
 *
 * Existe por una clase de fallo, no por un descuido: `APP_VERSION` fue durante
 * mucho tiempo una constante escrita a mano, y el bump de `package.json` y el de
 * la constante eran dos gestos independientes. El desfase ya ocurrió al menos dos
 * veces — `b1a71da` ("bump APP_VERSION a 0.21.0 (faltó al bumpear package.json)")
 * y el release 0.22.5, que salió a producción mostrando "versión 0.22.4" en el
 * pie y en Acerca de. Nada lo detectaba: build verde, suite verde, sitio en pie.
 *
 * Este test es el detector. Falla si la versión renderizada al usuario deja de
 * coincidir con la del paquete, y también si alguna superficie vuelve a escribir
 * el literal en vez de importar la constante (que reintroduciría la trampa por
 * otra puerta).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { APP_VERSION } from './version.ts';

const PWA_ROOT = resolve(import.meta.dirname, '../..');

function readPackageVersion(): string {
  const raw = readFileSync(resolve(PWA_ROOT, 'package.json'), 'utf-8');
  const { version } = JSON.parse(raw) as { version?: string };
  if (!version) throw new Error('apps/pwa/package.json no declara "version"');
  return version;
}

/** Superficies que renderizan la versión de cara al usuario. */
const USER_FACING_SOURCES = ['src/ui/Footer.svelte', 'src/routes/About.svelte'];

describe('version.ts — la versión visible al usuario', () => {
  it('coincide exactamente con la de apps/pwa/package.json', () => {
    expect(APP_VERSION).toBe(readPackageVersion());
  });

  it('tiene forma de versión semántica (no queda vacía si la inyección falla)', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+(?:[-+].+)?$/);
  });

  it.each(USER_FACING_SOURCES)('%s importa APP_VERSION y no escribe el literal', (relPath) => {
    const source = readFileSync(resolve(PWA_ROOT, relPath), 'utf-8');

    expect(source).toContain('APP_VERSION');
    // Un literal `x.y.z` en la plantilla sería una segunda fuente de verdad:
    // exactamente la trampa que este módulo existe para cerrar.
    expect(source).not.toMatch(/["'`]\d+\.\d+\.\d+["'`]/);
  });
});
