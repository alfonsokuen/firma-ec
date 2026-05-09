# UI Pro Max Critique — app.firmar.ec F2 v0.2.2

**Fecha:** 2026-05-09
**Reviewer:** Claude (UI Pro Max stack: ui-ux-pro-max + emil-design-eng + design-taste-frontend + high-end-visual-design + impeccable + polish + audit + critique)
**Surface auditado:** PWA `app.firmar.ec` — rutas `/`, `/verificar`, `/paranoia`, `/about`, header global
**Viewports objetivo:** 390×844 mobile · 1280×800 desktop · light + dark
**Método:** code review exhaustivo de `apps/pwa/src/**` + `infra/docker/Caddyfile.pwa` + `uno.config.ts` + `tokens.css`. Live screenshots vía Playwright MCP no ejecutados (Chrome del usuario tiene la profile-dir bloqueada — bloqueo conocido del MCP isolated mode). Findings derivados de inspección estática del DOM Svelte + tokens CSS + CSP/Permissions-Policy.

---

## Tier S — Lo que YA se siente premium (preservar)

- **Tokens OKLCH coherentes** en `tokens.css` — paleta `--ink-*` (12-step) + `--brand-*` (8-step) en color space perceptual, con `--ok-/--warn-/--err-` semantic separados. No hay un solo `#hex` Tailwind blue. Decisión adulta.
- **Type ramp `clamp()` fluido** en `h1..h4` (`tokens.css` L39-42). Geist Display 700, line-height 1.05-1.2, letter-spacing -0.02em → -0.015em descendiente. Editorial.
- **Focus rings consistentes**: cada componente interactivo usa `focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950`. Cero defaults del navegador.
- **Verdict variants en `Result.svelte`**: tres estados (valid/warning/invalid/no_signature) con `iconBg + iconText + border + glow` cuádruple por status, glow `shadow-[0_0_0_4px_oklch(...)/_0.12]` brand-tinted. Esto es Emil-tier detalle.
- **Drop zone con `dropzone-active` style scoped** (no inline shadow override), oklch brand glow + `transition-all duration-200`. Mobile-first `min-h-44` (44px tap-target).
- **Detail panel `<details>` nativo**: progressive disclosure sin JS, `group-open:rotate-180` chevron, `dt/dd` semánticos con `text-ink-500 text-xs uppercase tracking-wide` keys. Buena arquitectura informacional.
- **CSP estricta** en `Caddyfile.pwa`: `require-trusted-types-for 'script'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`, COOP `same-origin`, COEP `require-corp`, CORP `same-origin`. Surface DOM-XSS minimizado.
- **Permissions-Policy como muralla**: ~35 features denegadas explícitamente. Solo `clipboard-write=(self)` activo (necesario para `/paranoia` copy buttons).
- **`X-Robots-Tag noindex`** intencional en PWA — separación correcta del landing institucional.

---

## Findings — Priorizados

### P0 — BLOCKERs (rompen función o credibilidad)

#### P0-1 · Theme toggle no traduce labels al inglés
**Qué.** `apps/pwa/src/ui/Header.svelte` L51 pasa hardcoded:
```svelte
<ThemeToggle labelToggle={t('theme.toggle')} labelLight="Claro" labelDark="Oscuro" />
```
"Claro"/"Oscuro" están literales en español. En modo EN el `<span class="sr-only">` lee "Oscuro" → screen-reader EN dice "Oscuro" (palabra extranjera, lectura confusa).

**Por qué importa.** Bilingüe es premise de la app (i18n.svelte.ts ya tiene `lang.switch`/`theme.toggle`/`nav.*` traducidos). Theme toggle escapado del sistema = bug de credibilidad — el primer usuario EN que cambie tema lo notará.

**Fix.** Añadir keys `theme.light`/`theme.dark` a `i18n.svelte.ts`, pasar `labelLight={t('theme.light')}` en Header.

---

#### P0-2 · Iconos PWA son placeholders 1×1 px (manifest broken en stores/Add-to-Home)
**Qué.** `apps/pwa/public/icon-192.png` y `icon-512.png` son archivos de 67 bytes — `file` reporta `PNG image data, 1 x 1, 8-bit/color RGBA`. Esto es un placeholder, no un icono.

**Por qué importa.**
- Lighthouse PWA install: `icon-192` y `icon-512 maskable` requeridos a tamaños correctos. **Falla "Installable" criterion**.
- Add-to-Home Screen Android/iOS muestra cuadrado vacío.
- Workbox cachea estos PNGs en SW (`globPatterns: ['**/*.{js,css,html,svg,woff2,png}']`) — basura permanente.

**Fix.** Generar `icon-192.png` (192×192 RGBA) y `icon-512.png` (512×512, también `purpose: maskable` requiere safe-area de 10% padding) a partir del concept de `favicon.svg` (rect azul `#0B1A3A` + letra "f" blanca).

