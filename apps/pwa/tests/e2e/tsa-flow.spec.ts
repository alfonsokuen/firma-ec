import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * E2E — F6 TSA flow (PAdES B-T) — Batch IV §Task 20.
 *
 * Covers four user journeys around RFC 3161 timestamps:
 *   1. Sign happy path with TSA on  → gold TimestampBadge in DownloadResult.
 *   2. Sign with TSA disabled       → no badge, no `request_timestamp` stage.
 *   3. Sign with TSA timeout        → fallback B-B + warning toast.
 *   4. Verify a B-T PDF             → gold TimestampBadge in /verificar.
 *
 * TSA response mocking: the actual TSA POST is issued by `sign.worker.ts` (a
 * dedicated Worker), whose fetches Playwright's `page.route()` /
 * `context.route()` cannot intercept (visible via the passive
 * `page.on('request')` listener, but `route.fulfill()` never applies). TSA-1
 * and TSA-3 instead rely on the dev-only `/api/tsa` mock middleware in
 * `apps/pwa/vite.config.ts` (`e2eMockTsa`, gated by `E2E_MOCK_TSA=1`, set in
 * this project's `playwright.config.ts` `webServer.env`), driven purely by
 * the `tsaUrl`/`tsaTimeoutMs` settings each test writes to localStorage.
 *
 * Run: `pnpm --filter @firma-ec/pwa exec playwright test tsa-flow.spec.ts --project=chromium`
 * Test 4 (B-T verify) auto-skips if `fixtures/sample-b-t.pdf` is absent.
 *
 * @see docs/superpowers/plans/2026-05-09-firma-ec-F6-TSA.md §Task 20
 * @see apps/pwa/src/ui/firma/TimestampBadge.svelte (`.tsa-badge--gold`)
 * @see apps/pwa/src/ui/firma/DownloadResult.svelte (badge + fallback toast)
 * @see apps/pwa/src/lib/settings.svelte.ts (STORAGE_KEY = `firma_ec_settings_v2`)
 */
import { type Page, expect, test } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = resolve(HERE, 'fixtures/sample.pdf');
const FIXTURE_B_T_PDF = resolve(HERE, 'fixtures/sample-b-t.pdf');
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const FIXTURE_P12_VALID = resolve(REPO_ROOT, 'packages/signer/tests/fixtures/rsa2048-valid.p12');
const VALID_PIN = 'test1234';

/** Must match `STORAGE_KEY` in apps/pwa/src/lib/settings.svelte.ts (v2). */
const SETTINGS_KEY = 'firma_ec_settings_v2';

/** Captures pageerror + network calls so individual tests can assert. */
function attachCaptures(page: Page) {
  const errors: string[] = [];
  const tsaCalls: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (r.url().includes('freetsa.org') || r.url().includes('/tsr') || r.url().includes('/api/tsa'))
      tsaCalls.push(`${r.method()} ${r.url()}`);
  });
  return { errors, tsaCalls };
}

/**
 * Merges a partial settings patch into the persisted v2 store, bypassing the
 * Configuracion UI's stricter validation (e.g. its `https://`-only URL
 * validator, or the 1000ms UI floor on `tsaTimeoutMs`) — same technique the
 * original test used, just against the correct storage key.
 */
async function patchSettings(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    ({ key, patch: p }) => {
      const cur = JSON.parse(localStorage.getItem(key) ?? '{}');
      localStorage.setItem(key, JSON.stringify({ ...cur, ...p }));
    },
    { key: SETTINGS_KEY, patch },
  );
}

/** Toggle the TSA setting via the Configuracion route + localStorage flush. */
async function setTsaEnabled(page: Page, enabled: boolean) {
  await page.goto('/#/configuracion');
  await page.waitForSelector('#tsa-enabled', { state: 'attached' });
  const current = await page.locator('#tsa-enabled').getAttribute('aria-checked');
  if (String(enabled) !== current) await page.locator('#tsa-enabled').click();
  await expect(page.locator('#tsa-enabled')).toHaveAttribute('aria-checked', String(enabled));
}

