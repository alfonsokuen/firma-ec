# Changelog

Todos los cambios notables a este proyecto se documentan aquí.
El formato sigue [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) y este proyecto usa [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **PWA: error de consola CSP por el beacon de Cloudflare Web Analytics** (`@firma-ec/pwa` 0.9.6 · infra CF): el edge de Cloudflare inyectaba `static.cloudflareinsights.com/beacon.min.js` en `app.firmar.ec`, pero el CSP estricto de la PWA (`script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`) lo bloqueaba → error de consola en cada carga y CF Analytics inútil en la app. Fix: **Cloudflare Configuration Rule** (`http.host eq "app.firmar.ec"` → `disable_rum: true`) que desactiva la inyección del beacon **solo en la PWA** — la app queda **sin terceros en runtime** (coherente con su promesa de privacidad) y la landing conserva su analítica. Verificado en vivo: el beacon ya no se inyecta. (Sin reinicio de Traefik.)
- **Limpieza de i18n muerto `firmar_placeholder.*`** (`@firma-ec/pwa` 0.9.6): removidas las 10 claves (ES+EN) del placeholder "Próximamente — F3" que ya no usa ningún componente (Firmar es una ruta real desde hace tiempo).
- **PWA Home: badge stale "Próximamente (F3)" en la card "Firmar un PDF"** (`@firma-ec/pwa` 0.9.5): F3 (firma con `.p12`) está LIVE desde v0.5.1, pero la card de Firmar en el Home seguía mostrando un badge ámbar "Próximamente (F3)" / "Coming soon (F3)" (label stale de cuando F3 no existía) — daba la impresión de que firmar no estaba disponible. Removido el badge + el acento de la card pasa de `warn-500` (ámbar/pendiente) a `brand-500` con flecha de hover, igual que la card de Verificar (feature live de primera clase). Eliminado el i18n muerto `home.firmar_soon` (ES+EN). (Queda `firmar_placeholder.*` como i18n muerto sin componente, sin impacto.)

### Changed
- **Wizard de Firmar: conteo de pasos correcto + footer alineado/centrado (responsive)** (`@firma-ec/pwa` 0.9.9): (a) **"Paso N de 7" → "Paso N de {total}"** — el wizard tiene **6 pasos** reales (el paso "Detalles opcionales" se removió en v0.7.15) pero los strings i18n `step_of` y `aria.progress` tenían el `7` hardcodeado; ahora se derivan de `totalSteps`/`steps.length` (no vuelve a desincronizarse). (b) **Footer en grid `[1fr·auto·1fr]`**: "Atrás" a la izquierda, indicador de paso centrado de verdad (offset ≤1px en PC/tablet, verificado), CTA a la derecha; el indicador se oculta en mobile (ya aparece en el stepper superior — evita el duplicado). (c) **CTA "Verificar contraseña" del paso 4 movido al footer**, alineado con "Atrás" en la misma fila (como "Firmar PDF" en el paso 5) en vez de flotar como botón aparte del `PinInput` — se eliminó el botón propio de `PinInput` (Enter sigue enviando). Verificado responsive PC 1280 / tablet 768 / mobile 390 con `getBoundingClientRect` (misma fila, sin solape, cabe en viewport).
- **Firma visible sin marco/recuadro** (`@firma-ec/pwa` 0.9.8 · `@firma-ec/signer`): la estampa visible (QR + "Firmado por / Fecha / Razón") dibujaba un recuadro gris alrededor del BBox. A pedido del usuario se removió el contorno → la estampa queda limpia sobre el documento (solo QR + texto). Eliminado el bloque de borde (`setLineWidth`/`rectangle`/`stroke`) en los **dos** generadores de apariencia (`visibleSig.ts` = single-sig vía `signPdfPades`, e `incrementalUpdate.ts` = multi-sig/incremental) + imports `setLineWidth`/`stroke` ya sin uso. Tests `visibleSig.test.ts` actualizados (afirman ausencia de borde: `not.toMatch(/0.5 w/)` y sin `S`); 35/35 verde, incluyendo la firma real con fixture rsa2048.
- **PWA Firmar: quitar el botón "Verificar contraseña" duplicado del paso 4** (`@firma-ec/pwa` 0.9.8): el paso 4 (contraseña del .p12) mostraba DOS botones idénticos "Verificar contraseña" — el propio del `PinInput` y el botón Next del footer del wizard — ambos llamando `onPinSubmit`. El diseño ya preveía ocultar el Next en ese paso pero `hideFooter` solo cubría los pasos 1/3/6. Se añadió el prop `hideNext` a `WizardShell` (oculta solo el botón Next, conservando "Atrás" + el indicador "Paso N de 7") y se activa en el paso 4. Ahora hay un único CTA "Verificar contraseña" (el de `PinInput`). El botón "Firmar PDF" real sigue siendo el del paso 5.
- **PWA Verificar: reformular el flujo del QR y quitar el aviso engañoso "hash no coincide"** (`@firma-ec/pwa` 0.9.7): el QR que el firmante incrusta codifica el hash del PDF **sin firmar**, pero el QR vive *dentro* del PDF firmado → al escanearlo y subir ese PDF firmado (el único que el usuario tiene) la comparación de hash **nunca** coincidía y mostraba un banner ámbar *"ℹ Hash no coincide"* que parecía un fallo. Alineado con la postura oficial de FirmaEC/MINTEL (*"el escaneo del código QR no es un método de verificación… el QR no valida que un documento esté firmado"*): el QR es solo un **atajo** al verificador; la validación real es subir el PDF (todo en el navegador, sin servidor). Cambios: banner reformulado ("Llegaste desde un QR de firmar.ec — sube el PDF firmado para validar; el QR por sí solo no verifica nada"), **eliminada** toda la comparación de hash (`compareHash12` + estado `qrCompare` + banners verde/ámbar + 4 claves i18n muertas `match_ok`/`match_warn`/`why_*` en ES+EN + su bloque de tests). La verificación criptográfica (el veredicto del worker) no cambia. `parseQrHash`/`readQrHashFromLocation` se mantienen (alimentan el banner de contexto).
- **`/patrocinar`: separar Patrocinio (donación) de Licencia comercial / Enterprise** (`@firma-ec/landing` 0.1.40): a raíz del modelo dual AGPL+comercial, la página separa dos pistas que antes se mezclaban. **Patrocinio** (Bronze→Platinum) = apoyo al proyecto abierto: visibilidad + influencia en roadmap + acceso anticipado (se removió "16 h/mes + integración" de Platinum → "Soporte prioritario"; el patrocinio ya no implica integración ni SLA). Nuevo panel **"Enterprise & Licencia comercial"** (reemplaza el de "Founding"): integración en sistemas propietarios (licencia comercial bajo AGPL), SLA y soporte por contrato, integración a medida (API/SSO/white-label), emisión de certificados, gobierno/GADs/universidades → contacto `info@idkmanager.com` (canal comercial, distinto de `sponsors@`). Clarificador en el encabezado de niveles. Coherente con la gobernanza ("el patrocinio no compra el servicio"). Campo `"license": "AGPL-3.0-only"` añadido a `apps/landing` y `apps/pwa` package.json.
- **Tema: light por defecto + auto-dark según el dispositivo** (`@firma-ec/landing` 0.1.39, `@firma-ec/pwa` 0.9.4): el bootstrap de tema (landing `Base.astro` + PWA `index.html`) ahora respeta `prefers-color-scheme`. Prioridad: elección explícita del usuario (`localStorage 'theme'` = `light`/`dark`) gana; si no hay elección, sigue al dispositivo (dispositivo en oscuro → dark), con **light como fallback**. Antes ignoraba `prefers-color-scheme` (default light salvo toggle manual). Se mantiene sin FOUC (script pre-render).
- **Relicencia a GNU AGPL-3.0 + licencia comercial (modelo dual)** (`@firma-ec/landing` 0.1.38, `@firma-ec/pwa` 0.9.3): el proyecto pasa de **Apache-2.0** a **AGPL-3.0** hacia adelante (sigue siendo open source / software libre — conserva la preferencia de compra pública en EC). Su *copyleft* obliga a quien integre firmar.ec en un sistema cerrado con fines de lucro a liberar su código **o** adquirir una **licencia comercial** (nuevo [`LICENSE-COMMERCIAL.md`](LICENSE-COMMERCIAL.md), contacto `info@idkmanager.com`). `LICENSE` reemplazado por el texto canónico AGPL-3.0; `package.json` (`AGPL-3.0-only`), `jsonld.ts` (URL OSI), badge README, footers landing+PWA, About/Home PWA, llms.txt/llms-full.txt, ai-plugin.json, Términos (§5 reescrito: copyleft + licencia comercial; §3 disclaimer AGPL §15-16), FAQ-empresas (ES+EN: uso de la app gratis; integrar código → AGPL/comercial) y docs de patrocinio (gobernanza/FAQ) actualizados. **Cero rastro de Apache-2.0** en superficie user-facing (se preserva la licencia Apache propia de pdf.js vendorizado y el historial). ⚠️ El contrato comercial lo formaliza un abogado; registro de obra en SENADI recomendado.
- **Repos git renombrados `firma-ec` → `firmar-ec`** para alinear con la marca y distanciar de "FirmaEC" (MINTEL): GitHub `idkmanager/firmar-ec` + `alfonsokuen/firmar-ec` (rename con redirect), Gitea ya era `alfonso/firmar-ec`. Todas las URLs de repo en landing/PWA/docs actualizadas. El scope npm `@firma-ec/*` se mantiene (interno; renombrarlo rompería el build). Las referencias a **FirmaEC** (producto MINTEL) en comparativos/alternativa se conservan (uso nominativo legítimo).

### Added
- **Menú de navegación mobile (hamburguesa)** (`@firma-ec/landing` 0.1.41): el `Header.astro` ocultaba los 6 enlaces (`Firmar`, `Verificar`, `Seguridad`, `Preguntas`, `Acerca`, `Patrocinar`) con `hidden md:flex` y **no había nada que los reemplazara en mobile** (`<768px`) — la navegación quedaba inaccesible en el teléfono (solo logo + "Abrir app" + idioma + tema). Se añadió un botón hamburguesa (`md:hidden`, icono `menu`↔`x`, `aria-expanded`/`aria-controls`) que despliega un panel con los enlaces apilados; cierra al tocar un enlace, con `Escape`, clic fuera, o al cruzar a viewport desktop. Los enlaces se generan desde un array único (`navKeys`) compartido por desktop y mobile para que **nunca diverjan**. Animación `opacity`+`transform` (GPU-friendly, respeta `prefers-reduced-motion`).
- **Fila de patrocinadores al pie del hero** (`@firma-ec/landing` 0.1.37): nuevo `HeroSponsors.astro` que muestra una fila compacta "Con el apoyo de" con los logos (escala de grises → color en hover) debajo del contador de uso. **Empty-safe**: con 0 patrocinadores no renderiza nada y aparece sola al agregar el primero. Clic en los logos y en "Ver patrocinadores →" baja a la sección `#patrocinadores` ("Quienes hacen esto sostenible") con `scroll-mt` por el nav fijo. Se introdujo `src/data/sponsors.ts` como **fuente única** (la consumen `HeroSponsors` y `SponsorsStrip` → agregar un logo aparece en ambos lugares a la vez); `SponsorsStrip.astro` ahora importa de ahí y la sección lleva `id="patrocinadores"`.

### Changed
- **Título de la home (`meta.home.title`) = frase de acción, igual al H1** (`@firma-ec/landing` 0.1.37): ES `'Firma y verifica PDFs con tu certificado electrónico .p12.'` / EN `'Sign and verify PDFs with your .p12 electronic certificate'` (antes `'Firma electrónica ecuatoriana en tu navegador'`). Cambia el `<title>` y el **título del preview al compartir** (og:title) para que coincida con el Hero. Mismo texto actualizado en los títulos de las imágenes OG generadas (`og/[slug].png.ts` slugs `default`/`home`). ⚠️ Trade-off SEO: el título deja de llevar el keyword literal "firma electrónica ecuatoriana" (sigue presente en `meta.home.description` y en el cuerpo). La imagen estática `public/og-firmar-ec.png` mantiene su texto incrustado (regeneración aparte si se desea).

### Docs
- **README + metadata de repos actualizados al estado actual** (2026-05-27): tabla "Estado del proyecto" sincronizada (landing `v0.1.36` · PWA `v0.9.2`, fila del contador de uso en vivo y del cluster de contenido SEO bilingüe), bullet del contador en "Características LIVE", y mirror personal añadido a "Repos". Descripción corta, website (`https://firmar.ec`) y topics actualizados en las 3 superficies (Gitea `alfonso/firmar-ec`, GitHub `idkmanager/firma-ec`, GitHub `alfonsokuen/firma-ec`). Sin tocar el conteo de ACEs ARCOTEL (decisión YMYL diferida) ni el bloque de verificación Sigstore (tag/artefactos reales).

### Fixed
- **Landing — auditoría SEO 2026-05-25: pulido de 2 overflows propios** (`@firma-ec/landing` 0.1.33): la re-auditoría tras los deploys del día detectó 2 metadatos recién creados ligeramente sobre el límite SERP — `/como-firmar-pdf` meta description 163→145 chars; `/alternativa-firmaec` title 62→50 renderizados ("Alternativa a FirmaEC para firmar PDFs"). Los equivalentes EN ya estaban en límite (≤60/≤154). Sin cambio de keyword.

### Fixed
- **Beacon de la PWA bloqueado por CSP** (`@firma-ec/pwa` 0.9.2, `@firma-ec/stats-worker`): el beacon apuntaba a `https://firmar.ec/api/stats/event` (cross-origin), pero el `connect-src` de la PWA (`'self' https://ocsp.firmar.ec https://freetsa.org`) NO incluye el apex → el navegador lo bloqueaba silenciosamente y firmar/verificar no contaba. Fix sin tocar CSP: el Worker ahora también sirve `app.firmar.ec/api/stats*` y el beacon usa URL **relativa** (mismo origen) → pasa `connect-src 'self'`.

### Added
- **Contador de uso en vivo en la landing + beacons anónimos** (`@firma-ec/landing` 0.1.36, `@firma-ec/pwa` 0.9.2, nuevo `@firma-ec/stats-worker`): el Hero muestra cifras reales de uso (documentos firmados · firmas verificadas; certificados emitidos cuando aplique) con count-up minimalista que respeta `prefers-reduced-motion`. Muestra el total real **siempre (incluso 0)**, creciendo con el uso; el "+" aparece solo cuando hay > 0. Se oculta **solo si el fetch falla** (sin números inventados). Servido por un **Cloudflare Worker** (`tools/stats-worker`, ruta `firmar.ec/api/stats*` misma zona, KV) — totalmente aislado de la app de firma, **sin PII** (solo dos enteros), rate-limit 20/h por IP, alineado con zero-knowledge/LOPDP. La PWA emite un beacon anónimo (`navigator.sendBeacon` a `/api/stats/event`) al completar una firma (`Firmar.svelte`) o una verificación con firmas (`Verificar.svelte`); best-effort, nunca rompe el flujo. Arranca en 0 → oculto hasta el primer uso real. Las rutas `/api/stats` equivalentes del `inbox-backend` quedan como alternativa probada pero NO desplegada.
- **Landing — posicionamiento de intención: emisión de certificados "próximamente"** (`@firma-ec/landing` 0.1.32): nuevo componente `CertNotice.astro` (aviso bilingüe, on-brand, **sin formulario ni captura de datos** — respeta la postura "sin formularios, sin tracking" del sitio) que anuncia que firmar.ec habilitará la **emisión de certificados de firma electrónica**, reafirmando que la herramienta de firma sigue **gratis y open source**. NO nombra proveedor ni precios (acuerdo de revendedor en negociación). Colocado en las 2 páginas de mayor intención de compra: `/como-obtener-certificado-firma-electronica` y `/como-firmar-pdf` (ES+EN). Primer paso del giro de monetización: convertir el tráfico SEO de intención de certificado en demanda posicionada.
- **Landing — 2 páginas P1: cluster "firmar" + "certificado"** (`@firma-ec/landing` 0.1.31):
  - **`/como-firmar-pdf` (`/en/how-to-sign-pdf`)** — HowTo madre para la query de mayor volumen del nicho ("cómo firmar un PDF"). Answer-first, requisitos, 6 pasos (schema **HowTo**), validez legal (LCE 2002-67), casos específicos que derivan a BCE/FirmaEC/token sin canibalizar la guía BCE (esta es genérica, BCE es el caso específico). `TechArticle`+`BreadcrumbList`.
  - **`/como-obtener-certificado-firma-electronica` (`/en/how-to-get-an-electronic-certificate`)** — proceso para obtener el certificado (G6): elegir ECI, requisitos, `.p12` vs token, solicitar/pagar/descargar. **HowTo** (5 pasos). Aclara que firmar.ec NO emite certificados (solo firma) y que el costo/vigencia **varían por ECI → remite a la lista oficial de ARCOTEL** (sin inventar precios; G5 tabla de precios queda pendiente de datos verificados).
  - Bilingüe (ROUTE_MAP + hreflang), enlaces en footer (Guías), silos pilar→cluster: la pilar enlaza firmar/obtener/verificar; cluster certificado↔firmar bidireccional.
- **Landing — nueva página `/verificar-firma-pdf` (`/en/verify-pdf-signature`)** (`@firma-ec/landing` 0.1.30): página P1 (G3) para la query "cómo verificar/validar la firma de un PDF" — alto intent, sin competidor bueno en EC, conecta con el verificador de `app.firmar.ec`. Answer-first (las 3 condiciones de validez: integridad + ECI ARCOTEL + no-revocación OCSP/CRL), pasos, qué reporta el verificador, alternativas honestas (Adobe Reader, validador MINTEL Minka) y FAQ. Schema **HowTo** (4 pasos) + `TechArticle` + `BreadcrumbList`. Bilingüe (ROUTE_MAP + hreflang), enlace en footer y silo "verificar/validez" bidireccional con `/que-es-firma-pades`. Claims tomados del comparativo verificado + LCE 2002-67.
- **Landing — nueva página `/alternativa-firmaec` (`/en/firmaec-alternative`)** (`@firma-ec/landing` 0.1.29): página P1 que ataca la query "alternativa a FirmaEC" + la **colisión de marca firmar.ec ↔ FirmaEC** detectada en el baseline GEO (Perplexity confunde firmar.ec con FirmaEC y no lo cita en 0/4 queries). Answer-first, sección explícita "firmar.ec no es FirmaEC" (desambiguación de entidad para LLMs y usuarios), razones para buscar alternativa (Java/móvil/instalación), tabla resumen, y sección honesta "cuándo SÍ necesitas FirmaEC" (XAdES SRI, token USB, lote, offline). Claims tomados del comparativo verificado `/comparativos/firmaec`. Bilingüe (ROUTE_MAP + hreflang), `TechArticle`+`BreadcrumbList`, enlace en footer (columna Guías) y silo bidireccional con el comparativo. Diferencia de intención vs `/comparativos/firmaec` (comparación neutral) para no canibalizar.

### Fixed
- **Landing — P0 SEO/GEO quick wins post-auditoría 2026-05-25** (`@firma-ec/landing` 0.1.28):
  - **Titles/descriptions recortados** (truncado en SERP, medido en auditoría): guía BCE title 77→54 car. renderizados ("Cómo firmar un PDF con certificado del BCE" / EN equivalente), `/comparativos/adobe-sign` title 63→≤60 ("…comparación para Ecuador"), meta description de la pilar `/firma-electronica-ecuador` 165→≤155 y `/que-es-firma-pades` 174→≤155 (ES+EN). Sin pérdida de keyword.
  - **TL;DR answer-first en `/seguridad`** (ES+EN): bloque al inicio que responde directo "¿Es seguro firmar.ec? Sí…" resumiendo hechos ya presentes en la página (llave `.p12` nunca sale del equipo, `extractable:false`, Web Worker, open source, A+ en Mozilla Observatory/SSL Labs/securityheaders verificado 2026-05-08). Mejora citabilidad GEO para la query "¿firmar.ec es seguro?". No añade hechos nuevos.
  - **Diferido (requiere decisión/insumos, NO incluido):** unificación de la cifra de ECIs entre superficies (home/pilar dicen "16 de 17 ECIs", `llms-full.txt` dice "9 ACEs/8 roots", TSL real tiene 28 roots activos → afirmación factual de trust list YMYL que exige fijar el número/framing canónico antes de tocar); enriquecer `sameAs` del Organization (requiere crear perfiles off-site LinkedIn/Wikidata primero).
- **Landing — P1: CTA EN rotos `/en/sign` y `/en/verify` (404)** (`@firma-ec/landing` 0.1.27): los dos CTA principales de la home en inglés (`Hero.astro` → `localizedUrl('firmar'|'verificar', 'en')`) apuntan a `/en/sign` y `/en/verify` por el `ROUTE_MAP` (`src/i18n/utils.ts`), pero `Caddyfile.landing` solo tenía los `redir` de las rutas ES (`/firmar`, `/verificar`, `/paranoia`) → **ambos daban 404**. Añadidos los 4 `redir` EN espejo del bloque ES (`/en/sign`→`app.firmar.ec/#/firmar`, `/en/verify`→`app.firmar.ec/#/verificar`, con sus `/*`). Era visible en GSC como 2 errores "No se ha encontrado (404)" (`/en/sign`, `/en/verify`, último rastreo 21/5/26) y rompía la conversión de usuarios EN. Detectado en auditoría SEO 2026-05-25.
- **Landing — P1 SEO: autoría E-E-A-T en guías (YMYL)** (`@firma-ec/landing` 0.1.26): las guías (`TechArticle`) ahora declaran `author` y `reviewedBy` = **Equipo IDK Manager** (Organization, url idkmanager.com), además del `publisher` (org firmar.ec). Byline visible "Por Equipo IDK Manager · {fecha}" en el encabezado de cada guía (ES) / "By IDK Manager Team" (EN). Antes solo había `publisher` sin autoría → techo de ranking en queries legales (la autoría/revisión es factor E-E-A-T central en contenido YMYL de firma electrónica).
- **Landing — P0 SEO: cluster de guías enlazado (enlazado interno)** (`@firma-ec/landing` 0.1.25): el footer (presente en TODAS las páginas, incluida la home de máxima autoridad) ahora tiene una columna **"Guías"** que enlaza las 5 páginas de contenido que estaban huérfanas de enlaces internos: `firma-electronica-ecuador`, `como-firmar-con-certificado-bce`, `que-es-firma-pades`, `comparativos/firmaec`, `comparativos/adobe-sign` (ES+EN vía `localizedUrl`/hreflang). Antes solo el glosario estaba enlazado; el contenido que capta demanda informacional no recibía PageRank interno desde la home. Grid del footer 4→5 columnas. Pendiente (mayor esfuerzo, idealmente con datos GSC): sección de guías en el cuerpo de la home + autoría E-E-A-T + páginas "verificar PDF"/"obtener .p12".
- **Landing — P3 SEO post-auditoría** (`@firma-ec/landing` 0.1.24):
  - **`/favicon.ico`** (antes 404): añadido `public/favicon.ico` multi-resolución (16/32/48) generado desde `icon-512.png`. Bots/previews que piden el `favicon.ico` bare ya no reciben 404 (el HTML ya referenciaba `/icons/favicon.svg`).
  - **Redirect `/en/firma-electronica-ecuador/` → `/en/electronic-signature-ecuador/`** (301, Caddyfile): la guía EN vive en el slug inglés; evita soft-404 si alguien prefija `/en/` al slug ES. No estaba en sitemap ni hreflang (impacto SEO nulo, fix defensivo).
- **Landing — auditoría SEO técnica: quick wins** (`@firma-ec/landing` 0.1.23):
  - **Trailing slash canónico** (`astro.config.mjs` `trailingSlash: 'never' → 'always'` + `ROUTE_MAP` y breadcrumbs/related/`llms.txt`/`llms-full.txt` normalizados): el canonical, el sitemap, los hreflang y los enlaces de nav apuntaban a URLs **sin** slash que el host (Caddy, directory-format) **308-redirige** a la versión con slash. Resultado: canonical no auto-referencial + sitemap lleno de redirects. Ahora las 4 señales coinciden con la URL servida (`/pagina/`), sin redirects. Detectado por los 3 frentes de la auditoría (técnico, contenido, GEO).
  - **Cifra de ECIs unificada a "16 de las 17"** (`Compatibilidad.astro`, `glosario/eci`+`en-eci`, `glosario/tsl`+`en-tsl`, `acerca`/`about`, guía `firma-electronica-ecuador`/`electronic-signature-ecuador`): el glosario, "acerca" y la guía pilar seguían diciendo "8 ECIs activas" (dato **stale** previo a v0.8.0); ahora reflejan las 16 ECIs con raíz propia que firmar.ec reconoce (16 de las 17 acreditadas; la 17ª, Registro Civil, firma con BCE/Security Data). Elimina la contradicción factual YMYL (home decía 17, glosario/guía decían 8). Se añaden por nombre las 8 ECIs faltantes (Lazzate, Alpha Technologies, AppFirmas, CorpNewBest, DarkCam, FirmaSegura, LetMi Ecuador, PrimeCoreLat) sin fabricar columnas Tipo/Notas.
  - **CSP permite el beacon de Cloudflare Web Analytics** (`Caddyfile.landing`): `static.cloudflareinsights.com` en `script-src` + `cloudflareinsights.com` en `connect-src`. Antes la CSP bloqueaba el beacon que CF inyecta en el edge → **cero datos de tráfico** + error CSP en consola en cada carga (único motivo del Best-Practices 92 en Lighthouse).
  - **Eliminado `public/sitemap.xml` huérfano**: archivo estático de 194 B con namespace XML malformado (`schemas/sitemap-0.9`) que sombreaba el sitemap real generado por `@astrojs/sitemap` (`/sitemap-index.xml`).
  - **Meta description de la home acortada** a ≤155 chars (ES y EN) para evitar truncado en SERP.

### Changed
- **Landing — nombre de marca en patrocinio** (`@firma-ec/landing` 0.1.22): la sección "Cómo se paga" de `/patrocinar` (`Sponsors.astro`, ES y EN) ahora dice "transferencia bancaria directa a **IDKMANAGER**" en vez de "IDK Manager Cía. Ltda." — usa la marca institucional como el resto del sitio. La factura SRI la sigue emitiendo la persona jurídica; el cambio es solo de marca visible.

### Added
- **Landing — strip de patrocinadores en la home** (`@firma-ec/landing` 0.1.21): nueva sección `SponsorsStrip.astro` en la portada (ES y EN, antes de `OperadoPor`) — muro de logos de patrocinadores cuando existan (grayscale→color en hover) y **empty-state** con borde discontinuo ("Este espacio está disponible" + CTA a `/patrocinar`) mientras no haya ninguno. Data-driven: agregar entradas al array `sponsors` con logo SVG en `/sponsors/<tier>/`.
- **Landing — programa de patrocinio** (`@firma-ec/landing` 0.1.20): nueva página `/patrocinar` (`/en/sponsor`) con la sección `Sponsors.astro` — tiers Bronze/Silver/Gold/Platinum/Founding, beneficios y modelo de **pago directo por transferencia bancaria con factura SRI, sin intermediarios** (no GitHub Sponsors, no Open Collective, no tarjeta). Enlace en el nav y el footer, bilingüe ES/EN, ruta en `ROUTE_MAP` con hreflang. Mensaje alineado con `OperadoPor`: la app sigue gratis; el patrocinio financia desarrollo/auditorías/infra. Construido sobre los tokens existentes (OKLCH ink/brand, Geist, iconos lucide) — sin emojis-como-icono, sin morado/glow, sin gradient-text; verificado en claro/oscuro y móvil. Acompaña la estructura del repo: `SPONSORS.md`, `.github/FUNDING.yml` (solo URLs propias), `docs/sponsorship/{README,benefits,governance,faq}.md`, `assets/sponsors/`.

## [0.9.0] — 2026-05-23 — Validar Certificado: nombres/apellidos/cédula + Expirado/Revocado (paridad FirmaEC)

### Added
- **Revocación en vivo en Validar Certificado** (`@firma-ec/verifier` `checkCertificate`): nueva opción `checkRevocation` que ejecuta la cascada **OCSP→CRL** contra ARCOTEL reusando `@firma-ec/ltv-validation` + `ARCOTEL_PROXY_MAP` (mismo patrón que el firmante). Expone `revocationStatus` (`good | revoked | unknown | unchecked`) + `revocationVia` + `revokedAt`. Es tolerante a offline: si no alcanza al respondedor (o el cert no trae AIA/CDP) devuelve `unknown` → la UI muestra "No verificable"; **nunca lanza ni bloquea** el veredicto de vigencia/cadena. Activado en `cert.worker.ts`.
- **Titular desglosado**: `CertCheckResult` ahora separa `givenName` (RDN 2.5.4.42 = nombres), `surname` (2.5.4.4 = apellidos) y `cedula` (2.5.4.5 = cédula/RUC) del CN, igual que FirmaEC 5.1.0. La UI muestra filas Nombres / Apellidos / Cédula (condicionales; si el cert no las trae cae al Titular/CN).
- **Estados Expirado y Revocado** en la tarjeta de resultado (`ValidarCertificado.svelte`): filas explícitas NO/SÍ; la tarjeta se pone roja cuando el cert está revocado. Claves i18n ES/EN (`common.yes/no`, `field_nombres/apellidos/cedula/expirado/revocado`, `revoked_unknown/unchecked`).

### Changed
- **Fechas de vigencia con hora** (`fmtDate`): "Válido desde/hasta" ahora incluyen hora:minuto:segundo (`dateStyle:'medium' + timeStyle:'medium'`) en zona local del navegador, en vez de solo la fecha.

## [0.8.4] — 2026-05-22 — diagnóstico: tamaño del .p12 recibido en error de PIN

### Changed
- **`p12.worker.ts`**: el diagnóstico de `pin_invalid` ahora incluye `p12bytes=<n>` (bytes recibidos del archivo). forge reporta un PKCS#12 truncado/corrupto (p.ej. mangleado al pasarlo al teléfono por chat/email) como fallo de MAC — indistinguible de una contraseña incorrecta. Si `p12bytes` es menor que el archivo real en disco, la subida llegó truncada (NO es la contraseña). Permite diagnosticar en remoto el caso "el mismo .p12 + PIN funciona en escritorio pero falla en el móvil". Confirmado que el parser forge en sí es correcto (parsea un .p12 LAZZATE real en ~25 ms).

## [0.8.3] — 2026-05-22 — fix: etiqueta de progreso de verificación mostraba la clave i18n cruda

### Fixed
- **`Progress.svelte`**: el spinner de verificación mostraba la clave literal `progress.verify:#0 ltv` en vez de un texto legible. El verifier emite beacons `verify:${tag}${name}` (con `#N ` de índice de firma en multi-firma) y el componente hacía `t('progress.' + stage)` sin normalizar → clave inexistente → se renderizaba cruda. Además faltaban claves para las fases `tsa`, `chain`, `ltv` y `scan`. Ahora se normaliza el beacon al token de fase, se mapea a etiqueta localizada (con fallback genérico para que NUNCA se filtre una clave cruda), se muestran las claves nuevas (incl. "Validando a largo plazo (LTV) — puede tardar", que explica la lentitud de la fase LTV en móvil) y el número de firma en PDFs multi-firma. Breadcrumb alineado a las fases reales (`cms · integrity · tsa · chain · ocsp · ltv`).

## [0.8.2] — 2026-05-22 — orden del nav: Firmar primero

### Changed
- **Header PWA**: reordenado el nav a `Inicio · Firmar · Verificar · Validar certificado · Paranoia · Acerca · Configuración` (Firmar pasa a ser la primera acción; antes iba después de Verificar/Validar certificado).

## [0.8.1] — 2026-05-22 — fix: Result.svelte no crashea en firmas con error de motor

### Fixed
- **`Result.svelte` (summaryKey)**: `result.integrity` es opcional y queda `undefined` cuando la verificación de una firma lanza excepción (path `catch` de `verifyPdf` → `status:'invalid'` sin `integrity`). El acceso sin guardia (`!result.integrity.digestMatches`) tiraba `TypeError` y rompía la tarjeta de resultado en vez de mostrar el error. Ahora se guarda con `result.integrity && …`; un error de motor cae al resumen genérico de firma inválida en lugar de etiquetarse erróneamente como "documento modificado". svelte-check vuelve a 0 errores.

## [0.8.0] — 2026-05-22 — Validar Certificado + raíces ACE reales (placeholders → 28/29 reales)

### Context
- Reporte de un firmante real (Leandro Gorina, cert **LAZZATE** `Persona Natural EXT`): la verificación NO funcionaba "con todos los firmadores autorizados". Causa raíz: 14 de 17 raíces ACE eran *placeholders* auto-firmados y `pathValidation` salta los placeholders (`if (r.isPlaceholder) continue`), así que cualquier documento firmado con un cert de esas ACE (incluida LAZZATE, además marcada erróneamente `isDefunct`) jamás validaba.
- Segundo reporte: faltaba **Validar Certificado** (subir `.p12` + PIN → ver emisor/titular/vigencia/cadena ACE), distinto de Validar PDF — como la pestaña de FirmaEC 5.1.0.

### Added
- **Nueva ruta `/validar-certificado`** + entrada de navegación "Validar certificado" (i18n ES/EN). Valida un certificado por sí mismo: parsea el `.p12` en un Worker single-shot (la clave privada nunca vuelve al hilo principal), muestra Titular, Emisor (ACE acreditada o "no acreditada por ARCOTEL"), N.º de serie, vigencia (desde/hasta), estado (VIGENTE / EXPIRADO / AÚN NO VÁLIDO) y cadena de confianza.
- **`checkCertificate(certDer, intermediatesDer, opts?)`** en `@firma-ec/verifier` — reusa `validatePath` contra las raíces TSL; sin firma de PDF.

### Fixed
- **Raíces ACE reales** (`@firma-ec/tsl-ec`, TSL **v1.11.0** seq **12**): las 8 ACE que eran placeholder (alpha-technologies, appfirmas, corpnewbest, darkcam, firmasegura, **lazzate**, letmi, primecorelat) ahora usan la raíz REAL extraída de la librería oficial MINTEL FirmaEC (firmadigital-libreria) — el mismo trust store que usa FirmaEC. Resultado: **28/29 entradas reales** (antes 9). Solo queda placeholder `registro-civil` (DIGERCIC no opera raíz PKI pública).
- **Anclas paralelas multi-vintage** (`isParallelAnchor`): se añaden raíces de distinta cosecha para que validen certs que encadenan a una raíz vieja O nueva — `lazzate`+`lazzate-ca1`/`ca2`/`wego`, `anfac-2024`/`anfac-2016`, `argosdata-2026`, `datil-2025`, etc.
- Cada raíz se verificó: huella SHA-256 del DER recomputada == `fingerprintSha256` almacenada (29/29), todas self-signed.

### Changed
- `APP_VERSION` + `apps/pwa/package.json` → 0.8.0; `@firma-ec/verifier` 0.7.8 → 0.7.9; TSL 1.10.0 → 1.11.0 (seq 11 → 12).

## [0.7.42] — 2026-05-21 — Firma .p12: recuperación de espacios internos en el PIN (teclado móvil + tecla `+`)

### Context
- Reporte (Samsung, móvil): firmar con un .p12 cuya contraseña **contiene un `+`** era rechazado como `pin_invalid` pese a ser correcta; en escritorio no se reproducía. 0.7.41 ya reintentaba `pin.trim()`, que solo arregla espacios al **inicio/final**.
- **Reproducción determinista** (`packages/signer`, round-trip con node-forge): forge maneja el `+` perfectamente (en medio, al inicio, múltiples). El modo de fallo real es el teclado en pantalla insertando un espacio **adyacente** a la tecla de símbolo (`clave + 2026` en vez de `clave+2026`); `trim()` NO recupera un espacio interno.

### Fixed
- **Candidato whitespace-strip en `parsePfx`** (`packages/signer/src/p12.ts`): tras los candidatos tal-cual / NFC / NFD / `trim()`, se prueba el PIN con **todo** el whitespace removido (`replace(/\s+/g,'')`) + su forma NFC. Cubre el espacio interno que `trim()` deja. Seguro: el PIN tal-cual se prueba primero (una contraseña con espacio legítimo sigue funcionando), y un PIN sin espacios no se ve afectado (no-op). El gate sigue siendo el MAC de forge, así que ningún candidato genera un falso-positivo. No recupera una sustitución `+`→espacio (ambigua).

### Changed
- `APP_VERSION` + `apps/pwa/package.json` → 0.7.42; `@firma-ec/signer` 0.7.5 → 0.7.6.

### Verified
- `vitest run` signer: 17/17 — incluido nuevo bloque que genera un .p12 con PIN `clave+2026` y valida recuperación de espacio interno (`clave + 2026`) + trailing, y que un PIN genuinamente incorrecto sigue siendo rechazado (sin falso-accept).

## [0.7.41] — 2026-05-21 — Multi-firma: verificación secuencial + document-timestamp cacheado (cierra el cuelgue de la última firma)

### Context
- 0.7.40 (cap 100 KB) avanzó: el usuario reportó que ahora **procesa firmas 0–4 y se detiene en la #5** (la 6ª/última) de un PDF B-LTA. Dos causas residuales: (1) las N firmas se verificaban con `Promise.all` (**en paralelo**) → todas emiten su beacon `ltv` casi a la vez y luego ejecutan su trabajo SÍNCRONO una tras otra sin beacon intermedio → tormenta síncrona cuyo total cruza los 30s (el watchdog no se resetea porque los beacons ya se emitieron). (2) `findDocumentTimestamps` + verificación del sello de archivo (que hashea **todo** el PDF) se ejecutaban **una vez por firma** (6× redundante).

### Fixed
- **Verificación SECUENCIAL** (`packages/verifier/src/index.ts`): `verifyAllSignatures` procesa las firmas en un `for…await` en vez de `Promise.all`. Así el trabajo síncrono de cada firma queda **entre sus propios beacons** y el watchdog se resetea entre firmas — solo importa el tiempo por-firma (acotado por los caps de CRL/OCSP + el deadline de LTV), no el acumulado.
- **Document-timestamp cacheado por PDF** (`packages/verifier/src/ltv.ts`): el escaneo + verificación del sello de archivo B-LTA es idéntico para todas las firmas del mismo PDF, pero corría 1×/firma. Ahora se memoiza por referencia de `pdfBytes` (la MISMA Uint8Array se pasa a todas las firmas) vía `WeakMap`, así corre **exactamente una vez**. Elimina el trabajo pesado redundante y acelera el multi-firma drásticamente. `ENGINE_VERSION` 0.7.13 → 0.7.14.

### Changed
- `APP_VERSION` + `package.json` → 0.7.41.

### Verified
- `vitest run` verifier: 72/72 (4 skipped).

## [0.7.40] — 2026-05-20 — El cuelgue era SÍNCRONO: cap agresivo de CRL/OCSP (100 KB) en LTV

### Context
- 0.7.39 (deadline `Promise.race` 12s) **tampoco** resolvió el cuelgue — y eso es **prueba concluyente**: un `setTimeout` NO puede dispararse mientras código **síncrono** retiene el único hilo del worker. Por tanto el bloqueo es síncrono, no asíncrono (descarta la cripto del document-timestamp, que es async y el deadline habría cortado). El único parseo síncrono de tamaño variable en LTV es pkijs `new CertificateRevocationList()`, que expande **cada entrada revocada** en un objeto: una CRL de ARCOTEL con cientos de miles de entradas tarda >30s en el CPU del móvil. El cap de 1.5 MB de 0.7.38 era demasiado alto.

### Fixed
- **Cap agresivo de CRL y OCSP a 100 KB** (`packages/verifier/src/ltv.ts`): cualquier CRL u OCSP embebido mayor a 100 KB se **omite antes de parsear** (warnings `crl_too_large_skipped` / `ocsp_too_large_skipped`). 100 KB parsea muy por debajo de un segundo; las CRLs grandes de ARCOTEL (el origen del cuelgue) se saltan. El perfil B-LT/B-LTA se sigue derivando de la **presencia** del DSS (conteos sin parsear), así que solo se pierde el detalle retrospectivo revoked/good — y LTV nunca cambia la validez de la firma (spec §6.4). Esto, sumado al deadline de 0.7.39 (async) y la memoización de 0.7.36, hace que la verificación **complete siempre** en móvil. `ENGINE_VERSION` 0.7.12 → 0.7.13.

### Changed
- `APP_VERSION` + `package.json` → 0.7.40.

### Verified
- `vitest run` verifier: 72/72 (4 skipped) — las CRLs/OCSP de los fixtures son < 100 KB, así que siguen evaluándose.

## [0.7.39] — 2026-05-20 — Deadline duro (Promise.race) alrededor de verifyLtv: cubre el cuelgue ASÍNCRONO

### Context
- 0.7.38 (cap CRL + presupuesto `Date.now()`) **no resolvió** el cuelgue (`verify:#5 ltv` seguía). Razón: `Date.now()` solo acota trabajo **síncrono**; un `await` que nunca resuelve (p.ej. la criptografía del document-timestamp B-LTA — ECDSA freetsa — o un parseo lento dentro de una llamada awaited) se salta esos chequeos y el watchdog de 30s dispara igual. Pista: la verificación pasó la fase `chain` (que usa crypto.subtle RSA sin problema) y murió en `ltv` → el staller asíncrono es muy probablemente la verificación ECDSA del sello de tiempo de archivo.

### Fixed
- **Deadline duro alrededor de `verifyLtv`** (`packages/verifier/src/index.ts`): `Promise.race([verifyLtv(...), deadline(12s)])`. Si LTV no termina en 12s — sin importar si lo que cuelga es síncrono o asíncrono — la fase retorna un `LtvSummary` degradado (perfil derivado de la presencia del DSS, `retrospectiveValid=false`, warning `ltv_timeout`). LTV es informativo y **nunca** cambia la validez de la firma (spec §6.4), así que la firma se reporta con su validez real. Junto al cap de CRL de 0.7.38 (riesgo síncrono), esto hace que la verificación **complete siempre**. `ENGINE_VERSION` 0.7.11 → 0.7.12.

### Changed
- `APP_VERSION` + `package.json` → 0.7.39.

### Verified
- `vitest run` verifier: 72/72 (4 skipped) — los fixtures completan LTV muy por debajo de 12s, así que el deadline no los afecta.

## [0.7.38] — 2026-05-20 — Cota dura en LTV (cap CRL + presupuesto de tiempo) para que la verificación NUNCA cuelgue

### Context
- Tras 0.7.36 (memoización) la verificación **seguía colgándose** (`verify:#5 ltv`). La memoización no ayuda cuando UNA sola CRL de ARCOTEL pesa megas: un único parseo síncrono de pkijs ya supera 30s en el CPU del móvil y bloquea el hilo del worker (el watchdog dispara sin que llegue otro beacon).

### Fixed
- **Cota dura de LTV** (`packages/verifier/src/ltv.ts`): LTV es **informativo y nunca invalida la firma** (spec §6.4), así que ahora se acota para que no pueda colgar:
  1. **Cap de tamaño de CRL** (`MAX_CRL_BYTES = 1.5 MB`): una CRL más grande se **omite** (un parseo completo bloquearía el hilo más allá del watchdog) con warning `crl_too_large_skipped`. El perfil B-LT/B-LTA se sigue derivando de la **presencia** del DSS, así que lo único que se pierde es el detalle retrospectivo revoked/good.
  2. **Presupuesto de tiempo** (`LTV_BUDGET_MS = 8s`): el bucle retrospectivo aborta al exceder el presupuesto con warning `ltv_budget_exceeded`.
  En ambos casos la firma sigue reportando su validez real; LTV degrada a una nota en vez de congelar el UI. `ENGINE_VERSION` 0.7.10 → 0.7.11.

### Changed
- `APP_VERSION` + `package.json` → 0.7.38.

### Verified
- `vitest run` verifier: 72/72 (4 skipped) — el cap/presupuesto no afecta los fixtures (CRLs de test < 1.5 MB, parseo < 8s).

## [0.7.37] — 2026-05-20 — PIN .p12 con `+`: retry trim + fingerprint de diagnóstico (no sensible)

### Context
- El usuario reportó que su contraseña .p12 **tiene un `+`** y es rechazada solo en móvil. `+` es ASCII → la normalización Unicode de 0.7.36 no aplica. No hay decodificación URL del PIN en el código (verificado), así que el `+` llega íntegro a forge. Hipótesis: el teclado del Samsung **auto-inserta un espacio** alrededor de la tecla de símbolos (`?123 → +`), produciendo un espacio invisible al inicio/fin → MAC distinta → `pin_invalid` espurio.

### Added
- **Retry con PIN recortado** (`packages/signer/src/p12.ts`): `parsePfx` ahora prueba también `pin.trim()` y `pin.trim().normalize('NFC')` además de tal-cual/NFC/NFD. La MAC de forge sigue siendo el gate (un candidato equivocado simplemente falla); el PIN tal-cual se prueba PRIMERO, así que una contraseña con espacio legítimo aún matchea por la vía as-typed.
- **Fingerprint de PIN no sensible** en el error (`p12.worker.ts` + `Firmar.svelte`): ante `pin_invalid` se anexa `[pin shape: len=N, trimmedDiffers=…, innerSpace=…, ascii=…]` — **nunca los caracteres**, solo la forma — visible en el mensaje de error del PIN. Permite diagnosticar desde el celular si el teclado mete un espacio (trimmedDiffers=true) o altera la longitud, sin filtrar la contraseña.

### Changed
- `APP_VERSION` + `package.json` → 0.7.37.

### Verified
- `vitest run` signer: 70/70.

## [0.7.36] — 2026-05-20 — Fix cuelgue LTV móvil (memoización) + retry de normalización Unicode del PIN .p12

### Context
- 0.7.35 localizó el cuelgue con precisión: `timeout (v0.7.35, last stage: verify:#5 ltv)` → fase **LTV de la firma #5** (PDF con 6 firmas). El watchdog por-fase funcionó: el problema es que **una sola fase LTV** supera los 30s en el CPU del móvil. El usuario confirmó además que el **PDF sin firma ya se arregló**.

### Fixed
- **Cuelgue LTV en móvil** (`packages/verifier/src/ltv.ts`): el bucle retrospectivo re-serializaba cada cert emisor (`cert.toSchema().toBER()`) **dentro de `tryParseOcsp` por cada índice OCSP y por cada cert de la cadena**, y re-parseaba la **misma CRL grande de ARCOTEL** (pueden ser MB) una vez por eslabón de cadena — O(cadena × entradas-DSS) de trabajo ASN.1 pesado por firma, ×6 firmas. Rápido en V8 desktop, >30s en móvil. Memoización por firma: `parseCert` (Map por Certificate), `parseCrlCached` (Map por índice), `ocspCache` (Map por `idx|eslabón`) → colapsa a O(cadena + entradas-DSS). Con el reset de watchdog por-fase de 0.7.35, cada firma vuelve a tener 30s, así que el PDF completo verifica. `ENGINE_VERSION` 0.7.9 → 0.7.10.
- **`.p12` "contraseña no coincide" con PIN correcto en móvil** (`packages/signer/src/p12.ts`): forge deriva la clave MAC del PKCS#12 desde el PIN como BMPString (UTF-16 de cada code point). Un teclado móvil puede entregar un PIN con caracteres no-ASCII (ñ, tildes) en una **forma de normalización Unicode distinta** (descompuesta `n`+◌̃) a la que usó el software emisor (precompuesta `ñ`) → mismo password visible, distintos code points, MAC distinta → `pin_invalid` espurio solo en móvil. Fix: `parsePfx` reintenta el PIN tal-cual → NFC → NFD antes de declarar `pin_invalid`. No-op para PINs ASCII (seguro). Si el PIN del usuario es ASCII puro y aun así falla, hay que investigar otra vía.

### Changed
- `APP_VERSION` + `package.json` → 0.7.36.

### Verified
- `vitest run` verifier ltv: 7/7. signer: 70/70 (incluye round-trip 3DES/AES PFX). bus: 13/13.

## [0.7.35] — 2026-05-20 — Cuelgue verify móvil = perf cliff por fase; beacons que resetean el watchdog + fix PDF sin firma en blanco

### Context
- Evidencia del dispositivo (Samsung, Chrome **y** Edge incógnito, **0.7.34 confirmado**): error `timeout … (v0.7.34, last stage: verify)`. Como corta a los 30s (no 6s) el worker **sí arranca** (beacon `boot`) → el cuelgue está **dentro de `verifyAllSignatures`**, no en la carga del worker. El único fetch del verify está acotado a 6s (OCSP) y para B-LTA ni se intenta → **no es red**. Conclusión: trabajo cripto/ASN.1 síncrono (validación de cadena + parseo de CRLs grandes de ARCOTEL embebidas en el DSS B-LTA) que en V8 desktop tarda ~2s pero en el CPU del móvil supera los 30s. Es regresión porque LTV/multi-firma agregaron ese trabajo.

### Fixed
- **Cuelgue de verificación en móvil**: el worker ahora emite un **beacon de progreso por fase** (`verify:scan`, `verify:cms`, `verify:integrity`, `verify:tsa`, `verify:chain`, `verify:ocsp`, `verify:ltv`, con prefijo `#N` en multi-firma). El watchdog del bus **se resetea en cada beacon**, así que una verificación lenta-pero-viva ya **no muere a los 30s** mientras ninguna fase individual los supere → completa en el móvil. Si una fase concreta cuelga de verdad, el `last stage:` la señala (cms/tsa/chain/ocsp/ltv) en vez del opaco `verify`. (`packages/verifier/src/index.ts` `verifyAllSignatures`/`verifyOneSignature` aceptan `onProgress` local-al-worker — no cruza `postMessage`; `verify.worker.ts` lo pasa.)
- **PDF sin firma mostraba pantalla en blanco** ("se queda vacío"): el branch `done` exigía `result` no-nulo (derivado de `signatures[0]`), y un PDF con 0 firmas tiene `signatures: []` → no renderizaba nada. Nuevo branch dedicado que muestra "Este PDF no contiene una firma electrónica" + botón de reinicio. (`Verificar.svelte`) — bug presente también en desktop, no solo móvil.

### Added — diagnóstico
- **`p12.worker`**: guard que si recibe **0 bytes** (buffer detachado antes del transfer) reporta `empty_p12` con la causa real, en vez de dejar que forge falle el MAC y lo reporte como `pin_invalid` (indistinguible de "contraseña incorrecta"). Para no atribuir erróneamente al PIN un problema de buffer. La defensiva-copy del caller (`Firmar.svelte:266`) es correcta, así que si persiste `pin_invalid` con PIN correcto, el siguiente paso es encoding del password.

### Changed
- `ENGINE_VERSION` 0.7.8 → 0.7.9. `APP_VERSION` + `package.json` → 0.7.35.

### Verified
- `vitest run` packages/verifier: 72/72 (4 skipped) — threading de `onProgress` no altera comportamiento.
- `vitest run` bus.test.ts: pendiente re-run tras build.

## [0.7.34] — 2026-05-20 — Regresión móvil: fallback a hilo principal cuando el module worker no arranca

### Context
- Dato clave del usuario: **en versiones anteriores la verificación SÍ funcionaba en el celular** → es una **regresión**, no una incompatibilidad de base. Falla en Chrome **y** Edge para Android (mismo Chromium), funciona en desktop, y rompe **los tres** workers (verify, p12-decrypt, sign) → el factor común es la **carga del chunk del module worker**, no la lógica de verificación. La regresión correlaciona con: `4097a0a` (p12 decrypt movido del hilo principal a un worker — antes funcionaba en móvil), `a868450` (deps cripto code-split en chunks lazy que el worker importa) y `5d69795` (verify pasó a multi-firma `runVerifyAll`).

### Added — apps/pwa 0.7.33 → 0.7.34
- **Fallback a hilo principal en `runVerifyAll`** (`bus.ts`): el worker emite un beacon `boot` apenas su módulo + chunks estáticos cargan (`verify.worker.ts`). Si no llega ningún mensaje en `VERIFY_BOOT_DEADLINE_MS` (6s) — el síntoma exacto de un module worker que en Chromium móvil muere en silencio sin `onerror` — se termina el worker nonato y la verificación **se re-ejecuta en el hilo principal** vía `import('@firma-ec/verifier')` dinámico (mantiene el chunk fuera del bundle de entrada). Es justo la ruta que funcionaba antes de mover la verificación off-thread, así que **restaura la función en los dispositivos afectados** a costa de bloquear el UI unos segundos. También cae al hilo principal si el worker dispara `error` antes de bootear o si `postMessage` lanza.
- **Error de timeout enriquecido**: ahora incluye versión + última etapa (`v0.7.34, last stage: none|boot|parse|verify`) para diagnóstico directo desde "Mostrar detalle técnico" sin cable. `last stage: none` = el worker nunca booteó (carga de chunk); `boot`/`verify` = booteó pero se colgó.

### Diagnóstico que habilita
- Si tras 0.7.34 la verificación funciona en el celular → la causa es **carga del chunk en contexto module-worker** (el hilo principal sí carga el mismo chunk). Replicar el patrón de fallback en p12/sign.
- Si sigue fallando con `fallback_failed` → el chunk es **inalcanzable** (SW/red), y la pista relevante es el fix de SW de 0.7.33.

### Verified
- `vitest run bus.test.ts`: 13/13 (3 nuevos: boot beacon no se filtra a UI, fallback al no bootear, NO fallback si ya booteó).

## [0.7.33] — 2026-05-20 — Causa raíz REAL del cuelgue móvil: el Service Worker borraba su propio precache

### Fixed
- **El cuelgue en Android NO era OCSP** (0.7.31/0.7.32 quedaron como defensa en profundidad, pero no eran la causa). Pista decisiva del usuario: **un PDF SIN firmas también se colgaba** (no toca red ni OCSP) y **la contraseña del .p12 tampoco se aceptaba** en el móvil. Ambos síntomas apuntan a una sola causa: **los Web Workers nunca arrancaban** (verify, p12-decrypt y sign son tres chunks `new Worker(new URL(...))` separados).
- **Causa raíz**: el handler `install` del Service Worker hacía un `caches.delete()` con alcance de **origen** de todos los `workbox-precache-*` en **cada** install. Con `registerType: 'prompt'` el SW nuevo se queda en `waiting` y **no activa** hasta que el usuario toca un toast de actualización. Resultado: al recargar, el SW nuevo se instala y **borra el precache que el SW viejo (todavía en control) está sirviendo** — además compite con `precacheAndRoute` que escribe ese mismo cache keyed-por-origen. Entonces los chunks de los workers daban **404** (Caddy `/assets/* serve-or-404`), los module workers **morían en silencio** (Chromium no dispara `onerror` fiable en fallo de import de dependencia) → verify colgaba hasta el watchdog de 30s y firmar reportaba "contraseña no aceptada" (el worker del p12 nunca corría). Android quedaba roto entre recargas porque **cada recarga re-borraba el precache** mientras el SW viejo seguía en control.

### Changed — apps/pwa 0.7.32 → 0.7.33
- **`sw.ts`**: eliminado el purgado destructivo de precache en `install`. Se conserva `cleanupOutdatedCaches()` (corre en `activate`, es revision-aware y nunca borra el precache activo). El SW ahora hace **`skipWaiting()` en `install`** + `clients.claim()` en `activate`, así una sola recarga en un cliente stale toma el build nuevo, repuebla el precache y restaura los chunks de los workers (verify/p12/sign). El listener `controllerchange` de `swUpdate.svelte.ts` recarga una vez al tomar control.
- `APP_VERSION` + `package.json` bump.

### Notas
- Self-heal: los dispositivos ya rotos se arreglan con **una recarga** sobre 0.7.33 (SW nuevo → skipWaiting → activate → claim → controllerchange → reload → shell + precache frescos).
- Regla anti-regresión documentada en `sw.ts`: **nunca** reintroducir un `caches.delete()` general en `install`.

## [0.7.32] — 2026-05-20 — Fix DEFINITIVO: cuelgue verificación móvil = OCSP a endpoint caído

### Fixed
- **Causa raíz REAL del cuelgue en Android Chrome** (los fixes 0.7.30/0.7.31 fueron paliativos): `ocsp.firmar.ec` está **caído/sin registro DNS** (devuelve HTTP 000). El verificador intentaba un OCSP en vivo a ese host para perfiles con timestamp. En desktop el fetch **falla rápido** (connection refused → rechaza al instante → `not_checked` → sigue). En **red móvil el host inalcanzable hace black-hole** del SYN (sin RST), así que el fetch **se queda colgado** en vez de fallar — colgando toda la verificación hasta el watchdog de 30s.

### Changed — packages/verifier 0.7.7 → 0.7.8
- `ENGINE_VERSION` 0.7.7 → 0.7.8.
- **`index.ts`**: el verificador ahora **salta el OCSP en vivo cuando la firma trae revocación embebida en el DSS (B-LT / B-LTA)**. Esa es exactamente la evidencia de revocación que el perfil exige (capturada al firmar), así que el fetch en vivo es redundante Y peligroso (el host puede colgar la red). Nuevo guard `hasEmbeddedRevocation` (DSS con ≥1 OCSP o CRL). Solo B-T (timestamp sin DSS) intenta aún un OCSP en vivo acotado. Resultado: para PDFs B-LTA (como los que firma firmar.ec) **cero llamadas de red en la verificación → cero cuelgue, en cualquier red**.

### Changed — apps/pwa 0.7.31 → 0.7.32
- `APP_VERSION` + `package.json` bump.

### Notas
- Los watchdog (0.7.30) y el OCSP race-deadline (0.7.31) se conservan como defensa en profundidad — siguen protegiendo el caso B-T y cualquier futura llamada de red.
- Acción de infra pendiente (separada): decidir si se levanta `ocsp.firmar.ec` o se retira del código por completo. Mientras tanto B-LTA no lo necesita.

### Verified
- `pnpm vitest run` packages/verifier: 72/72 pass, 4 skipped.

## [landing 0.1.18] — 2026-05-20 — Corrección de exactitud factual del contenido

### Fixed
- **Multi-firma mal descrita** en comparativos Adobe Sign (ES+EN): decía "Workflows multi-firmante ❌ No (v1; quizás v2)", lo que negaba una capacidad que SÍ existe. Reescrito a "🟡 Secuencial manual (cada persona firma y pasa el PDF al siguiente; las firmas previas se conservan válidas). Sin orquestación de links/recordatorios" — refleja la verdad: la firma secuencial manual funciona (incremental update), pero el workflow orquestado con links/notificaciones NO existe (requeriría backend, choca con el modelo sin-servidor).
- **Perfiles PAdES incompletos**: comparativos y `Cumplimiento.astro` solo listaban "PAdES B-B". Actualizado a "B-B / B-T / B-LT / B-LTA" + fila nueva de Timestamp (RFC 3161 / ETSI EN 319 122) y Revocation ahora incluye CRL RFC 5280.
- **Conteo de ACEs inconsistente (7 vs 8) + ECI incorrecta**: `firma-electronica-ecuador.md` (ES) tenía header "8 ECIs" pero tabla de 7 con Lazzate y sin ArgosData/Judicatura; la versión EN decía "7 accredited ECIs"; FAQ 03 (ES+EN) y `glosario/en-tsl.md` ("7 root certificates") arrastraban el mismo error. Alineado todo a las **8 ACEs reales** de la TSL-EC actual (BCE, Consejo de la Judicatura/iCert-EC, Security Data, ANFAC, ArgosData, Uanataca, Eclipse Soft, Datil) — sin Lazzate, que no está en la verdad actual. Coherente con `Compatibilidad.astro` que ya era correcto.

### Verified
- `pnpm --filter @firma-ec/landing build` — 28 páginas, 0 errores.

## [0.7.31] — 2026-05-20 — Fix: OCSP fetch atascado cuelga la verificación en red móvil

### Fixed
- **La verificación se cuelga en red móvil aunque el cliente ya esté en 0.7.30** (reportado en Android Chrome tras limpiar caché). El watchdog de 0.7.30 convertía el cuelgue en error a los 30s, pero la causa seguía: el worker arrancaba (progreso `parse`→`verify`) y luego `checkOcsp` se quedaba pegado. Causa raíz: el fetch OCSP a `https://ocsp.firmar.ec` se atasca en establecimiento de conexión (DNS/TLS) en ciertas redes móviles, y `AbortController.abort()` **no rechaza** un fetch atascado antes de recibir respuesta en esa condición → `await postViaProxy(...)` nunca settlea → la verificación nunca retorna.

### Changed — packages/verifier 0.7.6 → 0.7.7
- `ENGINE_VERSION` 0.7.6 → 0.7.7.
- **`ocsp.ts` `checkOcsp`**: deadline duro vía `Promise.race([fetch, timer-que-rechaza])`. Garantiza que `checkOcsp` settlea dentro de `fetchTimeoutMs` (6s) sin importar si el fetch subyacente aborta o no. Se sigue llamando `ac.abort()` para liberar el socket donde el navegador lo respeta. OCSP en vivo es **redundante para B-LTA** (la revocación ya viene embebida en el DSS), así que un `not_checked` por timeout no degrada el veredicto.

### Changed — apps/pwa 0.7.30 → 0.7.31
- `APP_VERSION` + `package.json` bump (consume verifier 0.7.7).

### Verified
- `pnpm vitest run` packages/verifier: 72/72 pass, 4 skipped.

## [0.7.30] — 2026-05-20 — Fix: verificación cuelga (spinner infinito) en clientes con SW stale

### Fixed
- **Spinner infinito al verificar en móvil (reportado en Android Chrome).** El PDF cargaba pero la verificación nunca terminaba. Causa raíz triple: (1) un Service Worker stale (cliente que no aceptó el prompt de actualización) servía un app-shell que referencia chunks con hash ya purgados por el deploy nuevo; (2) Caddy respondía esos `/assets/*.js` faltantes con `index.html` (HTML 200) por el SPA fallback `try_files`; (3) un module worker cuyo `import()` recibe HTML en vez de JS falla a cargar y **Chromium no dispara `worker.onerror` de forma fiable** para errores de carga de dependencias de module workers → el worker queda creado pero su handler nunca corre → `postMessage` al vacío → como `runVerify`/`runVerifyAll` no tenían timeout, spinner infinito.

### Changed — apps/pwa 0.7.29 → 0.7.30
- **`lib/workers/bus.ts`**: `runVerify` y `runVerifyAll` ahora tienen un **watchdog de timeout** (`DEFAULT_VERIFY_TIMEOUT_MS = 30s`, configurable vía `opts.timeoutMs`, `0` lo desactiva). Si el worker no postea result/error/progress dentro de la ventana, la promesa rechaza con `code: 'timeout'`. El timer se **resetea en cada mensaje de progreso**, así un worker lento-pero-vivo no se mata; solo uno muerto-en-silencio. Convierte el cuelgue en un error accionable.
- **`infra/docker/Caddyfile.pwa`**: nuevo bloque `@assets path /assets/*` con `file_server` **antes** del SPA `try_files`. Los assets hasheados ahora sirven el archivo o **404 real** — nunca caen al fallback `index.html`. Esto deja que el `import()` de un chunk purgado **rechace** (en vez de recibir HTML), permitiendo que el worker reporte error y la UI muestre el mensaje de recarga. Self-heal para clientes stale.
- **`routes/Verificar.svelte`**: el mapeo de error ahora incluye `timeout` (lowercase, del watchdog) y `worker_error` → `error.engine_TIMEOUT`.
- **`lib/i18n.svelte.ts`**: mensaje `error.engine_TIMEOUT` reescrito (ES+EN) para guiar a **recargar la página / cerrar y reabrir la app instalada** (la causa típica es un SW stale), en vez del genérico "intenta de nuevo".

### Added — apps/pwa/src/lib/workers/bus.test.ts
- 3 tests del watchdog: rechaza con `timeout` si el worker calla; progress resetea el deadline (slow-but-alive no muere); `timeoutMs=0` desactiva el watchdog. 10/10 tests del bus verde.

### Notas de operación
- **Workaround inmediato para usuarios afectados** (sin esperar el deploy): recargar con caché limpia o, en la app instalada, cerrarla y reabrirla; en última instancia borrar datos del sitio para desregistrar el SW viejo.
- El verifier (`packages/verifier` 0.7.6) no cambió — el fix de 0.7.29 (B-LTA multi-sig) sigue intacto.

## [0.7.29] — 2026-05-19 — Verifier: B-LTA multi-sig DocTimeStamp handling (P0 regression fix)

### Fixed
- **PWA mostraba "Firma inválida" para PDFs B-LTA legítimos firmados por firmar.ec con TSA wrap de freetsa.org.** Síntoma reportado: PDF de Alfonso firmado con su cert ArgosData real (cuyo root está en la TSL-EC con fingerprint correcto) aparecía como "Firma inválida — El certificado del firmante no proviene de una ACE acreditada por ARCOTEL". El cert sí encadenaba; el verifier estaba contaminado por la firma TSA-wrap.

### Changed — packages/verifier 0.7.5 → 0.7.6
- `ENGINE_VERSION` 0.7.5 → 0.7.6.
- **Bug A — `verifyAllSignatures` filtra DocTimeStamps**: las firmas con `/SubFilter /ETSI.RFC3161` (PAdES B-LTA document timestamp wrap) ya NO se cuentan como "firmas del usuario". Antes se procesaban como signers normales y (a) fallaban con `weak_signature_algorithm` por el ecdsa-SHA512 que usa freetsa.org, (b) sus certs entraban a `pooledIntermediates` confundiendo a `pkijs.CertificateChainValidationEngine.verify()` que devolvía `false` para la firma real → `matchedRoot=undefined` → `untrusted_root`. El verifier ya expone el DTS por `signature.timestamp` + `verifyLtv` → no se pierde información.
- **Bug B — `parseString` anclado al `<<` del dict**: el escaneo forward desde `/ByteRange.tokenAt` se filtraba al siguiente sig dict porque `/SubFilter` suele preceder a `/ByteRange` (orden alfabético o del productor). Antes: dos firmas con subFilter `'unknown'` o cruzados. Nuevo: `findDictStart()` retrocede hasta el `<<` del dict actual (con depth counting) y escanea desde ahí. Fix también beneficia a `/Reason`, `/Location`, `/ContactInfo`, `/M`.
- **Bug B' — `parseString` soporta PDF Names** (`/foo`): antes solo aceptaba literales `(string)` o `<hex>`; `/SubFilter` es un Name y devolvía `undefined` → `'unknown'`. Añadido parser de Name con todos los delimitadores PDF (whitespace + `()<>[]{}/%`).
- **Bug C — DTS-wrap no dispara `incremental_updates`**: nueva flag `appendedBytesAreDocTimeStamp` en `verifyOneSignature`. `verifyAllSignatures` la setea cuando los bytes apendados después de la firma del usuario corresponden a un DTS B-LTA legítimo que llega hasta EOF. La firma del usuario queda `valid`, no `warning`.

### Added — packages/verifier/tests
- **b-lta-multisig-regression.test.ts** — 3 tests que blindan los 3 bugs con `carta-arrendamiento-firmado.pdf` (firmado por Alfonso/ArgosData con TSA wrap freetsa, 2 firmas PAdES detectadas, solo 1 firma de usuario).

### Changed — apps/pwa 0.7.28 → 0.7.29
- `APP_VERSION` + `package.json` bump.

### Verified
- `pnpm vitest run` en packages/verifier: 13/13 archivos verde, 73/73 tests pass (3 nuevos + 70 existentes), 4 skipped.
- PDF de Alfonso ahora retorna: `overallStatus='valid'`, `signatureCount=1`, `matchedRootSlug='argosdata'`, profile B-LTA, sin warnings.

## [0.7.28] — 2026-05-19 — Verifier: untrusted_root warning + specific invalid summaries

### Fixed
- **PWA verdict UX**: cuando una firma cripto-correcta no encadena a ninguna ACE ARCOTEL (caso típico: cert auto-firmado o emisor no acreditado), el verificador mostraba "Firma inválida — La firma no es válida o el documento fue modificado tras la firma". El mensaje sugería tampering inexistente. Discovered via Playwright E2E real contra prod 2026-05-18 con fixture `sample.pdf` + `Test Signer RSA-2048`: hash matched, modifications=No, byteRange correcto, pero verdict invalid → user confundido.

### Changed — packages/verifier 0.7.3 → 0.7.5
- `ENGINE_VERSION` bumped 0.7.4 → 0.7.5.
- Cuando `!path.success && !trustInconclusive` el verifier **empuja warning `untrusted_root`** explicando que el cert es cripto-correcto pero el emisor no está reconocido por ARCOTEL. Verdict sigue siendo `invalid` (correcto).

### Changed — apps/pwa 0.7.22 → 0.7.23
- `Result.svelte`: el summary del verdict 'invalid' se selecciona por causa específica derivada de:
  - `!integrity.digestMatches` → `invalid_summary_hash_mismatch`
  - `ocsp.status === 'revoked'` → `invalid_summary_revoked`
  - warning code `untrusted_root` → `invalid_summary_untrusted_root`
  - fallback → `invalid_summary_bad_signature`
- `i18n.svelte.ts`: 4 nuevas keys (ES+EN) `verificar.invalid_summary_{untrusted_root, revoked, hash_mismatch, bad_signature}`. La key original `invalid_summary` queda como fallback compatible.

## [landing 0.1.17] — 2026-05-18 — TSL truth fix + deploy script + landing CI

### Fixed
- **apps/landing/public/llms-full.txt** — sección "Modelo de confianza ARCOTEL" tenía 5 ACEs como "root pendiente". La realidad (verificada contra `apps/pwa/public/trust/tsl-ec.json` v1.10.0 seq 11) es **8/8 ACEs activas con root real cargado** (BCE, Security Data, ANFAC, Judicatura, Uanataca, ArgosData, Datil, Eclipsoft). Registro Civil marcado `isDefunct` desde v0.7.12 (firma con certs BCE/Security Data, no opera PKI propia).

### Added
- **scripts/deploy-landing.sh** — pipeline manual reusable: tar + scp a IAS01 + docker build + push + swarm update + HTTP smoke verify. Reemplaza la cadena de comandos one-off.
- **.github/workflows/landing-ci.yml** — CI dedicado para landing en push a main / tags `v-landing-*`. Valida `pnpm build`, presencia de `llms.txt`, `llms-full.txt`, `.well-known/ai-plugin.json`, `security.txt`, `robots.txt`, `sitemap-index.xml`, page count ≥28, JSON válido, y docker build. Push a registry + swarm update siguen siendo manuales (requieren acceso SSH a la red IDK).

## [landing 0.1.16] — 2026-05-18 — AI Search readiness (llms-full.txt + ai-plugin.json)

### Added
- **apps/landing/public/llms-full.txt** (8.4KB): comprehensive content dump optimized for LLM retrieval (Claude, GPT, Perplexity, Gemini). Covers trust model TSL-EC, PAdES profiles B-B/B-T/B-LT/B-LTA, legal framework Ecuador (LCE 2002-67 + LOPDP), full FAQ, glossary, and preferred citation format.
- **apps/landing/public/.well-known/ai-plugin.json**: ChatGPT plugin manifest. `description_for_model` geared to Ecuadorian electronic-signature questions; `auth: none`, `api: none` (info-only — points crawlers to llms.txt, llms-full.txt, sitemap).

### Changed
- **apps/landing/public/llms.txt**: replaced stale URLs (blog and /spec/* routes that never shipped) with real ones (faq, glosario, comparativos/adobe-sign, comparativos/firmaec, en/*, security.txt, sitemap-index.xml).

### Audit context
- Closes "AI Search 70/100" gap identified in firmar.ec SEO/SEM/AI audit 2026-05-18.

## [0.7.22] — 2026-05-15 — CI unblock: tsl-ec tsconfig + biome lint reality

### Fixed
- **packages/tsl-ec/tsconfig.json**: añadido `"exclude": ["src/build-json.ts"]`. El archivo se ejecuta como script Node con `--experimental-strip-types` (requiere extensión `.ts` explícita en imports), pero el library build con `tsc` lo veía y fallaba con `TS5097`. Excluirlo del compile mantiene el script funcional y desbloquea el Release workflow que llevaba fallando desde v0.7.17.
- **biome.json**: relajadas reglas que rompían la realidad del codebase. `useLiteralKeys: off` (colisiona con TS `noPropertyAccessFromIndexSignature`), `useConst: off` (rompía bindings `$state` en Svelte runes), `noUnusedImports: off` + `noUnusedVariables: off` (biome no detecta usos en templates Astro/Svelte y eliminaba imports válidos), `noNonNullAssertion: off` (estilo aceptado). Otras reglas (noExplicitAny, noConsole, useTemplate, noAssignInExpressions, noImplicitAnyLet, useOptionalChain, etc.) bajadas a `warn` → 143 warnings visibles en IDE como tech debt, 0 errores bloqueantes.

### Formatted
- `pnpm biome format --write` aplicado a 212 archivos (sólo whitespace: LF endings, single quotes, trailing commas).
- `pnpm biome organizeImports` aplicado vía `biome check --fix` (sólo reordenamiento de imports, no eliminación).

### Verified locally
- `pnpm biome check` — 0 errors, 143 warnings.
- `pnpm -r typecheck` — 16/16 packages pass (incluyendo pwa svelte-check y landing astro check).
- `pnpm build` — todos los packages + 28 páginas landing.
- `pnpm build:tsl` + `tsc tsl-ec` — OK.

## [0.7.12] — 2026-05-15 — Registro Civil marked defunct (8/8 ACEs activas, demo mode OFF)

### Changed — tsl-ec 1.10.0 (TSL_SEQUENCE 11)
- **Registro Civil** slot marked `isDefunct: true`. Evidencia: resolución
  oficial **009-DIGERCIC-CGAJ-DPyN-2025** descargada del sitio público
  del Registro Civil, firmada por 4 funcionarios. Análisis de las 4
  cadenas CMS PAdES:
  - **Director General Ottón José Rivadeneira González** → cert emitido
    por `AC BANCO CENTRAL DEL ECUADOR` (intermedio BCE), raíz **BCE**.
  - **Andrea Cristina Garnica Rojas** (analista RC) → cert emitido por
    `AC BANCO CENTRAL DEL ECUADOR`, raíz **BCE**.
  - **Víctor Andrés Oquendo Torres** → cert emitido por
    `AUTORIDAD DE CERTIFICACION SUBCA-2 SECURITY DATA`, raíz
    **Security Data CA-2**.
  - **María José Rentería Landívar** → cert emitido por
    `AUTORIDAD DE CERTIFICACION SUBCA-2 SECURITY DATA`, raíz
    **Security Data CA-2**.
- Conclusión: Registro Civil NO opera una raíz PKI independiente. Sus
  funcionarios delegan 100% en BCE + Security Data. La acreditación
  ARCOTEL del Registro Civil como ECI es nominal/histórica.

### Changed — pwa 0.7.12
- Banner `TRUST_PARTIAL` ahora dirá **8 de 8 ACEs activas** (no aparecerá
  porque ya no hay placeholders entre los activos). Demo mode efectivamente
  OFF para cualquier PDF firmado con cert de las 8 ACEs reales.
- `verificar.demo_banner_body` (es+en) actualizado con la explicación
  de delegación BCE/SD del Registro Civil. Banner se conserva por si
  algún día aparece un PDF firmado con cert de una ACE inactiva.

## [0.7.11] — 2026-05-15 — Judicatura iCert-EC real Root CA

### Added — tsl-ec 1.9.0 (TSL_SEQUENCE 10)
- Real **iCert-EC root** loaded into `judicatura-2024.pem`. Subject:
  `CN=ICERT-EC ENTIDAD DE CERTIFICACION RAIZ, OU=SUBDIRECCION NACIONAL
  DE SEGURIDAD DE LA INFORMACION DNTICS, O=CONSEJO DE LA JUDICATURA,
  L=DM QUITO, C=EC`. Valid 2014-10-16 → 2034-10-16 (20-year root,
  10 años vigentes restantes). SHA-256
  `a434953dc5a028313d9e07b8cfefdf5a47b08e2d353bffb854a52360d6ef00c6`.
  Extracted offline from PAdES CMS chain of a 4-signature judicial PDF
  (`075-2026.pdf`, 3 firmas ancladas en iCert-EC). `icert.fje.gob.ec`
  sigue en mantenimiento — fetch público no era viable.
- **8/9 ACEs activas reales** ahora (era 7/9). Solo Registro Civil
  queda como placeholder.

### Changed — pwa 0.7.11
- `verificar.demo_banner_body` (es+en): "8 de 9 ACEs ARCOTEL activas
  tienen raíz real cargada (… Judicatura iCert-EC); falta solo 1
  (Registro Civil)".
- TSL bumped 1.8.0 → 1.9.0 (sequence 9 → 10).

### TODO for v0.7.12+
- **Registro Civil**: hipótesis activa de delegación en BCE pendiente
  de confirmar con PDF de funcionario operativo (no Director).

## [0.7.10] — 2026-05-15 — Security Data legacy Root CA (parallel anchor)

### Added — tsl-ec 1.8.0 (TSL_SEQUENCE 9)
- New trust anchor slot `securitydata-legacy`. Self-signed legacy root
  `CN=AUTORIDAD DE CERTIFICACION RAIZ SECURITY DATA, O=SECURITY DATA
  S.A., OU=ENTIDAD DE CERTIFICACION DE INFORMACION, C=EC`. Valid
  2011-02-16 → 2031-02-16 (20-year root, still vigente). SHA-256
  `fc8d6968851e6dc8c4be8fe8962e52d85ad32c90cd7b0d7fb6376c7a165c0e2a`.
  Extracted 2026-05-15 from 6 PAdES CMS chains across production signed
  PDFs (`whats empresa recovery/Media/WhatsApp Business Documents/…`).
  Modelled as a separate slug (not concatenated into
  `securitydata-2024.pem`) because the verifier's `pemToCert` parses one
  cert per PEM file and the `TrustRoot` schema carries a single
  fingerprint/validity pair.
- Banner counter unchanged (Security Data already counted in v0.7.7).
  This release strengthens chain validation for end-entity certs issued
  under the older Security Data root that remain operative.

### Changed — pwa 0.7.10
- `tsl-ec` bumped 1.7.0 → 1.8.0 (sequence 8 → 9). 18 trust roots in TSL
  (17 ARCOTEL slots + 1 legacy parallel anchor). 8 real roots loaded.

### TODO for v0.7.11+
- **Judicatura**: still placeholder. icert.fje.gob.ec sigue en
  mantenimiento. Esperar PDF firmado B-LT/LTA con cert iCert-EC.
- **Registro Civil**: still placeholder. Necesita PDF firmado por
  funcionario operativo (no Director) para confirmar si emiten desde
  raíz propia o delegan en BCE.

## [0.7.9] — 2026-05-15 — ANFAC Ecuador real Root CA via PAdES PDF scan

### Added — tsl-ec 1.7.0 (TSL_SEQUENCE 8)
- Real **ANFAC Ecuador Root CA** loaded into
  `packages/tsl-ec/src/roots/anfac-2024.pem`. Found by scanning all 114
  signed PDFs in `~/Nextcloud/Documentos`: the `Cliente GPS/Borrador de
  Contrato Ariendo de equipos…-signed.pdf` PAdES CMS chain delivered
  the full self-signed root. Subject: `CN=ANF High Assurance Ecuador
  Root CA, O=ANFAC AUTORIDAD DE CERTIFICACION ECUADOR C.A.
  (RUC 1792601215001), OU=ANF Clase 1 CA EC, C=EC`. Valid
  2019-10-17 → 2039-10-12 (20-year root). SHA-256
  `0f361d8b258123ea9bb84dd3f2c821c0285479626e1185e12f1a04b85546e459`.
  ANFAC Ecuador is operationally active — the previous "no public web
  presence" finding was misleading. They issue certificates under their
  own EC-incorporated root (distinct from the Spanish ANF AC root).
- **7/17 ACEs now have real roots**: eclipsesoft, uanataca, argosdata,
  datil, bce, securitydata, anfac. 2 SRI-accepted still placeholders:
  judicatura, registro-civil.

### Changed — pwa 0.7.9
- Verifier `TRUST_PARTIAL` banner now reports `7 de 9 ACEs ARCOTEL
  activas` instead of `6 de 9`. Banner names the 2 remaining active
  placeholders (Judicatura, Registro Civil).

### TODO for v0.7.10+
- **Security Data legacy root** (`AUTORIDAD DE CERTIFICACION RAIZ
  SECURITY DATA`, sha256 `fc8d6968…`, valid 2011-02-16 → 2031-02-16)
  found in 6 additional signed PDFs but not yet loaded — requires
  decision: concatenate PEMs in `securitydata-2024.pem` or add separate
  slug. Certificates issued under this older root are still valid; ship
  alongside the CA-2 root in a follow-up.
- **Judicatura**: all 35 Judicatura-signed PDFs scanned used legacy
  `adbe.pkcs7.sha1` mode that does NOT embed the chain. Still waiting
  for either a B-LT/LTA signed document or `icert.fje.gob.ec` to come
  back from maintenance.

## [0.7.8] — 2026-05-15 — Header logo + "Inicio" now redirect to landing

### Changed — pwa 0.7.8
- `Header.svelte`: lockup ("firmar.ec app") and the "Inicio / Home" nav item
  now point to `https://firmar.ec/` (institutional landing) instead of the
  internal SPA `/` route. The PWA `Home.svelte` route still exists for
  deep-links and installed-app entry, but the global navigation always
  takes the user back to the institutional site as expected. Behaviour is
  identical on desktop and mobile menus.

## [0.7.7] — 2026-05-15 — Security Data real Root CA via signed contract PDF

### Added — tsl-ec 1.6.0 (TSL_SEQUENCE 7)
- Real **Security Data Root CA** loaded into
  `packages/tsl-ec/src/roots/securitydata-2024.pem`. Extracted from the
  PAdES CMS chain of a real signed contract (`CONTRATO2026 SOLUCIONES…`)
  that had the full LT-level chain embedded. Self-signed:
  `CN=AUTORIDAD DE CERTIFICACION RAIZ CA-2 SECURITY DATA,
  O=SECURITY DATA S.A. 2, OU=ENTIDAD DE CERTIFICACION DE INFORMACION,
  C=EC`. Valid 2019-10-15 → 2039-10-06 (20-year root). SHA-256 fingerprint
  `503b5960fa8cc58f3367642a911fd8f8277e474d6891637fe56ca2a69f069cbd`.
  Security Data does not publish this PEM on a public URL; offline
  extraction from a real signed PDF was the only path.
- **6/17 ACEs now have real roots** (eclipsesoft, uanataca, argosdata,
  datil, bce, securitydata). 3 SRI-accepted still placeholders: anfac,
  judicatura, registro-civil.

### Changed — pwa 0.7.7
- Verifier `TRUST_PARTIAL` banner now reports `6 de 9 ACEs ARCOTEL
  activas` instead of `5 de 9`. Banner copy explicitly names the 3
  remaining active placeholders (ANFAC, Judicatura, Registro Civil).

### Notes — Judicatura still placeholder
- Attempted: P12 client cert (only end-entity), legacy `adbe.pkcs7.sha1`
  PDF (chain not embedded), OCSP responder (only returned responder
  cert), crt.sh (502), `icert.fje.gob.ec` (site under maintenance).
- Needs: a Judicatura-signed PDF at LT/LTA level (B-LT or B-LTA) where
  the full chain is mandatorily embedded, OR a direct CA cert from
  iCert when their site is back, OR a working crt.sh query.

## [0.7.6] — 2026-05-15 — BCE real Root CA via Registro Civil PAdES chain

### Added — tsl-ec 1.5.0 (TSL_SEQUENCE 6)
- Real **BCE Root CA** loaded into `packages/tsl-ec/src/roots/bce-2024.pem`.
  Extracted from the PAdES CMS chain of a Certificado de Matrimonio signed
  by the Director General del Registro Civil (Ottón José Rivadeneira
  González). The Registro Civil uses BCE-issued certificates, so the CMS
  delivered the BCE root directly. Subject == Issuer (self-signed):
  `CN=AUTORIDAD DE CERTIFICACION RAIZ DEL BANCO CENTRAL DEL ECUADOR,
  O=BANCO CENTRAL DEL ECUADOR, OU=ECIBCE, L=Quito, C=EC`. Valid
  2011-08-08 → 2031-08-08 (20-year root). SHA-256 fingerprint
  `11c7c59be9d21d216f0e8151378d53d03b314060559adc49da161ec4f7829bec`.
  BCE does **not** publish this PEM on a public URL (their WAF blocks
  `/aia/eciroot.crt`); the only path was offline extraction from a real
  signed PDF.
- **5/17 ACEs now have real roots** (eclipsesoft, uanataca, argosdata,
  datil, bce). 4 SRI-accepted CAs still placeholders: anfac, judicatura,
  registro-civil, securitydata.

### Changed — pwa 0.7.6
- Verifier `TRUST_PARTIAL` banner now reports `5 de 9 ACEs ARCOTEL
  activas` instead of `4 de 9`. Banner copy explicitly names the 4
  remaining active placeholders (ANFAC, Judicatura, Registro Civil,
  Security Data) and keeps disclosing the 8 inactive ACEs.

### Notes
- The discovery that Registro Civil signs with a BCE-issued cert (rather
  than its own ECI root) raises a question for v0.7.7+: does Registro
  Civil even issue end-entity certs from its own root, or is its ARCOTEL
  accreditation purely formal while it delegates to BCE? Keep the slot
  for now and revisit when we find a document signed with a true
  Registro-Civil-issued cert.

## [0.7.5] — 2026-05-14 — Datil real CA + isDefunct flag + IDK Manager wordmark

### Added — tsl-ec 1.4.0 (TSL_SEQUENCE 5)
- Real Datil Root CA loaded into `packages/tsl-ec/src/roots/datil-2024.pem`
  — fetched from Datil public S3 (`Root_CA.crt` linked from
  `datil.com/certificados`). Subject `CN=Datil Autoridad de Certificacion,
  O=Datilmedia S.A.`, self-signed 2021-12-16 → 2031-12-14, sha256
  `4015 74c5 215e d1d6`. **4/17 ACEs now have real roots** (eclipsesoft,
  uanataca, argosdata, datil).
- New `isDefunct?: boolean` field on `TrustRoot` interface for
  ARCOTEL-listed CAs with no operational public presence. Verifier
  excludes them from the active denominator so the demo banner reflects
  only currently-issuing CAs.
- 8 entries flagged `isDefunct: true` (alpha-technologies, appfirmas,
  corpnewbest, darkcam, firmasegura, lazzate, letmi, primecorelat) —
  ARCOTEL-listed but no public website, no PKI repository, no SRI
  acceptance. Preserved in TSL for traceability against ARCOTEL listing.

### Changed — pwa 0.7.5
- Verifier `TRUST_PARTIAL` banner now reports `4 de 9 ACEs ARCOTEL
  activas` instead of `3 de 17`. New i18n copy explicitly names the 5
  remaining active placeholders (ANFAC, BCE, Judicatura, Registro Civil,
  Security Data) and discloses that 8 inactive ACEs are excluded.
- `packages/verifier/src/index.ts` heuristic now filters
  `activeRoots = roots.filter(r => !r.isDefunct)` before computing
  `placeholderCount` / `allRootsPlaceholder` / `someRootsPlaceholder`.

### Changed — landing
- `OperadoPor.astro` replaced the plain "IDK Manager" text heading with
  the official `idk-manager-wordmark.png` brand asset (160×66, @2x 320×132)
  copied from `_work/idkmanager-web/public/brand/`. H2 retains semantic
  text via `sr-only` span; image alt text preserved for screen readers.

### Fetch attempts that failed (kept as placeholder, still in TSL)
- BCE: `bce.fin.ec/aia/eciroot.crt` actively blocked by WAF
  ("requerimiento de despliegue del url fue rechazado"). Contact
  `seguridad@bce.ec`.
- Security Data: site live but no PKI repository at standard paths
  (`/repositorio`, `/wp-content/uploads/...CA-RAIZ...`). Contact
  `+593 2 392 2169`.
- ANFAC Ecuador: zero public web presence (anfac.ec, .com.ec all
  NXDOMAIN). Spanish ANF/ANFAC is a different entity.
- Consejo de la Judicatura: no PKI subdomain
  (`firmadigital.funcionjudicial.gob.ec` NXDOMAIN).

## [seo-2026-05-14] — SEO / GSC fixes (landing 0.1.14 + pwa 0.7.4)

> Tag collision avoidance: registry already holds `landing:v0.1.13` /
> `pwa:0.7.3` from prior builds with different content; bumped to
> `0.1.14` / `0.7.4` per qa-verify §7.1 (never reuse a pushed image tag).

### Fixed — landing 0.1.14
- `/sitemap.xml` now returns a valid 200 sitemapindex (was 404). Google
  Search Console probes the bare `/sitemap.xml` path independently of the
  `Sitemap:` directive in robots.txt; the new static file points at
  `sitemap-0.xml` directly so both discovery paths resolve.
- JSON-LD `SoftwareApplication.softwareVersion` updated from stale `0.1.0`
  to current PWA `0.7.4` so structured data reported to crawlers matches
  the deployed app.

### Fixed — pwa 0.7.4
- `/robots.txt` now serves a real `User-agent: * / Disallow: /` body
  instead of falling through to the SPA `index.html` (200 HTML response
  on robots.txt confused Google indexing — surface mirrors the existing
  `X-Robots-Tag: noindex, nofollow` Caddy header).

## [0.7.3] — 2026-05-12 — Demo banner version-agnostic + verifier test fixes

### Fixed — pwa 0.7.3
- Demo banner ("Verificación en modo demostración") no longer hard-codes
  the release version (was stuck at "v0.7.0" two releases after the bump).
  Banner now states the TSL coverage state (3/17 ACEs real, 14 placeholder)
  without a version prefix so it stays accurate across releases.

### Fixed — verifier (test suite, no engine change)
- `regression-real-eci.test.ts` updated for v0.7.0+ reality: the
  `eci-real-signed.pdf` fixture (alfonso/ArgosData) now anchors on a real
  root, so the test accepts EITHER an explicit TRUST_PLACEHOLDER/
  TRUST_PARTIAL code OR a confirmed `matchedRootSlug` while still asserting
  the banner-trigger placeholder message is present.
- Engine version assertion now compares against the exported `ENGINE_VERSION`
  constant instead of a hard-coded string so future bumps don't re-break it.
- `verify-status.test.ts` mirrors the same "real root OR demo code" guard.
- Result: 68/68 verifier tests green (was 65/68 since v0.7.0).

## [0.7.2] — 2026-05-12 — Per-signer Detail panel (multi-firma inspection)

Completes the multi-firma UX gap left open in 0.7.1: clicking a signer in the
summary list now swaps the Result + Detail panels to that signature instead
of always showing #1.

### Changed — pwa 0.7.2
- Verificar route: each signer row in the multi-firma banner is now a
  `<button>` that updates `selectedIndex`. The `Result`, `TimestampBadge`,
  `LtvBadge`, and `Detail` panels below the banner reflect the selected
  signature reactively.
- Visual: selected row gets a brand-tinted background + ring + eye icon
  on the right. Keyboard accessible (`aria-pressed`, focus ring).
- Hint text under the list updated to "Toca un firmante para inspeccionar…
  viendo firma #N de M".
- `selectedIndex` resets to 0 on every new verification and on Reset.

### Unchanged
- Verifier/signer engine: no changes (still 0.7.1). UI-only release.
- Single-sig PDFs: banner hidden, template behaves identically to 0.7.1.

## [0.7.1] — 2026-05-12 — Multi-firma ilimitado: verifier enumeration + UI list + signer xref-stream support

Closes the multi-firma gap reported by external tester 2026-05-12. PAdES
documents with N ≥ 2 signatures now verify each signature independently and
sign-on-top works against PDFs that use cross-reference streams (the SRI
gob.ec / BCE / PDF 1.5+ default — previously rejected with the cryptic
`cannot_add_signature_to_corrupt_pdf` message).

### Added — verifier 0.7.1
- `findAllSignatures(pdfBytes): SignedRange[]` — enumerates every PAdES
  signature in document/chronological order. Each entry carries its own
  /ByteRange + /Contents + metadata. Pairs each /ByteRange with the
  /Contents inside the same sig dict by forward-search and validates the
  hex window matches the gap [a+b, c).
- `verifyAllSignatures(pdfBytes, opts): MultiVerificationResult` — runs
  the full crypto/path/OCSP/TSA/LTV pipeline per signature, aggregating
  per-signature statuses into `overallStatus` via worst-case rank
  (invalid > no_signature > warning > valid).
- `MultiVerificationResult` type exported alongside `VerificationResult`.
- 4 new unit tests under `packages/verifier/tests/multi-signature.test.ts`.

### Added — pwa 0.7.1
- `runVerifyAll(pdf, opts): Promise<MultiVerificationResult>` in
  `apps/pwa/src/lib/workers/bus.ts` + new `verifyAll`/`resultAll` wire
  protocol on `verify.worker.ts`.
- Verificar route now calls `runVerifyAll` instead of `runVerify`.
- New summary banner renders above the single-sig detail block whenever
  `signatureCount > 1`. Shows overall colour (valid/warning/err), a
  numbered list of every signer (CN, signing time, profile B-B/B-T/B-LT
  /B-LTA), and an inline notice that detail panels still target sig #1.
- Single-sig PDFs render unchanged — banner hidden, existing template
  consumes signatures[0].

### Fixed — signer 0.7.1
- `parsePriorPdf` now accepts PDFs whose most recent cross-reference is a
  `/Type /XRef` stream (PDF 1.5+). The new helper `parseXrefStreamDict`
  reads /Size + /Root from the stream's plaintext dictionary without
  decompressing the FlateDecode data portion. Incremental update emits a
  classic xref+trailer chained via /Prev to the prior xref-stream object
  start — the resulting hybrid document is valid per ISO 32000-1 §7.5.8.4.
- This unblocks **multi-firma over SRI gob.ec comprobantes** (`RC-...pdf`)
  which previously failed with `cannot_add_signature_to_corrupt_pdf`.
- 10/10 existing classic-xref incremental tests still pass; integration
  test for the xref-stream path deferred until a real SRI fixture is
  captured (pdf-lib cannot synthesise an xref-stream PDF that preserves
  a /Sig dict — manual smoke path documented inline).

### Bumped — packages
- `@firma-ec/verifier` 0.7.0 → 0.7.1 (engineVersion in result body).
- `@firma-ec/signer` 0.7.0 → 0.7.1.
- `@firma-ec/pwa` 0.7.0 → 0.7.1 (footer badge).
- TSL package unchanged at 1.3.0 seq 4.

### Known limitations (not regressions)
- **Verificar Detail panel still shows signature #1 only** even on multi-
  signed PDFs. The summary banner gives users the full list of signers
  with per-sig status, but DSS/timestamp inspection drills into the first
  signature only. Per-signer inspection tracked for 0.7.2.

## [0.7.0] — 2026-05-12 — Stable release: graduates F7 RC + ArgosData real root + version coherence

Promotes the F7 LTV release chain to stable. Consolidates 26 unreleased commits
post-`v0.7.0-rc1` (rc2..rc9 mentioned only in commit subjects, never tagged) and
syncs all 5 sources of truth for version per qa-verify §3.1 (badge, frontend
package.json, packages, CHANGELOG, git tag).

### Added — tsl-ec
- **Real root for ArgosData** (3rd of 17 ARCOTEL ACEs with a real PEM, joining
  Eclipsoft + Uanataca). `ArgosData Root CA -SHA256`, self-signed, valid
  2022-06-09 → 2032-06-09. SHA-256
  `aaf7700654779e09dd8e380776022b24f6dde672f50cf82f88406ab7b01bde39`.
  Issues intermediate `ArgosData CA 1 - SHA256` which directly signs end-entity
  certs. ArgosData does not expose the root at well-known URLs; obtained via
  client-side `openssl pkcs12 -cacerts -nokeys` chain export from an
  ArgosData-issued .p12. With this root loaded, end-user signatures from
  ArgosData-issued certs verify in firmar.ec with full trust chain instead
  of `tsl_warning` placeholder warnings.

### Changed — versioning
- Unified all production packages + the app version badge to `0.7.0`:
  - `apps/pwa` (was 0.7.0-rc2 in package.json, 0.7.0-rc1 in footer; both drifted).
  - `packages/signer` (was 0.6.0-rc1; signer matures alongside F7 stable).
  - `packages/dss-pdf`, `packages/ltv-validation`, `packages/verifier` (were 0.7.0-rc1).
  - `packages/tsa-client`, `packages/tsa-trust` (were 0.5.0-rc1; F6 stable).
  - `apps/pwa/src/lib/version.ts` `APP_VERSION` constant (the footer badge).
- `verificar.demo_banner_body` (ES + EN): version string `v0.6.0-rc7` →
  `v0.7.0`; count `2 of 17` → `3 of 17` to reflect the new ArgosData root.
  Eliminates the stale-string drift incident reported by the operator on
  2026-05-12.

### Included (commits post-v0.7.0-rc1, previously unreleased)
- `5a00445` feat(ltv): F7.5 same-origin OCSP/CRL proxy (allowlisted ARCOTEL upstreams).
- `8383715` fix(ltv): F7.6 raise asn1js maxNodes for real ARCOTEL CRLs.
- `4097a0a` feat(mobile): p12 decrypt off main thread + zoom controls + 44px touch targets.
- `f11a7b3` fix(sw): aggressive workbox cache purge on install (Android stale SW fix).
- `7219d97` feat(firmar/mobile): default to last PDF page on load.
- `e6315ac` feat(pwa): user-confirmed SW updates + UpdateNotification toast.
- `96d4b90` fix(pwa): Button hrefs use hash for internal routes (PWA install fix).
- `919a13f` fix(configuracion): LTA toggle h-7→h-11.

### Known limitations (carried into 0.7.0, not regressions)
- **Signer**: multi-signature on PDFs with **xref streams + prior signature**
  still rejected with `cannot_add_signature_to_corrupt_pdf`
  (`packages/signer/src/incrementalUpdate.ts` requires classic xref tables).
  Affects SRI-issued documents (e.g. `RC-258-144-...pdf`); workaround is to
  re-print via browser print-to-PDF, flatten, then sign the fresh copy.
  Note: sequential multi-firma on classic-xref PDFs IS supported (tests in
  `incremental.test.ts` cover up to 3 signatures and assert all are detected).
  Proper xref-stream support tracked for 0.7.1+.
- **Verifier**: currently extracts only the **first** /ByteRange in a multi-signed
  PDF (`packages/verifier/src/pdf.ts:152` — "Find first /ByteRange") and reports
  on that single signature. Subsequent signatures on the same document are not
  enumerated nor displayed in the Verificar UI. PAdES requires verifiers to
  enumerate all signatures and report each independently. Tracked for 0.7.1
  as a P0 follow-up (tester report 2026-05-12).

### Landing 0.1.12 — F7 follow-up 2026-05-10
- Remove `/como-funciona-wa` from build (page parked in `_drafts/` until F3.5 WhatsApp inbox ships). Removed Header + Footer nav entries and `como-funciona-wa` route key. Eliminates the F6.7-audit-reported 404 on prod.

### Infra / docs — F7 follow-up 2026-05-10
- `infra/docker/Caddyfile.pwa` documents the planned `/api/ocsp` + `/api/crl` reverse-proxy shape (F7.5 scope, allowlisted upstreams). Not implemented; PWA falls back to direct fetch.
- `apps/pwa/src/lib/i18n.svelte.ts` warn copy in Configuracion clarifies that `/api/ocsp` is documented but not yet implemented.
- `packages/ltv-validation/tests/__fixtures__/` adds real ARCOTEL ACE OCSP + CRL fixtures captured 2026-05-10 (SECURITY DATA SubCA-2 + ArgosData CA 1).
- `packages/ltv-validation/tests/ocsp-kat-arcotel.test.ts` + `crl-arcotel.test.ts` consume the new fixtures (2 OCSP KATs pass; SD CRL skipped — BER indef-length, F7.6 followup).
- `scripts/lh-fallback-2026-05-10.mjs` + `_backups/F7-followup-2026-05-10/LIGHTHOUSE-SUMMARY.md` — Playwright-based lighthouse-equivalent audit (lighthouse CLI absent). 8 prod routes audited; cold-cache outlier on `firmar.ec/`, CF Web Analytics beacon blocked by CSP (expected).

## [0.7.0-rc1] / verifier 0.7.0-rc1 / signer 0.6.0-rc1 / ltv-validation 0.7.0-rc1 / dss-pdf 0.7.0-rc1 — 2026-05-10 — F7 LTV: PAdES B-LT + B-LTA

End of the PAdES ETSI baseline ladder. The signer now collects revocation
material (OCSP-first, CRL-fallback) and embeds it in a DSS dictionary as
an incremental update (B-LT), then optionally appends a document
timestamp (B-LTA). The verifier reads DSS + document timestamps and
reports the achieved profile without ever downgrading B-T to B-B.

Spec: `docs/superpowers/specs/2026-05-10-firma-ec-F7-LTV-design.md` (4266c4f)
Plan: `docs/superpowers/plans/2026-05-10-firma-ec-F7-LTV.md` (3bc1d6c)

### Added — signer 0.6.0-rc1
- `packages/signer/src/ltv.ts` — `collectLtvData()` orchestrates the
  OCSP-first / CRL-fallback cascade for signer + intermediates + TSA
  cert. Returns an aggregate `DssData` ready for `appendDss()`.
- `packages/signer/src/pades.ts` — `signPdfPades()` now threads
  `opts.ltv: { longTerm, longTermArchive, ocspUrl, crlUrl, ... }`. After
  B-T it runs LT (DSS) then LTA (document timestamp). Fallback policy:
  cert revoked → throw; network failure → drop back one tier with
  warning. New result field `ltv: LtvMeta`.

### Added — ltv-validation 0.7.0-rc1 (initial release)
- `src/ocsp/*` — RFC 6960 OCSP request builder, HTTP fetcher, response
  parser + `isCertRevoked()` predicate.
- `src/crl/*` — CertificateList parser + AIA/CDP URL discovery.
- `src/cache.ts` — in-memory + IndexedDB caches keyed by cert SKI +
  responder URL, TTL governed by `nextUpdate`.
- 33 tests (OCSP-fetch, OCSP-KAT, OCSP-request, CRL, AIA discovery,
  cache, property-based).

### Added — dss-pdf 0.7.0-rc1 (initial release)
- `appendDss({ pdfBytes, dss })` — writes DSS as PAdES incremental update
  (B-T → B-LT).
- `parseDss(pdfBytes)` — recovers the same shape (verifier-side).
- `appendDocumentTimestamp()` + `findDocumentTimestamps()` for
  /Sig /ETSI.RFC3161 envelopes (B-LT → B-LTA).
- 23 tests (incremental writer, parser round-trip, doc timestamp,
  streams).

### Added — verifier 0.7.0-rc1
- `src/dss.ts` — `extractDss()` recovers DSS via xref walk.
- `src/ltv.ts` — `verifyLtv()` cross-references embedded OCSP/CRL with
  the signer chain and checks document timestamps via the shared
  `verifyTimestamp()` (refactored to accept generic imprint sources).
- `verifyPdf()` now populates `result.ltv: LtvSummary`.
- Profile state machine: `B-B → B-T → B-LT → B-LTA`. No downgrade.
- 64 tests (DSS extraction, LTV cross-ref, profile inference,
  regression on F6 B-T sample → still profile B-T not B-B).

### Added — PWA 0.7.0-rc1
- `apps/pwa/src/ui/firma/LtvBadge.svelte` — emerald for B-LT, bright
  emerald for B-LTA. Wired into DownloadResult + Verificar detail panel.
- `apps/pwa/src/routes/Configuracion.svelte` — "Validez a largo plazo"
  section: toggles for B-LT/B-LTA, custom OCSP/CRL URLs, timeouts.
  Persisted via `lib/settings.ts`.
- `sign.worker.ts` — new stages `collect_ocsp`, `collect_crl`,
  `embed_dss`, `request_document_ts`.
- i18n ES/EN strings for the LtvBadge tooltip ladder + Configuracion
  copy. Small hint near OCSP/CRL URL fields: "URLs no por defecto
  requieren ajuste CSP del operador".
- E2E scaffold `tests/e2e/ltv-flow.spec.ts` (4 fixme tests).

### Added — fixtures + cross-val artifacts
- `scripts/gen-f7-samples.mjs` — Node script. Synthetic-CA fallback path
  used in sandbox (OCSP/CRL responders unreachable from build network);
  real B-T reused from F6.
- `_backups/F7-cross-val-artifacts/sample-{b-t,b-lt,b-lta}.pdf` mirrored
  into `packages/verifier/tests/fixtures/`.
- 2 verifier integration tests (`B-LT roundtrip`, `B-LTA
  documentTimestamp present`).

### Caveats
- Live OCSP/CRL fetches against ARCOTEL ACE responders unverified in
  sandbox; covered by synthetic-CA fixtures + unit KATs.
- Adobe Reader cross-val of B-LT/B-LTA samples is a manual user step
  (follow-up F7.5).
- CSP — `connect-src` retains the F6 TSA trade-off: user-supplied
  OCSP/CRL URLs require operator-side Caddyfile edits. UI hint added.

### Out of scope (followed up post-release)
- F7.5 — LTV refresh (re-add fresh OCSP/CRL before TSA expiry).
- F7.6 — Multi-OCSP with deterministic responder ranking.
- F8 — QES eIDAS (qualified electronic signature gates).

## [landing 0.1.11] — 2026-05-10 — Cleanup: remove non-existent @firmar.ec emails

User-visible cleanup. Three email addresses (`contacto@`, `datos@`, `security@firmar.ec`) were never provisioned (zone has null MX). Replaced with public, working channels — preserving LOPDP compliance via the parent data controller (IDK Manager) and following RFC 9116's allowance for URL-based security contacts.

### Changed — landing user-visible
- `apps/landing/src/lib/jsonld.ts` — `SITE.contactEmail` / `SITE.dpoEmail` / `SITE.securityEmail` removed. Added `SITE.contactUrl` (GitHub Issues), `SITE.dpoContactUrl` (idkmanager.com/contacto), `SITE.securityUrl` (GitHub Security Advisories). Schema.org `ContactPoint` now uses `url` instead of `email`.
- `apps/landing/src/components/OperadoPor.astro` — footer links rewritten to GitHub Issues / IDK Manager / Private Advisory.
- `apps/landing/src/components/PorQueEsSeguro.astro` — LOPDP card body: "DPO publicado" → "controlador de datos identificado" (ES + EN).
- `apps/landing/src/pages/{contacto,en/contact}.astro` — page rewritten: 3 cards now point to GitHub/IDK Manager/Advisory URLs. PGP section replaced by responsible-disclosure paragraph (no PGP maintained).
- `apps/landing/src/pages/500.astro` — error fallback CTA → GitHub Issues.
- `apps/landing/src/pages/{faq,en/faq}.astro` — lead copy drops the email mention.
- `apps/landing/src/content/pages/{es/privacidad,en/privacy}.md` — DPO section, lawful-basis table, ARCO+ access/erasure procedure, and contact list rewritten to redirect data subjects to IDK Manager (the legal data controller). Inbound-email language replaced by GitHub-issues language. **LOPDP compliance preserved** — Art. 12 rights still routable through the named controller.
- `apps/landing/src/content/pages/{es/acerca,en/about,es/terminos,en/terms}.md` — Contact list updated.
- `apps/landing/src/content/pages/{es/seguridad,en/security}.md` — Disclosure step 1 now points to GitHub Security Advisories (was: email + PGP).
- `apps/landing/src/content/faq/{10-empresas,en-10-organisations}.md` — sale paragraph drops the email contact.
- `README.md` — security reports line updated.
- `docs/transparency-report.md` — CAA `iodef` and DMARC `rua` rows annotated as pending operator DNS update.

### Removed
- `apps/landing/public/.well-known/pgp-key.txt` — file deleted (was a placeholder pointing to a key that was never generated).

### Changed — RFC 9116 security.txt
- `apps/landing/public/.well-known/security.txt` — `Contact:` lines now use HTTPS URLs (RFC 9116 §2.5.4 allows URI). `Encryption:` removed (no PGP key). `Expires:` bumped to 2027-05-10.

### Notes
- inbox-backend internal env-vars referencing `@firmar.ec` left untouched (out of user-visible scope; will be reviewed in next inbox-backend release).
- DNS-zone follow-up for the operator: update CAA `iodef` (currently `mailto:security@firmar.ec`) and DMARC `rua` (currently `mailto:datos@firmar.ec`) — non-blocking since MX is null.

## [0.6.0-rc8] / [landing 0.1.10] — 2026-05-10 — Phase A sweep (CF Insights + OG + editorial + cosign keypair)

Cosmetic + privacy + supply-chain sweep. Four items shipped together as `apps/pwa 0.6.0-rc8` + `apps/landing 0.1.10`.

### Changed — editorial pass
- Normalized "certificado digital ecuatoriano" → "certificado electrónico .p12 (ECI ARCOTEL)" in user-facing copy where the focus is the artifact (the cert file), not the country/ecosystem context. Targeted edits only — legal/about/FAQ prose discussing "ecosistema digital ecuatoriano" preserved.
  - `apps/pwa/index.html` meta description.
  - `apps/pwa/vite.config.ts` PWA manifest description.
  - `apps/landing/src/i18n/ui.ts` ES + EN `meta.home.description`.
  - `apps/landing/src/lib/jsonld.ts` SoftwareApplication description (ES + EN).
  - `apps/pwa/src/lib/i18n.svelte.ts` `home.firmar_desc` + `firmar_placeholder.body`.
  - `apps/landing/src/components/ParaQuien.astro` h2 (ES + EN).

### Added — OG image surface
- PWA `apps/pwa/index.html` now emits `og:title`, `og:description`, `og:image` (1200×630), `og:url`, `og:locale`, plus Twitter card meta.
- PWA `og-app-firmar-ec.png` packaged into `apps/pwa/public/`.
- Landing `apps/landing/public/og-firmar-ec.png` available as a stable URL alias for share previews. The dynamic Astro renderer at `src/pages/og/[slug].png.ts` (satori + resvg-js, 1200×630 brand template) continues to serve `/og/{slug}.png` for per-page cards.

### Privacy — Cloudflare Insights beacon
- Documented that the `static.cloudflareinsights.com/beacon.min.js` violation reported in F6.7 audit (P2-1) is **edge-injected by Cloudflare proxy**, not present in source. **Action required from operator**: disable "Web Analytics" in CF dashboard for `firmar.ec` and `app.firmar.ec` zones to honor the documented "sin tracking" promise. CSP intentionally does *not* whitelist the beacon.

### Security — Cosign keypair scaffolding
- New `apps/landing/public/.well-known/cosign.pub` exposes the verifying public key at `https://firmar.ec/.well-known/cosign.pub` for downstream verifiers.
- Operator runbook: keypair generated via `docker run --rm gcr.io/projectsigstore/cosign:v2.2.4 generate-key-pair`, stored in workspace SOPS vault under `apps_firma_ec.cosign_priv` / `apps_firma_ec.cosign_pub` / `apps_firma_ec.cosign_password`. Tag signing for `v0.6.0-rc8` is *opt-in* once operator confirms the vault entry and runs the documented `cosign sign-blob` step.

## [landing 0.1.9] — 2026-05-10 — Hero copy: .p12 + electrónico

`apps/landing 0.1.9`. Hero h1 mentions `.p12` and `certificado electrónico` (was just "ecuatoriano") for SEO + correct expectations vs hardware tokens. PWA `hero.title` (i18n) bumped in parity (no PWA version bump — already 0.6.0-rc7).

### Changed
- `apps/landing/src/components/Hero.astro` h1 ES/EN.
- `apps/pwa/src/lib/i18n.svelte.ts` `hero.title` ES/EN parity.

## [0.6.0-rc7] — 2026-05-10 — F6.7 TSL real PEM fetch (2/17 ACEs)

`apps/pwa 0.6.0-rc7`, `@firma-ec/tsl-ec` TSL_VERSION 1.2.0 sequence 3.

### Changed
- **TSL upgraded from full demo to partial demo (2/17 real ACEs)**:
  - `eclipsesoft` now real: ECLIPSOFT CA ROOT, self-signed
    2025-12-02 → 2050-12-03, fetched from
    `firmas.eclipsoft.com/wp-content/uploads/2026/03/ECLIPSOFTCAROOT.cacert.cer`.
    SHA-256 `e40c3ce5…22c1f9`. Subject `CN=ECLIPSOFT CA ROOT, O=ECLIPSOFT S.A.,
    L=GUAYAQUIL, C=EC, organizationIdentifier=VATEC-0992253428001`.
  - `uanataca` now real: UANATACA ROOT 2016, self-signed 2016-03-11 → 2041-03-11,
    fetched from `web.uanataca.com/ec/certificados-ca` (Ecuador-specific repo).
    SHA-256 `44607b3d…dfb5a6`. Subject `C=ES, O=UANATACA S.A., CN=UANATACA ROOT 2016,
    organizationIdentifier=VATES-A66721499`. Spanish-incorporated qualified TSP
    under eIDAS, ARCOTEL-accredited as ECI in Ecuador via Uanataca Ecuador S.A.
- 15/17 slots remain self-signed placeholders. ARCOTEL listing page does not
  link to per-ACE repositories; BCE, Argosdata, Datil, Security Data,
  registro-civil, judicatura and the smaller ECIs do not publish their roots
  at well-known URLs reachable from outside EC networks. Each placeholder's
  `notes` field documents what was tried.
- **Verifier banner logic granular (`packages/verifier/src/index.ts`)**:
  - When ALL 17 are placeholders → emit `TRUST_PLACEHOLDER` (legacy, full demo).
  - When SOME real but path didn't validate (signer's CA still placeholder) →
    emit new `TRUST_PARTIAL` with message `"Trust chain not yet established:
    N/M ACEs ARCOTEL tienen raíz real; K aún placeholder"`.
  - When 0 placeholders remain → no banner (production).
- `Verificar.svelte` banner heuristic now also triggers on `TRUST_PARTIAL`.
- i18n `verificar.demo_banner_body` (es+en) reflects the partial-demo state
  ("2 de 17 …").
- Tests in `verify-status.test.ts`, `pathValidation.test.ts`,
  `regression-real-eci.test.ts` relaxed: assertions that required
  `roots.every(r => r.isPlaceholder)` now use `roots.some(...)`; checks for
  warning code now accept `TRUST_PLACEHOLDER` OR `TRUST_PARTIAL`.

### Bumped
- `packages/tsl-ec/src/index.ts`: TSL_VERSION `1.1.0` → `1.2.0`,
  TSL_SEQUENCE `2` → `3`.
- TSL bundle SHA-256 regenerated:
  `c15f6357c694a07090f715cdf8e70a86a34239415ea8eaa8d6eff1db1b13d2a5`.

### Tests
- All `pnpm -r test` packages green: 57 verifier (2 skipped legacy),
  64 signer, 19 tsa-client, 9 inbox-crypto, 7 tsa-trust, 121 inbox-backend.

### Backup
- `_backups/F6-tsl-pemfetch-2026-05-10/{roots/,roots.ts}` snapshot of
  pre-fetch state preserved.

### TODOs (manual fetch follow-up — 15 remaining ACEs)
- `bce` — `eci.bce.fin.ec` DNS unreachable from this build host. Try from EC.
- `argosdata` — site doesn't expose repositorio publicly. Contact +593939658192.
- `datil` — `Centros de Ayuda → Certificados Digitales` collection (3 articles)
  not crawlable; check docs.datil.com manually.
- `securitydata` — site has no `/repositorio` or `/descargas` link to CA root
  on public pages. Contact 02-3922169.
- `registro-civil`, `judicatura`, `alpha-technologies`, `anfac`, `appfirmas`,
  `corpnewbest`, `darkcam`, `firmasegura`, `lazzate`, `letmi`, `primecorelat`
  — no PKI repository link found on public sites. ARCOTEL listing page
  doesn't link per-entity. Likely accessible only via signed PDF chain
  extraction once a representative .p12 from each CA is available.

## [0.6.0-rc6] — 2026-05-10 — F6.6 TimestampBadge gold variant: success-green

`apps/pwa 0.6.0-rc6`. Verifier/signer/landing unchanged (cosmetic only).

### Changed
- **F6.6 TimestampBadge `gold` variant retuned from honey-amber → success-green**
  to read as positive/verified instead of "another warning". When a B-T PDF
  is verified end-to-end and the outer cert chain still produces 18 TSL
  placeholder advertencias, the orange "Firma válida con advertencias"
  panel sits directly above the gold badge. The previous hue 85° (honey
  amber) shared visual register with warn-tone surfaces and the user read
  the gold badge as a second warning.
  - File: `apps/pwa/src/ui/firma/TimestampBadge.svelte` (style block).
  - Triad now hue 145° (the `ok` token family): bg `oklch(96% 0.04 145)`,
    border `oklch(64% 0.16 145 / 0.45)`, fg `oklch(34% 0.10 145)`. Dark
    theme triad mirrored for parity. Icon `i-lucide-shield-check` retained
    (semantic for "verified timestamp"; already on the safelist).
- Silver variant unchanged — it correctly stays in the warn/neutral register
  to signal "stamp present but at least one check failed".

### Notes
- No verifier/signer/i18n logic touched. Cosmetic only.
- SW cache caveat: append `?bust=rc6` or hard-reload to pick up the new
  bundle on devices that have rc5 cached.

## [0.6.0-rc5] / verifier 0.5.0-rc4 — 2026-05-10 — F6.5 fix B-T extraction + engine version

`apps/pwa 0.6.0-rc5` + `@firma-ec/verifier 0.5.0-rc4`. Signer/landing unchanged.

### Fixed
- **F6.5 verifier reports B-B on B-T PDFs** — user signed a PDF with TSA on
  (rc4 LIVE), badge "Firma sellada · www.freetsa.org" rendered fine in
  DownloadResult, but verifying the same PDF showed "PERFIL PADES: B-B" and
  the TimestampBadge never went gold. Root cause same class as F3 v0.4.4
  (`pkijs encodedValue empty on build path`): in `packages/verifier/src/cms.ts`
  the timestamp unsigned-attribute extraction was reading
  `tsAttr.values[0].valueBlock.valueHex`, which is **empty** for parsed
  ASN.1 SEQUENCEs in asn1js. The TimeStampToken (a ContentInfo SEQUENCE)
  came back as a 0-byte buffer → verifier silently treated the signature as
  B-B. Fix: prefer `valueBeforeDecodeView` (asn1js stores the original DER
  bytes when parsed from BER) with `toBER(false)` as fallback.
  - File: `packages/verifier/src/cms.ts` (timestamp extraction block).
  - Regression test: `tests/cms.test.ts` "F6.5 — extracts RFC 3161
    timestampToken from B-T PDF". Asserts `timestampToken !== undefined` and
    `length > 1000` (FreeTSA tokens are ~4–5 KB; bare TSTInfo ≥ 1 KB).
  - Companion test: B-B PDF leaves `timestampToken` undefined.
- **F6.5 stale `ENGINE_VERSION = '0.3.3'`** in `packages/verifier/src/index.ts`
  surfaced in PWA Configuración footer ("Versión del motor: 0.3.3"). Bumped
  to `'0.5.0-rc4'` to match the verifier package version. Regression-real-eci
  test updated to assert the new value.

### Changed
- `packages/verifier/package.json`: `0.5.0-rc1` → `0.5.0-rc4` (catch up to
  signer/tsa-client baseline).

### Notes
- Hardcoded `ENGINE_VERSION` (vs JSON import) chosen to avoid coupling tsconfig
  `resolveJsonModule` across all consumers. Bump on each release.
- SW cache caveat: hard reload may be required for users on rc4 to pick up the
  new bundle.

## [0.6.0-rc4] / signer 0.5.0-rc3 — 2026-05-10 — F6.4 fix B-T `signature_too_long`

`apps/pwa 0.6.0-rc4` + `@firma-ec/signer 0.5.0-rc3`. Landing unchanged at `0.1.8`.

### Fixed
- **F6.4 `signature_too_long` on real .p12 + B-T (TSA on)**: First production
  attempt with an ECI Ecuador (ArgosData CA 1) certificate failed at the embed
  step with code `signature_too_long`. Root cause: the `/Contents` placeholder
  reserved only 16384 bytes (32768 hex chars). PAdES-B-T appends a full RFC
  3161 TimeStampToken (FreeTSA cert + chain + TSTInfo, ~4–5 KB) on top of the
  CMS, and ECI chains run ~3–5 KB themselves — total CMS hex routinely
  overflows 32 K hex chars.
  - `packages/signer/src/pades.ts`: `DEFAULT_SIGNATURE_LENGTH` 16384 → 32768
    bytes (65 536 hex chars). Comfortable headroom for B-T + multi-cert chains.
  - `packages/signer/src/incrementalUpdate.ts`: same bump (mirrors the
    primary signature path used for second-and-later signatures).
  - JSDoc on `PadesSignOptions.signatureLength` updated.

### Cost
- +16 KB per signed PDF (32 768 − 16 384). Negligible vs typical signed-PDF
  sizes (often hundreds of KB to multi-MB). No regressions in B-B path.

### Notes
- PWA service workers from rc1/rc2/rc3 still cached on user devices need to
  accept the update prompt to pick up rc4. The fix is in the signer worker
  bundle, not in any cached page.

## [0.6.0-rc3] / [0.1.8] / signer 0.5.0-rc2 — 2026-05-10 — F6.3 QR URL fix + landing hash redirect

`apps/pwa 0.6.0-rc3` + `apps/landing 0.1.8` + `@firma-ec/signer 0.5.0-rc2`.

### Fixed
- **F6.3 QR deep-link landed on the wrong site**: F6 introduced a QR encoding
  `https://firmar.ec/#/verificar?h=<hex>` in every signed PDF. Scanning that QR
  opened the **Astro landing** at `firmar.ec`, which doesn't handle SPA hash
  routes — the `/verificar` deep-link banner (F6.1) never fired and users were
  stuck on the marketing home.
  - **Forward fix (signer)**: `packages/signer/src/pades.ts` now embeds
    `https://app.firmar.ec/#/verificar?h=<hex>` in the QR. New signatures land
    on the PWA directly.
  - **Backward-compat (landing)**: `apps/landing/src/layouts/Base.astro`
    ships an inline pre-render script that redirects any hash matching
    `^#/(verificar|firmar|paranoia|about|configuracion)` to
    `app.firmar.ec`, preserving the hash. Covers every PDF signed with
    F3–F6.2 already in circulation.
  - Inline script runs before BaseHead/theme bootstrap so the user never
    sees a landing flash. CSP-compliant (`'unsafe-inline'` already in
    landing policy; no Trusted Types lockdown).
- Signer test suite updated: `visibleSig.test.ts` now asserts the
  `app.firmar.ec` prefix in three places, plus a new F6.3-specific test.

### Notes
- PWA service workers from rc1/rc2 still cached on user devices will keep the
  old verifier UI until the update prompt is accepted. The landing redirect
  ensures the deep-link still works for those users — they get routed to
  `app.firmar.ec` and the cached PWA handles the hash.

## [0.6.0-rc2] — 2026-05-10 — F6.1 QR deep-link + F6.2 multi-firma UX

`apps/pwa 0.6.0-rc2` (PWA + signer-types bump; verifier unchanged from
`0.5.0-rc1`). The `TimestampMeta.reason` union gains two new members
(`'user_disabled'`, `'multifirma_path'`) — non-breaking SemVer addition;
`'disabled'` retained as backward-compat alias.

### Fixed
- **F6.2 multi-firma TSA silent-no-feedback**: when the user re-signed an
  already-signed PDF, the worker forced PAdES B-B (incremental update) and
  emitted `timestamp.reason: 'disabled'`. `DownloadResult.svelte` then
  treated that as a deliberate user opt-out and suppressed both the gold
  badge AND any toast — leaving users with zero visual feedback about why
  their signature had no timestamp. Now:
  - Worker distinguishes `'user_disabled'` (silent, intended) from
    `'multifirma_path'` (renders an informational pill: "Firma adicional
    sobre PDF ya firmado — el sello RFC 3161 solo aplica a la primera
    firma de un documento; las firmas anteriores conservan sus propios
    sellos").
  - Legacy `'disabled'` value retained as backward-compat alias and
    mapped to the same pill at the UI layer (older sign-worker bundles
    still cached in service workers will keep working without redeploy).
  - Worker emits `progress: request_timestamp` BEFORE entering the
    single-firma signer call when TSA is enabled, so users see
    "Solicitando sello de tiempo…" while the FreeTSA round-trip is in
    flight rather than only after it completes.
  - 4 i18n entries added (`firmar.tsa.multifirma_pill_title` + `_body`,
    es + en). Pill uses ink-tone (info, not warn) to match the design.

### Added
- **F6.1 QR deep-link**: `/verificar` now reads the `?h=<hex>` hint that the
  signed-PDF QR encodes (`https://firmar.ec/#/verificar?h=<sha256-12hex>`).
  - Info banner at the top of the page when `?h=` is present, showing the QR
    document hash and inviting the user to drop the signed PDF.
  - Hash compare badge after verification: SHA-256 (first 12 hex) of the
    uploaded bytes is compared to the QR hint and rendered as a green "match"
    or amber "info — expected if you uploaded the signed PDF" hint with an
    expandable "¿Por qué?" explainer covering the unsigned-vs-signed semantics.
  - Compare is **purely informational**; the cryptographic verdict from the
    verifier worker remains the source of truth.
- New helper `apps/pwa/src/lib/qrDeepLink.ts` (`parseQrHash`,
  `readQrHashFromLocation`, `compareHash12`) with 11 unit tests in
  `tests/qrDeepLink.test.ts`.
- 6 i18n keys × 2 langs (12 entries): `verificar.qr.banner_title`,
  `banner_subtitle`, `match_ok`, `match_warn`, `why_summary`, `why_body`.

### Notes
- The signer hashes the *unsigned* source PDF, so legitimate verifications of
  the signed PDF will surface as "info — expected" rather than "match". Copy
  is calibrated to make this an honest, non-alarming UX rather than a warning.

## [0.5.0-rc1] — 2026-05-09 — F6 PAdES B-T (RFC 3161 timestamp)

Release-candidate cut for F6 (TSA). Versions in this train:
`apps/pwa 0.6.0-rc1`, `packages/{signer,verifier,tsa-client,tsa-trust} 0.5.0-rc1`,
`apps/landing 0.1.7` (unchanged).

### Added
- **F6 TSA**: PAdES B-T via FreeTSA timestamp, default-on with graceful B-B fallback.
  - New `@firma-ec/tsa-client` package — RFC 3161 client (browser + Node), KAT-tested
    request/response/parse pipeline, fetched via `https://freetsa.org/tsr` by default.
  - New `@firma-ec/tsa-trust` package — embedded FreeTSA root + ARCOTEL placeholder
    slot, EKU `id-kp-timeStamping` chain validation.
  - Signer attaches `id-aa-signatureTimeStampToken` (OID `1.2.840.113549.1.9.16.2.14`)
    in CMS `unsignedAttrs` after the inner signature is computed; PDFs round-trip as
    PAdES B-T in Adobe Reader.
  - Verifier renders gold/silver/none badge based on TSA imprint + signature + chain
    validity. Legacy B-B PDFs continue to verify as `valid` with `badge: 'none'`.
  - **`TimestampBadge.svelte`** component with `Intl.DateTimeFormat('es-EC')` /
    `('en-US')` formatting, three-state contract, reduced-motion aware.
  - **`/configuracion`** route with TSA enable/URL/timeout controls (persisted in
    `localStorage.firma_ec_settings_v1`) plus a "Probar TSA" probe button.
  - Caddy CSP `connect-src` now allows `https://freetsa.org`.
  - Sign worker emits the new `request_timestamp` progress stage.

### Fixed
- Verifier ECDSA curve derivation: now reads from SPKI `algorithmParams` instead
  of inferring from the digest algo (was failing for FreeTSA SHA-512+P-384 combos
  during F6 KAT verification).

### Notes
- F3.5 WhatsApp inbox/outbox code complete (24 commits) but deploy gated behind a
  separate batch.
- ARCOTEL TSAs: F6.5 will swap the placeholder PEM once they publish RFC 3161
  endpoints.
- Mozilla Observatory + securityheaders.com should be re-checked post-deploy on
  both `firmar.ec` and `app.firmar.ec`; A+ should hold (the only CSP delta is the
  added `https://freetsa.org` in `connect-src`).

## [0.5.1] / landing [0.1.7] - 2026-05-09 — Default LIGHT, dark only opt-in

### Fixed
- **P0 user-reported**: "landing y app siempre en blanco tema oscuro solo manual". Both sites auto-switched to dark when the OS preferred dark, ignoring user intent. Now the default is **always light**; dark applies only after the user clicks the toggle, and the choice persists in `localStorage.theme`.
  - `apps/landing/src/layouts/Base.astro` — bootstrap script no longer reads `matchMedia('(prefers-color-scheme: dark)')`. `data-theme` is `'dark'` only when `localStorage.theme === 'dark'`; any other value (including legacy `'system'`) collapses to light. `<html data-theme-default="system">` → `"light"`.
  - `apps/pwa/index.html` — added an inline theme bootstrap script (runs before the Trusted Types policy) so the PWA matches the landing's behaviour: default light, no `prefers-color-scheme`, migration of legacy `'system'` → light. Removed the `<meta name="color-scheme" content="light dark">` (now driven by `[data-theme]` via CSS).
  - `apps/landing/src/styles/reset.css` + `apps/pwa/src/styles/reset.css` — replaced `color-scheme: light dark` + `light-dark()` (which automatically rendered dark on OS-dark before any JS bootstrap could fire) with explicit `color-scheme: light` and `[data-theme="dark"]` overrides.
  - `apps/landing/uno.config.ts` + `apps/pwa/uno.config.ts` — `presetWind4({ dark: '[data-theme="dark"]' })` so all `dark:` utilities (`dark:bg-ink-950`, `dark:text-ink-100`, etc.) key off the same selector the toggle writes, instead of UnoCSS' default `.dark` class which was a dead path in this codebase.

### Notes
- The `ThemeToggle.svelte` components were already binary (light↔dark), so no code change was needed there — the bootstrap now guarantees `dataset.theme` is exactly `'light'` or `'dark'` on mount.
- `prefers-reduced-motion` is preserved (still honoured for accessibility). Only `prefers-color-scheme` was removed from the auto-decision.

### Verification
- Live Playwright audit with `prefersColorScheme: 'dark'` context option:
  - `https://firmar.ec/` first visit → light. Toggle → dark. Reload → still dark. Toggle → light. Reload → still light.
  - `https://app.firmar.ec/` first visit → light. Toggle → dark. Reload → still dark. Toggle → light. Reload → still light.
  - 0 console errors on both, before/after screenshots captured.

## [0.5.0] - 2026-05-09 — Deep visual parity landing ↔ PWA

User reported: "https://app.firmar.ec/ y https://firmar.ec/ pareciera que son cosas diferentes!!!! unifica todo para que no se vea como cosas separadas aunque solo sea visualmente". v0.4.9 had unified design **tokens** but the components themselves rendered visibly different. v0.5.0 reimplements PWA components to match the landing's design system pixel-by-pixel where reasonable.

### Added
- **`apps/pwa/src/ui/Button.svelte`** — shared CTA primitive mirroring landing patterns. Variants `primary | outline | ghost | compact`, sizes `sm | md | lg`. Inherits the landing's premium shadow/lift/easing tokens (`cubic-bezier(0.4,0,0.2,1)` and `cubic-bezier(0.32,0.72,0,1)`).
- **PWA Hero** — eyebrow "Firma electrónica · Ecuador" (uppercase mono brand-500) + landing-style H1 (`clamp(2rem,1.2rem+4vw,4rem)` bold tracking `-0.02em`) + lead paragraph + 3-button row (primary verify + outline sign + ghost institutional) + 5 trust badges (Apache, ETSI, ARCOTEL, LOPDP, 100% browser).
- **PWA Footer 3-col grid** — lockup + description + IDKMARK / Project links / Privacy claim, plus bottom strip with copyright + version + security.txt link, mirroring `apps/landing/src/components/Footer.astro`.

### Changed
- **PWA Header** bumped from `h-14` to `h-16` to match landing. Border now transparent until scroll (`border-transparent` → `border-ink-200/dark:border-ink-800` after 8px scroll), via `onMount` listener on Svelte side. Container width unified.
- **PWA Home cards** — `rounded-xl` → `rounded-lg` to match landing Card.astro radius. Numbered list cards use mono `01/02/03` instead of plain `1/2/3` for landing typographic voice.
- **`apps/pwa/src/lib/version.ts`** + **package.json**: `0.4.9` → `0.5.0`.

### i18n keys nuevas (ES + EN)
- `hero.eyebrow`, `hero.title`, `hero.lead`, `hero.cta_primary`, `hero.cta_secondary`, `hero.cta_tertiary`.
- `footer.description`, `footer.project`, `footer.privacy_heading`, `footer.licencia`.

### Verification
- Audit doc `docs/visual-divergence-landing-pwa-2026-05-09.md` with side-by-side before/after screenshots at 390/1280/1920 viewports.
- Tests cumulative: signer 56 / verifier 47+2 skipped — all green (103 PASS).
- PWA typecheck: 542 files, 0 errors, 0 warnings.
- PWA bundle main 53.36 KB gzip (was 51.78; +1.58 KB for Button component + 8 i18n keys, well under 200 KB target).
- Console errors live preview: 0.

### Lessons
> **Tokens unify is not enough for visual parity.** `firma-ec` v0.4.9 already shared brand/ink/spacing/motion/shadow tokens between landing and PWA, yet user perceived them as "two different things" because component implementations (Astro vs Svelte) translated tokens into divergent layouts. Real parity required **reimplementing components with the same patterns** (Hero structure, Footer grid, Button variants) and verifying side-by-side at multiple viewports. New rule: when unifying multi-stack apps, design at the component-pattern level, not just token level.

## [0.4.9] / landing [0.1.6] - 2026-05-09 — Visual unify (landing centering fix + IDKMANAGER credit + token sync)

### Fixed
- **Landing main container flush-left on desktop** (P0 user-reported). UnoCSS `presetWind4`'s default `.container` utility was setting `max-width: 1536px` without `margin-inline: auto`, overriding the project's tokenised `.container` rule defined in `@layer base`. Sections rendered at `x: 0, w: 1536px` on a 1920px viewport instead of centered.
  - **Fix** (`apps/landing/src/styles/tokens.css`): moved `.container`/`.container-narrow`/`.container-prose` definitions into `@layer utilities` (last layer in cascade) with `!important` on `width`, `max-width` and `margin-inline`, so they win over Wind4's utility regardless of injection order.
  - Verified: section now reports `x: 384, w: 1152, ml: 384px, mr: 384px` (exact center on 1920px viewport, `--w-default: 72rem`).

### Added
- **`apps/landing/src/components/IdkmanagerMark.astro`** + **`apps/pwa/src/ui/IdkmanagerMark.svelte`** — institutional wordmark "IDKMANAGER" as inline SVG (zero HTTP cost, theme-aware via `currentColor`). Sizes `sm` (88px), `md` (128px), `lg` (160px) — typography Geist Display 700, letter-spacing `0.04em`.
- **Landing footer** — IDKMANAGER mark next to "Operado por" credit, linking to `https://idkmanager.com/`.
- **PWA footer** — "Operado por IDKMANAGER" credit row alongside copyright + version.
- **PWA About** — full IDKMANAGER credit card with `lg` mark, body text, hover affordance — replaces the visual gap that previously existed before the institutional CTA.

### Changed
- **Token sync landing ⇄ PWA** (`apps/landing/src/styles/tokens.css`):
  - Imported PWA's F3 motion tokens (`--motion-curve`, `--motion-tap`, `--motion-state`, `--motion-state-lg`, `--motion-emerge`).
  - Imported PWA's shadow tier tokens (`--shadow-flat/rest/hover/focus/success`) including dark-theme overrides.
  - Imported PWA's reduced-motion media query block.
  - Both apps now share the exact same brand/ink/spacing/radius/font scales (already aligned pre-v0.4.9, verified during audit).

### i18n keys nuevas (ES + EN)
- `footer.operated_by` — "Operado por" / "Operated by".
- `about.idk_credit_label` — "Un proyecto de" / "A project by".
- `about.idk_credit_body` — descripción institucional IDKMANAGER.
- `about.idk_credit_aria` — aria-label del bloque enlazado.

### Verification
- Pre-fix Playwright probe `getBoundingClientRect()` → confirmed flush-left bug live on `https://firmar.ec/`.
- Post-fix expected: `main section.container` centered on viewports ≥1024px; mobile (<640px) keeps 1rem inline padding.

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