---

#### P0-3 · Tap targets <44px en nav links desktop+mobile (a11y P0 / WCAG 2.5.5 fail)
**Qué.** `Header.svelte` L31-33: nav anchors usan `class="px-3 py-2 rounded-md..."` → `padding: 8px 12px` ⇒ height ~32px (no `min-h-11` ni `min-h-12`).
- En desktop ≥md hay 5 items. En mobile <md están ocultos (`hidden md:flex`) — pero **no hay menú hamburger replacement**: el usuario mobile no tiene navegación, solo logo.

**Por qué importa.** WCAG 2.5.5 (Target Size) AAA pide 44×44, AA acepta 24×24 con espaciado. `8px 12px` con texto 14px renderizado ≈ 32px alto. Falla AAA, pasa AA marginalmente. **Crítico**: en mobile NO HAY NAV (oculto sin replacement).

**Fix.**
- Añadir `min-h-11` a `<a>` y un menú hamburger mobile (`<details>` o disclosure menu) con todos los items.
- Padding `px-3 py-2.5` o `h-11 px-3 inline-flex items-center` para garantizar 44px exact.

---

#### P0-4 · Demo banner se pre-existe pero NO aparece en producción con PDFs ECI Ecuador reales
**Qué.** `Verificar.svelte` L31-35 deriva visibilidad del banner con:
```ts
return result.warnings.some((w) => /placeholder/i.test(w.message));
```
La detección es **frágil**: depende de que el verifier inserte la palabra "placeholder" textualmente en un warning. Si los PEMs reales ARCOTEL aún están en placeholder pero el verifier emite el warning con otro wording (ej. `"Trust roots are provisional"`, `"TSL unverified"`), el banner queda invisible y el usuario no ve el disclaimer crítico.

**Por qué importa.** El banner es contrato legal de la fase F2 — comunicar que la cadena de confianza no es vinculante todavía. Si falla silenciosamente, riesgo regulatorio.

**Fix.** Cambiar trigger a `result.warnings.some((w) => w.code === 'TSL_PROVISIONAL' || w.code === 'TRUST_PLACEHOLDER')` (codes estables del verifier). Si no existe code, exponer flag `result.trustChain.binding === 'provisional'` desde el verifier API. **Verificación en navegador con un ECI real es necesaria post-fix** (queda como TODO).

---

#### P0-5 · No hay skip-link (a11y P0)
**Qué.** `App.svelte` L21-26 renderiza `<Header /><main tabindex="-1">` sin un `<a class="skip-link" href="#main-content">Skip to content</a>` previo.

**Por qué importa.** WCAG 2.4.1 (Bypass Blocks) Level A. Usuario de teclado/screen-reader que abre `/verificar` por enésima vez tiene que tabular por header (logo + 5 nav items + lang toggle + theme toggle = 8 stops) antes de llegar al `<main>`.

**Fix.** Añadir skip-link absolutely-positioned (off-screen until focused) en App.svelte arriba del Header, target `#main-content` con `id` en `<main>`.

---

### P1 — Importantes (afectan calidad percibida)

#### P1-1 · Lang toggle expone "EN/ES" pero no anuncia idioma destino al SR
**Qué.** Header L42-50: button con `aria-label={t('lang.switch')}` ("Cambiar idioma") y span `EN` / `ES`. El SR lee "Cambiar idioma, EN, button" — ambiguo: ¿estoy EN ahora, o cambio A EN?
**Fix.** Patrón estándar: `aria-label="Switch to English"` / `aria-label="Cambiar a español"` (texto del DESTINO). El span visible mantiene `EN`/`ES` para usuarios sighted.

#### P1-2 · `bundle hash badge` en header parece debug-only — desplazar a `/about` o `/paranoia`
**Qué.** `BundleHashBadge` se renderiza permanentemente en el header (L41), entre lang toggle y theme toggle. Para 99% de usuarios es ruido visual y un identificador técnico.
**Fix.** Mostrar solo en `/paranoia` (ya existe ahí, L150) y `/about`. Quitar del Header global.

#### P1-3 · Errores del verifier exponen strings raw incomprensibles ("Odd-length hex", "Cannot read property…")
**Qué.** `Verificar.svelte` L139-144 renderiza:
```svelte
<span class="font-mono text-xs text-err-500">{error.code}</span>
<span class="ml-2">{error.message}</span>
```
Si el verifier lanza `WorkerVerificationError({ code: 'PARSE_ERROR', message: 'Odd-length hex string' })`, el usuario lee literalmente "PARSE_ERROR Odd-length hex string". Cero contexto humano.
**Fix.** Mapa `errorCode → i18n_key`: `PARSE_ERROR → 'error.parse_human'` ("El PDF parece corrupto o no contiene un campo de firma válido."), `INVALID_PDF → 'error.invalid_pdf'`, etc. Code técnico queda **debajo** en `<details>` "Detalles técnicos" para usuarios avanzados.

