# UI Pro Max — F3 Design Adendum (Sprint B, pre-impl)

**Fecha:** 2026-05-09
**Autor:** Claude (UI Pro Max stack: ui-ux-pro-max + emil-design-eng + design-taste-frontend + high-end-visual-design + impeccable + polish + critique + audit + clarify + typeset + layout + colorize + animate + delight)
**Surface:** ruta nueva `/firmar` en `app.firmar.ec` PWA — wizard de 7 pasos PAdES B-B
**Spec base:** `docs/superpowers/specs/2026-05-09-firma-ec-F3-firma-MVP-design.md`
**Plan base:** `docs/superpowers/plans/2026-05-09-firma-ec-F3-firma-MVP.md` (34 tasks, numeración FIJA)
**Status:** **DESIGN-LOCKED, IMPL-READY**. Cualquier desvío de los design decisions de este adendum durante Sprint C requiere actualizar el adendum y re-revisar.

---

## 0. Resumen ejecutivo

Sprint A (v0.2.3) cerró el lenguaje visual de la PWA: tokens OKLCH, Geist Display, focus rings consistentes, dropzone con glow brand, verdict variants Emil-tier, CSP estricta y Mozilla A+. Sprint B (este adendum) extiende ese lenguaje a `/firmar` **antes** de escribir una sola línea de impl, para evitar que la complejidad cripto del backend arrastre la UI a defaults baratos. Las decisiones aquí: **stepper full-screen mobile-first dominante**, **un solo CTA primario por pantalla**, **el cuadro visible se previsualiza con la tipografía exacta del PDF final** (Helvetica embed, no Geist), **el PIN es el momento más cuidado del flujo** (advertencia visible antes de teclear, no después), **el resultado es celebración + cross-link al verifier** (no una pantalla muerta de descarga). Tokens consolidados, copy ES/EN bloqueado, micro-interactions con timings exactos, 7 wireframes mobile + 7 desktop, 4 mini-specs de componentes complejos (BoxPlacer, PinInput, PdfPreview, DownloadResult), 38 hallazgos de critique con tags P0/P1/P2.

---

## 0.5 Anchor de copy: SRI gob.ec + 17 ACEs ARCOTEL (update 2026-05-09)

> Este adendum se escribió originalmente cuando la TSL tenía 7 placeholders. La TSL fue expandida a **17 ACEs ARCOTEL** (todas placeholder) en `@firma-ec/tsl-ec` v1.1.0. Cualquier copy que mencione número de ACEs debe decir **17**, no 7. Cualquier copy que justifique el caso de uso debe enlazar a `https://www.sri.gob.ec/tramites-en-gob-ec` (13 trámites que requieren firma electrónica) — es la conexión más directa con el usuario que va a firmar un PDF en su móvil para subirlo al SRI. Las 8 ACEs aceptadas por SRI son: ANFAC, ArgosData, BCE, Consejo de la Judicatura, DatilMedia, EclipSoft, Security Data, UanaTaca.

Implicación práctica para Sprint B/C: el step 3 (DropP12) menciona "BCE, Security Data, ANFAC, etc." en el `eci_hint`; añadir "(17 ACEs soportadas)" para que el usuario sepa que aplica a la suya aunque no esté en la lista de ejemplos.

---

## 1. Design tokens consolidados (sprint-B baseline)

> Reúso 100% del set Sprint A (`tokens.css`). Lo que sigue **NO** introduce tokens nuevos arbitrarios; consolida los existentes y declara los slots semánticos que F3 va a consumir.

### 1.1 Spacing scale (8px base, ya en `tokens.css`)

| Token | Valor | Uso típico F3 |
|---|---|---|
| `--s-1` | 4px | gap entre dot del stepper y línea conectora |
| `--s-2` | 8px | gap inline en CTAs (icono ↔ texto) |
| `--s-3` | 12px | gap vertical entre label y input |
| `--s-4` | 16px | padding interno de chips/pills (size selector) |
| `--s-5` | 24px | gap entre cards del summary (paso 6) |
| `--s-6` | 32px | padding-Y de cada step container |
| `--s-7` | 48px | margin entre hero del step y dropzone |
| `--s-8` | 64px | reservado celebración paso 7 (espacio respiratorio) |

Touch targets mínimos: **44×44 px** (WCAG 2.5.5 AA). El stepper top-bar usa botones `min-h-11 min-w-11`. El BoxPlacer corner handle es **22×22 px visible + 22 px hit-area extra invisible** = 44px efectivo.

### 1.2 Typography ladder

Stack: `Geist Display` (700/600) para headings, `Geist Sans` (400/500) para body, `Geist Mono` (400) para datos técnicos (CN, hashes, fingerprints, hex coords).

| Slot | Font / Weight / Size / Line-height / Tracking | Uso F3 |
|---|---|---|
| `display-xl` | Display 700 / `clamp(2rem, 1.2rem + 4vw, 4rem)` / 1.05 / -0.02em | NO usar en stepper (demasiado grande); reservado a hero del paso 7 success |
| `display-lg` | Display 700 / `clamp(1.5rem, 1rem + 2.5vw, 2.5rem)` / 1.1 / -0.015em | título de cada step (h1 efectivo del wizard) |
| `display-md` | Display 600 / `clamp(1.25rem, 1rem + 1.5vw, 1.75rem)` / 1.15 / -0.01em | sub-headings dentro de un step (ej. "Resumen" en paso 6) |
| `display-sm` | Display 600 / 18px / 24px / -0.005em | label del CTA primario y del verdict del PDF firmado (no es un h*) |
| `body-lg` | Sans 400 / 17px / 26px / 0 | párrafos descriptivos del step (sub-CTA copy) |
| `body-md` | Sans 400 / 15px / 22px / 0 | hints, descripciones cortas, status del worker |
| `body-sm` | Sans 400 / 13px / 18px / 0 | metadata secundaria, captions |
| `mono-md` | Mono 400 / 13px / 18px / 0 | CN, fingerprint, fechas técnicas, coords (x,y) |
| `mono-sm` | Mono 400 / 11px / 16px / 0.04em uppercase | tags de tipo de archivo ("PDF", "P12") |

**Crítico:** el cuadro visible del PDF **no** usa Geist — usa Helvetica embed (decisión spec §4.5). En el preview Svelte simulamos esa tipografía con `font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-weight: 400` para que el WYSIWYG sea fiel byte-a-byte al output.

### 1.3 Color tokens (semánticos para F3)

Extiende `tokens.css` con dos slots semánticos **derivados** (no nuevos hex):

| Token semántico F3 | Light | Dark | Uso |
|---|---|---|---|
| `--firmar-accent` | `var(--brand-500)` oklch(58% 0.21 245) | mismo | CTA primario y placeholder cuadro firmado |
| `--firmar-accent-glow` | `oklch(58% 0.21 245 / 0.15)` | `oklch(70% 0.19 245 / 0.20)` | shadow del CTA primario y del BoxPlacer activo |
| `--firmar-pdf-bg` | `oklch(99% 0 0)` | `oklch(96% 0.005 250)` | fondo del PDF preview (siempre claro, incluso en dark — los PDFs son blancos) |
| `--firmar-box-stroke` | `oklch(58% 0.21 245 / 0.6)` | mismo | dashed outline del BoxPlacer (no resting) |
| `--firmar-box-stroke-active` | `oklch(58% 0.21 245)` | mismo | outline durante drag/resize |
| `--firmar-pin-warn` | `var(--warn-500)` | mismo | banner amarillo en step 4 |
| `--firmar-success-glow` | `oklch(64% 0.16 145 / 0.18)` | `oklch(74% 0.14 145 / 0.22)` | celebración paso 7 (más amplio que verdict valid de F2) |

Dark mode: el preview del PDF mantiene fondo claro siempre. Aplicamos `.firmar-pdf-stage { color-scheme: light; background: var(--firmar-pdf-bg); }` para forzar el rendering del PDF como si fuera printed paper, regardless del theme global. Esto es Emil-tier — el contenido del PDF no debe cambiar de tono según el tema del wrapper.

### 1.4 Motion durations + easings

Cuatro buckets con curva única `cubic-bezier(0.32, 0.72, 0, 1)` (Apple-tier emergent):

| Token | Duración | Curva | Uso F3 |
|---|---|---|---|
| `--motion-tap` | 120ms | `cubic-bezier(0.32,0.72,0,1)` | feedback de tap en CTA, chip selection |
| `--motion-state` | 240ms | mismo | step transition (slide-x), modal show, BoxPlacer drop |
| `--motion-emerge` | 360ms | mismo | celebración paso 7 (icono check + glow) |
| `--motion-scrub` | 0ms (instant) | n/a | drag del BoxPlacer (NO transition durante drag, solo en drop) |

