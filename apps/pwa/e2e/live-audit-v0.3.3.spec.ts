import path from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * LIVE audit v0.3.3 — verificar 3 real ECI PDFs against production app.firmar.ec
 * Per skill rule: no DONE without visual verification.
 */
import { expect, test } from '@playwright/test';

const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirnameLocal, '../../../packages/verifier/tests/fixtures');

const REAL_PDFS = [
  { file: 'eci-real-signed.pdf', expectedCn: 'Alfonso Kuen Arroyo' },
  { file: 'eci-real-contrato2026.pdf', expectedCn: 'LUIS DANILO ORELLANA ARELLANO' },
  { file: 'eci-real-lideres.pdf', expectedCn: 'BEATRIZ DE LOURDES VALENCIA CACERES' },
];

for (const { file, expectedCn } of REAL_PDFS) {
  test(`live verifier: ${file} → warning + DEMO + clean CN`, async ({ page }) => {
    const consoleMsgs: { type: string; text: string }[] = [];
    page.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text() }));
    page.on('pageerror', (e) => consoleMsgs.push({ type: 'pageerror', text: e.message }));

    await page.goto('https://app.firmar.ec/#/verificar', {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });

    // The Drop component exposes a hidden input[type=file]
    const fileInput = page.locator('input[type=file]');
    await fileInput.setInputFiles(path.join(FIXTURES_DIR, file));

    // Wait for Result component to appear; it renders status badges
    await page.waitForSelector('text=/Verificación|Verification|firma|signature/i', {
      timeout: 30_000,
    });

    // Wait until phase 'done' (not 'running'). Result text appears.
    await page.waitForFunction(
      () =>
        !document.body.innerText.match(
          /Verificando|Verifying|hashing|Hashing|placing|placeholder PDF/i,
        ),
      undefined,
      { timeout: 60_000 },
    );

    // Capture page text for assertions
    const bodyText = await page.locator('body').innerText();

    // 1. Status: NOT 'invalid' (red). Should be 'warning' or 'valid' or DEMO label.
    //    Bug 2 regression: must NOT be invalid for real ECI + placeholder TSL.
    expect
      .soft(bodyText, `Status of ${file}`)
      .not.toMatch(/firma\s+inv[aá]lida|signature\s+invalid|inv[aá]lido/i);

    // 2. DEMO banner: must be visible (Verificación en modo demostración / Demonstration mode)
    expect.soft(bodyText, `DEMO banner on ${file}`).toMatch(/demostraci[oó]n|demonstration/i);

    // 3. Signer CN: open detail panel, find CN, must be clean (no UTF8String : '...')
    //    Try to open <details> element if collapsed
    const detailsCount = await page.locator('details').count();
    for (let i = 0; i < detailsCount; i++) {
      const det = page.locator('details').nth(i);
      const isOpen = await det.evaluate((el) => (el as HTMLDetailsElement).open);
      if (!isOpen)
        await det
          .locator('summary')
          .click({ force: true })
          .catch(() => {});
    }
    await page.waitForTimeout(300);
    const detailText = await page.locator('body').innerText();

    expect.soft(detailText, `Signer CN raw asn1 for ${file}`).not.toMatch(/UTF8String\s*:\s*'/);
    expect
      .soft(detailText, `Signer CN raw asn1 for ${file}`)
      .not.toMatch(/PrintableString\s*:\s*'/);
    expect.soft(detailText, `Expected CN ${expectedCn}`).toContain(expectedCn);

    // 4. Engine version 0.3.3
    expect.soft(detailText, `Engine version on ${file}`).toMatch(/0\.3\.3/);

    // Screenshot
    await page.screenshot({
      path: path.resolve(__dirnameLocal, `../e2e-results/v0.3.3-${file.replace(/\.pdf$/, '')}.png`),
      fullPage: true,
    });

    // Report console errors (informational)
    const errors = consoleMsgs.filter((m) => m.type === 'error' || m.type === 'pageerror');
    if (errors.length > 0) {
      console.log(`Console errors on ${file}:`, JSON.stringify(errors, null, 2));
    }
  });
}