#### P1-4 · `Home.svelte` "Firmar" es `<button disabled>` con `cursor-not-allowed` y `opacity-60`
**Qué.** L26-39: toda la card está disabled — pero la badge "Próximamente (F3)" no es suficiente para comunicar el roadmap. Tap target en mobile cubre toda la card; usuario se frustra al tocarla.
**Fix.**
- Cambiar a `<a href="/firmar">` que lleva a una página `/firmar` con un layout "Coming soon — F3" + link a la spec en GitHub. Más informativo, no-frustrating, mantiene navegabilidad.
- O mantener disabled pero añadir `tabindex="-1"` y `aria-disabled="true"` (botón disabled HTML por sí solo lo cubre, pero asegurar SR no lo lee como "Sign a PDF, button" sin más).

#### P1-5 · `<details>` summaries no hacen height-collapse smooth — "snap" feel
**Qué.** `Detail.svelte` y `Paranoia.svelte` usan `<details>`/`<summary>` nativo. Al toggle hace snap instant — choca con `transition-transform group-open:rotate-180` del chevron que sí transiciona. Inconsistencia de motion.
**Fix.** Animar height con CSS `interpolate-size: allow-keywords` + `transition: height 200ms cubic-bezier(0.4,0,0.2,1)` (Chrome 129+). O usar Svelte `slide` transition wrapping el contenido cuando `open`. Detalle Emil-tier.

#### P1-6 · Hero `<h1>` en Verificar/Paranoia rinde `text-3xl md:text-4xl` pero tokens.css force `clamp(2rem, 1.2rem + 4vw, 4rem)` global a `h1`
**Qué.** Los componentes ponen `class="text-3xl md:text-4xl font-display font-bold tracking-tight"` PERO `tokens.css` L39 ya define `h1 { font-size: clamp(2rem, 1.2rem + 4vw, 4rem); ... font-weight: 700 }`. UnoCSS atomic classes ganan por specificity (al ser clases) — desperdicia el token global.
**Fix.** Confiar en el token global y solo añadir margin/spacing classes:
```svelte
<h1 class="mb-2">{t('verificar.title')}</h1>
```
O eliminar la regla global de `tokens.css` y mantener atomic. Decisión arquitectural — no ambas. Recomendación: **mantener atomic** (más explícito por route, evita global creep), eliminar `h1, h2…` rules de `tokens.css`.

#### P1-7 · `verificar.error_title` ("Error al verificar") suena alarmante para errores leves (pick error)
**Qué.** Misma string para "El archivo no es PDF" (validación trivial) y "El motor de verificación crashed" (engine error real). Tone mismatch — primer caso es esperable, segundo es bug.
**Fix.** Bifurcar: `error.title_pick` → "No pudimos abrir ese archivo" / "We couldn't open that file" para errores de validación, y reservar "Error al verificar" para engine errors.

#### P1-8 · Demo banner dismiss button `aria-label="✕"` es literalmente el carácter, no descripción
**Qué.** `Verificar.svelte` L118: `aria-label="✕"`. SR lee el carácter "x" o silencio. Mal a11y.
**Fix.** `aria-label={getLang() === 'es' ? 'Cerrar aviso' : 'Dismiss notice'}` + i18n key `verificar.dismiss_demo`.

---

### P2 — Polish (detalles invisible-but-felt)

