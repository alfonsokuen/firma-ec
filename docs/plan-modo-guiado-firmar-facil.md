# PLAN MAESTRO — Modo Guiado Accesible "Firmar Fácil" (firmar.ec PWA)

> Estado: **PLAN aprobado, sin construir todavía** (decisión del 2026-07-09).
> Objetivo: que un adulto mayor o una persona con poca soltura digital firme un PDF
> **solo**, acompañado por voz, sin arrastrar nada y sin jerga técnica.
> Aditivo, reversible, sin tocar el camino de firma estándar.
>
> Autoría: spec diseñada por el arquitecto (Fable), destilada por el capataz (Opus)
> a partir del mapeo real de `apps/pwa` y del patrón guiado probado en
> `tienda-firmar-ec/apps/storefront/src/routes/guiado`.

---

## 0. Decisiones tomadas (congeladas)

| Tema | Decisión | Nota |
|---|---|---|
| **Alcance de la 1ª sesión** | Solo documentar el plan. No tocar código aún. | Se construye en otra sesión, empezando por F1. |
| **Identidad / voz de la guía** | Reutilizar **"Fe"** (voz femenina, tono cálido) de la tienda. | Coherencia de marca en todo el ecosistema firmar.ec; patrón ya probado con usuarios reales. |
| **Generación de la voz** | **MoneyPrinterTurbo / edge-tts `es-EC-AndreaNeural`** (voz ecuatoriana femenina, gratis, CLI, headless). | Sustituye a Higgsfield (Plan B de Fable): elimina el riesgo de OAuth no-headless y mantiene la identidad "Fe". |
| **Arquitectura** | Ruta paralela `#/firmar-facil` que monta la **misma** máquina de estados (`Firmar.svelte` con prop `guided`). | Una sola lógica de seguridad; wizard estándar intacto. |

---

## 1. Decisión de arquitectura

**Ruta paralela `#/firmar-facil` que monta la MISMA máquina de estados
(`Firmar.svelte` parametrizado con prop `guided`), con renderers guiados por paso.
NO se duplica la orquestación; NO se extrae un core headless todavía (YAGNI).**

### Por qué (trade-offs)

- **Descartado — toggle puro de narración sobre el wizard actual:** mantiene una
  sola state machine, pero no resuelve el problema de fondo. El paso 2 (arrastrar la
  caja de firma) y la densidad visual son inadecuados **por diseño**, no por falta de
  hints. Narrar una pantalla difícil no la vuelve fácil.
- **Descartado — flujo paralelo con su propia orquestación:** claridad máxima, pero
  **duplica la parte sensible a seguridad** (ciclo .p12/PIN/workers, borrado
  single-shot del PIN). Dos máquinas de firma = drift garantizado y doble superficie
  de bugs de seguridad. Inaceptable.
- **Elegido — híbrido presentación/lógica:**
  - `Firmar.svelte` sigue siendo la ÚNICA máquina (`currentStep` 1–6, ciclo de vida
    del PIN, workers intactos). Gana una prop `guided: boolean` (default `false` →
    **diff nulo** en el camino estándar).
  - Por paso, el render elige componente estándar o guiado:
    `{#if guided} <GuidedX/> {:else} <componente actual/>`. Los componentes guiados
    pueden tener micro-pantallas internas (one-thing-per-page) SIN cambiar la
    semántica de `currentStep`.
  - `#/firmar-facil` es una ruta nueva en el mapa de `svelte-spa-router` que monta
    `Firmar.svelte` con `guided=true`.
  - `guidedMode` en `lib/settings.svelte.ts` hace el modo *sticky* (si está activo, la
    home ofrece/redirige al fácil). El flag es preferencia; la ruta es el mecanismo.
  - **Regla de escalado:** si `Firmar.svelte` supera ~400 líneas con los
    condicionales, ENTONCES extraer core headless `lib/firma/flow.svelte.ts`
    ("extraer cuando duele", no antes).

### Mitigación de los pasos duros

- **Paso 2 (ubicar firma) — CERO drag.** Auto-colocación con `smartPlacement.ts`
  (caja grande, preset "visible"), preview con la caja resaltada y pregunta:
  *"Tu firma irá aquí. ¿Está bien?"* → botón grande **"Sí, continuar"** / secundario
  **"Elegir otro lugar"**. El camino alternativo NO es drag libre: **rejilla de ~6
  posiciones predefinidas** (esquinas + centro-abajo) + selector "primera / última
  página", con toque para elegir. La confirmación humana del lugar es SIEMPRE
  obligatoria (mitiga que el auto-place tape contenido).
