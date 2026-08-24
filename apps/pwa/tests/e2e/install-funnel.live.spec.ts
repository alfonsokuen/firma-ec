/**
 * install-funnel.live.spec.ts — verificación EN VIVO del embudo de instalación.
 *
 * Corre contra producción (`app.firmar.ec`), no contra localhost, porque lo que
 * comprueba solo existe una vez desplegado: las cabeceras que sirve Caddy, el
 * manifest emitido por el build y el prompt nativo de Chromium.
 *
 * Uso:
 *   pnpm exec playwright test tests/e2e/install-funnel.live.spec.ts \
 *     --config=playwright.live-install.config.ts
 *
 * Estos tests están pensados para correrse A MANO tras un deploy, no en el gate
 * de PR: dependen de que producción ya tenga el cambio.
 *
 * Privacidad: no envían ningún evento real de `install` a los contadores de
 * producción — solo leen el estado. El conteo se verifica aparte, contra
 * `/api/stats/series`, comparando antes/después de una instalación real hecha
 * por una persona.
 */
import { expect, test } from '@playwright/test';

const APP = 'https://app.firmar.ec';

test.describe('embudo de instalación — en vivo', () => {
  test('el manifest declara standalone y los dos accesos directos, con rutas que existen', async ({
    request,
    page,
  }) => {
    const res = await request.get(`${APP}/manifest.webmanifest`);
    expect(res.ok()).toBe(true);
    const m = (await res.json()) as {
      display?: string;
      shortcuts?: { name: string; url: string }[];
      share_target?: unknown;
      file_handlers?: unknown;
    };

    // Sin `standalone` Chrome no ofrece instalar: es la precondición de todo.
    expect(m.display).toBe('standalone');

    const urls = (m.shortcuts ?? []).map((s) => s.url).sort();
    expect(urls).toEqual(['/#/firmar-facil', '/#/verificar']);

    // Lo que ya estaba y no se debe perder en un despliegue.
    expect(m.share_target).toBeTruthy();
    expect(m.file_handlers).toBeTruthy();

    // Un acceso directo a una ruta inexistente es peor que no tenerlo: el
    // usuario toca el icono y aterriza en una pantalla vacía. Se comprueba
    // que cada URL renderiza su vista, no solo que responde 200.
    for (const url of urls) {
      await page.goto(`${APP}${url}`);
      await expect(page.locator('main, [role="main"]').first()).toBeVisible({ timeout: 15_000 });
    }
  });

  test('las etiquetas que iOS necesita están servidas', async ({ page }) => {
    await page.goto(APP);
    // iOS no tiene `beforeinstallprompt`: "Añadir a pantalla de inicio" lee
    // estas etiquetas del HTML, no el manifest.
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveCount(1);
    // `apple-mobile-web-app-capable` se retiró a propósito (fuerza standalone en
    // iOS <16.4, sin probar en el flujo de descarga). Se afirma su AUSENCIA para
    // que no vuelva por accidente sin una prueba en iPhone real.
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveCount(0);
    await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveCount(1);
    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);

    const icon = await page.getAttribute('link[rel="apple-touch-icon"]', 'href');
    expect(icon).toBeTruthy();
    // El icono tiene que existir de verdad; iOS que no lo encuentra usa una
    // captura de la página como icono de la pantalla de inicio.
    const iconRes = await page.request.get(new URL(icon as string, APP).toString());
    expect(iconRes.status()).toBe(200);
    expect(iconRes.headers()['content-type']).toContain('image');
  });

  test('la serie de estadísticas acepta y expone el contador de instalaciones', async ({
    request,
  }) => {
    const res = await request.get(`${APP}/api/stats/series?granularity=day`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { buckets?: Record<string, unknown>[] };
    expect(Array.isArray(body.buckets)).toBe(true);
    const ultimo = body.buckets?.[body.buckets.length - 1];
    // Que la clave exista es lo que demuestra que el backend desplegado
    // conoce el tipo `install`. Su valor puede ser 0 legítimamente.
    expect(ultimo).toHaveProperty('install');
  });

  test('el shape público de /api/stats NO cambió (lo consume la landing)', async ({ request }) => {
    const res = await request.get(`${APP}/api/stats`);
    expect(res.ok()).toBe(true);
    const t = (await res.json()) as Record<string, unknown>;
    // Contrato con UsageCounter.svelte y la landing: estas tres claves y su tipo.
    for (const k of ['pdfsSigned', 'signaturesVerified', 'certificatesValidated']) {
      expect(typeof t[k]).toBe('number');
    }
  });

  test('el service worker sigue sirviéndose SIN caché (es la única vía de rescate)', async ({
    request,
  }) => {
    // Si /sw.js se cachea, un service worker zombi deja de ser recuperable:
    // no se puede desplegar un SW suicida que lo purgue. Invariante dura.
    const res = await request.get(`${APP}/sw.js`);
    expect(res.status()).toBe(200);
    const cc = res.headers()['cache-control'] ?? '';
    expect(cc).toMatch(/no-store|no-cache/);
  });
});