// ── Wizard helpers (kept lean — full helpers live in firma.spec.ts) ────────

async function step1DropPdf(page: Page, pdfPath: string) {
  await page.locator('input[type="file"]').first().setInputFiles(pdfPath);
  await expect(
    page.getByRole('heading', { name: /coloca tu cuadro|place your signature/i }),
  ).toBeVisible({ timeout: 15_000 });
}
async function step2PlaceBox(page: Page) {
  await page.locator('.box-overlay').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('.sig-box').waitFor({ state: 'visible', timeout: 10_000 });
  await page
    .getByRole('button', { name: /^continuar$|^continue$/i })
    .last()
    .click();
}
async function step3DropP12(page: Page, p12Path: string) {
  await page.locator('input[type="file"]').first().setInputFiles(p12Path);
}
async function step4Pin(page: Page, pin: string) {
  const inp = page
    .locator('input[type="password"], input[type="text"][autocomplete="off"]')
    .first();
  await inp.fill(pin);
  await inp.press('Enter');
}
// The "Detalles opcionales" step was removed in v0.7.15 — PIN submission
// (step4Pin) advances straight to the summary step, so clickSign's own wait
// for "listo para firmar"/"ready to sign" is the only gate needed here.
async function clickSign(page: Page) {
  await expect(page.getByRole('heading', { name: /listo para firmar|ready to sign/i })).toBeVisible(
    { timeout: 10_000 },
  );
  await page.getByRole('button', { name: /^firmar pdf$|^sign pdf$/i }).click();
}
async function expectSignedHeading(page: Page) {
  await expect(
    page.getByRole('heading', { name: /pdf firmado correctamente|pdf signed successfully/i }),
  ).toBeVisible({ timeout: 30_000 });
}

// ── Tests ──────────────────────────────────────────────────────────────────

