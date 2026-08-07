import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * E2E — F1 AIA caIssuers fallback (real browser, real Worker, real
 * same-origin proxy routing — only the upstream UANATACA network call is
 * mocked, via `e2eMockAia` in vite.config.ts, E2E_MOCK_AIA=1).
 *
 * Every unit/integration test for F1 (aia-certs.test.ts, chain-
 * intermediates.test.ts, sign-bus.test.ts, sign-network-budget.test.ts)
 * exercises `resolveSigningIntermediates`/`fetchIssuerCertViaAia` directly,
 * with a mocked `fetchImpl` injected at the function-call boundary. None of
 * them prove the pieces are actually WIRED end to end: that a real fetch
 * issued from inside `sign.worker.ts`'s own Worker scope really reaches the
 * same-origin `/api/aia/uanataca` route (`ARCOTEL_PROXY_MAP`'s exact
 * allowlist key), that the resolved cert really reaches `signPdfPades`, and
 * that the UI (`DownloadResult.svelte`) really renders the warning the
 * worker reports. This spec closes that gap.
 *
 * Fixture: `global-setup.ts` generates a leaf-only .p12 (bundle-miss,
 * `test-signer-aia-bundle-miss.p12`) whose leaf's AIA URL is UANATACA's REAL
 * subordinate1.crt string, so the walk naturally proxies through the same
 * route production does. The intermediate `e2eMockAia` serves is
 * self-signed and NOT a trust anchor this app knows — see global-setup.ts's
 * header for why a test fixture can never legitimately resolve to
 * `chainComplete: true` here. All three tests below therefore expect the
 * SAME non-blocking `chain_incomplete` warning, reached via three different
 * code paths (HIGH-1a PEM parsing + HIGH-B untrusted-root rejection /
 * clean AIA failure / AIA network budget under HIGH-3's deadline).
 *
 * @see apps/pwa/tests/e2e/global-setup.ts (fixture + AIA chain generation)
 * @see apps/pwa/vite.config.ts (e2eMockAia)
 * @see packages/signer/src/chainIntermediates.ts (the walk + HIGH-B fix)
 * @see apps/pwa/src/ui/firma/DownloadResult.svelte (chain_incomplete UI)
 */
import { type Page, expect, test } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = resolve(HERE, 'fixtures/sample.pdf');
const FIXTURE_P12_AIA_BUNDLE_MISS = resolve(
  HERE,
  'fixtures/generated/test-signer-aia-bundle-miss.p12',
);
const VALID_PIN = 'test1234';

/** Reconfigure `e2eMockAia`'s response for `/api/aia/uanataca` before the
 *  next sign. Must run before `step3DropP12` — the fetch can happen as soon
 *  as signing starts. */
async function setAiaMockMode(
  page: Page,
  mode: 'ok' | 'notfound' | 'hang',
  delayMs = 0,
): Promise<void> {
  const res = await page.request.post(
    `/api/__test__/aia-mode?mode=${mode}&delayMs=${delayMs}`,
  );
  expect(res.status(), 'aia-mode control endpoint must be reachable (E2E_MOCK_AIA=1)').toBe(204);
}

function attachErrorCapture(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return { errors };
}

// ── Step helpers (mirrors firma.spec.ts's #/firmar wizard — see there for
//    the full annotated version) ───────────────────────────────────────────

async function step1DropPdf(page: Page, pdfPath: string): Promise<void> {
  const pdfInput = page.locator('input[type="file"]').first();
  await pdfInput.waitFor({ state: 'attached' });
  await pdfInput.setInputFiles(pdfPath);
  await expect(
    page.getByRole('heading', { name: /coloca tu cuadro|place your signature/i }),
  ).toBeVisible({ timeout: 15_000 });
}

async function step2PlaceBox(page: Page): Promise<void> {
  const overlay = page.locator('.box-overlay');
  await overlay.waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('.sig-box').waitFor({ state: 'visible', timeout: 10_000 });
  const nextBtn = page.getByRole('button', { name: /^continuar$|^continue$/i }).last();
  await nextBtn.click();
  await expect(
    page.getByRole('heading', { name: /tu certificado|your \.p12 certificate/i }),
  ).toBeVisible({ timeout: 10_000 });
}

async function step3DropP12(page: Page, p12Path: string): Promise<void> {
  const p12Input = page.locator('input[type="file"]').first();
  await p12Input.waitFor({ state: 'attached' });
  await p12Input.setInputFiles(p12Path);
  await expect(
    page.getByRole('heading', {
      name: /escribe tu contraseña|enter your password|tu contraseña|password/i,
    }),
  ).toBeVisible({ timeout: 10_000 });
}

async function step4PinAndSign(page: Page, pin: string): Promise<void> {
  const pinInput = page
    .locator('input[type="password"], input[type="text"][autocomplete="off"]')
    .first();
  await pinInput.waitFor({ state: 'visible' });
  await pinInput.fill(pin);
  await pinInput.press('Enter');
  await expect(
    page.getByRole('heading', { name: /listo para firmar|ready to sign/i }),
  ).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /^firmar pdf$|^sign pdf$/i }).click();
}