- **P2-1.** `Drop.svelte` no tiene cursor-pointer feedback visible cuando hay un archivo siendo arrastrado pero el browser cancela `dragleave` antes del `drop`. Añadir timeout safety reset.
- **P2-2.** Drop hint `PDF · máximo 50 MB` está en `font-mono` — el carácter `·` separador queda raro en mono fonts. Usar `–` o `|` o reescribir como dos lines: `PDF` (mono) + `Máximo 50 MB` (sans).
- **P2-3.** `Paranoia.svelte` `<pre>` con `max-h-96 overflow-x-auto` no tiene scroll-shadow indicator — usuario no sabe que hay más contenido scroll-down. Añadir `mask-image: linear-gradient(to bottom, black calc(100% - 24px), transparent)` o un fade fadeout.
- **P2-4.** Reset button en Verificar/Paranoia tiene icon `i-lucide-rotate-ccw` (counter-clockwise = "undo") pero la acción es "verify another" (forward, new). Icon más apropiado: `i-lucide-file-plus-2` o `i-lucide-rotate-cw`.
- **P2-5.** Header logo `firmar.ec app` — el span `app` con `font-mono text-xs text-ink-400` se siente desconectado. Considera aplicar `bg-ink-100 dark:bg-ink-800 px-1.5 py-0.5 rounded text-[10px]` para que parezca un badge intencional.
- **P2-6.** Bundle hash badge usa `text-xs` — en pantallas retina queda casi ilegible. Si se mantiene en `/paranoia` solamente, subir a `text-sm` con `font-mono`.
- **P2-7.** Theme toggle `aria-pressed={theme === 'dark'}` está bien, pero los iconos `i-lucide-sun` / `i-lucide-moon` muestran el ESTADO ACTUAL, no la ACCIÓN. Patrón ambiguo. Mantener (es industria-standard) pero documentar.
- **P2-8.** `/about` página usa `getLang() === 'es' ? 'Versión' : 'Version'` inline — debería usar `t()` con keys i18n. Refactor menor.
- **P2-9.** No hay `<footer>` global con copyright + link OSS + version. `/about` cubre algo, pero un footer landmark `<footer role="contentinfo">` es esperable y SEO-positive (aunque PWA es noindex).
- **P2-10.** Color contrast `text-ink-500 text-xs uppercase tracking-wide` (dt elements en Detail) — `--ink-500: oklch(54% 0.05 250)` sobre `--ink-50` BG da contraste ~4.0:1. WCAG AA pide 4.5:1 para texto pequeño (<18px). **Fail técnico**. Subir a `--ink-600` (oklch 42%).
- **P2-11.** `Drop.svelte` usa `border-2 border-dashed` — emil-tier: dashed pattern por defecto del browser tiene gap inconsistente, override con `background-image: repeating-linear-gradient(...)` para gap perfectamente parejo.
- **P2-12.** Paranoia copy buttons `setTimeout(() => copiedKey = null, 1500)` — animación de "Copiado ✓" desaparece abrupt. Añadir fade-out 200ms antes del unmount.

---

### P3 — Aspiracionales (F3+)

- Motion library prebuilt — `cubic-bezier` curves consistentes (`--ease-out: cubic-bezier(0.32, 0.72, 0, 1)` Apple-tier) como CSS custom properties.
- Spring physics en drop zone scale durante drag (Framer Motion equivalente Svelte).
- View Transitions API entre rutas.
- Haptic feedback en mobile (`navigator.vibrate(10)` en drop success).

---

## Plan de implementación v0.2.3 (orden ejecución)

1. **P0-1** → i18n keys `theme.light/dark`, Header pass via `t()`. (~5 LOC)
2. **P0-2** → Generate `icon-192.png`/`icon-512.png` con Python+PIL desde concept SVG (192/512 px, brand-900 BG, "f" Geist Display blanca). (~asset)
3. **P0-3** → Header nav `min-h-11`, mobile hamburger menu disclosure. (~30 LOC)
4. **P0-4** → Verificar banner trigger por `warning.code` (TSL_PROVISIONAL) — además del regex placeholder como fallback temporal. (~3 LOC)
5. **P0-5** → Skip-link en App.svelte + `id="main-content"` en `<main>`. (~10 LOC)
6. **P1-1** → lang toggle aria-label dinámico ("Switch to English"). (~3 LOC)
7. **P1-2** → BundleHashBadge sólo en `/paranoia` y `/about`. Quitar de Header. (~5 LOC)
8. **P1-3** → error.code → i18n map (`engineErrorMessage()`). (~30 LOC)
9. **P1-7** → bifurcar error.title_pick vs error.title_engine. (~10 LOC)
10. **P1-8** → demo dismiss aria-label i18n. (~3 LOC)
11. **P1-4** → Home "Firmar" → `<a href="/firmar">` link informativo. (~10 LOC)
12. **P2-2, P2-4, P2-5, P2-8, P2-10** → micro-fixes (~30 LOC total).

**P1-5 (details slide)**, **P1-6 (heading global)**, **P2-9 (footer)** quedan TODO documentado para v0.2.4 — son refactor architectural (>50 LOC).

**Total estimado v0.2.3:** ~150 LOC en `apps/pwa/src/**`, 2 PNGs nuevos en `apps/pwa/public/`.

---

## Acceptance v0.2.3

- [ ] Lang switch entre ES/EN cambia TODOS los strings visible (incluyendo theme toggle SR-only labels)
- [ ] Iconos 192/512 son PNGs válidos correspondientes; Lighthouse PWA "Installable" pasa
- [ ] Tab key navigation: Skip-link aparece, todos los nav targets ≥44px
- [ ] Mobile <md: hamburger menu funcional, todas las rutas accesibles
- [ ] Demo banner aparece con PDF ECI real (verificación manual con archivo del usuario)
- [ ] Errores no muestran strings técnicos sin contexto humano
- [ ] axe-core 0 violations
- [ ] Lighthouse: perf 100 / a11y 100 / bp 95+ / seo 60+ (noindex limita)
- [ ] Visual regression: dark mode parity preservada