- **Paso 3 (.p12) — pre-pregunta.** Antes de pedir el archivo:
  *"¿Tienes tu archivo de firma?"* → **[Sí, lo tengo]** / **[No tengo / no sé]**.
  El camino "No": explicación llana + 2 salidas configurables — "Comprar mi firma"
  (URL tienda) y "Escríbenos por WhatsApp" (URL wa.me). **URLs centralizadas en
  `src/lib/links.ts` leyendo `import.meta.env` (`VITE_STORE_URL`,
  `VITE_WHATSAPP_URL`) — cero hardcoding (Constitución Art. 2).**
- **Paso 4 (PIN):** copy "la contraseña de tu firma", toggle ver/ocultar grande,
  errores en lenguaje llano, y tras 3 fallos ofrecer WhatsApp.

### Puntos de integración exactos (`C:\Dev\fec-deploy\apps\pwa`)

| Archivo | Acción |
|---|---|
| `src/routes/Firmar.svelte` | prop `guided` + selección de renderer por paso |
| mapa de rutas (`src/App.svelte` o `src/routes.ts` — confirmar) | añadir `#/firmar-facil` |
| `src/lib/settings.svelte.ts` | `guidedMode`, `voiceAuto` |
| `src/lib/i18n.svelte.ts` | namespace `guided.*` ES/EN |
| `src/ui/firma/WizardShell.svelte` / `WizardProgress.svelte` | variante `guided` (tipografía XL, "Paso N de M" grande) — NO nuevos componentes de shell |
| `src/ui/Drop.svelte`, `ui/firma/DropP12.svelte`, `PinInput.svelte`, `SignSummary.svelte`, `DownloadResult.svelte` | prop `variant="xl"` (targets 60–80px, letra grande) en vez de duplicarlos |
| Home / `Drop` | tarjeta de entrada "¿Primera vez? Usa el modo fácil con voz" |

---

## 2. Componentes nuevos (mínimos — 5)

Todos en `src/ui/guiado/`:

1. **`GuideStep.svelte`** — plantilla one-thing-per-page: h1 2rem (Lexend), cuerpo
   1.25rem+, slot, CTA primaria 60–80px + secundaria, región `aria-live`.
2. **`GuideNarrator.svelte`** — narración del paso: reproduce clip/TTS, botón
   "Escuchar de nuevo" ↔ "Detener", toggle voz, corta al navegar.
3. **`SimplePlacer.svelte`** — auto-place + confirmación + rejilla de posiciones;
   envuelve `PdfPreview.svelte`, reemplaza a `BoxPlacer` solo en guiado.
4. **`CertHelp.svelte`** — pantalla "¿Tienes tu firma?" con salidas tienda/WhatsApp.
5. **`WhatsAppSticky.svelte`** — "¿Necesitas ayuda?" siempre visible en guiado
   (candidato a global futuro).

Lógica sin UI: `src/lib/guiado/voice.ts` (subsistema de voz).

---

## 3. Subsistema de VOZ

Arquitectura en **2 niveles** (patrón probado en `tienda-firmar-ec`):

- **Nivel 1 — clips mp3 pre-renderizados** en `public/voz/` (Vite sirve `public/`).
  Nombre de archivo = clave i18n (`guided.voz.bienvenida` → `voz/bienvenida.mp3`).
  Manifest `public/voz/manifest.json` con `{clave, archivo, hash_del_texto}`: si el
  texto i18n cambia y el hash no coincide, `voice.ts` cae a TTS y el CI avisa (evita
  audio desincronizado del copy).
- **Nivel 2 — fallback Web Speech API:** `speechSynthesis` con
  `pickSpanishFemaleVoice()` (portar la función de la tienda). Se usa si falta el
  clip, falla la carga, o el texto es dinámico (errores variables).

### Generación de clips — **MoneyPrinterTurbo / edge-tts** (decisión del usuario)

- Script `scripts/gen-voz.mjs` lee el diccionario `guided.voz.*` y genera los mp3
  con **edge-tts, voz `es-EC-AndreaNeural`** (el mismo motor TTS que usa
  MoneyPrinterTurbo; voz ecuatoriana femenina = identidad "Fe"). Gratis, CLI,
  100% headless — sin el bloqueo de OAuth de Higgsfield.
- Post-proceso: mono, normalizar ~-16 LUFS, mp3 ~48 kbps. Presupuesto total
  **< 1.5 MB** (~13 clips).
- **Desacople:** el manifest es el contrato. F2 puede salir solo con Web Speech
  (Plan C) y los clips llegan en F2.1 **sin cambiar código**.
- Gotcha heredado de MoneyPrinterTurbo (memoria del tutorial en vídeo): MPT ignora
  la duración de clip al montar vídeo — **irrelevante aquí**, porque generamos clips
  TTS aislados, no un montaje de vídeo. Solo usamos su capa edge-tts.

### Reglas de reproducción