test.describe('F6 — TSA flow', () => {
  test.fixme(
    'TSA-1 — sign happy path with TSA on → gold badge visible (needs a dynamic TSA responder)',
    async ({ page }) => {
      // FIXTURE GAP (found while fixing this suite's stale selectors, P5):
      // this test's original design mocked the TSA POST by replaying a
      // static captured KAT (`freetsa-kat-2026-05-09.tsr`) regardless of the
      // request. That cannot work for a live golden-path sign: RFC 3161
      // requires the response's messageImprint to hash-match THIS request's
      // signature value (verifyResponseAgainstRequest, packages/tsa-client/
      // src/response.ts), and the signature value is never reproducible
      // run-to-run (it embeds the current signing time). A canned reply
      // always fails imprint validation → 'malformed' → the (correctly
      // implemented) fallback banner, never the gold badge.
      // Reaching the gold badge for real needs either (a) a dynamic RFC 3161
      // responder in the dev-mock (parse the incoming TimeStampReq, mint a
      // TSTInfo/CMS SignedData bound to its actual imprint+nonce — real
      // crypto work, no shortcut) or (b) hitting the live freetsa.org (not
      // hermetic/offline-safe). Tracked as a follow-up; TSA-2/3/4 already
      // cover the disabled/timeout/verify paths for this subsystem.
      const cap = attachCaptures(page);
      await setTsaEnabled(page, true);

      await page.goto('/#/firmar');
      await step1DropPdf(page, FIXTURE_PDF);
      await step2PlaceBox(page);
      await step3DropP12(page, FIXTURE_P12_VALID);
      await step4Pin(page, VALID_PIN);
      await clickSign(page);
      await expectSignedHeading(page);

      const goldBadge = page.locator('.tsa-badge--gold');
      await expect(goldBadge).toBeVisible({ timeout: 15_000 });
      await expect(goldBadge).toHaveAttribute('role', 'status');

      expect(cap.tsaCalls.length).toBeGreaterThanOrEqual(1);
      expect(cap.errors).toEqual([]);
    },
  );

  test('TSA-2 — TSA disabled → no badge, no /tsr request', async ({ page }) => {
    const cap = attachCaptures(page);
    await setTsaEnabled(page, false);

    await page.goto('/#/firmar');
    await step1DropPdf(page, FIXTURE_PDF);
    await step2PlaceBox(page);
    await step3DropP12(page, FIXTURE_P12_VALID);
    await step4Pin(page, VALID_PIN);
    await clickSign(page);
    await expectSignedHeading(page);

    // No TimestampBadge rendered when reason === 'disabled'.
    await expect(page.locator('.tsa-badge--gold')).toHaveCount(0);
    // And the worker never hits the TSA endpoint.
    expect(cap.tsaCalls).toEqual([]);
    expect(cap.errors).toEqual([]);
  });

  test('TSA-3 — TSA timeout → fallback B-B with warning toast, no gold badge', async ({ page }) => {
    const cap = attachCaptures(page);
    await setTsaEnabled(page, true);
    // `?delay=5000` makes the dev-mock (vite.config.ts `e2eMockTsa`) hold the
    // response for 5s, well past the 50ms client timeout below — forces a
    // real AbortError/'timeout' the same way a slow/unreachable TSA would.
    await patchSettings(page, {
      tsaEnabled: true,
      tsaUrl: '/api/tsa?delay=5000',
      tsaTimeoutMs: 50,
    });

    await page.goto('/#/firmar');
    await step1DropPdf(page, FIXTURE_PDF);
    await step2PlaceBox(page);
    await step3DropP12(page, FIXTURE_P12_VALID);
    await step4Pin(page, VALID_PIN);
    await clickSign(page);
    await expectSignedHeading(page);

    // Fallback warning visible. DownloadResult renders this banner with
    // `role="status"` (aria-live="polite"), not `role="alert"` — it's a
    // non-blocking notice (the signature itself is still valid), so it uses
    // the less-interruptive live-region semantics.
    const fallbackNotice = page.getByRole('status').filter({
      hasText: /sello de tiempo|timestamp/i,
    });
    await expect(fallbackNotice.first()).toBeVisible({ timeout: 15_000 });
    // No gold badge in the fallback path.
    await expect(page.locator('.tsa-badge--gold')).toHaveCount(0);

    expect(cap.errors.filter((e) => /Unhandled/i.test(e))).toEqual([]);
  });

  test('TSA-4 — verify B-T PDF → gold badge in /verificar', async ({ page }) => {
    // FIXTURE GAP: this test needs `apps/pwa/tests/e2e/fixtures/sample-b-t.pdf`
    // produced by signing once with TSA on. Generation strategy:
    //   1. Run TSA-1 manually, capture the downloaded PDF.
    //   2. Or add a one-shot script `tools/gen-b-t-fixture.ts` that
    //      calls `signPdfPades({ timestamp: true })` against rsa2048-valid.p12
    //      with the KAT TSR mocked at the fetch layer.
    // Until then this remains `test.fixme`.
    if (!existsSync(FIXTURE_B_T_PDF)) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping TSA-4: fixture ${FIXTURE_B_T_PDF} missing.`);
      test.skip();
    }
    const cap = attachCaptures(page);
    await page.goto('/#/verificar');
    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE_B_T_PDF);

    // Wait for the verifier to render its result panel. `Result.svelte`
    // renders a `role="alert"` section (no "resultado/result" heading text —
    // titles are e.g. "Firma válida"/"Valid signature").
    await expect(page.getByRole('alert')).toBeVisible({
      timeout: 20_000,
    });
    // Gold timestamp badge for a B-T PDF.
    await expect(page.locator('.tsa-badge--gold')).toBeVisible({ timeout: 15_000 });

    expect(cap.errors).toEqual([]);
  });
});
