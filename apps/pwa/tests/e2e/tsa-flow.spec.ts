/**
 * E2E — F6 TSA flow (PAdES B-T) — Batch IV §Task 20.
 *
 * Covers four user journeys around RFC 3161 timestamps:
 *   1. Sign happy path with TSA on  → gold TimestampBadge in DownloadResult.
 *   2. Sign with TSA disabled       → no badge, no `request_timestamp` stage.
 *   3. Sign with TSA timeout        → fallback B-B + warning toast.
 *   4. Verify a B-T PDF             → gold TimestampBadge in /verificar.
 *
 * Status: all tests are wrapped with `test.fixme` because:
 *   - the dev server (`pnpm --filter @firma-ec/pwa dev`) is not available in
 *     this sandbox (no Node child-spawn for vite), and
 *   - Test 4 requires a pre-signed B-T PDF fixture that has to be produced
 *     against the live FreeTSA endpoint OR via a mocked KAT — the fixture
 *     generator is in scope of a follow-up task (see comment in Test 4).
 *
 * To run them locally once the dev server boots:
 *
 *   # 1. Build the whole workspace so @firma-ec/* packages resolve.
 *   pnpm -r build
 *
 *   # 2. (Optional) Generate the B-T fixture for Test 4.
 *   #    Run the wizard manually once with TSA on, save the resulting PDF as
 *   #    apps/pwa/tests/e2e/fixtures/sample-b-t.pdf
 *
 *   # 3. Strip the `.fixme` from each test you want to run, then:
 *   pnpm --filter @firma-ec/pwa exec playwright test tsa-flow.spec.ts
 *
 *   # 4. List the suite without executing (sanity-check the file parses):
 *   pnpm --filter @firma-ec/pwa exec playwright test --list
 *
 * @see docs/superpowers/plans/2026-05-09-firma-ec-F6-TSA.md §Task 20
 * @see apps/pwa/src/ui/firma/TimestampBadge.svelte (`.tsa-badge--gold`)
 * @see apps/pwa/src/ui/firma/DownloadResult.svelte (badge + fallback toast)
 */
import { expect, test, type Page, type Route } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = resolve(HERE, 'fixtures/sample.pdf');
const FIXTURE_B_T_PDF = resolve(HERE, 'fixtures/sample-b-t.pdf');
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const FIXTURE_P12_VALID = resolve(REPO_ROOT, 'packages/signer/tests/fixtures/rsa2048-valid.p12');
const FIXTURE_KAT_TSR = resolve(
  REPO_ROOT,
  'packages/tsa-client/tests/__fixtures__/freetsa-kat-2026-05-09.tsr',
);
const VALID_PIN = 'test1234';

/** Captures pageerror + network calls so individual tests can assert. */
function attachCaptures(page: Page) {
  const errors: string[] = [];
  const tsaCalls: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (r.url().includes('freetsa.org') || r.url().includes('/tsr'))
      tsaCalls.push(`${r.method()} ${r.url()}`);
  });
  return { errors, tsaCalls };
}

/** Forwards captured KAT TSR bytes for any TSA HTTP POST. */
async function mockTsaKat(page: Page) {
  if (!existsSync(FIXTURE_KAT_TSR)) {
    throw new Error(
      `KAT fixture missing at ${FIXTURE_KAT_TSR}. Capture once with tools/capture-tsa-kat.ts.`,
    );
  }
  const tsr = readFileSync(FIXTURE_KAT_TSR);
  await page.route(/freetsa\.org\/tsr|\/tsr$/i, async (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/timestamp-reply' },
      body: tsr,
    });
  });
}

/** Aborts every TSA request to simulate timeout / network failure. */
async function blockTsa(page: Page) {
  await page.route(/freetsa\.org\/tsr|\/tsr$/i, (route) => route.abort('timedout'));
}