- **Autoplay: NUNCA** al cargar. La primera pantalla exige toque en **"Empezar"**
  (gesto que desbloquea el audio). Tras ese gesto, auto-narración por paso (setting
  `voiceAuto`, ON por defecto en guiado, toggle visible "Voz: activada / apagada").
- Botón "Escuchar de nuevo" en cada paso. La voz se detiene en cualquier navegación
  y en `onDestroy`.
- **Service worker:** runtime caching `CacheFirst` para `voz/*.mp3` (maxEntries ~20)
  — NO precache masivo. Excepción: precachear solo `bienvenida.mp3`.

---

## 4. Guion de voz + copy (ES) — `[P]` = pre-renderizado

| Clave | Texto |
|---|---|
| `bienvenida` `[P]` | "Hola. Te voy a acompañar paso a paso para firmar tu documento. Es fácil. Toca el botón verde para empezar." |
| `cargar_pdf` `[P]` | "Paso uno. Busca el documento que quieres firmar. Toca el botón grande que dice 'Elegir mi documento'." |
| `pdf_ok` `[P]` | "Muy bien. Ya tengo tu documento. Vamos al siguiente paso." |
| `ubicar_firma` `[P]` | "Paso dos. Mira la pantalla. El recuadro azul muestra dónde irá tu firma. Si está bien, toca 'Sí, continuar'. Si prefieres otro lugar, toca 'Elegir otro lugar'." |
| `cert_pregunta` `[P]` | "Paso tres. Para firmar necesitas tu archivo de firma electrónica. También se llama certificado. ¿Lo tienes en este equipo?" |
| `cert_no` `[P]` | "No te preocupes. Podemos ayudarte a conseguir tu firma. Toca el botón verde para escribirnos por WhatsApp, o el azul para comprarla ahora." |
| `cargar_p12` `[P]` | "Busca tu archivo de firma. Suele estar en Descargas y termina en punto pe doce. Toca 'Buscar mi archivo'." |
| `pin` `[P]` | "Paso cuatro. Escribe la contraseña de tu firma. Es la que te dieron cuando la compraste. Escríbela con cuidado: las mayúsculas y minúsculas importan." |
| `pin_error` `[P]` | "La contraseña no es correcta. Tranquilo, no pasa nada. Bórrala y escríbela otra vez, despacio." |
| `confirmar` `[P]` | "Paso cinco. Revisa que todo esté bien: tu nombre y tu documento. Si es correcto, toca el botón verde 'Firmar ahora'." |
| `firmando` `[P]` | "Estoy firmando tu documento. Espera un momento, por favor." |
| `listo` `[P]` | "¡Listo! Tu documento ya está firmado. Toca 'Guardar' para descargarlo, o 'Enviar por WhatsApp' para compartirlo." |
| `ayuda_lugar` `[P]` | "Toca el lugar de la página donde quieres tu firma. Puedes elegir la primera o la última hoja." |
| errores dinámicos | Web Speech (no clip). Copy en pantalla: "Este archivo no se pudo abrir. Prueba con otro documento, o escríbenos por WhatsApp y te ayudamos." / "Este archivo no es una firma electrónica. Busca uno que termine en punto pe doce (.p12)." |

**Reglas de copy:** 2ª persona, frases ≤ 12 palabras, cero jerga técnica sin
explicar, siempre una salida ("escríbenos por WhatsApp"), nivel de lectura ≤ 6º grado.

---

## 5. Accesibilidad — checklist AAA del flujo guiado

- Contraste ≥ 7:1 texto normal; azul `#0062c4` / `#1e3a8a` sobre blanco verificado.
- Targets ≥ 60px (mínimo absoluto 44); separación ≥ 8px.
- Cambio de paso: mover focus al `h1` (`tabindex="-1"`) + `aria-live="polite"`
  anuncia "Paso N de M: <título>".
- Errores: `role="alert"` (ya existe) + `aria-describedby` al input; nunca solo color.
- Focus ring 3–4px visible; camino completo por teclado (e2e keyboard-only firma un PDF).
- `prefers-reduced-motion`: sin transiciones animadas entre pasos.
- Sin límites de tiempo; sin tooltips hover (usar `<details>` "¿Por qué lo piden?").
- **Lexend** (heading) + **Source Sans 3** (body) SOLO bajo clase scope `.guided`
  — no toca la marca del wizard estándar.
- Verificación: axe-core vía Playwright en cada pantalla guiada (**gate: 0
  critical/serious**), Lighthouse a11y ≥ 95, smoke manual con lector de pantalla
  (NVDA) 1 vez por fase.

---

## 6. Fases entregables

Cada fase: flujo **qa-verify** completo (respaldo → rama → cambio + bump SemVer +
CHANGELOG → verificación multicapa → escaneo hardcoding del diff → push confirmado →
registro en memoria) y **qa-auditor** da el GO/NO-GO.

### F1 — MVP "Firmar Fácil" SIN voz — rama `feat/modo-guiado-f1`, bump **v0.18.0**

