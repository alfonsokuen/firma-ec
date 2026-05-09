# UI Pro Max Critique — firmar.ec F1 v0.1.1

**Fecha:** 2026-05-08
**Reviewer:** Claude (UI Pro Max stack: Emil Kowalski + design-taste-frontend + high-end-visual-design + impeccable + critique)
**Routes auditadas:** `/`, `/seguridad`, `/faq`, `/glosario`, `/firma-electronica-ecuador`, `/comparativos/firmaec`
**Viewports:** 1280×720 desktop · 375×667 mobile · light + dark
**Console:** solo el CSP block del CF beacon (esperado).

---

## Tier S — "El sitio se siente caro" (lo que SÍ funciona)

- **Paleta OKLCH coherente.** `--brand-500` en lab azul-oscuro saturado contra `--ink-50` lab(97%) y `--ink-950` lab(0.43%) da un contraste editorial limpio en ambos modos. Cero default Tailwind blue. Decisión adulta.
- **`text-wrap: balance` aplicado a todos los headings.** Detalle invisible que evita huérfanas en H1/H2; Emil approves.
- **`prose` + `container-prose` (max-w 630px) en `/seguridad`, `/firma-electronica-ecuador`, `/glosario`.** Medida óptima de lectura ~70ch, jerarquía 48/30/24px sólida. Estos pages funcionan correcto out-of-the-box.
- **PWA crawl-clean.** Mozilla Observatory A+ y SSL Labs A+ visibles como badges en hero — confianza inmediata para una app de firma legal.
- **Section vertical rhythm consistente.** `padding: 80px 0` en cada `<section>` del home da respiración editorial. No bento apretado, no marketing sales-y.

---

## Tier A — Mejoras importantes (ANTES de soft launch)

### A1 — 🔴 BLOCKER · Headings de home renderizan a 16px / weight 400

**Qué pasa.** El hero H1 `"Firma y verifica PDFs con tu certificado ecuatoriano."` y TODOS los H2 de sections (`Tres pasos. Cero confianza requerida.`, etc.) renderizan con `font-size: 16px; font-weight: 400; line-height: 16.8px`. La regla `h1,h2,h3,h4,h5,h6 { font-size: inherit; font-weight: inherit }` del reset (Tailwind/UnoCSS preflight) gana porque las clases del componente solo declaran `max-w-4xl mb-6` — **no hay `text-display-2xl`, `text-5xl`, ni `font-bold` aplicado**.

**Por qué importa.** Es el visual hook principal del sitio. El usuario aterriza, ve un párrafo gris donde debería haber un statement. Geist Display 700 con tracking -0.02em **se está cargando** (verificado en `document.fonts`) — pero se renderiza como body text. *"Typography that whispers when it should speak feels like a missing layer, not a stylistic choice."*

**Fix.** En `apps/landing/src/components/sections/Hero.astro` y cada `sections/*.astro`, agregar al H1:
```html
<h1 class="text-4xl md:text-6xl font-bold tracking-tight leading-[1.05] max-w-4xl mb-6">
```
Para H2 de sections: `text-3xl md:text-4xl font-semibold tracking-tight`. **Verificar Hero.svelte si el H1 vive en el island**. Considerar mover a un primitivo `<Heading tier="display|h1|h2">` para forzar la decisión.

### A2 — Hero CTA invisible / no diferenciado del flow

**Qué.** No hay un `<a class="btn">` con `bg-brand-500` en el hero (el primer link con peso visible es el toggle "Oscuro" del header). El CTA primary se está renderizando como link plano.

**Por qué.** Si el sitio es la puerta a la PWA, el CTA "Abrir app" debe ser el elemento más pesado de la página. *"The button that takes you to the product should never feel optional."*

**Fix.** Hero debe tener:
```html
<a href="https://app.firmar.ec" class="inline-flex items-center gap-2 px-6 py-3.5 rounded-lg bg-brand-500 text-ink-50 font-medium tracking-tight shadow-[0_1px_0_0_rgba(255,255,255,0.1)_inset,0_8px_24px_-8px_var(--brand-500)] ring-1 ring-brand-600/30 hover:translate-y-[-1px] hover:shadow-[0_12px_32px_-8px_var(--brand-500)] transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]">
  Abrir app <ArrowRight class="w-4 h-4" />
</a>
```
Stack 2-layer shadow (inner highlight + outer glow brand-tinted) + transform on hover, no plain `hover:bg-brand-600`.

