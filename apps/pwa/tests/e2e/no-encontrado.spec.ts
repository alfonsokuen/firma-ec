import { expect, test } from '@playwright/test';

/**
 * E2E — ruta no encontrada: el sumidero deja de ser mudo.
 *
 * Hasta el 2026-09-02, cualquier ruta desconocida —hash (`#/verify`) o path
 * (`/validate-certificat`)— montaba la Home con 200. Así vivieron meses cuatro
 * rutas rotas que las páginas anunciaban: nadie ve un 200. Este test fija que
 * ahora se ve una pantalla de "no encontrado" con el destino intentado, que es
 * lo que hace posible que un humano, un canary o un monitor AFIRMEN sobre un
 * texto en vez de adivinar.
 */
test.describe('firmar.ec — ruta no encontrada', () => {
  test('una ruta hash desconocida muestra "no encontrado", no la Home', async ({ page }) => {
    await page.goto('/#/verify');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      /no encontramos|couldn't find/i,
    );
    // Y la Home NO está: su hero no debe renderizar.
    await expect(page.locator('a[href="#/firmar-lote"]')).toHaveCount(0);
  });

  test('un path desconocido se desvía a "no encontrado" y muestra el path intentado', async ({
    page,
  }) => {
    await page.goto('/validate-certificat');
    await expect(page).toHaveURL(/#\/no-encontrado\?p=%2Fvalidate-certificat/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      /no encontramos|couldn't find/i,
    );
    await expect(page.getByText('/validate-certificat')).toBeVisible();
  });

  test('desde "no encontrado" se vuelve a la Home con un solo enlace', async ({ page }) => {
    await page.goto('/#/no-existe');
    await page.getByTestId('notfound-home').click();
    await expect(page).toHaveURL(/\/#\/?$/);
    await expect(page.locator('a[href="#/firmar-lote"]').first()).toBeVisible();
  });

  test('texto arbitrario en ?p= NO se pinta: solo se muestra lo que parece un path', async ({
    page,
  }) => {
    // Suplantación de contenido: un enlace real a app.firmar.ec que "instruye".
    await page.goto('/#/no-encontrado?p=Llame+al+0999+123+456+para+recuperar+su+certificado');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      /no encontramos|couldn't find/i,
    );
    await expect(page.getByText(/Llame al 0999/)).toHaveCount(0);
    await expect(page.getByText(/intentada|attempted/i)).toHaveCount(0);
  });

  test('las rutas reales y las entradas del SO no se ven afectadas', async ({ page }) => {
    await page.goto('/#/verificar');
    await expect(page.getByRole('heading', { level: 1 })).not.toContainText(
      /no encontramos|couldn't find/i,
    );
    await page.goto('/sign');
    await expect(page).toHaveURL(/#\/firmar/);
  });
});
