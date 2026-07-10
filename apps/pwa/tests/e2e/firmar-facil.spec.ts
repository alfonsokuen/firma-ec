import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * E2E — F1 "modo guiado" / Firmar Fácil (`#/firmar-facil`) — P5.
 *
 * Golden path of the guided flow, real signing end to end (no mocks), plus a
 * 2-layer validation of the signed output:
 *   (a) bytes  — the downloaded PDF carries a real PAdES signature
 *       (`/ByteRange` + `/Contents`), not a placeholder.
 *   (b) product — re-uploading the signed PDF into the STANDARD wizard
 *       (`#/firmar`) makes the pre-flight `detectSignatures` scan (wired to
 *       `onSignaturesScanned` in Firmar.svelte) report ≥1 existing signature,
 *       surfaced as the `ExistingSignaturesPanel` banner at step 2.
 *
 * Reuses the pattern proven in the (now-deleted) spike-sign.spec.ts: real
 * signing works in headless Chromium once `vite.config.ts` allows the TSL
 * intermediates fs read (`server.fs.strict: false`) — see that file's
 * removed header for the investigation, and apps/pwa/tests/e2e/global-setup.ts
 * for the ephemeral `.p12` fixture (node-forge, PIN `test1234`, generated
 * fresh per run — never committed).
 *
 * @see apps/pwa/src/routes/Firmar.svelte (guided=true renderers per step)
 * @see apps/pwa/src/ui/firma/SimplePlacer.svelte (step 2 — no-drag placement)
 * @see apps/pwa/src/ui/firma/CertHelp.svelte (step 3 — pre-question)
 */
import { type Page, expect, test } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = resolve(HERE, 'fixtures/sample.pdf');
const GENERATED_P12 = resolve(HERE, 'fixtures/generated/test-signer.p12');
const PIN = 'test1234';

/** Captures pageerrors so tests can assert no runtime error fired mid-flow. */
function attachErrorCapture(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return { errors };
}

// ── Guided-flow step helpers ────────────────────────────────────────────

/** Step 1 → drop a PDF. Advances to step 2 (SimplePlacer). */
async function step1DropPdf(page: Page, pdfPath: string): Promise<void> {
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
async function step2ConfirmPlacement(page: Page): Promise<void> {
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
async function step3ConfirmHasCertAndUpload(page: Page, p12Path: string): Promise<void> {
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
async function step4Pin(page: Page, pin: string): Promise<void> {
  const pinInput = page
    .locator('input[type="password"], input[type="text"][autocomplete="off"]')
    .first();
  await pinInput.waitFor({ state: 'visible' });
  await pinInput.fill(pin);
  await pinInput.press('Enter');
}

test.describe('firmar.ec — #/firmar-facil (modo guiado)', () => {
  test('data-guided="true" is present on the guided route root', async ({ page }) => {
    await page.goto('/#/firmar-facil');
    await expect(page.locator('[data-guided="true"]')).toBeAttached();
  });

  test('golden path — real signing end to end, 2-layer validation of the output', async ({
    page,
  }) => {
    const cap = attachErrorCapture(page);

    // ── Route + guided marker ──────────────────────────────────────────
    await page.goto('/#/firmar-facil');
    await expect(page.locator('[data-guided="true"]')).toBeAttached();

    // ── Steps 1–5: PDF → auto-place → cert → PIN → summary ─────────────
    await step1DropPdf(page, FIXTURE_PDF);
    await step2ConfirmPlacement(page);
    await step3ConfirmHasCertAndUpload(page, GENERATED_P12);
    await step4Pin(page, PIN);

    await expect(
      page.getByRole('heading', { name: /listo para firmar|ready to sign/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Step 5 — "Firmar ahora"/"Firmar PDF" CTA. Capture the programmatic
    // download DownloadResult triggers on mount (step 6).
    const signButton = page.getByRole('button', { name: /^firmar pdf$|^sign pdf$/i });
    await expect(signButton).toBeVisible();
    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await signButton.click();
    const download = await downloadPromise;

    // Step 6 — success screen.
    await expect(
      page.getByRole('heading', { name: /pdf firmado correctamente|pdf signed successfully/i }),
    ).toBeVisible({ timeout: 10_000 });

    // ── Layer (a) — bytes: real PAdES signature, not a placeholder ──────
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const signedBytes = readFileSync(downloadPath as string);
    const signedText = signedBytes.toString('latin1');
    expect(signedText).toContain('/ByteRange');
    expect(signedText).toContain('/Contents');
    expect(signedBytes.byteLength).toBeGreaterThan(readFileSync(FIXTURE_PDF).byteLength);

    expect(cap.errors).toEqual([]);

    // ── Layer (b) — product: standard wizard detects the existing signature
    // on re-upload (detectSignatures pre-flight → onSignaturesScanned →
    // ExistingSignaturesPanel banner at step 2). ────────────────────────
    // Playwright's `download.path()` lands in a temp file with no `.pdf`
    // extension; `Drop.svelte`'s `isPdf()` gate requires either
    // `file.type === 'application/pdf'` or a `.pdf`-suffixed name (setting a
    // path via `setInputFiles` never carries a MIME type on Windows/Chromium
    // headless), so copy it to a `.pdf`-suffixed path first.
    const reuploadDir = mkdtempSync(join(tmpdir(), 'firmar-facil-e2e-'));
    const signedPdfPath = join(reuploadDir, 'signed.pdf');
    copyFileSync(downloadPath as string, signedPdfPath);

    await page.goto('/#/firmar');
    const pdfInput = page.locator('input[type="file"]').first();
    await pdfInput.waitFor({ state: 'attached' });
    await pdfInput.setInputFiles(signedPdfPath);
    await expect(
      page.getByRole('heading', { name: /coloca tu cuadro|place your signature/i }),
    ).toBeVisible({ timeout: 15_000 });
    // `ExistingSignaturesPanel` renders only when `detectedSignatures.length
    // > 0` — its presence alone proves the re-upload detected ≥1 existing
    // signature. `aria-label` = i18n `firmar.step6.previous_section`
    // ("Firmas previas" / "Prior signatures").
    const existingSigPanel = page.getByRole('complementary', {
      name: /firmas previas|prior signatures/i,
    });
    await expect(existingSigPanel).toBeVisible({ timeout: 10_000 });
    // And it lists at least one signer entry.
    await expect(existingSigPanel.locator('li')).toHaveCount(1);
  });

  test('mobile (Pixel 7) — guided route loads and reaches step 2', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Only meaningful under the mobile project.');
    await page.goto('/#/firmar-facil');
    await expect(page.locator('[data-guided="true"]')).toBeAttached();
    await step1DropPdf(page, FIXTURE_PDF);
    await page.locator('.placed-box').waitFor({ state: 'visible', timeout: 15_000 });
  });
});
