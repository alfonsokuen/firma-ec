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
import { expect, test } from '@playwright/test';
import {
  attachErrorCapture,
  step0ClickEmpezar,
  step1DropPdf,
  step2ConfirmPlacement,
  step3ConfirmHasCertAndUpload,
  step4Pin,
} from './helpers/guided-flow.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = resolve(HERE, 'fixtures/sample.pdf');
const GENERATED_P12 = resolve(HERE, 'fixtures/generated/test-signer.p12');
const PIN = 'test1234';

test.describe('firmar.ec — #/firmar-facil (modo guiado)', () => {
  test('data-guided="true" is present on the guided route root', async ({ page }) => {
    await page.goto('/#/firmar-facil');
    await expect(page.locator('[data-guided="true"]')).toBeAttached();
  });

  test('Home shows a visible entry point to the guided flow', async ({ page }) => {
    await page.goto('/#/');
    const entry = page.locator('main a[href="#/firmar-facil"]');
    await expect(entry).toBeVisible();
    await entry.click();
    await expect(page).toHaveURL(/#\/firmar-facil/);
    await expect(page.locator('[data-guided="true"]')).toBeAttached();
  });

  // ── Discoverability gap fix — standard flow `#/firmar` (step 1) and the
  // header nav must both offer a way into the guided flow, not just the
  // Home banner. ──────────────────────────────────────────────────────
  test('standard flow #/firmar (step 1) offers a link into the guided flow', async ({ page }) => {
    await page.goto('/#/firmar');
    const entry = page.locator('main a[href="#/firmar-facil"]');
    await expect(entry).toBeVisible();
    await entry.click();
    await expect(page).toHaveURL(/#\/firmar-facil/);
    await expect(page.locator('[data-guided="true"]')).toBeAttached();
  });

  test('the guided-flow link is not shown once inside the guided mode itself', async ({ page }) => {
    await page.goto('/#/firmar-facil');
    await expect(page.locator('[data-guided="true"]')).toBeAttached();
    await expect(page.locator('main a[href="#/firmar-facil"]')).toHaveCount(0);
  });

  test('header nav has a "Firmar Fácil" item linking to the guided flow', async ({
    page,
    viewport,
  }) => {
    await page.goto('/#/');
    // Desktop nav is `hidden md:flex`; on narrow viewports (< 768px, the
    // UnoCSS `md` breakpoint) the same item only exists inside the hamburger
    // menu — open it first there, so this test works under both the
    // `chromium` and `mobile` Playwright projects. Decided from the fixed
    // `viewport` config (not a post-hoc `isVisible()` check, which races
    // against hydration right after `goto`).
    const isNarrow = (viewport?.width ?? 1280) < 768;
    if (isNarrow) {
      await page.getByRole('button', { name: /abrir menú|open menu/i }).click();
    }
    const navEntry = page.locator('header a[href="#/firmar-facil"]:visible').first();
    await expect(navEntry).toBeVisible();
    await navEntry.click();
    await expect(page).toHaveURL(/#\/firmar-facil/);
    await expect(page.locator('[data-guided="true"]')).toBeAttached();
  });

  test('golden path — real signing end to end, 2-layer validation of the output', async ({
    page,
  }) => {
    const cap = attachErrorCapture(page);

    // ── Route + guided marker ──────────────────────────────────────────
    await page.goto('/#/firmar-facil');
    await expect(page.locator('[data-guided="true"]')).toBeAttached();

    // ── Steps 1–5: welcome gate → PDF → auto-place → cert → PIN → summary ──
    await step0ClickEmpezar(page);
    await step1DropPdf(page, FIXTURE_PDF);
    await step2ConfirmPlacement(page);

    // Voice/UI coherence — step 3: `guided.voz.cargar_p12` tells the user to
    // tap "Buscar mi archivo"; the DropP12 zone must show that exact label
    // (F-voice-doble-voz follow-up: audio used to name a button that didn't
    // exist on screen — DropP12's `label`/`ariaLabel` props now carry it).
    await page.getByRole('button', { name: /^sí, lo tengo$|^yes, i have it$/i }).click();
    await expect(
      page.getByRole('button', { name: /^buscar mi archivo$|^find my file$/i }),
    ).toBeVisible({ timeout: 10_000 });
    const p12Input = page.locator('input[type="file"]').first();
    await p12Input.waitFor({ state: 'attached' });
    await p12Input.setInputFiles(GENERATED_P12);
    await expect(
      page.getByRole('heading', {
        name: /escribe tu contraseña|enter your password|tu contraseña|password/i,
      }),
    ).toBeVisible({ timeout: 10_000 });

    await step4Pin(page, PIN);

    await expect(
      page.getByRole('heading', { name: /listo para firmar|ready to sign/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Voice/UI coherence — step 5: `guided.voz.confirmar` says "toca 'Firmar
    // ahora'"; the footer CTA must say exactly that in guided mode (standard
    // mode keeps "Firmar PDF" — see nextLabel in Firmar.svelte). Capture the
    // programmatic download DownloadResult triggers on mount (step 6).
    const signButton = page.getByRole('button', { name: /^firmar ahora$|^sign now$/i });
    await expect(signButton).toBeVisible();
    await expect(page.getByRole('button', { name: /^firmar pdf$|^sign pdf$/i })).toHaveCount(0);
    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await signButton.click();
    const download = await downloadPromise;

    // Step 6 — success screen. Voice/UI coherence: `guided.voz.listo` says
    // "toca 'Descargar' ... o 'Compartir'" — those must be the real labels.
    await expect(
      page.getByRole('heading', { name: /pdf firmado correctamente|pdf signed successfully/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /^descargar$|^download$/i })).toBeVisible();

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

  // ── F3 pulido — "retomar donde ibas": localStorage debe llevar SOLO el nº
  // de paso, jamás el PDF, el .p12 ni el PIN (docs/plan §6 F3, tabla de
  // riesgos "Seguridad (.p12/PIN)"). ──────────────────────────────────────
  test('localStorage in guided mode only ever holds the step number — never the PDF or the PIN', async ({
    page,
  }) => {
    await page.goto('/#/firmar-facil');
    await step0ClickEmpezar(page);
    await step1DropPdf(page, FIXTURE_PDF);
    await step2ConfirmPlacement(page);
    await step3ConfirmHasCertAndUpload(page, GENERATED_P12);
    await step4Pin(page, PIN);

    const storage = await page.evaluate(() => ({ ...localStorage }));
    const entries = Object.entries(storage);

    const stepEntry = entries.find(([key]) => key === 'fec.guided.step.v1');
    expect(stepEntry).toBeTruthy();
    // Just a small integer — never a serialized object/blob.
    expect(stepEntry?.[1]).toMatch(/^[1-9]\d*$/);

    // Across ALL localStorage entries (not just the guided-step key): no
    // value may embed the PIN or reference the .p12 file, and nothing is
    // large enough to be PDF/PFX bytes.
    for (const [, value] of entries) {
      expect(value.length).toBeLessThan(200);
      expect(value).not.toContain(PIN);
      expect(value.toLowerCase()).not.toContain('.p12');
    }
  });

  // ── F3 pulido — defensivo: `getSavedStep()` debe devolver null (y NUNCA
  // lanzar) ante un valor corrupto en localStorage, así que el banner de
  // "retomar" no debe aparecer y el modo guiado debe cargar normal. ──────
  for (const corruptValue of ['no-es-numero', '-1', '{}']) {
    test(`corrupt fec.guided.step.v1 ("${corruptValue}") — no resume banner, no error, loads normally`, async ({
      page,
    }) => {
      const cap = attachErrorCapture(page);
      await page.addInitScript(
        (value) => localStorage.setItem('fec.guided.step.v1', value),
        corruptValue,
      );

      await page.goto('/#/firmar-facil');
      await expect(page.locator('[data-guided="true"]')).toBeAttached();

      // No resume banner: getSavedStep() must have returned null for garbage.
      await expect(
        page.getByRole('group', { name: /retomamos donde ibas|pick up where you left off/i }),
      ).toHaveCount(0);

      // Normal welcome gate renders — the flow never got derailed by the
      // corrupt value.
      await expect(page.getByRole('button', { name: /^empezar$|^start$/i })).toBeVisible({
        timeout: 10_000,
      });

      expect(cap.errors).toEqual([]);
    });
  }

  test('mobile (Pixel 7) — guided route loads and reaches step 2', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Only meaningful under the mobile project.');
    await page.goto('/#/firmar-facil');
    await expect(page.locator('[data-guided="true"]')).toBeAttached();
    await step0ClickEmpezar(page);
    await step1DropPdf(page, FIXTURE_PDF);
    await page.locator('.placed-box').waitFor({ state: 'visible', timeout: 15_000 });
  });

  // ── F2 fix A — voice narrator: no autoplay without a user gesture; the
  // "Empezar" welcome-gate button is the one real gesture that unlocks it. ──
  test('welcome gate blocks audio until "Empezar"; no autoplay before it', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    const cap = attachErrorCapture(page);

    await page.goto('/#/firmar-facil');
    await expect(page.locator('[data-guided="true"]')).toBeAttached();

    // Before "Empezar": welcome card is shown, Drop/GuideNarrator are NOT
    // mounted yet, so no audio could have played (0 NotAllowedError so far).
    const startButton = page.getByRole('button', { name: /^empezar$|^start$/i });
    await expect(startButton).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /^escuchar$|^listen$/i })).toHaveCount(0);

    const errorsBeforeStart = [...cap.errors, ...consoleErrors].filter((m) =>
      /NotAllowedError/i.test(m),
    );
    expect(errorsBeforeStart).toEqual([]);

    // "Empezar" is the one legitimate user gesture that unlocks audio
    // (`speak('bienvenida')` inside `onStart` sets `audioUnlocked = true`).
    await startButton.click();

    // After "Empezar": Drop + GuideNarrator(cargar_pdf) render with a toggle
    // that is already "Detener"/"Stop" if the bienvenida clip is still
    // playing, or back to "Escuchar"/"Listen" once it finished — either state
    // proves the narrator mounted and audio unlocked without violating the
    // autoplay policy (the gesture that unlocked it was the click itself).
    await expect(
      page.getByRole('button', { name: /^escuchar$|^detener$|^listen$|^stop$/i }),
    ).toBeVisible({ timeout: 10_000 });

    const autoplayErrors = [...cap.errors, ...consoleErrors].filter((m) =>
      /NotAllowedError/i.test(m),
    );
    expect(autoplayErrors).toEqual([]);
  });

  // ── F3b — voz en inglés: Web Speech con lang="en-US" cuando el idioma de
  // la app es EN, sin tocar el manifest de clips mp3 (solo ES) ni romper el
  // autoplay gate. ──────────────────────────────────────────────────────
  test('voz EN: usa Web Speech con lang="en-US" y no pide el manifest de clips ES', async ({
    page,
  }) => {
    // Espía `speechSynthesis.speak` ANTES de que la app cargue (init script
    // corre antes de cualquier script de la página) y registra si se pidió
    // el manifest de clips (solo existen en español — pedirlo en EN sería
    // un desperdicio de red y una señal de que `speak()` no está mirando el
    // idioma actual).
    await page.addInitScript(() => {
      (window as unknown as { __ttsCalls: Array<{ text: string; lang: string }> }).__ttsCalls = [];
      const w = window as unknown as { __ttsCalls: Array<{ text: string; lang: string }> };
      const originalSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => {
        w.__ttsCalls.push({ text: utterance.text, lang: utterance.lang });
        // No reproduce audio de verdad en headless — evita que la promesa de
        // play() nunca resuelva; onend no es necesario para esta aserción.
        return originalSpeak(utterance);
      };
    });
    let manifestRequested = false;
    await page.route('**/voz-firma/manifest.json', (route) => {
      manifestRequested = true;
      return route.fulfill({ status: 404 });
    });

    // `initialLang()` in i18n.svelte.ts reads `localStorage.getItem('lang')`
    // synchronously at module load — `addInitScript` (not `evaluate`, which
    // would run too late on `about:blank`, a different origin) guarantees
    // this runs before the app's own scripts on the real navigation.
    await page.addInitScript(() => localStorage.setItem('lang', 'en'));
    await page.goto('/#/firmar-facil');
    await expect(page.locator('[data-guided="true"]')).toBeAttached();

    const startButton = page.getByRole('button', { name: /^start$/i });
    await expect(startButton).toBeVisible({ timeout: 10_000 });
    await startButton.click();

    await expect(async () => {
      const calls = await page.evaluate(
        () =>
          (window as unknown as { __ttsCalls: Array<{ text: string; lang: string }> }).__ttsCalls,
      );
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0]?.lang).toBe('en-US');
    }).toPass({ timeout: 10_000 });

    expect(manifestRequested, 'EN speak() must not fetch the ES-only clip manifest').toBe(false);
  });
});