test.describe('F1 — AIA caIssuers fallback (real Worker, real same-origin proxy route)', () => {
  test('AIA resolves the missing intermediate, but it anchors on an untrusted root → signs OK, chain_incomplete warning shown', async ({
    page,
  }) => {
    const cap = attachErrorCapture(page);
    // Dual-review fix (2026-08-06): the 'ok' and 'notfound' tests below used
    // to assert only on the warning's TEXT — and `leafCert`'s issuer DN
    // (generateAiaTestChain in global-setup.ts) equals the synthetic
    // intermediate's own CN ("Synthetic E2E CA (untrusted)"), so that text is
    // IDENTICAL whether AIA actually resolved the intermediate or was never
    // called at all. A verified repro (forcing this mock to 'notfound' while
    // still running the 'ok' test body) passed 4/5 runs with AIA completely
    // broken. Capturing real network requests to `/api/aia/` proves the
    // fetch genuinely fired during THIS run, which the warning text alone
    // does not.
    //
    // NOTE: DownloadResult.svelte's chain-incomplete-warn today only exposes
    // `missingIssuerDn` (see apps/pwa/src/ui/firma/DownloadResult.svelte) —
    // there is no separate reason code (e.g. `resolved_untrusted` vs
    // `http_error`) rendered in the UI that would let an assertion on the
    // warning's own content tell the 'ok' and 'notfound' paths apart. Until
    // such a field exists, the request-capture assertion below is the real
    // signal distinguishing the two tests, not the warning text.
    const aiaRequests: string[] = [];
    const aiaStatuses: number[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/aia/')) aiaRequests.push(r.url());
    });
    page.on('response', (r) => {
      if (r.url().includes('/api/aia/')) aiaStatuses.push(r.status());
    });

    await page.goto('/#/firmar');
    await setAiaMockMode(page, 'ok');

    await step1DropPdf(page, FIXTURE_PDF);
    await step2PlaceBox(page);
    await step3DropP12(page, FIXTURE_P12_AIA_BUNDLE_MISS);
    await step4PinAndSign(page, VALID_PIN);

    await expect(
      page.getByRole('heading', { name: /pdf firmado correctamente|pdf signed successfully/i }),
    ).toBeVisible({ timeout: 30_000 });

    // HIGH-1a (PEM parsing) + HIGH-B (untrusted self-signed root rejected,
    // never embedded, complete:false) — both had to work for this warning
    // to be the one that renders, instead of a hard failure or a false
    // "complete" verdict.
    const warn = page.getByTestId('chain-incomplete-warn');
    await expect(warn).toBeVisible({ timeout: 10_000 });
    await expect(warn).toContainText(/no pudimos confirmar|couldn't confirm/i);
    // missingIssuerDn detail line — the untrusted synthetic CA's own DN.
    await expect(warn).toContainText(/Synthetic E2E CA/i);

    // Proves the AIA fetch actually happened during this run — the warning
    // text above is identical in the 'notfound' test and would pass even if
    // AIA were never called at all (see comment at the top of this test).
    expect(aiaRequests.length, 'AIA endpoint must have been fetched at least once').toBeGreaterThan(
      0,
    );
    // Proves it actually SUCCEEDED (200 + the intermediate's PEM), not just
    // that a request fired and got e.g. a 500 — without this, this test and
    // the 'notfound' test below would still be observationally identical
    // except for which mode was requested, not what the app saw back.
    // Fixed cardinality (not `aiaStatuses.map(() => 200)`, which derives the
    // expected value from the actual one and would pass on `[]` too, or on
    // any array of the same length regardless of content — the exact
    // anti-pattern this diff exists to eradicate).
    expect(aiaStatuses, 'AIA response(s) must all be 200 in "ok" mode').toEqual([200]);

    expect(cap.errors).toEqual([]);
  });

  test('AIA responder 404s → signs OK anyway (non-blocking), same chain_incomplete warning', async ({
    page,
  }) => {
    const cap = attachErrorCapture(page);
    const aiaRequests: string[] = [];
    const aiaStatuses: number[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/aia/')) aiaRequests.push(r.url());
    });
    page.on('response', (r) => {
      if (r.url().includes('/api/aia/')) aiaStatuses.push(r.status());
    });

    await page.goto('/#/firmar');
    await setAiaMockMode(page, 'notfound');

    await step1DropPdf(page, FIXTURE_PDF);
    await step2PlaceBox(page);
    await step3DropP12(page, FIXTURE_P12_AIA_BUNDLE_MISS);
    await step4PinAndSign(page, VALID_PIN);

    await expect(
      page.getByRole('heading', { name: /pdf firmado correctamente|pdf signed successfully/i }),
    ).toBeVisible({ timeout: 30_000 });

    const warn = page.getByTestId('chain-incomplete-warn');
    await expect(warn).toBeVisible({ timeout: 10_000 });
    // Different code path than the 'ok' test (http_error, not
    // "resolved-but-untrusted") — the leaf's OWN issuer DN is what's
    // reported missing here, since the AIA fetch never got a candidate at
    // all (formatIssuerDn(current) where current is still the leaf).
    await expect(warn).toContainText(/Synthetic E2E CA/i);

    // Proves the 404 genuinely came from a real request to the mock — not
    // that AIA was simply never invoked (which would render the exact same
    // warning text, see comment in the 'ok' test above).
    expect(
      aiaRequests.length,
      'AIA endpoint must have been fetched at least once (to receive the 404)',
    ).toBeGreaterThan(0);
    // Proves the 404 was real, not e.g. a request that never reached the
    // mock at all — this is what makes this test observationally distinct
    // from the 'ok' test above instead of a near-duplicate that only differs
    // in which mode string was requested. Fixed cardinality — see the 'ok'
    // test above for why deriving the expected array from `aiaStatuses`
    // itself would be a no-op assertion.
    expect(aiaStatuses, 'AIA response(s) must all be 404 in "notfound" mode').toEqual([404]);

    expect(cap.errors).toEqual([]);
  });

  test('AIA responder hangs forever → HIGH-3 network budget still lets signing complete within the document timeout, not a session-fatal hang', async ({
    page,
  }) => {
    const cap = attachErrorCapture(page);
    // Same tautology risk as the 'ok'/'notfound' tests above, left open in
    // the first pass of this fix (dual-review finding, 2026-08-07): without
    // these captures, a network budget regression back to the full 60s cap,
    // or the AIA fetch never firing at all, would both still pass this test
    // green — measured slack today is ~13× (completes in ~1.9s against the
    // 25s timeout).
    const aiaRequests: string[] = [];
    const aiaStatuses: number[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/aia/')) aiaRequests.push(r.url());
    });
    page.on('response', (r) => {
      if (r.url().includes('/api/aia/')) aiaStatuses.push(r.status());
    });

    await page.goto('/#/firmar');
    await setAiaMockMode(page, 'hang');

    await step1DropPdf(page, FIXTURE_PDF);
    await step2PlaceBox(page);
    await step3DropP12(page, FIXTURE_P12_AIA_BUNDLE_MISS);
    await step4PinAndSign(page, VALID_PIN);

    // A small PDF's document timeout is ~15s (computeSignTimeoutMs) and the
    // AIA leg's aggregate deadline is a small fraction of that
    // (deriveNetworkBudget) — so signing must still finish well inside a
    // generous 25s window, not silently consume the full 60s cap nor
    // surface a hard `timeout` error. This is the direct real-browser proof
    // for the single-document HIGH-3 fix (sign-bus.ts / sign.worker.ts).
    await expect(
      page.getByRole('heading', { name: /pdf firmado correctamente|pdf signed successfully/i }),
    ).toBeVisible({ timeout: 25_000 });

    const warn = page.getByTestId('chain-incomplete-warn');
    await expect(warn).toBeVisible({ timeout: 10_000 });

    // Proves the AIA fetch really fired (request sent) and really never got
    // a response (the defining signature of 'hang' mode) — not that it was
    // simply skipped, which would look identical without these asserts.
    expect(aiaRequests.length, 'AIA endpoint must have been fetched').toBeGreaterThan(0);
    expect(aiaStatuses, 'a hung request must never receive a response').toEqual([]);

    expect(cap.errors).toEqual([]);
  });
});