Reduced-motion: `@media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }` global aplica. Pero el feedback de error shake en PIN se reduce a un cambio de border-color (no de translate) bajo reduced-motion — preservamos la señal sin la sacudida.

### 1.5 Shadow tiers

Compuesta para sentirse en oklch (no `rgba`):

| Tier | Light | Dark | Uso |
|---|---|---|---|
| `shadow-flat` | none | none | resting de cards |
| `shadow-rest` | `0 1px 2px oklch(20% 0.04 250 / 0.05)` | `0 1px 2px oklch(0% 0 0 / 0.4)` | summary card paso 6 |
| `shadow-hover` | `0 4px 12px oklch(20% 0.04 250 / 0.08)` | `0 4px 12px oklch(0% 0 0 / 0.5)` | hover de chips, BoxPlacer hover |
| `shadow-focus` | `0 0 0 4px var(--firmar-accent-glow)` | mismo | focus ring del CTA primario y del BoxPlacer activo |
| `shadow-success` | `0 0 0 4px var(--firmar-success-glow)` | mismo | verdict success paso 7 |

**Regla anti-default:** prohibido `box-shadow: 0 4px 6px rgba(0,0,0,0.1)`. Si necesita un shadow que no está en la tabla, primero discutirlo (probablemente la solución es un border + glow, no shadow).

### 1.6 Radius scale

Reúso 100% Sprint A. Mapping a F3:

| Token | Valor | Uso F3 |
|---|---|---|
| `--r-sm` | 4px | tags `mono-sm` (PDF/P12) |
| `--r-md` | 8px | inputs, chips de size selector |
| `--r-lg` | 16px | dropzone, summary card, step container móvil |
| `--r-xl` | 24px | hero card del paso 7 success |
| `--r-full` | 9999px | progress dots del top stepper, chip activo |

Nada de `border-radius: 6px` o valores random. Si quiere otro, define un nuevo token primero.

### 1.7 Z-index scale (nuevo, no existía formal)

```css
--z-base: 0;       /* PDF canvas, content */
--z-overlay: 10;   /* BoxPlacer overlay sobre PDF */
--z-fixed-bar: 20; /* mobile bottom action bar */
--z-modal: 30;     /* dialogs (no usados en MVP) */
--z-toast: 40;     /* error inline shake */
```

---

## 2. Wireframes ASCII detallados

> Convención: un carácter ≈ 6px de ancho real. `[X]` es un CTA primario, `[ X ]` con padding visual = mejor presencia. `(  )` = chip/pill. `〔  〕` = input.

### 2.1 Step 1 — Cargar PDF (mobile 390 + desktop 1280)

**Mobile 390×844 (iPhone 13/14):**

```
┌────────────────────────────────────┐
│ ←  Firmar PDF              ES  ☾  │   ← top bar 56px, back btn 44×44
├────────────────────────────────────┤
│                                    │
│  ● ○ ○ ○ ○ ○ ○                    │   ← progress dots, h=8px
│  Paso 1 de 7                       │   ← body-sm ink-500
│                                    │
│  Sube tu PDF                       │   ← display-lg
│                                    │
│  Tu PDF nunca sale de tu           │   ← body-md ink-600, max 30ch
│  dispositivo.                      │
│                                    │
│  ┌──────────────────────────┐      │
│  │       ⬆                  │      │   ← icon container 56×56,
│  │                          │      │     bg-brand-500/10
│  │   Toca para elegir un    │      │   ← body-lg ink-700
│  │       PDF                │      │
│  │                          │      │
│  │   PDF · max 50 MB        │      │   ← mono-sm ink-500
│  └──────────────────────────┘      │   ← dashed border, r-lg, h≥240px
│                                    │
│                                    │
│                                    │
│                                    │
├────────────────────────────────────┤
│  ┌──────────────────────────┐      │
│  │   Continuar  →           │      │   ← bottom-fixed bar, h=72px
│  └──────────────────────────┘      │     CTA disabled hasta hay PDF
└────────────────────────────────────┘
```

**Desktop 1280×800:**

```
┌────────────────────────────────────────────────────────────────────────┐
│  firmar.ec app    [Verificar] [Firmar•]  …  …    EN  ☾                │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│        ●─○─○─○─○─○─○      Paso 1 de 7                                  │
│                                                                        │
│                Sube tu PDF                                             │
│                Tu PDF nunca sale de tu dispositivo.                    │
│                                                                        │
│        ┌─────────────────────────────────────────┐                     │
│        │              ⬆                          │                     │
│        │                                         │                     │
│        │     Arrastra un PDF aquí o              │                     │
│        │     haz clic para elegir                │                     │
│        │                                         │                     │
│        │     PDF · máximo 50 MB                  │                     │
│        └─────────────────────────────────────────┘                     │
│                                                                        │
│                                                                        │
│        [← Atrás]                       [Continuar →]                   │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

Constraints desktop: contenedor centrado `max-w-prose` (65ch ≈ 720px). El dropzone es width-100% del contenedor. CTAs alineados al final del flow content (NO bottom-fixed en desktop).

### 2.2 Step 2 — Posicionar cuadro (el step más complejo)

**Mobile 390×844:**

```
┌────────────────────────────────────┐
│ ←  Posicionar firma         ES  ☾ │
├────────────────────────────────────┤
│  ●─●─○─○─○─○─○   Paso 2 de 7      │
│                                    │
│  Coloca tu cuadro de firma         │   ← display-lg
│                                    │
│  ⓘ Este PDF tiene 1 firma previa.  │   ← banner info (si N>0)
│    La tuya se añadirá sin romper-  │     bg-brand-500/8 r-md, body-sm
│    la.                             │
│                                    │
│  ┌  Página  〔 1  ▾ 〕  de 5  ┐    │   ← page selector h=44, wide
│                                    │
│  ┌────────────────────────────┐    │
│  │                            │    │
│  │   PDF Preview              │    │
│  │   ┌─────────────────┐      │    │   ← BoxPlacer.
│  │   │ Firmado por:    │      │    │     Tap-to-place initial.
│  │   │ TEST USER       │      │    │     Long-press = drag.
│  │   └─────────────────┘      │    │     Corners with 22px handles.
│  │   ◢                        │    │
│  │                            │    │
│  │                            │    │
│  └────────────────────────────┘    │   ← bg --firmar-pdf-bg, r-lg,
│  Toca para colocar · arrastra      │     min-h≈480px, color-scheme:light
│  para mover                        │   ← hint body-sm ink-500
│                                    │
│  Tamaño                            │   ← display-sm ink-700
│  ( compact ) (•standard•) ( large )│   ← chip group, h=44 each
│                                    │
├────────────────────────────────────┤
│  [← Atrás]      [Continuar →]      │   ← bottom-fixed dual CTA
└────────────────────────────────────┘
```

**Desktop 1280×800 (split-pane):**

```
┌────────────────────────────────────────────────────────────────────────┐
│  ●─●─○─○─○─○─○      Paso 2 de 7 · Posicionar firma                     │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌─────────────────────────────────────┐  ┌──────────────────────┐     │
│  │   Página  〔 1 ▾ 〕  de 5            │  │  Tamaño              │     │
│  │   ◀  ▶  (wheel también)             │  │ ( compact )          │     │
│  │                                      │  │ (•standard•)         │     │
│  │   ┌──────────────────────────┐       │  │ ( large )            │     │
│  │   │                          │       │  ├──────────────────────┤     │
│  │   │  PDF preview             │       │  │  Coords (pt PDF)     │     │
│  │   │   ┌──────────────┐       │       │  │  x: 50.0  y: 720.0   │     │
│  │   │   │ Firmado por: │       │       │  │  w: 200.0  h: 30.0   │     │
│  │   │   │ TEST USER    │       │       │  │  página 1            │     │
│  │   │   └──────────────┘       │       │  ├──────────────────────┤     │
│  │   │                          │       │  │  ⓘ Si este PDF ya    │     │
│  │   │                          │       │  │  está firmado, tu    │     │
│  │   └──────────────────────────┘       │  │  firma se añadirá    │     │
│  │   Drag para mover · esquina resize   │  │  sin romper las      │     │
│  └─────────────────────────────────────┘  │  anteriores.         │     │
│                                            └──────────────────────┘     │
│                                                                        │
│  [← Atrás]                                          [Continuar →]      │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Step 3 — Cargar .p12

**Mobile:**

