import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * REGRESIÓN — el Service Worker no puede reiniciar la app encima del trabajo.
 *
 * Reportado por Alfonso el 2026-09-03 como «el firmador no funciona». No había
 * ningún error: en la PRIMERA visita el SW se instala, hace `clients.claim()`
 * y dispara `controllerchange` unos segundos después de cargar. El módulo de
 * actualización recargaba la página ahí sin mirar si había un controlador
 * ANTERIOR — y no lo había: la página ya estaba corriendo el código recién
 * bajado de la red. Medido en producción (Pixel 7, 3G): PDF subido a los
 * 2,6 s, recarga a los 3,6 s, y a los 20 s el usuario de vuelta en «Sube tu
 * PDF» sin explicación. Le pasaba a todo visitante nuevo y tras cada
 * despliegue, que es justo cuando alguien prueba la app por primera vez.
 *
 * Estos tests corren contra `vite preview` (build real) porque en `vite dev`
 * no existe el SW — ese es el hueco por el que esto llegó a producción.
 *
 * @see apps/pwa/src/lib/swUpdate.svelte.ts (`controlled` / primera toma de control)
 * @see apps/pwa/src/routes/Firmar.svelte (`$effect` que retiene la recarga)
 */
import { expect, test } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = resolve(HERE, '..', 'e2e', 'fixtures', 'sample.pdf');

/** Espera a que el SW controle la página: hasta aquí llegaba la recarga. */
async function esperaAlServiceWorker(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const controlado = await Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 20_000)),
    ]);
    return controlado;
  });
}

test.describe('SW — primera visita', () => {
  test('el PDF subido SOBREVIVE a que el Service Worker tome el control', async ({ page }) => {
    // Contexto nuevo = sin SW registrado = exactamente la primera visita real.
    const navegaciones: string[] = [];
    page.on('request', (r) => {
      if (r.isNavigationRequest() && r.frame() === page.mainFrame()) navegaciones.push(r.url());
    });

    await page.goto('/#/firmar');
    await expect(page.getByRole('heading', { name: /sube tu pdf|upload your pdf/i })).toBeVisible();

    // El usuario sube su documento en cuanto ve la pantalla, sin esperar al SW.
    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE_PDF);
    await expect(
      page.getByRole('heading', { name: /coloca tu cuadro|place your signature/i }),
    ).toBeVisible();

    expect(await esperaAlServiceWorker(page)).toBe(true);
    // Margen de sobra para que `controllerchange` llegue y recargue si va a hacerlo.
    await page.waitForTimeout(8000);

    // Lo que importa: seguimos en el paso 2 con el documento puesto.
    await expect(
      page.getByRole('heading', { name: /coloca tu cuadro|place your signature/i }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: /sube tu pdf|upload your pdf/i })).toHaveCount(
      0,
    );
    // Y ni una sola navegación más allá de la primera: no hubo recarga.
    expect(navegaciones).toHaveLength(1);
  });

  test('control negativo — sin documento a medias, el SW toma el control igual y la app queda sana', async ({
    page,
  }) => {
    await page.goto('/#/firmar');
    expect(await esperaAlServiceWorker(page)).toBe(true);
    await page.waitForTimeout(5000);
    await expect(page.getByRole('heading', { name: /sube tu pdf|upload your pdf/i })).toBeVisible();
    // El SW quedó activo y controlando: la app funciona sin red a partir de aquí.
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  });
});
