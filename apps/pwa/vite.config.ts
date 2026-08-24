import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import UnoCSS from 'unocss/vite';
import { type Plugin, defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { appVersionDefine } from './appVersion.ts';

// Read the TSL SHA-256 baked in at build time for the runtime SRI check.
// Falls back to empty string in dev mode (before build:tsl has run).
const tslShaPath = resolve(import.meta.dirname, 'public/trust/tsl-ec.sha256');
const TSL_HASH = existsSync(tslShaPath) ? readFileSync(tslShaPath, 'utf-8').trim() : '';

/**
 * e2eMockTsa — dev-server-only middleware that mocks the `/api/tsa` proxy
 * (see settings.svelte.ts `DEFAULT_SETTINGS.tsaUrl`) for Playwright's F6 TSA
 * e2e coverage (tests/e2e/tsa-flow.spec.ts).
 *
 * WHY a Vite dev-server plugin and not `page.route()`: the TSA request is
 * issued by `sign.worker.ts`, a dedicated Worker — Playwright's network
 * interception (`page.route()` / `context.route()`) does not intercept
 * fetches made from a Worker's own global scope (the request IS visible via
 * the passive `page.on('request')` listener, but `route.fulfill()` never
 * applies to it). A same-origin dev-server mock is the only way to control
 * the TSA response without touching runtime app code.
 *
 * Gated by `E2E_MOCK_TSA=1` (set only in playwright.config.ts's `webServer`
 * env — see there) so `pnpm dev` and `vite build` are completely unaffected;
 * mirrors the existing `server.fs.strict: false` dev-only precedent below.
 *
 * Response shape is controlled by the test via the `tsaUrl` setting itself
 * (written directly to localStorage, bypassing the UI's https:// validator —
 * same precedent as tsa-flow.spec.ts's existing settings overrides):
 *   - `/api/tsa`              → 200 + the KAT TSR fixture bytes immediately.
 *   - `/api/tsa?delay=<ms>`   → waits `<ms>` before responding, letting a
 *     test force a client-side timeout by pairing it with a low
 *     `settings.tsaTimeoutMs`.
 */
function e2eMockTsa(): Plugin {
  if (process.env.E2E_MOCK_TSA !== '1') return { name: 'e2e-mock-tsa:noop' };
  const katPath = resolve(
    import.meta.dirname,
    '../../packages/tsa-client/tests/__fixtures__/freetsa-kat-2026-05-09.tsr',
  );
  return {
    name: 'e2e-mock-tsa',
    configureServer(server) {
      server.middlewares.use('/api/tsa', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const delayMs = Number(
          new URL(req.url ?? '', 'http://localhost').searchParams.get('delay') ?? '0',
        );
        const respond = () => {
          const tsr = readFileSync(katPath);
          res.statusCode = 200;
          res.setHeader('content-type', 'application/timestamp-reply');
          res.end(tsr);
        };
        if (delayMs > 0) setTimeout(respond, delayMs);
        else respond();
      });
    },
  };
}

/**
 * e2eMockAia — dev-server-only middleware that mocks `/api/aia/uanataca`
 * (the same-origin proxy route `ARCOTEL_PROXY_MAP` rewrites UANATACA's real
 * caIssuers URL to — see packages/ltv-validation/src/proxy.ts) for the F1
 * AIA-fallback E2E coverage (tests/e2e/aia-fallback.spec.ts).
 *
 * Same rationale as `e2eMockTsa` above: the AIA fetch happens inside
 * sign.worker.ts's own Worker scope. `page.route()` CAN actually intercept
 * it (verified by dual review, 2026-08-07 — Worker fetches are not exempt in
 * Playwright, contrary to what an earlier version of this comment claimed),
 * but a same-origin dev-server mock is still the only way to serve the real
 * `.pem` fixture content without duplicating it into a `page.route()` handler.
 *
 * Behaviour is controlled by a companion test-only endpoint
 * (`/api/__test__/aia-mode`, POST `?mode=ok|notfound|hang&delayMs=<n>`) the
 * spec calls before triggering a sign — mirrors `e2eMockTsa`'s `?delay=`
 * query param, but as a settable side channel since the leaf's AIA URL
 * (baked into the fixture cert at generation time) can't carry per-test
 * query params of its own.
 *
 * Gated by `E2E_MOCK_AIA=1` (playwright.config.ts's `webServer` env only) —
 * `pnpm dev` / `vite build` are completely unaffected.
 */