```
┌────────────────────────────────────┐
│ ←  Tu certificado          ES  ☾   │
├────────────────────────────────────┤
│  ●─●─●─○─○─○─○  Paso 3 de 7        │
│                                    │
│  🔐 Tu certificado .p12            │   ← display-lg
│                                    │
│  ┌──────────────────────────┐      │
│  │       ⬆ p12              │      │
│  │                          │      │
│  │   Toca para elegir tu    │      │
│  │   certificado .p12 / .pfx│      │
│  │                          │      │
│  │   P12 · máximo 1 MB      │      │
│  └──────────────────────────┘      │
│                                    │
│  ⓘ Es el archivo que recibiste    │   ← banner info
│    de tu ECI (BCE, Security Data,  │
│    ANFAC, etc.).                   │
│                                    │
│  Tu llave privada nunca sale       │   ← privacy claim,
│  de tu navegador. Se descarta      │     body-sm ink-600
│  apenas terminamos de firmar.      │
├────────────────────────────────────┤
│  [← Atrás]      [Continuar →]      │
└────────────────────────────────────┘
```

### 2.4 Step 4 — PIN (el más cuidado)

**Mobile:**

```
┌────────────────────────────────────┐
│ ←  Contraseña             ES  ☾    │
├────────────────────────────────────┤
│  ●─●─●─●─○─○─○  Paso 4 de 7        │
│                                    │
│  🔑 Contraseña del certificado     │   ← display-lg
│                                    │
│  ┌──────────────────────────┐      │
│  │ ⚠  Tu contraseña se borra │      │   ← banner warn (visible ANTES
│  │   inmediatamente tras im- │      │     de teclear, no después)
│  │   portar la llave.       │      │     bg-warn-500/10, r-md
│  │   No se guarda. No se en-│      │
│  │   vía a ningún servidor. │      │
│  └──────────────────────────┘      │
│                                    │
│  Contraseña                        │   ← label body-md
│  〔 • • • • • • • • • • • 👁 〕   │   ← input h=56, eye toggle btn
│                                    │   ← font-mono dentro del input
│                                    │
│  [Verificar contraseña]            │   ← CTA único, h=56,
│                                    │     primary brand
│                                    │
│  Si olvidaste la contraseña,       │   ← body-sm ink-500
│  contacta a tu ECI. firmar.ec      │     (acepta que no podemos
│  no puede ayudarte a recuperarla.  │      ayudar — honesty Emil-tier)
└────────────────────────────────────┘
```

Nota crítica: **el botón se llama "Verificar contraseña", NO "Continuar"**, porque acá la acción real es decrypt PFX + import key (la única operación que puede fallar con `bad_pin`). Si el botón dice "Continuar" + el PIN está mal, el back-button al volver se siente como reset; con "Verificar contraseña" la mental model es ✓ acción discreta.

### 2.5 Step 5 — Razón / Lugar (opcionales)

```
┌────────────────────────────────────┐
│ ←  Detalles opcionales     ES  ☾   │
├────────────────────────────────────┤
│  ●─●─●─●─●─○─○  Paso 5 de 7        │
│                                    │
│  Detalles opcionales               │   ← display-lg
│                                    │
│  Estos datos van como metadatos    │   ← body-md ink-600
│  firmados (no aparecen en el       │
│  cuadro visible).                  │
│                                    │
│  Razón                             │   ← label
│  〔 ej. Aprobado                  〕│   ← input h=48
│                          0/200     │   ← counter body-sm ink-500
│                                    │
│  Lugar                             │
│  〔 ej. Quito, Ecuador            〕│
│                          0/200     │
│                                    │
├────────────────────────────────────┤
│  [Saltar →]            [Continuar→]│   ← Saltar dominante si vacío,
│                                    │     Continuar dominante si lleno
└────────────────────────────────────┘
```

Detalle Emil-tier: el CTA "Saltar" se vuelve secundario (border, no fill) cuando el usuario empieza a tipear cualquier campo. Cambio de prominencia visual = la UI guía sin gritar.

### 2.6 Step 6 — Confirmar y firmar

```
┌────────────────────────────────────┐
│ ←  Confirmar              ES  ☾    │
├────────────────────────────────────┤
│  ●─●─●─●─●─●─○  Paso 6 de 7        │
│                                    │
│  ✓ Listo para firmar               │   ← display-lg
│                                    │
│  Resumen                           │   ← display-md
│  ┌──────────────────────────┐      │
│  │ 📄 Documento              │      │
│  │ facturas-mayo.pdf · 245KB│      │   ← mono-md
│  ├──────────────────────────┤      │
│  │ ✍ Firmante                │      │
│  │ JUAN PEREZ GOMEZ          │      │   ← mono-md, truncate
│  │ Emitido por BCE           │      │   ← body-sm ink-600
│  │ Vigente hasta 2027-08-15 ✓│      │
│  ├──────────────────────────┤      │
│  │ 📍 Cuadro                 │      │
│  │ pág 1 · standard · 50,720│      │   ← mono-md
│  ├──────────────────────────┤      │
│  │ 🏷 Detalles               │      │
│  │ Razón: (sin razón)        │      │   ← italic ink-500 si vacío
│  │ Lugar: Quito, Ecuador     │      │
│  ├──────────────────────────┤      │
│  │ ⚠ Firmas previas: 1       │      │   ← warn tone si hay previas
│  │   Tu firma se añadirá.    │      │     (informativo, no bloqueante)
│  └──────────────────────────┘      │
│                                    │
├────────────────────────────────────┤
│  [← Atrás]    [✍ Firmar PDF]       │   ← CTA primario brand h=56
└────────────────────────────────────┘
```

Durante la firma (mientras corre el worker), TODA la pantalla se reemplaza por:

```
┌────────────────────────────────────┐
│  ●─●─●─●─●─●─●  Firmando…          │
├────────────────────────────────────┤
│                                    │
│              ◐ (spin)              │   ← reuso Progress.svelte F2
│                                    │
│        Construyendo firma          │   ← stage label
│   ●━●━●━○━○━○━○━○                  │   ← 8 dots para
│                                    │     stages F3
│                                    │
│        parse_pfx · import_key ·    │   ← mono-sm ink-500
│        load_pdf · build_cms ·      │
│        sign · assemble_pades       │
│                                    │
│  Esto toma ~2-5 segundos.          │   ← body-md
│  No cierres la pestaña.            │
│                                    │
└────────────────────────────────────┘
```

### 2.7 Step 7 — Resultado (celebración + cross-link)

```
┌────────────────────────────────────┐
│                            ES  ☾   │   ← sin back btn, sin progress
├────────────────────────────────────┤
│                                    │
│              ╭───╮                 │
│              │ ✓ │                 │   ← icon 88×88, bg-ok-500/15
│              ╰───╯                 │     animated emerge 360ms
│                                    │
│      PDF firmado correctamente     │   ← display-xl ok-500
│                                    │
│  facturas-mayo-firmado.pdf         │   ← mono-md
│  248 KB · 1 firma                  │   ← body-sm ink-500
│                                    │
│  ┌──────────────────────────┐      │
│  │  ⬇  Descargar             │      │   ← CTA primario brand h=56
│  └──────────────────────────┘      │
│                                    │
│  ┌────────────┐  ┌────────────┐    │
│  │ 📤 Compartir│  │🔍 Verificar│    │   ← CTAs secundarios h=48
│  └────────────┘  └────────────┘    │     compartir solo si feature-
│                                    │     detect navigator.share
│                                    │
│  ─────────────────────────────     │
│  Tu llave y contraseña ya          │   ← privacy reassurance
│  fueron descartadas.               │     body-sm ink-600
│                                    │
│  [Firmar otro PDF]                 │   ← link discreto, ink-500
└────────────────────────────────────┘
```

El "Verificar" del paso 7 navega a `/verificar` con los signedBytes pre-cargados (state pasaje vía svelte-spa-router store, NO query string — mantiene LOPDP-stateless). Si el feature falla por route reset, fallback es scroll-to dropzone con un toast "Suelta el PDF firmado para verificar".

---

## 3. Copy ES/EN definitivo (bloqueado)

> Todas las keys nuevas para `i18n.svelte.ts` (Task 15 del plan). **Affects Task 15:** la lista del task era mínima; este adendum la expande y la blocked-down.

### 3.1 Top-level wizard

| Key | ES | EN |
|---|---|---|
| `firmar.title` | Firmar PDF | Sign PDF |
| `firmar.back` | Atrás | Back |
| `firmar.next` | Continuar | Continue |
| `firmar.skip` | Saltar | Skip |
| `firmar.cancel` | Cancelar | Cancel |
| `firmar.step_of` | Paso {n} de 7 | Step {n} of 7 |

### 3.2 Step 1 — Drop PDF