- **Archivos:** los de la tabla del §1 + `GuideStep`, `SimplePlacer`, `CertHelp`,
  `WhatsAppSticky`, `links.ts`, i18n `guided.*` ES/EN.
- **Contenido:** ruta + 6 pasos guiados one-thing-per-page + auto-place sin drag +
  salida "no tengo certificado" + a11y base (focus, aria-live, tamaños, contraste).
- **Tests:** e2e Playwright firma **REAL** un PDF de prueba con .p12 de prueba por
  `#/firmar-facil`; e2e de regresión del wizard estándar (paridad, sin cambios); axe
  por pantalla.
- **Criterios de éxito observables:**
  1. Baseline medido del wizard estándar (nº interacciones / tiempo con
     `measure_flow`) vs guiado: guiado ≤ **8 taps + contraseña** en happy path y
     ≤ **60%** de las interacciones del baseline.
  2. axe **0 críticos**.
  3. Suite existente **verde**.
  4. Smoke en `app.firmar.ec`: la ruta carga, firma e2e real, y el PDF firmado
     re-subido es detectado como "con firmas previas" por `Drop.svelte`.
  5. **qa-auditor: GO.**

### F2 — VOZ — rama `feat/modo-guiado-f2-voz`, bump **v0.19.0**

- **Archivos:** `lib/guiado/voice.ts`, `GuideNarrator.svelte`, `public/voz/*` +
  `manifest.json`, `scripts/gen-voz.mjs` (edge-tts es-EC-Andrea), ajuste workbox
  runtime-cache.
- Puede salir con Web Speech solamente si la generación de clips se bloquea
  (Plan C); clips = F2.1 sin cambio de código.
- **Criterios:** narración por paso tras gesto inicial (**0 `NotAllowedError`** en
  consola en e2e); "Escuchar de nuevo" funciona en cada paso; voz se corta al
  navegar; fallback TTS activa con la red de mp3 bloqueada (test); clips < 1.5 MB;
  audio offline tras 1ª reproducción (SW).

### F3 — Pulido AAA + ayuda cálida — bump **v0.20.0**

- Lexend / Source Sans 3 scoped, **mascota / avatar "Fe"** (reutilizar el patrón de
  la tienda), `<details>` contextuales, rejilla completa de posiciones, "retomar
  donde ibas" en localStorage (SOLO nº de paso, **JAMÁS** archivo ni PIN — al retomar
  se vuelve a pedir el PDF), guion EN (voz EN solo Web Speech).
- **Criterios:** Lighthouse a11y ≥ 95 en todas las pantallas; e2e keyboard-only
  completo; reduced-motion verificado.

### F4 — Validación con humanos (sin deploy de código)

- firmar.ec es **NO-TRACKING**: nada de analytics en prod. Medición = laboratorio
  (`measure_flow` / e2e) + prueba con **3–5 usuarios reales** del perfil objetivo
  reclutados por WhatsApp. Éxito = **≥ 4/5 completan la firma sin ayuda humana**;
  iterar copy / voz según hallazgos.

---

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Autoplay bloqueado | Gesto "Empezar" obligatorio antes de cualquier audio; toggle visible; test e2e de consola limpia |
| Auto-place tapa contenido | `smartPlacement.ts` + confirmación humana SIEMPRE + rejilla alternativa |
| TTS lento en móviles viejos | Clips pre-renderizados como camino primario; Web Speech solo fallback; probar en Android WebView antiguo |
| Copy y audio divergen | clip = clave i18n + hash del texto en manifest; mismatch → fallback TTS + aviso CI |
| Romper wizard estándar | prop `guided` default false; e2e de paridad como gate de cada fase; diff acotado en `Firmar.svelte` |
| SW engorda install | runtime `CacheFirst`, no precache (salvo `bienvenida`) |
| Hardcoding WhatsApp/tienda | `links.ts` + `VITE_*` env, escaneo de diff pre-commit |
| Seguridad (.p12/PIN) | Modelo single-shot intacto; jamás persistir archivo ni contraseña; localStorage solo nº de paso en F3 |

---

## 8. Primer movimiento cuando se construya (F1)

1. Despachar `explorador` (haiku) a confirmar 3 supuestos antes de tocar nada:
   (a) archivo exacto del mapa de rutas (`App.svelte` vs `routes.ts`);
   (b) firma actual de `smartPlacement.ts` (¿acepta preset de tamaño / página?);
   (c) si los componentes hoja aceptan props de estilo o requieren variante.
2. Partir F1 en 4 tareas para `implementador` (ruta+flag / renderers guiados /
   `SimplePlacer` / i18n+copy), con `code-reviewer` y `qa-auditor` como gates.
3. Cerrar por el flujo `qa-verify` y registrar en memoria.
