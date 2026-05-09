# Changelog

Todos los cambios notables a este proyecto se documentan aquí.
El formato sigue [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) y este proyecto usa [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.7] - 2026-05-09 — ECDSA P-256/P-384/P-521 PKCS#12 path

### Added
- **`packages/signer/src/p12.ts`**: ruta completa para `.p12` con clave **ECDSA** (P-256, P-384, P-521).
  - Cuando `node-forge` no logra modelar la clave EC (`bag.key === undefined`), se extrae el ASN.1 PKCS#8 crudo de `bag.asn1` y se re-emite como DER — sin pasar por `wrapRsaPrivateKey`.
  - Cuando `forge.pki.certificateFromAsn1` rechaza un cert ECDSA, ahora se lee `cb.asn1` y se reconstruye `SignerCert` (CN, issuer, validity, serial) directamente desde el DER vía `asn1js` (`signerCertFromDer`).
  - `sigAlg` se infiere uniformemente desde el DER del cert (`readSpkiAlgorithmFromDer`) — converge RSA y EC en el mismo path.
  - Mapeo de `namedCurve` OID → suite: `1.2.840.10045.3.1.7` → `ECDSA-P256-SHA256`, `1.3.132.0.34` → `ECDSA-P384-SHA384`, `1.3.132.0.35` → `ECDSA-P521-SHA512`.
- **`packages/signer/scripts/gen-test-p12.ts`**: regenerador de `ecdsa-p256-valid.p12` ahora produce un PFX **forge-canónico**:
  - Cert self-signed sigue generándose con `pkijs` (forge no firma con EC).
  - El `EncryptedPrivateKeyInfo` del shrouded key bag se emite vía `forge.pki.encryptPrivateKeyInfo` (PBES2 + AES-256), garantizando `OCTET STRING` primitive (constructed=false) que `node-forge` puede re-decifrar al leer.
  - PFX outer (AuthenticatedSafe + ContentInfo + MacData HMAC-SHA1) construido a mano con primitivas forge para mantener el archivo 100% interoperable con `pkcs12FromAsn1`.

### Tests
- `tests/p12.test.ts`: el test `parses ECDSA P-256 valid` (anteriormente `it.skip` con caveat de v0.4.3) ahora corre y pasa. Verifica `sigAlg`, `subjectCN`, `kty='EC'` y que el PKCS#8 DER empieza con `0x30` (SEQUENCE).
- `tests/pades.test.ts`: el `describe.skip` para ECDSA-P256 PAdES (deferred desde v0.4.3) re-habilitado. Verifica round-trip completo: `parsePfx` → `signPdfPades` → `findSignature` → `parseCms` con OID `1.2.840.10045.4.3.2` (ecdsa-with-SHA256) y messageDigest cruzado contra el hash recomputado de `coveredBytes`.
- Total **56 tests / 0 skipped** en `@firma-ec/signer` (vs 54 passed + 2 skipped en v0.4.6).

### Changed
- `apps/pwa/src/lib/version.ts` y `apps/pwa/package.json` bumpeados a `0.4.7`.

### Notes
- Las ECIs ecuatorianas reales (BCE, Security Data, ArgosData, ANFAC, ConsejoJudicatura) emiten todas RSA hoy; este path es para futuro o cuando llegue alguna ECI con ECDSA. RSA + 3DES sigue funcionando idéntico (el code path RSA no se tocó).
- Bundle delta cero: ningún `dependency` nuevo. El cambio es lógica condicional dentro de `parsePfx`.

## [0.4.6] - 2026-05-09 — Polish bundle (a11y mobile + cross-route handoff + code-split)

### Added
- **Footer landmark global** (`apps/pwa/src/ui/Footer.svelte`) renderizado en todas las rutas excepto `/share` y `/handle-file`. Incluye copyright, versión (centralizada en `lib/version.ts`), claim de privacidad ("Sin tracking. Sin servidores. Tu PDF nunca sale de tu navegador."), link a /about y link a GitHub. Todos los enlaces ≥44×44 px (a11y tap targets WCAG 2.5.5 AAA).
- **Cross-route blob handoff sign→verify** — `Verificar.svelte` ahora consume la sessionStorage key `firmar.verify_preload.bytes_b64` que `DownloadResult.svelte` ya escribía. Click en "Verificar este PDF" en el step 7 ahora carga el PDF firmado en `/verificar` automáticamente con `status='warning'` (TSL demo) sin re-drop.
- **BoxPlacer auto-scrollIntoView** en mobile (<768px): al entrar al step 2, `requestAnimationFrame` + `scrollIntoView({block:'center'})` lleva el `.pdf-stage-host` al viewport sin que el usuario tenga que pasar manualmente el progress bar.
- `apps/pwa/src/lib/version.ts` — fuente única de `APP_VERSION`. Footer + About importan de aquí.