| Key | ES | EN |
|---|---|---|
| `firmar.step1.title` | Sube tu PDF | Upload your PDF |
| `firmar.step1.subtitle` | Tu PDF nunca sale de tu dispositivo. | Your PDF never leaves your device. |
| `firmar.step1.dropzone_mobile` | Toca para elegir un PDF | Tap to pick a PDF |
| `firmar.step1.dropzone_desktop` | Arrastra un PDF aquí o haz clic para elegir | Drop a PDF here or click to pick |
| `firmar.step1.hint` | PDF · máximo 50 MB | PDF · 50 MB max |
| `firmar.step1.preflight_signatures` | Detectamos {n} firma(s) previa(s) en este PDF. | We detected {n} prior signature(s) in this PDF. |

### 3.3 Step 2 — Box placer

| Key | ES | EN |
|---|---|---|
| `firmar.step2.title` | Coloca tu cuadro de firma | Place your signature box |
| `firmar.step2.subtitle_mobile` | Toca para colocar · arrastra para mover | Tap to place · drag to move |
| `firmar.step2.subtitle_desktop` | Arrastra para mover · esquina para redimensionar | Drag to move · corner to resize |
| `firmar.step2.page_label` | Página | Page |
| `firmar.step2.page_of` | de {total} | of {total} |
| `firmar.step2.size_label` | Tamaño | Size |
| `firmar.step2.size.compact` | Compacto | Compact |
| `firmar.step2.size.standard` | Estándar | Standard |
| `firmar.step2.size.large` | Grande | Large |
| `firmar.step2.coords_label` | Coordenadas (puntos PDF) | Coordinates (PDF points) |
| `firmar.step2.previous_banner` | Este PDF tiene {n} firma(s) previa(s). La tuya se añadirá sin romperlas. | This PDF has {n} prior signature(s). Yours will be added without breaking them. |
| `firmar.step2.preview_cn` | Firmado por: {cn} | Signed by: {cn} |
| `firmar.step2.preview_placeholder` | Firmado por: tu nombre | Signed by: your name |

### 3.4 Step 3 — .p12

| Key | ES | EN |
|---|---|---|
| `firmar.step3.title` | Tu certificado .p12 | Your .p12 certificate |
| `firmar.step3.dropzone` | Toca para elegir tu certificado .p12 / .pfx | Tap to pick your .p12 / .pfx certificate |
| `firmar.step3.dropzone_desktop` | Arrastra tu certificado aquí o haz clic para elegir | Drop your certificate here or click to pick |
| `firmar.step3.hint` | P12 · máximo 1 MB | P12 · 1 MB max |
| `firmar.step3.eci_hint` | Es el archivo que recibiste de tu ECI (BCE, Security Data, ANFAC, etc.). | It's the file you received from your CA (BCE, Security Data, ANFAC, etc.). |
| `firmar.step3.privacy` | Tu llave privada nunca sale de tu navegador. Se descarta apenas terminamos de firmar. | Your private key never leaves your browser. We discard it as soon as signing finishes. |

### 3.5 Step 4 — PIN

| Key | ES | EN |
|---|---|---|
| `firmar.step4.title` | Contraseña del certificado | Certificate password |
| `firmar.step4.warn` | Tu contraseña se borra inmediatamente tras importar la llave. No se guarda. No se envía a ningún servidor. | Your password is wiped immediately after we import the key. Not stored. Not sent anywhere. |
| `firmar.step4.label` | Contraseña | Password |
| `firmar.step4.show` | Mostrar contraseña | Show password |
| `firmar.step4.hide` | Ocultar contraseña | Hide password |
| `firmar.step4.cta` | Verificar contraseña | Verify password |
| `firmar.step4.lost` | Si olvidaste la contraseña, contacta a tu ECI. firmar.ec no puede ayudarte a recuperarla. | If you forgot your password, contact your CA. firmar.ec can't help recover it. |

### 3.6 Step 5 — Optional attrs

| Key | ES | EN |
|---|---|---|
| `firmar.step5.title` | Detalles opcionales | Optional details |
| `firmar.step5.subtitle` | Estos datos van como metadatos firmados. No aparecen en el cuadro visible. | These go as signed metadata. They don't appear in the visible box. |
| `firmar.step5.reason_label` | Razón | Reason |
| `firmar.step5.reason_placeholder` | ej. Aprobado | e.g. Approved |
| `firmar.step5.location_label` | Lugar | Location |
| `firmar.step5.location_placeholder` | ej. Quito, Ecuador | e.g. Quito, Ecuador |
| `firmar.step5.counter` | {n}/200 | {n}/200 |

### 3.7 Step 6 — Confirm

| Key | ES | EN |
|---|---|---|
| `firmar.step6.title` | Listo para firmar | Ready to sign |
| `firmar.step6.summary` | Resumen | Summary |
| `firmar.step6.doc_section` | Documento | Document |
| `firmar.step6.signer_section` | Firmante | Signer |
| `firmar.step6.signer_issued_by` | Emitido por {issuer} | Issued by {issuer} |
| `firmar.step6.signer_valid_until` | Vigente hasta {date} | Valid until {date} |
| `firmar.step6.box_section` | Cuadro de firma | Signature box |
| `firmar.step6.box_value` | pág {p} · {size} · ({x},{y}) | page {p} · {size} · ({x},{y}) |
| `firmar.step6.attrs_section` | Detalles | Details |
| `firmar.step6.attrs_no_reason` | Sin razón | No reason |
| `firmar.step6.attrs_no_location` | Sin lugar | No location |
| `firmar.step6.previous_section` | Firmas previas | Prior signatures |
| `firmar.step6.previous_value` | {n} · tu firma se añadirá | {n} · yours will be added |
| `firmar.step6.cta` | Firmar PDF | Sign PDF |
| `firmar.step6.signing` | Firmando… | Signing… |
| `firmar.step6.signing_hint` | Esto toma ~2-5 segundos. No cierres la pestaña. | This takes ~2-5 seconds. Don't close the tab. |
| `firmar.step6.stage.parse_pfx` | Leyendo certificado | Reading certificate |
| `firmar.step6.stage.import_key` | Importando llave | Importing key |
| `firmar.step6.stage.load_pdf` | Cargando PDF | Loading PDF |
| `firmar.step6.stage.build_cms` | Construyendo firma CMS | Building CMS signature |
| `firmar.step6.stage.sign` | Firmando criptográficamente | Signing cryptographically |
| `firmar.step6.stage.assemble_pades` | Ensamblando PAdES | Assembling PAdES |
| `firmar.step6.stage.incremental` | Aplicando actualización incremental | Applying incremental update |

### 3.8 Step 7 — Result

| Key | ES | EN |
|---|---|---|
| `firmar.step7.success_title` | PDF firmado correctamente | PDF signed successfully |
| `firmar.step7.filename_suffix` | -firmado | -signed |
| `firmar.step7.size_count` | {kb} KB · {n} firma(s) | {kb} KB · {n} signature(s) |
| `firmar.step7.download` | Descargar | Download |
| `firmar.step7.share` | Compartir | Share |
| `firmar.step7.verify_now` | Verificar | Verify |
| `firmar.step7.privacy_done` | Tu llave y contraseña ya fueron descartadas. | Your key and password have been discarded. |
| `firmar.step7.again` | Firmar otro PDF | Sign another PDF |

### 3.9 Errors (mapeo `SignErrorCode → human copy`)

**Affects Task 15:** la lista del task era genérica; este es el copy bloqueado.