### A3 — `<details><summary>` FAQ sin chevron custom ni transición

**Qué.** En `/faq` los 10 `<details>` muestran el triángulo nativo del browser (`list-style-position: inside`), `padding: 0` en summary, y `transition: all` (anti-pattern: anima todo, expensive).

**Por qué.** El triángulo SO-native rompe el lenguaje editorial del resto del sitio. *"Native disclosure markers are loud in the wrong way — like Comic Sans showing up in a Helvetica deck."*

**Fix.** En `FAQList.astro`/`.svelte`:
```css
summary { list-style: none; cursor: pointer; padding: 1rem 0; display: flex; justify-content: space-between; align-items: center; }
summary::-webkit-details-marker { display: none; }
summary::after { content: ''; width: 12px; height: 12px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(45deg); transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1); }
details[open] > summary::after { transform: rotate(225deg); }
```
Quitar `transition: all` global — solo animar `transform`.

### A4 — Tabla `/comparativos/firmaec` sin bordes ni zebra

**Qué.** 16 filas, `border: 0px solid`, `th` y `td` sin background ni divider. Visualmente colapsa.

**Por qué.** Una tabla comparativa es **el** elemento que la gente escanea — necesita estructura visual. *"A comparison without rhythm is just a list pretending to be evidence."*

**Fix.** En `prose` del article wrapper o `comparativos/[slug].astro`:
```css
:where(table) { border-collapse: separate; border-spacing: 0; }
:where(th) { border-bottom: 1px solid var(--ink-200); padding: 0.75rem 1rem 0.75rem 0; font-weight: 600; text-align: left; color: var(--ink-700); font-size: 0.8125rem; text-transform: uppercase; letter-spacing: 0.04em; }
:where(td) { border-bottom: 1px solid var(--ink-100); padding: 0.875rem 1rem 0.875rem 0; }
:where(tr:hover td) { background: var(--ink-50); }
```
Header tipográfico (uppercase + tracking) + dividers sutiles + hover state. No zebra (anticuada para editorial).

### A5 — Header sticky sin diferenciación on-scroll

**Qué.** Header `position: sticky` 65px de altura pero **sin** cambio de fondo/blur al hacer scroll. Sobre fondo blanco se ve correcto; al scrollear sobre cards o secciones de fondo distinto, "se cae" sobre el contenido.

**Por qué.** El header sticky sin elevación contextual es uno de los tells más comunes de "AI default Tailwind". *"A sticky header that doesn't acknowledge it's floating is denying physics."*

**Fix.** Svelte/Astro con `IntersectionObserver` o `scroll` listener:
```html
<header class="sticky top-0 z-50 transition-[background-color,backdrop-filter,border-color] duration-200 bg-ink-50/0 border-b border-transparent" data-scrolled-style="bg-ink-50/80 backdrop-blur-md border-ink-200/60">
```
Con script: añade clases `bg-ink-50/80 backdrop-blur-md border-ink-200/60` cuando `scrollY > 8`. En dark: `bg-ink-950/80 border-ink-800/60`.

### A6 — 22 tap targets bajo 44px en mobile

**Qué.** Theme toggle 40×40, EN toggle 36×67, badges-link "Mozilla Observatory" 24×165, "SSL Labs A+" 24×93.

**Por qué.** WCAG 2.5.5 AAA pide 44×44; Apple HIG 44pt. Los badges son links a auditorías externas (señal de confianza) — y son demasiado pequeños para tocar.

**Fix.** Theme/EN toggles → `min-w-11 min-h-11`. Badges en hero → wrappear en `<a class="inline-flex items-center min-h-11 px-3">` con padding vertical aunque la imagen sea pequeña.

### A7 — Color del CTA / link brand sub-saturado en light

**Qué.** `--brand-500: lab(43.7136% -10.28 -55.31)` (≈ azul muy oscuro). Sobre `--ink-50` el contraste es WCAG-perfecto pero **flat** — no tiene "vibración".

