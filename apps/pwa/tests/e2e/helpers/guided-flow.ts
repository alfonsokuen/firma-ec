import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Shared step helpers for the "Firmar Fácil" guided flow (`#/firmar-facil`).
 * Extracted from `firmar-facil.spec.ts` (P5 golden path) so the a11y spec
 * (`firmar-facil.a11y.spec.ts`, F3b) can reach the same screens without
 * duplicating the step-by-step wiring.
 *
 * @see ../firmar-facil.spec.ts (golden path + localStorage safety)
 * @see ../firmar-facil.a11y.spec.ts (axe + keyboard-only + reduced-motion)
 */

/** Captures pageerrors so tests can assert no runtime error fired mid-flow. */
export function attachErrorCapture(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return { errors };
}

/**
 * Step 1 (welcome gate) → click "Empezar"/"Start". This is the one real user
 * gesture that unlocks audio (`speak('bienvenida')` inside `onStart`); it
 * reveals the standard Drop dropzone + `GuideNarrator(cargar_pdf)`. Must run
 * before any interaction with the PDF file input in guided mode (F2 fix A).
 */
export async function step0ClickEmpezar(page: Page): Promise<void> {
  const startButton = page.getByRole('button', { name: /^empezar$|^start$/i });
  await expect(startButton).toBeVisible({ timeout: 10_000 });
  await startButton.click();
}

/** Step 1 → drop a PDF. Advances to step 2 (SimplePlacer). Assumes the
 *  "Empezar" gate (`step0ClickEmpezar`) already ran. */
export async function step1DropPdf(page: Page, pdfPath: string): Promise<void> {
  const pdfInput = page.locator('input[type="file"]').first();
  await pdfInput.waitFor({ state: 'attached' });
  await pdfInput.setInputFiles(pdfPath);
  await expect(
    page.getByRole('heading', { name: /¿dónde va tu firma\?|where does your signature go\?/i }),
  ).toBeVisible({ timeout: 15_000 });
}

/**
 * Step 2 (SimplePlacer) → wait for the auto-placed box (`.placed-box`) then
 * confirm via the i18n `guided.placer.confirm` CTA ("Sí, continuar" /
 * "Yes, continue"). Advances to step 3 (CertHelp).
 */
export async function step2ConfirmPlacement(page: Page): Promise<void> {
  await page.locator('.placed-box').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: /^sí, continuar$|^yes, continue$/i }).click();
  await expect(
    page.getByRole('heading', { name: /¿tienes tu firma\?|do you have your signature\?/i }),
  ).toBeVisible({ timeout: 10_000 });
}

/**
 * Step 3 (CertHelp → DropP12) → click "Sí, lo tengo" / "Yes, I have it" to
 * reveal the standard DropP12 dropzone, then upload the `.p12`. Advances to
 * step 4 (PIN).
 */
export async function step3ConfirmHasCertAndUpload(page: Page, p12Path: string): Promise<void> {
  await page.getByRole('button', { name: /^sí, lo tengo$|^yes, i have it$/i }).click();
  const p12Input = page.locator('input[type="file"]').first();
  await p12Input.waitFor({ state: 'attached' });
  await p12Input.setInputFiles(p12Path);
  await expect(
    page.getByRole('heading', {
      name: /escribe tu contraseña|enter your password|tu contraseña|password/i,
    }),
  ).toBeVisible({ timeout: 10_000 });
}

/** Step 4 → PIN + submit. Advances straight to the summary step. */
export async function step4Pin(page: Page, pin: string): Promise<void> {
  const pinInput = page
    .locator('input[type="password"], input[type="text"][autocomplete="off"]')
    .first();
  await pinInput.waitFor({ state: 'visible' });
  await pinInput.fill(pin);
  await pinInput.press('Enter');
}