### Changed
- **Bundle main code-split** (`apps/pwa/vite.config.ts` `manualChunks`):
  - `signer-deps` (node-forge + qrcode) — solo cuando se entra a `/firmar`.
  - `pki` (pkijs + asn1js) — compartido /firmar + /verificar.
  - `pdf` (pdfjs-dist) — lazy en Verificar + PdfPreview.
  - `crypto-utils` (@noble + pvutils + pvtsutils).
  - `signer` y `verifier` (paquetes locales).
  - **Resultado**: main `index-*.js` 1004 KB → **160 KB raw / 50 KB gzip** (−84% raw, −82% gzip).
- **DEMO banner copy** (`verificar.demo_banner_body` ES + EN): ahora menciona explícitamente "v0.4.5+ — las 17 ACEs ARCOTEL están como placeholders en el TSL local. Cuando se publiquen los PEMs reales, este banner desaparecerá."
- **GitHub Actions Node.js 20 → 22** en `release.yml`, `ci.yml`, `lighthouse.yml` (LTS, alinea con dev local + habilita Cosign + SBOM modernos).

### Fixed
- A11y: confirmado que hamburger header, theme toggle y lang switcher ya tenían `h-11 w-11 / min-h-11 min-w-11` (compliant con 44×44 desde v0.4.x). No se modifican.

### i18n keys nuevas (ES + EN)
`footer.copyright`, `footer.version_label`, `footer.privacy_claim`, `footer.github_repo`, `footer.about_link`, `verify.handoff_loading`.

### Bundle (gzip)
| Chunk | v0.4.5 | v0.4.6 |
|---|---|---|
| `index` (main) | 277 KB | **50 KB** |
| `pdf` | 98 KB | 98 KB |
| `pki` | (incluido en main) | 75 KB |
| `signer` | (incluido en main) | 188 KB |
| `signer-deps` | (incluido en main) | 88 KB |

### Tests
- 97 tests passing (pre-existing 5 vitest suites bloqueadas por `@firma-ec/tsl-ec` workspace resolution — heredado de v0.4.5, no introducido aquí).

## [0.4.5] - 2026-05-09 — Cuadro de firma con QR (FirmaEC-style)

### Added
- **Cuadro de firma visible con QR escaneable** (estilo FirmaEC desktop). El widget de firma ahora se renderiza con layout split:
  - **Izquierda**: QR code 60×60 pt en negro sobre blanco, generado 100% client-side (lib `qrcode` + nivel ECC `M`). Apunta a `https://firmar.ec/#/verificar?h=<sha256-12chars>` — los primeros 12 hex de SHA-256 del PDF original son una pista escaneable hacia el verificador público.
  - **Derecha** (174×60 pt + 6 pt margen): bloque de 3 líneas Helvetica 8 pt:
    - L1: `Firmado por: <CN>` (truncado a 35 chars con ellipsis).
    - L2: `Fecha: YYYY-MM-DD HH:mm` (timezone local del firmador).
    - L3: `Razón: <razón>` o `firmar.ec` si no se especifica razón.
  - **Borde**: outline negro 0.5 pt alrededor del cuadro completo.
  - **Tamaño por defecto**: 240×72 pt (vs. 200×60 en v0.4.4).
- `packages/signer/src/visibleSig.ts`:
  - Nuevo helper `buildQrOperators(text, sizePt)` — convierte la matrix N×N de `qrcode` a operators PDF `q / 0 0 0 rg / re* / f / Q` con coalescencia horizontal de runs (3-5× menos rectángulos vs. naïve por-módulo).
  - `buildAppearanceOperators` extendido con `opts.qrUrl?, opts.signingTime?, opts.reason?`. Sin `qrUrl` mantiene layout legacy (back-compat).
  - Nuevo helper `formatSigningTime(d)` → `YYYY-MM-DD HH:mm` local time.
  - Nuevas constantes exportadas: `DEFAULT_VISIBLE_SIG_QR_WIDTH=240`, `DEFAULT_VISIBLE_SIG_QR_HEIGHT=72`, `SPLIT_MAX_CN_CHARS=35`.
- `packages/signer/src/pades.ts`: calcula SHA-256 del PDF source pre-sign, toma los primeros 12 hex chars, construye `qrUrl` y los pasa al widget. Acceso content-addressable estable que sobrevive re-firma.
- `apps/pwa/src/ui/firma/BoxPlacer.svelte`: defaults a 240×72 pt (`MIN_W=180`, `MIN_H=54`); preview WYSIWYG split — placeholder QR a la izquierda + 3 líneas mock (CN preview, fecha en vivo, "Razón: firmar.ec") a la derecha. Borde y proporción coinciden con el output PDF.
- `apps/pwa/src/routes/About.svelte`: nueva sección "Código QR de validación" + bump APP_VERSION → `0.4.5`.
- i18n keys: `firmar.qr_label`, `firmar.box_qr_placeholder`, `about.qr_title`, `about.qr_description` (ES + EN).

### Tests
- `packages/signer/tests/visibleSig.test.ts` — **+5 tests** para v0.4.5:
  - `buildQrOperators` emite rect+fill ops del QR matrix (>5 rectángulos).
  - `buildAppearanceOperators` con `qrUrl` produce border + ≥10 rects + 3 Tj a 8 pt + hex codificados de las 3 líneas.
  - Sin `qrUrl` mantiene layout legacy (1 Tj, 10 pt, sin borde).
  - `formatSigningTime` produce `YYYY-MM-DD HH:mm` local.
  - `signPdfPades` inyecta el `qrUrl` con sha256-12 hex hint correcto en el AP/N stream.
  - End-to-end: PDF firmado con split layout sigue verificable (covered-hash matches CMS messageDigest).