**Por qué.** Eligieron oscuridad por contraste pero perdieron presencia. *"Saturation is to UI what dynamics are to music — without it, everything plays at the same volume."*

**Fix.** Considerar `--brand-500: oklch(58% 0.18 245)` (más luminoso, mismo hue) y un `--brand-600: oklch(48% 0.20 245)` para hover. Mantener AA contrast con el ink-50.

---

## Tier B — Refinamiento (F1.x)

- **B1 · Focus rings inconsistentes.** Body `outline: oklab(...) none 3px` (auto). Definir global `:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 2px; border-radius: inherit; }` y quitar `outline:none` donde aparezca. Cero dependencia de `:hover`-only para feedback.
- **B2 · `transition: all` en summary.** Anti-pattern (animar `display`, `height`, `content` no funciona y triggerea repaints). Sustituir por `transition: transform 200ms, background-color 150ms`.
- **B3 · Geist Display sólo H1; resto del sitio es system-ui.** Los `<p>` del hero usan `ui-sans-serif`. Inconsistencia: el body debe ser Geist (Sans, no Display) para coherencia tipográfica. Settear `--default-fontFamily` a Geist.
- **B4 · `letter-spacing: -0.32px` en H1 a 16px.** Cuando A1 esté arreglado y H1 sea 60px, tracking pasa a sentirse correcto (≈ -0.03em). Verificar después del fix.
- **B5 · `text-wrap: balance` no aplica a `<p>`.** En el subheadline del hero (debajo del H1) usar `text-wrap: pretty` o `balance` para evitar viuda final.
- **B6 · Dark mode body bg `oklab(0.08 ...)`** es casi negro puro — considerar `oklch(12% 0.01 245)` para tinte azul-cool sutil que matchea el brand. Diferencia invisible pero el sitio se "siente" distinto.
- **B7 · ThemeToggle persiste en `data-theme` pero la inicialización post-paint produce flash en modo dark si el usuario llega con `prefers-color-scheme: dark`.** Mover el script de tema a `<head>` con `is:inline` blocking.

---

## Tier C — Aspiracional (F2-F3)

- **C1 · HeroAnimation Svelte island con SVG path-drawing de una firma manuscrita** (stroke-dashoffset animation, easing custom, replay on intersection). 3 segundos, no loop. Convierte el hero en algo memorable sin ser distracting. Costo: ~2KB SVG + 30 líneas Svelte.
- **C2 · View Transitions API en routing Astro.** `<ClientRouter />` + `view-transition-name` en heading + card primario por route. La sensación de "single document" eleva la PWA percibida a app.
- **C3 · Comparison table como interactive matrix.** Click en columna → highlights diferencias clave. Exportable a PNG para que prensa/blogs lo embeban (canal de adquisición orgánico para un proyecto OSS).

---

## Resumen ejecutivo

**El sitio está al 70% de lo que el spec brainstormed prometía.** La paleta, el rhythm de spacing, el `prose` de los pages SEO, y el approach editorial están ✓. **El blocker A1 (headings 16px) es crítico** — un usuario que aterrice en la home AHORA piensa que la página falló al cargar estilos. Ese único bug hace que A2-A7 parezcan más graves de lo que son.

**Orden de ataque recomendado para F1.2:**
1. A1 (headings) — 30 min
2. A2 (hero CTA) — 1h
3. A3 (FAQ chevron) — 30 min
4. A5 (header on-scroll) — 1h
5. A6 (tap targets) — 30 min
6. A4 (table styling) — 30 min
7. A7 (brand saturation) — discusión + 15 min

**Total ≈ 4-5h** para llevar el sitio de "competente" a "se siente caro".

**Screenshots referenciados** (workspace root):
- `./firmar-desktop-home-light.png` · `./firmar-desktop-home-dark.png` · `./firmar-mobile-home-light.png`
- `./firmar-desktop-hero-light.png` (evidencia A1)
- `./firmar-desktop-seguridad-light.png` · `./firmar-desktop-seo-light.png` (prose ✓)
- `./firmar-desktop-faq-light.png` · `./firmar-mobile-faq-open.png` (evidencia A3)
- `./firmar-desktop-glosario-light.png` · `./firmar-desktop-comparativo-light.png` (evidencia A4)
