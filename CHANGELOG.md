# Changelog

Todos los cambios notables a este proyecto se documentan aquí.
El formato sigue [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) y este proyecto usa [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.1] - 2026-05-09

### Added
- **Custom Service Worker** (`apps/pwa/src/sw.ts`) — migración de VitePWA `generateSW` → `injectManifest` para poder interceptar `POST /share`. El SW:
  - Lee el `FormData` del Share Target, valida MIME (`application/pdf`), tamaño (≤50 MB), magic bytes `%PDF-`.
  - Stash del PDF en Cache Storage (`shared-pdf-v1`) bajo `/__shared-pdf__/<uuid>` con `X-Stored-At` y `X-Filename`.
  - 303 redirect a `/#/share?pdfId=<uuid>` (svelte-spa-router lo recoge).
  - Errores: redirect a `/?shareError=<no_file|not_pdf|too_big|invalid_pdf|internal>`. `App.svelte` reescribe esa query a `#/share?shareError=...` para que el SPA muestre el mensaje localizado.
  - Cleanup TTL 10 min — entradas viejas en `shared-pdf-v1` se borran en cada nueva escritura.
  - Mantiene reglas `NetworkOnly` de v0.4.0 para `/_assets/crypto-*`, `/trust/tsl-ec.json`, `/trust/tsl-ec.sha256` (parity de seguridad).
  - `precacheAndRoute(self.__WB_MANIFEST)` + `cleanupOutdatedCaches()` para que usuarios con shells viejas no queden colgados.
- `SharedFileHandler.svelte` ahora lee `pdfId` desde el hash, hace `caches.match('/__shared-pdf__/<id>')`, borra la entrada inmediatamente tras consumir (privacidad), corre `detectSignatures` y redirige a `/verificar` o `/firmar` (mismo pipeline v0.4.0).
- i18n nuevos: `share.error.{no_file,invalid_pdf,internal}` ES+EN.
- E2E spec `apps/pwa/tests/e2e/share-target.spec.ts` (skip si no hay `PREVIEW_BASE_URL`): verifica registro del SW, POST flow happy path, errores (no_file, not_pdf, invalid_pdf), TTL cleanup.

### Changed
- `apps/pwa/vite.config.ts` `VitePWA`: `strategies: 'injectManifest'`, `srcDir: 'src'`, `filename: 'sw.ts'`, `injectManifest.maximumFileSizeToCacheInBytes: 5_000_000`. Bloque `workbox: {...}` removido (lógica vive ahora en `src/sw.ts`).
- `apps/pwa/package.json` añade `workbox-precaching`, `workbox-routing`, `workbox-strategies` `^7.4.1` como deps directas (antes eran transitivas via `vite-plugin-pwa`).
- `App.svelte` detecta `?shareError=...` en `window.location.search` (post-redirect del SW) y lo reescribe a `#/share?shareError=...` para que SharedFileHandler muestre el error.

### Privacy
- El PDF compartido vive en Cache Storage local (per-origin, nunca sincronizado) y se borra al consumir + por TTL 10 min. Mantiene la promesa "nada sale del navegador".

## [0.4.0] - 2026-05-09

### Added
- **PWA share target & file handlers** (mobile UX).
  - Manifest declara `share_target` (POST + multipart, files accept `application/pdf`), `file_handlers` (`accept: { 'application/pdf': ['.pdf'] }`, `launch_type: single-client`), y `launch_handler: navigate-existing`. Ahora firmar.ec aparece en el menú "Compartir" / "Abrir con" del sistema (Android/Chromium-desktop) cuando la PWA está instalada.
  - Nuevas rutas `/share` y `/handle-file` en el SPA → componente `SharedFileHandler.svelte`. Lee el archivo desde `window.launchQueue` (Chromium 102+), corre `detectSignatures` y redirige a `/verificar` si hay firmas o a `/firmar` si no.
  - Pre-load de PDF en `Verificar.svelte` y `Firmar.svelte` vía sessionStorage (`__incomingPdf`), `consume()` borra la entrada para preservar privacidad.
  - Helper nuevo `apps/pwa/src/lib/sharedFile.ts` con round-trip Uint8Array ↔ base64 chunked (no stack overflow en >32KB).