| Code | Title ES | Body ES | Title EN | Body EN |
|---|---|---|---|---|
| `bad_pdf` | PDF inválido | Este archivo no parece un PDF válido. | Invalid PDF | This file doesn't look like a valid PDF. |
| `pdf_too_large` | PDF demasiado grande | El PDF supera 50 MB. Reduce su tamaño antes de firmar. | PDF too large | The PDF is over 50 MB. Reduce its size before signing. |
| `pdf_encrypted` | PDF protegido | No podemos firmar un PDF protegido con contraseña. Quítale la protección primero. | Encrypted PDF | We can't sign a password-protected PDF. Remove the protection first. |
| `bad_p12` | Archivo no es .p12 | Este archivo no parece un certificado .p12 / .pfx válido. | Not a .p12 | This file doesn't look like a valid .p12 / .pfx certificate. |
| `bad_pin` | Contraseña incorrecta | La contraseña no coincide. Vuelve a intentarlo. | Wrong password | The password doesn't match. Try again. |
| `no_signing_cert` | Certificado sin firma | Este .p12 no contiene un certificado con uso "firma digital". | No signing cert | This .p12 has no certificate with "digital signature" usage. |
| `weak_alg` | Algoritmo deprecado | Tu certificado usa un algoritmo deprecado (SHA-1 o RSA<2048) y no es seguro firmar con él. Renuévalo con tu ECI. | Deprecated algorithm | Your certificate uses a deprecated algorithm (SHA-1 or RSA<2048) and is not safe to sign with. Renew it with your CA. |
| `cert_expired` | Certificado expirado | Tu certificado venció el {date}. Renuévalo con tu ECI antes de firmar. | Expired certificate | Your certificate expired on {date}. Renew it with your CA before signing. |
| `cert_not_yet_valid` | Certificado no vigente | Tu certificado no es válido todavía (entra en vigor el {date}). | Certificate not yet valid | Your certificate isn't valid yet (it activates on {date}). |
| `visible_sig_oob` | Cuadro fuera de página | El cuadro de firma quedó fuera de los bordes de la página. Ajústalo y vuelve a intentar. | Box out of bounds | The signature box ended up outside the page edges. Adjust it and try again. |
| `webcrypto_unsupported` | Navegador incompatible | Tu navegador no soporta Web Crypto API. Usa Chrome, Firefox o Safari recientes. | Browser not supported | Your browser doesn't support the Web Crypto API. Use a recent Chrome, Firefox or Safari. |
| `sign_failed` | No se pudo firmar | Algo falló al construir la firma. Vuelve a intentarlo; si persiste, abre un issue en GitHub. | Signing failed | Something failed while building the signature. Try again; if it persists, open an issue on GitHub. |
| `timeout` | Tiempo agotado | La firma tomó demasiado (>30s). Intenta con un PDF más pequeño. | Timed out | Signing took too long (>30s). Try a smaller PDF. |
| `abort` | Cancelado | Firma cancelada. | Aborted | Signing aborted. |
| `unknown` | Error inesperado | Algo salió mal. Recarga la página y vuelve a intentar. | Unexpected error | Something went wrong. Reload the page and try again. |

### 3.10 ARIA / SR-only

| Key | ES | EN |
|---|---|---|
| `firmar.aria.progress` | Progreso del wizard de firma, paso {n} de 7 | Sign wizard progress, step {n} of 7 |
| `firmar.aria.box_placer` | Cuadro de firma, arrástralo o usa flechas para mover | Signature box, drag or use arrow keys to move |
| `firmar.aria.box_position` | Posición: x {x}, y {y}, ancho {w}, alto {h} | Position: x {x}, y {y}, width {w}, height {h} |
| `firmar.aria.pin_show` | Mostrar contraseña | Show password |
| `firmar.aria.pin_hide` | Ocultar contraseña | Hide password |
| `firmar.aria.dropzone_p12` | Zona para soltar o elegir certificado .p12 / .pfx | Drop or pick a .p12 / .pfx certificate |
| `firmar.aria.signing_busy` | Firmando, no cierres la pestaña | Signing, don't close the tab |

---

## 4. Micro-interactions documentadas

| Componente | Trigger | Efecto | Duración / Curva |
|---|---|---|---|
| CTA primario | hover (desktop) | bg `--brand-500 → --brand-600`, shadow flat → hover | 120ms / `cubic-bezier(0.32,0.72,0,1)` |
| CTA primario | active (press) | scale `1 → 0.98`, shadow hover → flat | 80ms / mismo |
| CTA primario | focus-visible | ring 4px `--firmar-accent-glow` | instant in, 160ms fade-out al blur |
| Drop zone PDF | dragenter | border solid `--firmar-accent`, bg tint `--firmar-accent-glow`, icon scale 1.1 | 200ms / mismo |
| Drop zone PDF | drop success | border verde flash 1s, then back to resting + small slide-down con el filename | 400ms slide |
| BoxPlacer (placed) | tap-to-place | aparece con scale 0.85 → 1, opacity 0 → 1 | 240ms emerge |
| BoxPlacer | drag start | shadow-rest → shadow-hover, cursor grabbing, **NO transition durante drag** (instant follow finger) | start: 80ms; durante drag: 0ms |
| BoxPlacer | drag end (drop) | snap to 1pt grid, shadow-hover → shadow-rest | 120ms tap |
| BoxPlacer | resize corner | border `--firmar-box-stroke` → `--firmar-box-stroke-active`, sin transition | instant |
| BoxPlacer | clipping fuera de página | shake horizontal 4px ×2 + border `--err-500/60` flash | 320ms shake total |
| Page selector | next page | preview canvas crossfade (opacity 0.4 mid-transition) | 240ms / mismo |
| PinInput | focus | ring brand 4px, border `--ink-300` → `--brand-500` | 160ms |
| PinInput | error (bad_pin) | shake horizontal 6px ×3, border `--err-500`, value clear | 360ms total |
| PinInput | eye toggle | icon swap (eye ↔ eye-off) sin animación | instant |
| Reason/Location input | typing | counter `0/200` color `--ink-500` → `--ink-600` cuando >0 | 120ms |
| Reason/Location input | counter > 180 | counter color → `--warn-500` | instant |
| Continuar/Saltar swap (paso 5) | typing detected | "Saltar" pierde fill, "Continuar" gana fill | 200ms |
| Summary card chips (paso 6) | hover desktop | bg `--ink-50 → --ink-100` | 120ms |
| Sign button (paso 6) | press → worker start | label "Firmar PDF" → "Firmando…", spinner aparece, button disable | instant |
| Stage dots (signing) | stage transition | dot inactive → active: bg flash brand 1.0 → 0.6 alpha pulse | 600ms loop |
| Step transition (next/back) | click | content slide-x 24px + opacity 0 → 1, duración 240ms | mismo curve |
| Result success icon (paso 7) | mount | scale 0 → 1.1 → 1 (overshoot), opacity 0 → 1, glow expand 0 → full | 360ms emerge |
| Download button | click | filename slug derivation invisible, file download starts | instant |
| Share button | click sin support | ocultarse en mount (feature-detect), no error | n/a |
| Reduced-motion | global | todas las translate / scale → 0ms; cambios de color preservados | n/a |

---

## 5. Componentes nuevos identificados (con mini-specs para los críticos)

| Componente | Path | LOC est. | Mini-spec |
|---|---|---|---|
| `WizardShell.svelte` | `apps/pwa/src/ui/WizardShell.svelte` | ~80 | Layout shared del stepper: top-bar (back + title + progress dots) + content slot + bottom action-bar (mobile). Slot props `step, total, title, onBack`. |
| `WizardProgress.svelte` | `apps/pwa/src/ui/WizardProgress.svelte` | ~40 | Stepper dots ●─●─○─○─○─○─○ con conector. ARIA `role="progressbar" aria-valuenow={step} aria-valuemax=7`. |
| `PdfPreview.svelte` | `apps/pwa/src/ui/PdfPreview.svelte` | ~150 | (mini-spec abajo) |
| `BoxPlacer.svelte` | `apps/pwa/src/ui/BoxPlacer.svelte` | ~250 | (mini-spec abajo) |
| `DropP12.svelte` | `apps/pwa/src/ui/DropP12.svelte` | ~100 | Reuso del pattern Drop.svelte F2 con `accept=".p12,.pfx,application/x-pkcs12"` y validación magic-bytes (`0x30 0x82`). |
| `PinInput.svelte` | `apps/pwa/src/ui/PinInput.svelte` | ~120 | (mini-spec abajo) |
| `OptionalAttrs.svelte` | `apps/pwa/src/ui/OptionalAttrs.svelte` | ~80 | Dos inputs textuales con counter, sanitización inline `/[^\p{L}\p{N}\s.,:;\-_/]/gu`. |
| `SignSummary.svelte` | `apps/pwa/src/ui/SignSummary.svelte` | ~120 | Card con secciones: doc, signer, box, attrs, previous. Reuso visual de `Detail.svelte` F2. |
| `DownloadResult.svelte` | `apps/pwa/src/ui/DownloadResult.svelte` | ~120 | (mini-spec abajo) |
| `ExistingSignaturesPanel.svelte` | `apps/pwa/src/ui/ExistingSignaturesPanel.svelte` | ~60 | Banner inline (no panel lateral en MVP) con count + tooltip detail. **Affects Task 16:** spec menciona panel lateral; el adendum lo simplifica a banner inline en step 2 + chip en summary step 6. Panel lateral se reserva para F4. |

### 5.1 Mini-spec — PdfPreview.svelte

**Responsabilidad:** renderizar una página de un `Uint8Array` PDF en `<canvas>` usando pdfjs-dist v4, con scale auto-fit al contenedor.

**Props:**
```ts
{
  pdfBytes: Uint8Array;
  pageIndex: number;     // 0-based
  scale?: number;        // override; default = auto-fit width
  onpagesloaded?: (totalPages: number) => void;
  onerror?: (e: Error) => void;
}
```

