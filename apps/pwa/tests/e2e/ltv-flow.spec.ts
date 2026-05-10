/**
 * E2E — F7 LTV flow (PAdES B-LT / B-LTA) — Batch IV §Task 32.
 *
 * Mirrors `tsa-flow.spec.ts` from F6. Four user journeys around DSS +
 * document timestamps:
 *
 *   1. Sign happy path with LTV on  → emerald LtvBadge (B-LT) +
 *      `collect_ocsp` + `embed_dss` stages observed in worker progress.
 *   2. Sign with LTV disabled        → no LtvBadge, no `embed_dss` stage,
 *      only TSA gold badge from F6.
 *   3. Sign with OCSP timeout       → fallback B-T (downgrade one tier),
 *      warning toast `ltv_unexpected_error` / `ltv_no_revocation_data`.
 *   4. Verify a B-LTA PDF           → bright-emerald LtvBadge in
 *      /verificar with `documentTimestamp.tsaIssuer` populated.
 *
 * Status — F7 T32 scaffold: all tests ship with `.fixme` (mirroring the
 * F6 pattern at scaffold time). Run locally to confirm parsing:
 *
 *   pnpm -F @firma-ec/pwa build
 *   pnpm -F @firma-ec/pwa preview --port 5174
 *   pnpm --filter @firma-ec/pwa exec playwright test \
 *     apps/pwa/tests/e2e/ltv-flow.spec.ts --list
 *
 * Fixture prerequisites — strip `.fixme` after generating these:
 *   - `apps/pwa/tests/e2e/fixtures/sample-b-t.pdf` (already needed by F6).
 *   - `apps/pwa/tests/e2e/fixtures/sample-b-lta.pdf` (copy from
 *     `_backups/F7-cross-val-artifacts/sample-b-lta.pdf` after running
 *     `scripts/gen-f7-samples.mjs`).
 *
 * @see docs/superpowers/plans/2026-05-10-firma-ec-F7-LTV.md §Task 32
 * @see apps/pwa/src/ui/firma/LtvBadge.svelte (`.ltv-badge--emerald`)
 * @see apps/pwa/src/ui/firma/DownloadResult.svelte (badge wiring)
 */
import { expect, test, type Page, type Route } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = resolve(HERE, 'fixtures/sample.pdf');
const FIXTURE_B_LTA_PDF = resolve(HERE, 'fixtures/sample-b-lta.pdf');
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const FIXTURE_P12_VALID = resolve(REPO_ROOT, 'packages/signer/tests/fixtures/rsa2048-valid.p12');
const VALID_PIN = 'test1234';

/** Capture page errors + LTV-related network calls for assertions. */
function attachCaptures(page: Page) {
  const errors: string[] = [];
  const ocspCalls: string[] = [];
  const crlCalls: string[] = [];
  const tsaCalls: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    const url = r.url();
    if (/ocsp|\.ocsp\./i.test(url)) ocspCalls.push(`${r.method()} ${url}`);
    if (/\.crl(\?|$)/i.test(url)) crlCalls.push(`${r.method()} ${url}`);
    if (url.includes('freetsa.org') || /\/tsr(\?|$)/i.test(url))
      tsaCalls.push(`${r.method()} ${url}`);
  });
  return { errors, ocspCalls, crlCalls, tsaCalls };
}

/** Force every OCSP HTTP call to a configurable verdict. */
async function mockOcsp(page: Page, verdict: 'good' | 'timeout' | 'network_error') {
  await page.route(/.*\/ocsp.*|ocsp\..*/i, async (route: Route) => {
    if (verdict === 'timeout') {
      // Hold the response forever (driver will hit ocspTimeoutMs).
      await new Promise(() => {});
      return;
    }
    if (verdict === 'network_error') {
      await route.abort('failed');
      return;
    }
    // 'good' — best-effort: return an empty 200 (verifier will treat as
    // unparsable and fall back to CRL).
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/ocsp-response' },
      body: Buffer.alloc(0),
    });
  });
}

test.describe('F7 LTV flow', () => {
  test.fixme('LTV happy path — emerald LtvBadge + DSS embedded', async ({ page }) => {
    const captures = attachCaptures(page);
    await mockOcsp(page, 'good');

    await page.goto('/firmar');
    // Wizard happy path: pick file, enter PIN, enable LTV.
    await page.setInputFiles('input[type=file]', FIXTURE_PDF);
    await page.setInputFiles('input[name=p12]', FIXTURE_P12_VALID);
    await page.fill('input[name=pin]', VALID_PIN);
    await page.check('input[name=ltv-longTerm]');
    await page.click('button:has-text("Firmar")');

    // Wait for emerald badge in DownloadResult.
    const badge = page.locator('.ltv-badge--emerald').first();
    await expect(badge).toBeVisible({ timeout: 30_000 });
    await expect(badge).toContainText(/B-LT/);

    // No page errors.
    expect(captures.errors).toEqual([]);
  });

  test.fixme('LTV disabled — no LtvBadge, gold TSA badge only', async ({ page }) => {
    attachCaptures(page);
    await page.goto('/firmar');
    await page.setInputFiles('input[type=file]', FIXTURE_PDF);
    await page.setInputFiles('input[name=p12]', FIXTURE_P12_VALID);
    await page.fill('input[name=pin]', VALID_PIN);
    await page.uncheck('input[name=ltv-longTerm]');
    await page.click('button:has-text("Firmar")');

    await expect(page.locator('.tsa-badge--gold')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.ltv-badge--emerald')).toHaveCount(0);
  });

  test.fixme('OCSP timeout — fallback B-T + warning toast', async ({ page }) => {
    const captures = attachCaptures(page);
    await mockOcsp(page, 'timeout');

    await page.goto('/firmar');
    await page.setInputFiles('input[type=file]', FIXTURE_PDF);
    await page.setInputFiles('input[name=p12]', FIXTURE_P12_VALID);
    await page.fill('input[name=pin]', VALID_PIN);
    await page.check('input[name=ltv-longTerm]');
    // Tight OCSP timeout so the test doesn't wait the default 8s.
    await page.fill('input[name=ltv-ocspTimeoutMs]', '500');
    await page.click('button:has-text("Firmar")');

    // Expect a B-T fallback (gold badge present, emerald absent).
    await expect(page.locator('.tsa-badge--gold')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.ltv-badge--emerald')).toHaveCount(0);
    // Warning toast/copy mentioning the fallback.
    await expect(page.locator('text=/sin (datos|revocaci)/i')).toBeVisible();
    expect(captures.ocspCalls.length).toBeGreaterThan(0);
  });

  test.fixme('verify B-LTA fixture — bright-emerald badge + documentTimestamp', async ({
    page,
  }) => {
    if (!existsSync(FIXTURE_B_LTA_PDF)) {
      test.skip(true, 'B-LTA fixture missing — run scripts/gen-f7-samples.mjs first');
    }
    void readFileSync; // silence unused import warning when skipped above

    await page.goto('/verificar');
    await page.setInputFiles('input[type=file]', FIXTURE_B_LTA_PDF);

    const badge = page.locator('.ltv-badge--emerald-bright').first();
    await expect(badge).toBeVisible({ timeout: 15_000 });
    await expect(badge).toContainText(/B-LTA/);
    // Detail panel should expose tsaIssuer for the document TS.
    await expect(page.locator('[data-test=ltv-doc-ts-issuer]')).not.toBeEmpty();
  });
});
