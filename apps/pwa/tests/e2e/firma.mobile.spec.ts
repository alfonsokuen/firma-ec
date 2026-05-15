import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * E2E mobile — /firmar wizard at 390×844 (Pixel 7).
 *
 * Sprint C Batch 9: PdfPreview effect-loop fix (untrack callbacks) unblocks
 * mobile golden path. Test 5b activated.
 *
 * @see apps/pwa/playwright.config.ts (project=mobile, Pixel 7 device)
 * @see apps/pwa/src/ui/firma/PdfPreview.svelte
 */
import { type Page, expect, test } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = resolve(HERE, 'fixtures/sample.pdf');
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const FIXTURE_P12_VALID = resolve(REPO_ROOT, 'packages/signer/tests/fixtures/rsa2048-valid.p12');
const VALID_PIN = 'test1234';

async function tapCenter(page: Page, locatorSel: string): Promise<void> {
  const box = await page.locator(locatorSel).boundingBox();
  if (!box) throw new Error(`No bounding box for ${locatorSel}`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('firmar.ec — mobile viewport (390×844)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile-only spec');
  });

  test('Test 5 — smoke: /firmar loads on mobile viewport (390×844)', async ({ page }) => {
    await page.goto('/#/firmar');
    await expect(page.getByRole('heading', { name: /firmar pdf|sign pdf/i })).toBeVisible();
    await expect(page.locator('input[type="file"]').first()).toBeAttached();
    const vp = page.viewportSize();
    expect(vp).not.toBeNull();
    if (vp) {
      expect(vp.width).toBeLessThanOrEqual(500);
      expect(vp.height).toBeGreaterThanOrEqual(700);
    }
  });

  test('Test 5b — golden path completo en mobile (touch.tap)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/#/firmar');

    // Step 1 — pick PDF (file inputs work the same on mobile emulation).
    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE_PDF);
    await expect(
      page.getByRole('heading', { name: /coloca tu cuadro|place your signature/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Step 2 — v0.4.2: BoxPlacer auto-places a centered default box on first
    // pageRender. The user can drag it; the wizard footer Next is the only CTA.
    const overlay = page.locator('.box-overlay');
    await overlay.waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('.sig-box').waitFor({ state: 'visible', timeout: 10_000 });
    await page
      .getByRole('button', { name: /^continuar$|^continue$/i })
      .last()
      .tap();

    // Step 3 — drop p12.
    await expect(
      page.getByRole('heading', { name: /tu certificado|your \.p12 certificate/i }),
    ).toBeVisible({ timeout: 10_000 });
    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE_P12_VALID);

    // Step 4 — PIN.
    const pinInput = page
      .locator('input[type="password"], input[type="text"][autocomplete="off"]')
      .first();
    await pinInput.waitFor({ state: 'visible' });
    await pinInput.fill(VALID_PIN);
    await pinInput.press('Enter');

    // Step 5 → Continuar.
    await page.getByRole('button', { name: /^continuar$|^continue$/i }).tap();

    // Step 6 → Firmar PDF.
    await expect(
      page.getByRole('heading', { name: /listo para firmar|ready to sign/i }),
    ).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /^firmar pdf$|^sign pdf$/i }).tap();

    // Step 7 — success.
    await expect(
      page.getByRole('heading', { name: /pdf firmado correctamente|pdf signed successfully/i }),
    ).toBeVisible({ timeout: 30_000 });

    expect(errors.filter((e) => /effect_update_depth_exceeded/.test(e))).toEqual([]);
  });
});