**Estados visuales:**
- `loading`: skeleton gris animado (no spinner — el spinner es de Progress.svelte). `--ink-100` con shimmer keyframe.
- `loaded`: canvas visible, dimensions calculadas vía `page.getViewport({ scale }).width/height`.
- `error`: card con icon `i-lucide-file-warning` + copy "No pudimos abrir este PDF" / "Couldn't open this PDF".

**Constraints crítica:**
- Lazy import: `const pdfjs = await import('pdfjs-dist')`. workerSrc se setea con `import.meta.url` resolution; **NO** blob: workers (CSP).
- Force `disableFontFace: true, isEvalSupported: false, useSystemFonts: false`. Si falla por fontes embebidas, fallback a `disableFontFace: false` con warning silenciada en dev console (queda para F4 audit).
- Mobile: `touch-action: pinch-zoom` solo en el canvas. NO permitimos pan vertical durante drag del BoxPlacer (handled por BoxPlacer pointer capture).
- `color-scheme: light` forzado en el wrapper para que no oscurezca el PDF en dark mode.
- `aria-label="PDF preview, página {n} de {total}"`. Canvas accesibilidad: provide alt-text a partir del title metadata del PDF (`pdfDoc.getMetadata().info.Title`) si existe.

**Interacciones:**
- Wheel + Ctrl: zoom in/out (desktop). 6 niveles: 0.5, 0.75, 1, 1.25, 1.5, 2. State local; reset al cambiar `pdfBytes`.
- Touch pinch: native via `touch-action`. Min 0.5×, max 3×.
- Page change (prop): crossfade 240ms (canvas overlay con opacity).

### 5.2 Mini-spec — BoxPlacer.svelte (el más complejo, ~250 LOC)

**Responsabilidad:** overlay absoluto sobre PdfPreview que permite (a) tap-to-place inicial, (b) drag-to-move con pointer events, (c) resize con corner handle, (d) keyboard nav (arrow keys), (e) sincronización canvas-pixels ↔ pt PDF.

**Props:**
```ts
{
  canvasWidth: number;       // px CSS del canvas
  canvasHeight: number;
  pageWidth: number;         // pt PDF
  pageHeight: number;
  cn: string;                // para preview
  size: 'compact' | 'standard' | 'large';
  initial?: { x: number; y: number; w: number; h: number };  // pt PDF
  onchange: (rect: { x: number; y: number; w: number; h: number }) => void;
  onsizechange: (size: 'compact' | 'standard' | 'large') => void;
}
```

**State machine (XState-style en plain TS):**
- `idle_no_box`: nada renderizado, hint "Toca para colocar" overlay.
- `idle_placed`: cuadro renderizado, NO hover/active.
- `dragging`: pointer captured, cuadro sigue al pointer instant.
- `resizing`: corner handle captured.
- `keyboard_focused`: caja con focus ring, arrow keys mueven 1pt (shift+arrow = 10pt).

**Eventos:**
- `pointerdown` en canvas vacío + state `idle_no_box` → place at (clientX, clientY) clamped to page; transition `idle_placed`.
- `pointerdown` en cuerpo del cuadro + state `idle_placed` → setPointerCapture, transition `dragging`.
- `pointerdown` en corner handle + state `idle_placed` → setPointerCapture, transition `resizing`.
- `pointermove` en `dragging` → update position con offset (touch ergonomics: el dedo cubre el cuadro al colocarlo — **offset 24px arriba del centro** del cuadro respecto al touch point para que el usuario vea lo que coloca).
- `pointerup` → releasePointerCapture, transition `idle_placed`, emit `onchange`.
- Keyboard `arrow` → 1pt movement (mantener si hold > 200ms, repeat cada 60ms).
- Keyboard `shift+arrow` → 10pt.

**Visual:**
- Border `2px dashed var(--firmar-box-stroke)` resting; `2px solid var(--firmar-box-stroke-active)` durante drag/resize.
- Bg interna: `oklch(58% 0.21 245 / 0.04)` resting, `0.08` durante drag.
- Texto preview: `Helvetica` (no Geist), color `oklch(20% 0.04 250)` light / `oklch(20% 0.04 250)` dark (NO cambia con tema — debe coincidir con el output PDF). Font-size deriva del `size` prop:
  - compact: 12pt PDF → `12 * canvasScale` px CSS
  - standard: 14pt → `14 * canvasScale`
  - large: 18pt → `18 * canvasScale`
- Si CN largo + width insuficiente: truncate con `...` (medir con `Canvas.measureText`).
- Corner handle: 22×22 px visible (4×4 dot + 18px hit-area extra), bottom-right only en MVP.

**Coords sync:**
- canvas-px ↔ pt PDF: `scale = pageWidth / canvasCssWidth`. PDF coords son bottom-left origin, canvas top-left → invert Y: `pdfY = pageHeight - (cssY + h)`.

**A11y:**
- `role="application" aria-label="Signature box, drag or arrow keys to move" tabindex="0"`.
- `aria-valuetext` reactivo con coords actuales (en mobile reader user puede oír "x 50, y 720, width 200, height 30").
- Focus ring 4px `--firmar-accent-glow`.

**Edge case 1 — clipping:** si tras drag/resize el cuadro queda fuera de los bordes de la página, **clamp** y emit error transient ("Cuadro ajustado al borde"). NO bloquea.

**Edge case 2 — el dedo cubre el cuadro:** durante drag mobile, render un **shadow-clone** del cuadro 60px arriba del touch point, leve opacity 0.5, para previewing. Al pointerup, el clone desaparece y el cuadro real queda en la posición final.

**Edge case 3 — resize a tamaño mínimo:** min-w `60pt`, min-h `20pt`. No permitir más pequeño (al hacerlo el texto truncate sería ilegible).

### 5.3 Mini-spec — PinInput.svelte

**Props:**
```ts
{
  value: string;
  oninput: (v: string) => void;
  onsubmit: () => void;
  error?: string | null;
  disabled?: boolean;
}
```

**Visual:**
- Input height 56px (mayor que el resto de inputs — claim de importancia).
- `font-family: var(--font-mono); letter-spacing: 0.18em` cuando type=password (los dots `•` se separan, es más legible).
- Placeholder: empty (NO mostramos placeholder en password fields — distrae).
- Eye toggle button: 44×44, icon `i-lucide-eye` / `i-lucide-eye-off`, alineado dentro del input padding-right.

**Atributos críticos (privacy):**
```html
<input
  type="password"
  inputmode="text"
  autocomplete="off"
  autocapitalize="off"
  autocorrect="off"
  spellcheck="false"
  enterkeyhint="done"
  name=""
  data-1p-ignore
  data-lpignore="true"
  data-form-type="other"
/>
```
- `data-1p-ignore` y `data-lpignore` desactivan 1Password / LastPass save prompts (usuarios tech-savvy no quieren guardar el PIN del cert en su password manager — es un PIN diferente al de su workflow normal).
- `name=""` sin name = browser autofill pierde anchor.
- `<form autocomplete="off">` wrapping también.

**Cleanup obligatorio:**
- En `onDestroy`: `inputEl.value = ''`.
- En step transition back: `pin = ''` en parent state.
- En `onsubmit` (después de bus call): zero-out via `pin = ''` después de pasar al worker (worker hace su propio cleanup también).

**Error state:**
- Border `--err-500`, ring 4px `--err-500/15`.
- Shake horizontal 6px ×3 (240ms total).
- Field clear automático.
- `aria-invalid="true" aria-describedby="pin-error"`.

### 5.4 Mini-spec — DownloadResult.svelte

**Props:**
```ts
{
  signedBytes: Uint8Array;
  originalName: string;     // e.g. "facturas-mayo.pdf"
  signatureCount: number;   // 1, 2, ...
  onverifynow: () => void;
  onsignagain: () => void;
}
```

**Filename derivation:**
- `outName = originalName.replace(/\.pdf$/i, '') + (lang === 'es' ? '-firmado' : '-signed') + '.pdf'`.
- Si ya tiene `-firmado` / `-signed`, append numerical suffix `-firmado-2`.

**Blob handling:**
- `const blob = new Blob([signedBytes], { type: 'application/pdf' });`
- `const url = URL.createObjectURL(blob);` en mount.
- `URL.revokeObjectURL(url)` en `onDestroy` y al click en "Firmar otro".

**Share button (feature-detect):**
```ts
const canShare = $derived.by(() => {
  if (typeof navigator === 'undefined') return false;
  if (!navigator.share || !navigator.canShare) return false;
  const file = new File([signedBytes], outName, { type: 'application/pdf' });
  try { return navigator.canShare({ files: [file] }); } catch { return false; }
});
```
Si `!canShare`: el botón se oculta totalmente (no greyed-out — emil-tier: si no aplica, no existe).