- `InstallPrompt.svelte` — captura `BeforeInstallPromptEvent`, muestra card sutil bottom-fixed, persiste dismiss 30 días, oculta si la app está en `standalone` display-mode o en rutas `/share`/`/handle-file`.
- Onboarding visual en `Home.svelte`: sección "Recibe un PDF por WhatsApp o Gmail" con 3 pasos (icons lucide `share-2`, `pen-tool`, `download`), variante install hint para iOS Safari.
- Nueva sección en `About.svelte`: "share target capability" con copy "Compatible con WhatsApp, Gmail, Outlook y cualquier app de mensajería en Android e iOS".
- i18n ES+EN: `share.processing`, `share.waiting_hint`, `share.error.{not_pdf,too_big,read}`, `share.back_home`, `install.prompt.{title,body,cta,dismiss}`, `home.share_anchor.{title,subtitle,step1,step2,step3,install_hint}`, `about.share_target_capability`.
- Vitest unit tests (`apps/pwa/tests/sharedFile.test.ts`) — round-trip, chunk-boundary >32KB, payload corrupto, empty state. **4/4 PASS**.
- Documentación: spec F3 actualizada con sección "v0.4.0 Share Target & File Handlers (in-scope mobile UX)".

### Changed
- `Caddyfile.pwa`: `Permissions-Policy` cambia `web-share=()` → `web-share=(self)` (necesario para que la PWA actúe como Share Target y use `navigator.share()`).
- `vite.config.ts` `workbox.navigateFallbackDenylist` añade `/^\/share/` y `/^\/handle-file/` (rutas de OS-handoff nunca deben servirse desde precache).
- `App.svelte` ahora trackea `currentRoute` vía `onRouteLoaded` callback para que `InstallPrompt` se oculte en flujos de share.

### Caveats / Deferred to v0.4.1
- **POST `/share` con multipart files no funciona todavía** sin un Service Worker custom que intercepte la request, parsee el `FormData` y haga handoff al SPA via Cache API + sessionStorage. La declaración del manifest se mantiene para que el OS liste firmar.ec, pero un share de archivo entregará el POST a Caddy (que responde 405). El flujo `file_handlers` (Open with) **sí funciona** porque usa `launchQueue` (sin SW). v0.4.1 migrará Workbox de `generateSW` a `injectManifest` para añadir el endpoint POST sin romper la política `NetworkOnly` de los chunks crypto.
- iOS Safari no implementa `share_target` ni `file_handlers` PWA-side; usuarios iOS verán solo "Add to Home Screen" + onboarding manual.
- Live Playwright audit en `app.firmar.ec` queda pendiente del deploy v0.4.0 (image build + push + `docker service update`). Tests E2E locales no añadidos en este sprint — la simulación de share_target en headless requiere mock manual del endpoint.

## [0.3.4] - 2026-05-09

### Added
- TSL `@firma-ec/tsl-ec` expandida de 7 a **17 ACEs ARCOTEL** acreditadas (todas placeholder) — alpha-technologies, anfac, appfirmas, argosdata, bce, judicatura, corpnewbest, darkcam, datil, registro-civil, eclipsesoft, firmasegura, lazzate, letmi, primecorelat, securitydata, uanataca.
- Nuevo campo opcional `acceptedInGobEc` en `TrustRoot` interface — 8/17 ACEs marcadas como aceptadas por SRI en gob.ec (ANFAC, ArgosData, BCE, Consejo de la Judicatura, DatilMedia, EclipSoft, Security Data, UanaTaca).
- TSL JSON payload ahora expone `stats.totalArcotelAccredited`, `stats.acceptedInGobEc`, `stats.sources` (URLs ARCOTEL + SRI).
- Generador de placeholders self-signed `packages/tsl-ec/scripts/gen-placeholder-pems.mjs` (node-forge). Modo `--missing` por default, `--all` regenera todas.
- PWA copy: `Home.svelte` añade CTA SRI gob.ec + counter "17 ACEs", `About.svelte` añade sección "Compatibilidad legal" con links ARCOTEL/SRI, `DropP12` ECI hint actualizado a "17 ACEs soportadas".
- i18n keys (es+en): `home.sri_anchor`, `home.aces_count`, `home.sri_link`, `about.aces_title`, `about.aces_body`, `about.aces_link_arcotel`, `about.aces_link_sri`.
- Documentación regulatoria: spec F3 nueva sección §7.5 (SRI gob.ec + ARCOTEL TSL), plan F3 nota out-of-scope confirmando 17 ACEs, adendum UI Pro Max §0.5 (anchor de copy).

### Changed
- `TSL_VERSION` 1.0.0 → 1.1.0, `TSL_SEQUENCE` 1 → 2.

### Notes
- **Todos los 17 PEMs siguen siendo placeholder**. La heurística `allRootsPlaceholder` del verifier sigue válida y mantiene el estado "warning + DEMO banner" para verificaciones reales hasta publicación de PEMs auténticos.

## [Earlier]

### Added
- Bootstrap del monorepo (F0).