function e2eMockAia(): Plugin {
  if (process.env.E2E_MOCK_AIA !== '1') return { name: 'e2e-mock-aia:noop' };
  const pemPath = resolve(
    import.meta.dirname,
    'tests/e2e/fixtures/generated/test-aia-intermediate.pem',
  );
  let mode: 'ok' | 'notfound' | 'hang' = 'ok';
  let delayMs = 0;
  return {
    name: 'e2e-mock-aia',
    configureServer(server) {
      server.middlewares.use('/api/__test__/aia-mode', (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost');
        const requested = url.searchParams.get('mode');
        mode = requested === 'notfound' || requested === 'hang' ? requested : 'ok';
        delayMs = Number(url.searchParams.get('delayMs') ?? '0');
        res.statusCode = 204;
        res.end();
      });
      server.middlewares.use('/api/aia/uanataca', (req, res) => {
        if (mode === 'hang') return; // never responds — exercises the AIA deadline
        if (mode === 'notfound') {
          res.statusCode = 404;
          res.end();
          return;
        }
        const respond = () => {
          const pem = readFileSync(pemPath);
          res.statusCode = 200;
          res.setHeader('content-type', 'application/x-pem-file');
          res.end(pem);
        };
        if (delayMs > 0) setTimeout(respond, delayMs);
        else respond();
      });
    },
  };
}

/**
 * Sync pdfjs-dist runtime assets (worker + standard fonts) into public/pdfjs/
 * from the *installed* package on every dev start and build.
 *
 * Why a plugin and not a committed copy: the PDF preview renders blank whenever
 * a document uses NON-embedded standard-14 fonts (Helvetica/Times/Courier — e.g.
 * every ReportLab-generated contract). pdfjs needs `standardFontDataUrl` pointing
 * at these font files or it drops every glyph. Committing them by hand rots on the
 * next pdfjs-dist bump (the worker/font data silently goes stale vs the runtime).
 * Sourcing them from node_modules at build time keeps them permanently in lock-step
 * with the installed version — one line can't drift. public/pdfjs/ is gitignored.
 */
function syncPdfjsAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'));
  const outDir = resolve(import.meta.dirname, 'public/pdfjs');
  return {
    name: 'sync-pdfjs-assets',
    // `configResolved`, NOT `buildStart` (2026-08-23, causa raíz de los 22
    // fallos e2e-en-contenedor): el dev server de Vite 5+ escanea `public/`
    // UNA vez al crearse (`server.publicFiles`) y sirve estáticos contra ese
    // set precalculado. `buildStart` corre DESPUÉS de ese escaneo, así que en
    // un checkout fresco (CI/contenedor, donde public/pdfjs/ aún no existe)
    // el server nunca registraba estos archivos: cada GET al worker caía al
    // fallback SPA y devolvía index.html (200, text/html) — un module worker
    // servido como HTML muere, pdf.js cae al "fake worker" (import() de un
    // asset de public/ → 404 by design en Vite) y el preview no monta jamás.
    // En el host de desarrollo public/pdfjs/ persiste de corridas anteriores,
    // por eso el fallo solo se veía en contenedor y era determinista.
    // `configResolved` corre antes de crear el server (y también en `vite
    // build`), así que el escaneo inicial ya ve los archivos.
    configResolved() {
      mkdirSync(outDir, { recursive: true });
      cpSync(join(pdfjsRoot, 'build/pdf.worker.min.mjs'), join(outDir, 'pdf.worker.min.mjs'));
      const fontsOut = join(outDir, 'standard_fonts');
      rmSync(fontsOut, { recursive: true, force: true });
      // Copies the .pfb/.ttf glyph data AND their LICENSE_FOXIT / LICENSE_LIBERATION.
      cpSync(join(pdfjsRoot, 'standard_fonts'), fontsOut, { recursive: true });
    },
  };
}

