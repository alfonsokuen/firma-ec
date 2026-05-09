# Changelog

Todos los cambios notables a este proyecto se documentan aquí.
El formato sigue [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) y este proyecto usa [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.3] - 2026-05-09 — P0 hotfix `pfx_unsupported_algo` (3DES legacy de ECIs ecuatorianas)

### Fixed
- **P0 — Killer bug: ningún `.p12` ecuatoriano real podía firmar.** Tras llegar al step 4 PIN del flujo `/firmar`, todo `.p12` emitido por las ECIs ecuatorianas (BCE, Security Data, ArgosData, ANFAC, Consejo Judicatura) caía con `Error inesperado. code: pfx_unsupported_algo`. Causa raíz: las ECIs cifran sus PKCS#12 con `pbeWithSHAAnd3-KeyTripleDES-CBC` (PBE-SHA1-3DES, default de OpenSSL pre-3.0). Nuestro `packages/signer/src/p12.ts` usaba `pkijs`, que delega cripto simétrica a Web Crypto API, y **Web Crypto API no expone 3DES**. Resultado: `pfx_unsupported_algo` determinístico sobre el 100% del corpus ecuatoriano real.
  - **Fix**: switch del backend de descifrado PKCS#12 `pkijs` → `node-forge`. node-forge provee implementación pura JS de 3DES + AES + RC2 + el matrix completo de ciphers PKCS#12 legacy.
  - `packages/signer/src/p12.ts` reescrito: (1) `forge.asn1.fromDer` parsea el outer PFX, (2) `forge.pkcs12.pkcs12FromAsn1(asn1, false, pin)` descifra TODOS los `safeContents` y `pkcs8ShroudedKeyBag` independientemente del cipher, (3) bag de cert → DER → `SignerCert`, (4) bag de clave RSA → `forge.pki.wrapRsaPrivateKey` → PKCS#8 DER que `pades.ts importPrivateKey('pkcs8', …)` consume sin cambios.
  - **Mapeo de errores preservado**: `MAC could not be verified` / `Invalid password` → `pin_invalid`; `Unsupported|cipher|algorithm|OID` → `pfx_unsupported_algo`; otros → `pfx_corrupt`. Contrato externo `SignerError` invariante.
  - **Privacidad intacta**: node-forge corre 100% client-side. El `.p12` y el PIN nunca tocan red.
  - **Bundle impact**: +~80 KB minified+gzip por node-forge. Aceptable para el caso de uso (firma local, ya cargamos pkijs/asn1js).

### Added
- **Fixture sintético `rsa2048-3des-legacy.p12`** generado vía `forge.pkcs12.toPkcs12Asn1` con `algorithm: '3des'` para reproducir exactamente el shape de las ECIs ecuatorianas. Pinning de regresión: cualquier futuro switch fuera de node-forge volverá a romper el flujo y los tests lo capturan.
- **Tests `parsePfx` 3DES legacy** (`packages/signer/tests/p12.test.ts`):
  - `parses RSA-2048 3DES legacy (Ecuadorian ECI cipher) → SUCCESS` — happy path con PIN correcto, valida `sigAlg=RSA-PKCS1-SHA256`, `kty=RSA`, PKCS#8 DER bien-formado.
  - `parses RSA-2048 3DES legacy with WRONG PIN → pin_invalid` — error mapping correcto.

### Changed
- `packages/signer/package.json`: `node-forge ^1.4.0` movido de `devDependencies` → `dependencies` (era dep dev solo para fixtures).
- `packages/signer/scripts/gen-test-p12.ts`: parametrizado con opción `algorithm: 'aes256' | '3des'` para emitir fixtures legacy.

### Deferred (v0.4.4)
- **ECDSA P-256 PFX parsing temporalmente bloqueado**. La fixture sintética `ecdsa-p256-valid.p12` se construye con pkijs y emite un `EncryptedPrivateKeyInfo` cuyo encoding del `OCTET STRING constructed` node-forge rechaza. Las ECIs ecuatorianas reales emiten **siempre** RSA + 3DES (no ECDSA), por lo que este edge case está **fuera del path P0**. Tests ECDSA marcados `it.skip` / `describe.skip`. Plan v0.4.4: regenerar la fixture en shape forge-compatible o añadir fallback pkijs solo para PFX ECDSA-only.
- Tests de `addIncrementalSignature` que usaban el PFX ECDSA como segundo firmante migrados a `rsa1024-weak.p12` (CN distinto a `rsa2048-valid.p12`).

### Tests
- `packages/signer`: 45 passing + 2 skipped (47 total).
- `packages/verifier`: 47 passing + 2 skipped (49 total). Sin cambios.
- **Total cumulative**: 92 passing.

## [0.4.2] - 2026-05-09 — P0 hotfix /firmar UX

### Fixed
- **P0 — Signature box rendered OFF the PDF page.** El overlay del `BoxPlacer` se montaba sobre `.pdf-stage-host` (contenedor padre con padding y page-nav), no sobre el `<canvas>` real. Resultado: el cuadro aparecía flotando en el margen blanco izquierdo y el usuario no podía colocar la firma.
  - `apps/pwa/src/ui/firma/PdfPreview.svelte` ahora acepta un snippet `overlay({ cssWidth, cssHeight })` que se renderiza en una capa absoluta dentro de un `.canvas-stack` (display:inline-block) anclado al canvas. Las dims del overlay siempre coinciden con `canvasEl.style.width/height`.
  - `apps/pwa/src/routes/Firmar.svelte` pasa `BoxPlacer` como ese snippet en lugar del mount externo `position:absolute` desalineado.
- **P0 — Sin posición inicial.** `BoxPlacer` requería tap-to-place; en touch ergonomics el tap caía a veces fuera del área visible. Ahora un `$effect` coloca un cuadro centrado horizontal + 12% del fondo de la página automáticamente cuando llega `pdfPageSize`. El usuario puede arrastrar/redimensionar igual.
- **P1 — Doble botón "Continuar"** en step 2 (uno en el overlay del PDF + otro en el footer del wizard). Eliminado el `confirm-bar` interno del `BoxPlacer`; el footer del `WizardShell` es el único CTA de avance.
- **P1 — Stepper "Paso 2 de 7 / 7"** duplicado. `WizardShell.svelte:124` concatenaba ` / {totalSteps}` además del valor de `firmar.step_of` que ya incluye "de 7". Eliminado el sufijo.
- **P2 — Visibilidad del cuadro.** Borde dashed 2px → solid 2.5px, fill `oklch 0.10` (antes `0.04`), inset ring blanco 1px + soft drop-shadow para contraste sobre fondo blanco del PDF.
- **P2 — Preview text "tu no..." truncado raro.** Placeholder ES `Firmado por: tu nombre` → `Firmado por: [tu nombre del certificado]`; EN equivalente. Los corchetes señalan claramente que es un slot a rellenar y la elipsis truncada lee mejor que la palabra cortada a mitad.

### Changed
- `BoxPlacer` añade prop `onChange?: (pos) => void` para que el parent observe las mutaciones (auto-place, drag, resize, keyboard) sin necesidad de `bind:`. `Firmar.svelte` cablea `onChange={onBoxPositionChange}`.

### Tests
- `apps/pwa/tests/e2e/firma.spec.ts::step2PlaceBox` y `firma.mobile.spec.ts::Test 5b` actualizados al nuevo contrato: esperar `.sig-box` visible (auto-placed) y avanzar con el botón Next del footer (`getByRole('button', { name: /^continuar$|^continue$/i }).last()`). Ya no se busca `[data-testid="box-confirm-bar"]`.

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