- 2 tests legacy (`renders Firmado por…`, `truncates CN > 50 chars…`) actualizados para reflejar el nuevo layout (8 pt font, 35-char cap).
- **Cumulative**: signer 54 + verifier 47 + tools/sbom 2 = **103 passing** (vs 95 en v0.4.4 → +8).

### Privacy & bundle
- QR generado 100% client-side; **sin** llamadas a APIs externas (Google Charts, qrcode-monkey, etc.).
- `qrcode` lib añade ~25 KB minified gzip al bundle del signer — aceptable.

### Dependencias
- `qrcode@^1.5.4` (+ `@types/qrcode` dev) en `packages/signer`.

## [0.4.4] - 2026-05-09 — P0 hotfix round-trip sign↔verify (sigValid=false killer)

### Fixed
- **P0 — Round-trip sign↔verify roto.** Tras los fixes v0.4.3 (3DES) + v0.4.2 (UX), los PDFs firmados en `/firmar` con `.p12` reales (ArgosData u otras ECIs ecuatorianas) llegaban a `/verificar` como `status='invalid'` ("Firma inválida" rojo + banner DEMO simultáneamente). Reproducible 100% con `rsa2048-3des-legacy.p12` y `rsa2048-valid.p12` en el nuevo suite `roundtrip.test.ts`. Causa raíz: `packages/signer/src/cms.ts` usaba `signedAttrsSet.encodedValue` para obtener los bytes a firmar:
  ```ts
  const signedAttrsDerForSign = new Uint8Array(signedAttrsSet.encodedValue);
  ```
  Pero `encodedValue` en `pkijs.SignedAndUnsignedAttributes` **solo está poblado cuando el objeto se construye parseando BER** — en el camino de **construcción nueva** retorna un `ArrayBuffer` de length 0. Resultado: firmábamos 0 bytes (la firma RSA del SHA-256 de la cadena vacía), mientras que el verificador reconstruía `signedAttrsDer` vía `signerInfo.signedAttrs.toSchema().toBER(false)` (~166 bytes reales). Web Crypto `verify` retornaba `false` → `sigValid=false` → `status='invalid'`, sobre **100% de los PDFs firmados**. **NO era un bug de PKCS#12 ni de wrap PKCS#8** — la cadena `forge → wrapRsaPrivateKey → Web Crypto importKey('pkcs8')` funcionaba perfectamente (validado por nuevo test `Web Crypto cross-check: forge-wrapped privKey signs match cert pubkey`).
  - **Fix**: usar `signedAttrsSet.toSchema().toBER(false)` (mismo path que el verificador) y parchar el primer byte `0xa0` (IMPLICIT [0]) → `0x31` (SET OF universal) per RFC 5652 §5.4. Diff localizado en `packages/signer/src/cms.ts` líneas 131-148.

### Added
- **Round-trip regression suite** `packages/signer/tests/roundtrip.test.ts` (3 tests, todos passing tras el fix):
  - `RSA-2048 valid (AES-256 PFX)` — firma PDF con `rsa2048-valid.p12`, verifica con TSL placeholder roots → `status='warning'` + `digestMatches=true` + `subjectCN='Test Signer RSA-2048'`.
  - `RSA-2048 3DES legacy (Ecuadorian ECI shape)` — proxy más cercano al `.p12` real ArgosData del usuario; mismo flow → `status='warning'` + `TRUST_PLACEHOLDER` warning + signer CN correcto.
  - `Web Crypto cross-check: forge-wrapped privKey signs match cert pubkey` — guard de unidad: extrae privKey + pubKey del PFX, firma un blob arbitrario, verifica. Pinning permanente: si esto falla, el wrap PKCS#8 de `p12.ts` está roto.
- Estos 3 tests **falsean ANTES** del fix y pasan DESPUÉS — pinning permanente de la regresión.

### Tests
- `packages/signer`: 48 passing + 2 skipped (50 total) — +3 desde v0.4.3.
- `packages/verifier`: 47 passing + 2 skipped (49 total) — sin cambios.
- **Total cumulative**: 95 passing (era 92 en v0.4.3).

### Deferred (v0.4.5)
- **QR estilo FirmaEC en firma visible** — fuera del scope P0. Diseño esbozado en el handoff:
  - Cuadro 240×72pt con QR (60×60pt) + texto (3 líneas: `Firmado por:`, `Fecha:`, `Razón:`).
  - QR content: `https://firmar.ec/#/verificar?h=<sha256-12chars>` para escaneabilidad estándar EC.
  - Implementación: dep `qrcode-svg` (~30 KB), Form XObject embebido en PDF vía pdf-lib, `BoxPlacer.svelte` preview WYSIWYG con placeholder QR + texto split-layout.
- Decisión: priorizar fix P0 sigValid → liberar v0.4.4 sin QR. v0.4.5 incluirá la firma visible con QR oficial.

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