/** Toggle the TSA setting via the Configuracion route + localStorage flush. */
async function setTsaEnabled(page: Page, enabled: boolean) {
  await page.goto('/#/configuracion');
  await page.waitForSelector('#tsa-enabled', { state: 'attached' });
  const current = await page.locator('#tsa-enabled').getAttribute('aria-checked');
  if (String(enabled) !== current) await page.locator('#tsa-enabled').click();
  await expect(page.locator('#tsa-enabled')).toHaveAttribute(
    'aria-checked',
    String(enabled),
  );
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
  await page.getByRole('button', { name: /^continuar$|^continue$/i }).last().click();
}
async function step3DropP12(page: Page, p12Path: string) {
  await page.locator('input[type="file"]').first().setInputFiles(p12Path);
}
async function step4Pin(page: Page, pin: string) {
  const inp = page.locator('input[type="password"], input[type="text"][autocomplete="off"]').first();
  await inp.fill(pin);
  await inp.press('Enter');
}
async function advanceFromOptionalToSummary(page: Page) {
  await expect(
    page.getByRole('heading', { name: /detalles opcionales|optional details/i }),
  ).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /^continuar$|^continue$/i }).click();
}
async function clickSign(page: Page) {
  await expect(
    page.getByRole('heading', { name: /listo para firmar|ready to sign/i }),
  ).toBeVisible({ timeout: 10_000 });
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
    'TSA-1 — sign happy path with TSA on → gold badge visible',
    async ({ page }) => {
      const cap = attachCaptures(page);
      await mockTsaKat(page);
      await setTsaEnabled(page, true);

      await page.goto('/#/firmar');
      await step1DropPdf(page, FIXTURE_PDF);
      await step2PlaceBox(page);
      await step3DropP12(page, FIXTURE_P12_VALID);
      await step4Pin(page, VALID_PIN);
      await advanceFromOptionalToSummary(page);
      await clickSign(page);
      await expectSignedHeading(page);

      // TimestampBadge gold variant in DownloadResult.
      const goldBadge = page.locator('.tsa-badge--gold');
      await expect(goldBadge).toBeVisible({ timeout: 15_000 });
      await expect(goldBadge).toHaveAttribute('role', 'status');

      expect(cap.tsaCalls.length).toBeGreaterThanOrEqual(1);
      expect(cap.errors).toEqual([]);
    },
  );

  test.fixme(
    'TSA-2 — TSA disabled → no badge, no /tsr request',
    async ({ page }) => {
      const cap = attachCaptures(page);
      await setTsaEnabled(page, false);

      await page.goto('/#/firmar');
      await step1DropPdf(page, FIXTURE_PDF);
      await step2PlaceBox(page);
      await step3DropP12(page, FIXTURE_P12_VALID);
      await step4Pin(page, VALID_PIN);
      await advanceFromOptionalToSummary(page);
      await clickSign(page);
      await expectSignedHeading(page);

      // No TimestampBadge rendered when reason === 'disabled'.
      await expect(page.locator('.tsa-badge--gold')).toHaveCount(0);
      // And the worker never hits the TSA endpoint.
      expect(cap.tsaCalls).toEqual([]);
      expect(cap.errors).toEqual([]);
    },
  );

  test.fixme(
    'TSA-3 — TSA timeout → fallback B-B with warning toast, no gold badge',
    async ({ page }) => {
      const cap = attachCaptures(page);
      await blockTsa(page);
      await setTsaEnabled(page, true);
      // Settings store key — keep the timeout very low so the test runs fast.
      await page.evaluate(() => {
        const KEY = 'firma_ec_settings_v1';
        const cur = JSON.parse(localStorage.getItem(KEY) ?? '{}');
        localStorage.setItem(
          KEY,
          JSON.stringify({ ...cur, tsaEnabled: true, tsaTimeoutMs: 50 }),
        );
      });

      await page.goto('/#/firmar');
      await step1DropPdf(page, FIXTURE_PDF);
      await step2PlaceBox(page);
      await step3DropP12(page, FIXTURE_P12_VALID);
      await step4Pin(page, VALID_PIN);
      await advanceFromOptionalToSummary(page);
      await clickSign(page);
      await expectSignedHeading(page);

      // Fallback warning visible (the DownloadResult renders an alert role
      // for `firmar.timestamp.failed.*` keys).
      const fallbackAlert = page.getByRole('alert').filter({
        hasText: /sello de tiempo|timestamp/i,
      });
      await expect(fallbackAlert.first()).toBeVisible({ timeout: 15_000 });
      // No gold badge in the fallback path.
      await expect(page.locator('.tsa-badge--gold')).toHaveCount(0);

      expect(cap.errors.filter((e) => /Unhandled/i.test(e))).toEqual([]);
    },
  );

  test.fixme(
    'TSA-4 — verify B-T PDF → gold badge in /verificar',
    async ({ page }) => {
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

      // Wait for the verifier to render its result panel.
      await expect(
        page.getByRole('heading', { name: /resultado|result/i }),
      ).toBeVisible({ timeout: 20_000 });
      // Gold timestamp badge for a B-T PDF.
      await expect(page.locator('.tsa-badge--gold')).toBeVisible({ timeout: 15_000 });

      expect(cap.errors).toEqual([]);
    },
  );
});
