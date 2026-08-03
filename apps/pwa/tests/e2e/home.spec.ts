import { expect, test } from '@playwright/test';

/**
 * E2E — Home: el acceso a "firmar por lotes" debe quedar visible SIN scroll.
 *
 * Regresión real (2026-08-03): vivía como link discreto bajo las tarjetas de
 * Verificar/Firmar; un usuario en producción no lo encontró. Se subió al hero
 * (mismo lugar que "Firmar Fácil", por el mismo motivo). Este test fija el
 * criterio en la suite para que una futura reorganización del hero no lo
 * vuelva a hundir bajo el fold sin que nadie lo note.
 */
test.describe('firmar.ec — Home', () => {
  test('el link a /firmar-lote está por encima del fold en mobile, sin scroll', async ({
    page,
  }) => {
    await page.goto('/');

    // Hay dos: el link del hero (arriba del fold) y la tarjeta más abajo
    // en la sección "¿Qué quieres hacer?" — el criterio de este test es
    // sobre el primero, que es el que debe quedar visible sin scroll.
    const link = page.locator('a[href="#/firmar-lote"]').first();
    await expect(link).toBeVisible();

    const box = await link.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    // Debe caber dentro del viewport inicial: nada de scroll para encontrarlo.
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  });

  test('el link a /firmar-lote navega a la pantalla del lote', async ({ page }) => {
    await page.goto('/');
    await page.locator('a[href="#/firmar-lote"]').first().click();
    await expect(page).toHaveURL(/#\/firmar-lote/);
  });
});