export default defineConfig({
  define: {
    __TSL_HASH__: JSON.stringify(TSL_HASH),
    // La versión visible al usuario sale de apps/pwa/package.json, nunca de una
    // constante a mano — ver appVersion.ts y src/lib/version.ts.
    ...appVersionDefine(),
  },
  plugins: [
    // UnoCSS must come before Svelte so atomic classes are generated before component compilation
    UnoCSS(),
    svelte(),
    syncPdfjsAssets(),
    e2eMockTsa(),
    e2eMockAia(),
    VitePWA({
      // v0.4.1 — switched from generateSW (Workbox auto) to injectManifest so
      // the custom sw.ts can intercept POST /share (Share Target). The
      // generated SW lives at /sw.js post-build (Vite bundles src/sw.ts).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        rollupFormat: 'es',
        // Bump from default 2MB — pdfjs/crypto chunks can exceed that.
        maximumFileSizeToCacheInBytes: 5_000_000,
        // pfb/ttf = pdfjs standard_fonts → precache so non-embedded fonts render
        // OFFLINE too (the app promises "sin servidores").
        globPatterns: ['**/*.{js,css,html,svg,woff2,png,pfb,ttf}'],
      },
      registerType: 'prompt',
      // rc8: register the SW manually from main.ts so we can drive the
      // update-available toast via the registration callbacks. The default
      // auto-registered /registerSW.js does a fire-and-forget register() with
      // no update detection, which is why installed PWAs got stuck on stale
      // versions.
      injectRegister: null,
      includeAssets: ['favicon.svg', 'fonts/*.woff2'],
      manifest: {
        name: 'firmar.ec — Firma y Verifica PDFs',
        short_name: 'firmar.ec',
        description:
          'Firma y verifica PDFs con tu certificado electrónico .p12 (ECI ARCOTEL). 100% en tu navegador: no se sube nada.',
        theme_color: '#0B1A3A',
        background_color: '#0B1A3A',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'es',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          // 'any maskable' → el mismo PNG sirve para el diálogo de instalación
          // (icono nítido, contexto "any") y para launchers adaptativos
          // (maskable). Antes era solo 'maskable', lo que dejaba al diálogo sin
          // un icono "any" 512 y podía verse recortado/borroso.
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
        // Accesos directos del icono instalado (mantener pulsado en Android /
        // clic derecho en escritorio). Sin esto el icono no ofrece nada y se
        // pierde la recurrencia, que es la razon de instalar la app.
        shortcuts: [
          {
            name: 'Firmar un PDF',
            short_name: 'Firmar',
            url: '/#/firmar-facil',
            icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Verificar una firma',
            short_name: 'Verificar',
            url: '/#/verificar',
            icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
        // v0.4.0 — receive PDFs from WhatsApp/Gmail/etc via OS share sheet.
        // POST + multipart will only deliver files when a SW intercepts /share
        // (deferred to v0.4.1). The declaration is kept now so the OS lists
        // firmar.ec as a target; until the SW lands, file shares hit the server
        // (gracefully redirected to / by Caddy try_files). text/url shares work.
        share_target: {
          action: '/share',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [{ name: 'file', accept: ['application/pdf', '.pdf'] }],
          },
        },
        // v0.4.0 — register as "Open with" target for PDFs. This uses the
        // browser launchQueue API (Chromium 102+ on Android/Desktop) and does
        // NOT require a service worker — the file arrives in the launchQueue
        // consumer at /handle-file and is read from a FileSystemHandle.
        file_handlers: [
          {
            action: '/handle-file',
            accept: { 'application/pdf': ['.pdf'] },
            icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
            launch_type: 'single-client',
          },
        ],
        // Reuse an existing tab if the PWA is already open when shared/launched.
        launch_handler: { client_mode: 'navigate-existing' },
      },
      // workbox: { ... }  — moved into src/sw.ts as part of v0.4.1 migration to
      // injectManifest. NetworkOnly rules for /_assets/crypto-* and /trust/*
      // and precache navigation are all expressed declaratively in sw.ts.
    }),
  ],
  worker: {
    // Worker is instantiated with `{ type: 'module' }` (see src/lib/workers/bus.ts).
    // Vite's default worker.format='iife' is incompatible with code-splitting builds
    // (chunked workers). ES output matches the runtime declaration.
    format: 'es',
  },
  build: {
    target: 'es2022',
    cssMinify: 'lightningcss',
    minify: 'esbuild',
    sourcemap: true,
    rollupOptions: {
      output: {
        // v0.4.6 — code-split heavy crypto deps so /firmar lands ~500KB instead
        // of pulling node-forge + pkijs + qrcode into the main entry chunk.
        // Grouped by load boundary: signer-deps (forge + qrcode) and pki
        // (pkijs/asn1js — also used by verifier). pdf for pdfjs-dist.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('node-forge') || id.includes('qrcode')) return 'signer-deps';
            if (id.includes('pdfjs-dist')) return 'pdf';
            if (id.includes('pkijs') || id.includes('asn1js')) return 'pki';
            if (id.includes('@noble') || id.includes('pvutils') || id.includes('pvtsutils'))
              return 'crypto-utils';
          }
          if (id.includes('packages/signer/src')) return 'signer';
          if (id.includes('packages/verifier/src')) return 'verifier';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // ROOT CAUSE (re-investigated 2026-07-10, code review of the modo-guiado
    // F1 spike): this is NOT an `fs.allow` / path-normalization problem —
    // `fs.allow` already defaults to the workspace root and matches these
    // files fine. The actual blocker is Vite's *default* `server.fs.deny`
    // list, which includes the blanket glob `*.{crt,pem}` (a hard-coded
    // safety net against accidentally serving TLS certs/keys). `deny` is
    // checked unconditionally before `allow` and wins regardless of it, for
    // EVERY `.pem?raw` import in the app (packages/tsl-ec/src/roots/*.pem
    // too, not just intermediates/*.pem — confirmed by direct reproduction:
    // both 403 identically once `fs.strict` is left at its default `true`).
    // These PEMs are public CA trust-anchor certificates (not secrets), but
    // Vite's glob has no per-path carve-out: `fs.deny` negation patterns
    // (`!packages/.../*.pem`) do NOT work as an exclusion here — picomatch's
    // array matching treats each pattern as an independent OR term, not an
    // ignore-list, so a negated entry never overrides the blanket positive
    // match (verified empirically against the installed picomatch version).
    // Renaming ~28 committed .pem assets across two packages to dodge the
    // glob would be the cleanest long-term fix but is out of scope for this
    // review pass (separate PR).
    //
    // FIX CHOSEN (documented trade-off, option "b"): keep `fs.strict: true`
    // (and the full default `fs.deny`, INCLUDING the `*.pem` protection) for
    // `pnpm dev` and `vite build` — zero change to the default security
    // posture. Only relax it when `DEV_FS_ALLOW_PEM=1` is explicitly set,
    // which Playwright's `webServer.env` sets for e2e (see
    // playwright.config.ts) so the real-signing golden-path tests keep
    // passing. A developer running `pnpm dev` to manually exercise real
    // signing (not just UI wiring) must set the same var:
    //   DEV_FS_ALLOW_PEM=1 pnpm --filter @firma-ec/pwa dev
    // Same env-gate shape as `e2eMockTsa` above — deliberately not a
    // `VITE_`-prefixed var, since this is read only in this Node config
    // file and must never leak into client bundle env.
    fs: { strict: process.env.DEV_FS_ALLOW_PEM !== '1' },
  },
});