**Verify-now flow:**
- Llama `onverifynow` que dispara navegación a `/verificar` con state `{ preloadedBytes: signedBytes }` vía svelte-spa-router store.
- En `/verificar`, si recibe `preloadedBytes`, lo procesa directo sin pedir drop. Toast inicial: "Verificando el PDF que acabas de firmar".

---

## 6. Edge cases visuales

| Caso | Comportamiento |
|---|---|
| CN muy largo (`JUAN PEREZ GOMEZ DE LA CRUZ MARTINEZ DE LA TORRE`) | En BoxPlacer preview: truncate con `…` calculado por `measureText`. En Summary card: `text-overflow: ellipsis; max-width: 100%`. En verdict success: line-break natural a 2 líneas, max-3-lines clamp. |
| PDF de 1 página | Page selector hidden completamente. Sólo render del canvas + BoxPlacer. |
| PDF de 200+ páginas | Page selector con input number en lugar de dropdown. Dropdown ≤30 páginas; input number > 30. |
| Cuadro clipping fuera de página | Clamp + shake horizontal en BoxPlacer + toast transient "Cuadro ajustado al borde de la página". |
| Mobile keyboard cubre PIN input | Scroll-into-view automático on focus; padding-bottom dinámico igual a `visualViewport.height - viewport.height` para compensar. |
| Dark mode + PDF claro | `color-scheme: light` forzado en wrapper PdfPreview — el PDF rendering canvas no se oscurece. |
| Error message muy largo (`weak_alg` con cadena cripto explicada) | Card error con `max-w-prose` (65ch), line-height 1.5, no truncate; permitir scroll-y si excede 200px alto. |
| Multi-firma N=5+ | Banner step 2 pluraliza ("Este PDF tiene 5 firmas previas"). Summary step 6 muestra "5 · tu firma se añadirá". No mostrar lista detallada de las 5 (eso es F4 ExistingSignaturesPanel). |
| PIN incorrecto 3+ veces seguidas | NO bloqueamos retry (no hay counter en .p12 PKCS#12). Sólo mostramos sugerencia adicional al 3er intento: "¿Estás seguro que es la contraseña del .p12 y no la del .p7? Algunos certificados tienen dos archivos." |
| Cert expiración hoy | `cert_expired` regulares lo cubre. Si expira en <30 días, banner amarillo informativo en step 6 ("Tu certificado vence el {date}. Considera renovarlo pronto."), NO bloqueante. |
| Firma exitosa pero file-save dialog cancelado | El blob URL persiste; "Descargar" CTA se mantiene; añadir hint "¿No se descargó? Toca de nuevo." (sólo si `download` event nunca dispara — feature-detect difícil, usar timeout 3s). |
| Worker timeout 30s | Modal "Tomó demasiado" con CTA "Reintentar" + "Cancelar". Siempre `worker.terminate()` antes del modal. |
| navigator.share falla con files attach | Fallback a `navigator.share({ url: blobUrl, title: outName })` (sin file). Si también falla, hide button. |
| Browser sin Web Crypto (raro) | Bloqueante en step 4: error `webcrypto_unsupported` con CTA "Usar otro navegador" (link a https://app.firmar.ec/about con browser-compat info). |

---

## 7. Critique findings (P0 / P1 / P2)

### P0 — bloqueantes / rompen feature

**P0-1.** **Affects Task 16, Task 19.** Spec §3.1 Step 4 dice `inputmode=text` pero la mayoría de PINs ECI Ecuador son numéricos. Sin embargo, Security Data permite PINs alfanuméricos. Decisión: `inputmode="text"` (cubre ambos casos, evita mostrar keyboard numeric quando el PIN es frase). **Fix:** dejar como spec dice; documentar en privacy claim que pueden ser frases largas.

**P0-2.** **Affects Task 18 (BoxPlacer).** Spec §3.1 Step 2 dice "tap-to-place, drag-to-reposition, pinch-or-corner-resize" — pinch-resize es **inviable** en mobile sin romper el pinch-zoom del canvas PdfPreview. Decisión: **drop pinch-resize**, sólo corner-handle resize. Documentado en mini-spec §5.2.

**P0-3.** **Affects Task 17.** PdfPreview con `disableFontFace: true` puede degradar gravemente la legibilidad de PDFs con fontes embebidas (ej. PDFs de gobierno con Calibri/Times). **Fix:** intentar `disableFontFace: false` primero, fallback a `true` solo si CSP bloquea. Documentar como warning F4.

**P0-4.** **Affects Task 16.** Spec no dice nada sobre **estado de la batería** del PIN. Si el usuario va al paso 5/6 y luego back al 4, el PIN ya fue zero-out (worker terminated, key descartada en parent). El usuario debería re-tipear. **Fix:** banner amarillo en step 4 cuando volvemos atrás: "Por seguridad, vuelve a escribir tu contraseña."

**P0-5.** **Affects Task 15.** Copy del paso 1 dice "Tu PDF nunca sale de tu dispositivo" pero **el PDF original ni siquiera está protegido como secreto** (se descarga firmado al final). El claim es técnicamente correcto pero confuso. **Fix:** rewording → "Todo se procesa en tu navegador. Sin servidor." (alinear con `verificar.subtitle` Sprint A).

### P1 — afectan calidad percibida

**P1-1.** Step 2 desktop (split-pane): coords (x,y,w,h) en pt PDF mostradas son útiles para power users pero ruido para 99%. **Fix:** colapsar bajo `<details>` "Coordenadas exactas".

**P1-2.** Stepper progress dots ●─●─○─○─○─○─○ → 7 dots es **demasiado** en mobile 390 (apenas caben con padding). **Fix:** mobile mostrar "Paso X de 7" como texto + progress-bar lineal h=4px (no dots). Desktop mantener dots.

**P1-3.** El CTA "Verificar contraseña" en step 4 puede parecer un "submit" técnico al usuario no-tech. Alternativa: "Continuar" pero con label-helper "Verificaremos tu contraseña". Decisión: **mantener "Verificar contraseña"** — es más honesto y la mental model es correcta (el botón hace algo discreto, el back btn no es destructivo del progreso).

**P1-4.** Step 7 success: el icono check 88×88 con scale-overshoot puede sentirse infantil para un app legal. **Fix:** Reducir overshoot a 1.05 max (no 1.1). Glow sutil. NO confetti, NO emoji adicional.

**P1-5.** Summary card paso 6 lista mucha info (5 secciones). En mobile 390 puede requerir scroll. **Fix:** Agrupar en 3 secciones colapsables: "Documento + Cuadro" (siempre visible), "Firmante" (siempre visible), "Detalles + Firmas previas" (colapsable, abierta por default si hay previous signatures).

**P1-6.** **Affects Task 14 (sign.bus).** Worker timeout 30s puede ser muy agresivo para PDFs de 30+MB en mobile lento. **Fix:** timeout dinámico: `15000 + (pdfBytes.length / 1024)` ms (15s base + 1ms per KB). Cap a 60s.

**P1-7.** Step 5 inputs reason/location max 200 char es razonable, pero NO mostramos ejemplos de qué razones son típicas. **Fix:** Placeholder rotativo si campo vacío, o un `<datalist>` con sugerencias comunes ("Aprobado", "Revisado", "Conforme").

**P1-8.** Step 7 botones secundarios "Compartir" y "Verificar" tienen mismo peso visual que CTA primario "Descargar". **Fix:** Descargar es full-width primary; compartir + verificar son half-width secondary (border, no fill).

**P1-9.** Multi-firma banner step 2 ("Este PDF tiene N firmas previas") no comunica **quiénes** firmaron. Es info que el usuario querría. **Fix:** Si N≤3, mostrar inline ("firmado por A, B, C; tu firma se añadirá"). Si N>3, "firmado por A, B, +N más; tu firma se añadirá" con tooltip detail. (Requiere expandir `findSignature` del verifier para devolver array — TODO F4 si no listo en F3.)

**P1-10.** No hay indicación visual de **qué tan avanzado** está el wizard cuando el usuario hace back. La progress bar regresa pero no se siente. **Fix:** Stepper dots animados con direction-aware (forward = slide-x positivo, backward = slide-x negativo) en el step transition.

**P1-11.** El cleanup `pin = ''` después del bus call puede no ser efectivo en Svelte si `pin` está bound al input via `bind:value`. **Fix:** En step transition forward (out of step 4), explicit `inputEl.value = ''; pin = ''` en order. Test E2E en Task 23 verifies que `inspect(window).pin === ''` post-step4.

**P1-12.** Iconografía: el icono 🔐 (candado) y 🔑 (llave) en step 3 / step 4 son **emojis**, no del set lucide. Inconsistente con el rest de la PWA. **Fix:** Reemplazar por `i-lucide-shield-check` (step 3) y `i-lucide-key-round` (step 4). Cero emojis en UI strings.

**P1-13.** "Firmar otro PDF" link en paso 7 es muy discreto (`ink-500`, no underline). Usuario que firma 2-3 PDFs en sesión no lo encontrará rápido. **Fix:** botón terciario h=40 con border, no full-width.

**P1-14.** **Affects Task 22.** CSP `worker-src 'self'` puede no permitir el pdfjs worker si Vite lo bundlea como blob. **Fix:** Pre-validar en Task 22 con `caddy run` local; si rompe, añadir `worker-src 'self' blob:` con justificación documentada.

### P2 — polish (detalles invisible-but-felt)

- **P2-1.** Step transition: el slide-x 24px es ligero. Considerar `prefers-reduced-motion` → `slide-x 0` + opacity-only.
- **P2-2.** PinInput letter-spacing 0.18em en password mode → fineness check en Safari iOS (renderiza dots con kerning raro). Fallback a 0.12em si problema.
- **P2-3.** BoxPlacer corner handle: usar `i-lucide-grip-horizontal` rotated o un dot custom en lugar de un dot plano. Detalle Emil-tier.
- **P2-4.** Step 6 summary: cada sección con `border-l-2 border-brand-500/30` para parecer "información firmable" (signal architectural).
- **P2-5.** Result success: el 88×88 icon container con `bg-ok-500/15` puede aumentar a `0/12` para más sutileza light-mode; mantener `/15` dark.
- **P2-6.** Step 7 filename con extension `.pdf`: aplicar `font-mono` solo a la extension (`facturas-mayo-firmado` sans + `.pdf` mono). Detalle typeset.
- **P2-7.** Stage dots animadas durante signing: usar wave pattern (cada dot pulsa con offset 100ms) en lugar de solo el activo. Sensación más rica.
- **P2-8.** Drop zone P12 hint: "P12 · máximo 1 MB" — algunos certs corporate tienen 2-3MB. **Fix:** subir limit a 5MB, ajustar copy.
- **P2-9.** Banner step 4 "Tu contraseña se borra inmediatamente" → más fuerte: "Tu contraseña existe sólo en tu RAM por ~1 segundo." Más técnico-confianza para audiencia.
- **P2-10.** Continuar/Saltar swap (paso 5): hacer la transición de prominencia con `font-weight: 500 → 600`, no solo bg.
- **P2-11.** Page selector dropdown estilo nativo es feo en Chrome/Edge. Custom dropdown con `<details><summary>` similar a `Detail.svelte` patrón.
- **P2-12.** PdfPreview loading skeleton: agregar shimmer keyframe en lugar de gris plano.
- **P2-13.** Step 4 error shake: que el container del input shake, no el input solo (la label "Contraseña" también).
- **P2-14.** Sign button (step 6) "✍ Firmar PDF": el carácter "✍" es un emoji. Reemplazar por `i-lucide-pen-line`.
- **P2-15.** Hash display en summary card (cert fingerprint): truncate con `…` middle, no end. Hash `aa:bb:cc:…:zz` es más útil.

**Total:** P0=5, P1=14, P2=15. **38 findings.**

---

## 8. Decisiones obligatorias para Sprint C (no sugerencias)

Estos puntos son **lock** del adendum. El impl de Sprint C no puede divergir sin actualizar este documento:

1. **Mobile-first dominante.** Cada step se diseña para 390×844 PRIMERO. Desktop es progressive enhancement (split-pane en step 2, no en otros).
2. **Un solo CTA primario por step** (excepción: step 5 con Saltar/Continuar swap, step 7 con Descargar dominante + 2 secundarios).
3. **Stepper progress: dots desktop, lineal mobile.** No 7 dots en mobile.
4. **PIN warning ANTES, no después.** Banner amarillo visible al entrar al step 4, antes de que el usuario tipee.
5. **CTA del step 4 dice "Verificar contraseña", no "Continuar".**
6. **BoxPlacer: NO pinch-resize en mobile.** Solo corner-handle. Pinch-zoom queda para el canvas PdfPreview.
7. **Helvetica (no Geist) en BoxPlacer preview.** WYSIWYG con el PDF firmado.
8. **`color-scheme: light` forzado en PdfPreview wrapper.** El PDF nunca se oscurece con el theme.
9. **Cero emojis en UI strings.** Reemplazar 🔐 🔑 ✍ por iconos lucide.
10. **Cleanup explícito** al transitar back-out de step 4: `inputEl.value = ''; pin = ''` en este orden.
11. **navigator.share feature-detect**: si no aplica, **botón se oculta** (no greyed-out).
12. **Tokens semánticos F3** (`--firmar-accent`, `--firmar-pdf-bg`, etc.) viven como CSS custom properties en `tokens.css`, no inline.
13. **Worker timeout dinámico**: 15s base + 1ms/KB del PDF, cap 60s.
14. **`data-1p-ignore` y `data-lpignore="true"`** obligatorios en PinInput.
15. **Step 7 success icon overshoot máx 1.05** (no 1.1).

---

## 9. Tasks del plan F3 con design impacts (mapping)

> No editamos el plan. Aquí mapeamos para Sprint C:

| Task | Affected by adendum | Notas |
|---|---|---|
| Task 13 (sign.worker.ts) | §3.7 stages copy, §1.4 motion stage transitions | progresivo dots con wave pattern |
| Task 14 (sign.bus.ts) | P1-6 timeout dinámico | implementar fórmula `15000 + bytes/1024` cap 60000 |
| Task 15 (i18n keys) | §3 entera (105+ keys) | superseder lista mínima del task con la tabla §3 |
| Task 16 (Firmar.svelte stepper) | §1, §2, §4, §5, §8 | usar `WizardShell` + `WizardProgress`; mobile lineal vs desktop dots; cleanup explícito step 4 back |
| Task 17 (PdfPreview) | §5.1 mini-spec | font-face fallback, color-scheme light, lazy import |
| Task 18 (BoxPlacer) | §5.2 mini-spec | drop pinch-resize, offset 24px touch, shadow-clone preview |
| Task 19 (DropP12 + PinInput) | §5.3 mini-spec, §3.5 copy, P1-12 iconos | data-1p-ignore, banner ANTES, "Verificar contraseña" |
| Task 20 (OptionalAttrs + SignButton + DownloadResult) | §5.4 mini-spec, P1-7 datalist, P1-13 firmar-otro botón | filename suffix lang-aware, share feature-detect |
| Task 21 (Vite config) | P1-14 worker-src CSP | pre-validar local |
| Task 22 (Caddyfile.pwa CSP) | P1-14 worker-src 'self' blob: si necesario | documentar justificación |
| Task 23 (Playwright sign.spec) | §6 edge cases, §3.10 ARIA | añadir specs para clipping, multi-firma, PIN cleanup, dark mode PDF |

Tasks 1-12 (cripto core) sin impacts visuales. Tasks 24-34 (audits/release/handoff) sin impacts visuales del adendum salvo Task 24 axe checks usar las keys i18n correctas.

---

## 10. Self-review

- **Tokens count**: spacing=10, typography=9, colors=7 nuevos slots semánticos (todos derivados, 0 hex), motion=4 buckets, shadow=5 tiers, radius=5, z=5. **Total 45 tokens consolidados/declarados.**
- **Wireframes count**: 7 mobile + 7 desktop = **14**.
- **Copy keys ES+EN count**: aprox 105 keys × 2 idiomas = **~210 strings bloqueados**.
- **Components nuevos**: WizardShell, WizardProgress, PdfPreview, BoxPlacer, DropP12, PinInput, OptionalAttrs, SignSummary, DownloadResult, ExistingSignaturesPanel = **10**. Mini-specs detalladas para 4 (PdfPreview, BoxPlacer, PinInput, DownloadResult).
- **Critique findings**: P0=5, P1=14, P2=15 = **38**.
- **Mobile-first verificado**: cada wireframe 390 declarado primero, desktop como progressive enhancement.
- **Sin emojis en UI strings**: P1-12 audita y reemplaza.
- **Bilingüe ES+EN**: tabla §3 completa.
- **Defaults baratos eliminados**: cada decision con valor concreto (px, ms, oklch, weight). 0 "spacing apropiado".
- **Spec/plan no editados**: solo adendum + apéndice puntual al spec (siguiente paso).

---

**Fin del adendum F3 UI Pro Max — design-locked, impl-ready.**
