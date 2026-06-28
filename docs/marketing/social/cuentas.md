# Runbook de cuentas y activos sociales

Registro vivo de las cuentas, páginas y activos publicitarios reales de firmar.ec, y el
orden en que se crean. Los **identificadores concretos** (IDs de Business Manager, Página,
Pixel, tokens) **no viven aquí**: este repo es público (AGPL-3.0). Viven en la **memoria
privada del proyecto** (`_memory/project_firmarec_fb_business_page_creada_2026-06-28.md`) y
los secretos en la **bóveda SOPS** (sección real `apps_firma_ec.*`). Aquí va la arquitectura, el estado
y el procedimiento.

## Principio: Página dentro de Business Manager (nunca cuenta-bot)

La presencia de marca se crea SIEMPRE como **Página** colgada de un **Business Manager**
(portfolio comercial), operando sobre la **sesión real del dueño** — nunca creando cuentas
personales con automatización de navegador (Meta las detecta y banea; sería catastrófico
para la cuenta base). Es coherente con el guardrail "publicación solo por API oficial": los
bots de Marketplace quedan aislados en su negocio.

Arquitectura: **el portfolio/BM representa la empresa** (IDKmanager); **cada Página
representa una marca** (Firmar.ec, idkmanager.ec, …). Así comparten Pixel, pauta y activos
sin mezclar audiencias.

## Estado de activos (2026-06-28)

| Activo | Nombre | Estado | IDs/secretos |
|--------|--------|--------|--------------|
| Business Manager (portfolio) | **IDKmanager** | ✅ Creado · correo de negocio verificado | → memoria privada |
| Página de Facebook | **Firmar.ec** | ✅ Creada y **vinculada al BM** · categoría *Software* · acceso total | → memoria privada |
| Instagram Business | **@firmar.ec** | ✅ Creada · perfil Negocio · categoría *Software* · **vinculada a la Página** · bio puesta | → memoria privada |
| Cuenta TikTok | **@firmar.ec** | ✅ Creada · pública · bio puesta · Business/avatar/enlace pendientes (app) | → memoria privada |
| Cuenta publicitaria (Ad Account) | — | ⛔ Pendiente (fase de pauta) | `apps_firmar_ec.meta_ad_account_id` |
| Meta Pixel | — | ⛔ Pendiente (ver `medicion.md` §3) | `apps_firmar_ec.pixel_id` |
| System User token | — | ⛔ Pendiente | `apps_firmar_ec.meta_system_user_token` |

> Meta **capitaliza** el nombre de Página: se pidió `firmar.ec` y quedó **"Firmar.ec"** (no
> acepta inicio en minúscula). El dominio y el @usuario siguen siendo `firmar.ec`.

## Gotchas observados al crear (2026-06-28)

- **Ya existía otro Business Manager bajo el dominio del correo de empresa** (con casi total
  certeza el del WhatsApp Cloud, bajo otra identidad). Meta lo avisa al enviar el formulario.
  Se creó un BM nuevo (acceso directo con la cuenta del dueño). **Pendiente**: si se quiere
  unificar, conectar el WhatsApp/Pixel de ese otro BM a "IDKmanager".
- **El correo de verificación de Meta llega a Spam** (`notification@facebookmail.com`).
  Marcarlo "No es spam" para que los correos de pauta no se pierdan.

## Convención de nombres / handles

- **@usuario**: el handle de marca es **`firmar.ec`** (con punto, matchea el dominio exacto) en
  **TikTok** e **Instagram** (ambos lo aceptan y estaba libre). En IG, **`firmarec` (sin punto)
  estaba TOMADO** por otra cuenta → se usó el punto, que además unifica la marca en las 3 redes.
  Reservar `firmarec` como fallback donde el `.` no se permita. Desambiguar SIEMPRE de **FirmaEC**
  (app del Estado).
- **Sitio web** del perfil: `https://firmar.ec`.
- **Botón de acción / CTA** del perfil: "Usar app" → `https://app.firmar.ec` (nunca a un
  formulario de captura — ver `guardrails.md`).
- **Presentación / About**: herramienta que firma y verifica PDF + privacidad local +
  **desambiguación explícita de FirmaEC**; sin claims legales (gate YMYL de `guardrails.md`).

## Pendientes inmediatos (personalizar la Página Firmar.ec)

1. Foto de perfil + portada con el sistema visual (Azul Fe `#1E3A8A`, Sello Ámbar `#C9821E`).
   Imágenes de marca ya generadas (perfil 1080² y portada 1640×624) — subida **manual** (el MCP
   del navegador no sube archivos).
2. **@usuario de la Página FB**: aún **no elegible** — Facebook exige foto de perfil + algo de
   actividad antes de habilitar "nombre de usuario"; fijar `firmar.ec`/`firmarec` **después** de
   subir la foto.
3. ✅ Sitio web (`firmar.ec`) y ✅ Presentación con desambiguación de FirmaEC — **ya configurados**.
4. ✅ **Instagram Business `@firmar.ec` vinculado** (ver sección Instagram) — falta avatar + posts.
5. Fase de pauta (cuando gerencia lo decida): Ad Account → Pixel (con CSP + banner LOPDP,
   ver `medicion.md` §3) → secretos a SOPS `apps_firma_ec.*`.

## Instagram — `@firmar.ec` (creada 2026-06-28)

Perfil **profesional Negocio**, categoría **Software**, **creado desde Meta Business Suite** (home de
la Página → "Conectar un perfil de Instagram" → **"Crear un perfil de Instagram"**) y **vinculado a la
Página de Facebook** en el mismo flujo. Los mensajes de IG quedan unificados en la bandeja de la Página.

- **Hecho:** handle `@firmar.ec`, nombre para mostrar `firmar.ec · Firma Electrónica` (keyword SEO),
  **bio** (voz del portafolio + desambiguación) =
  `Firma y verifica PDF desde tu equipo. Sin formularios ni rastreo; tu llave nunca sale de tu computador. No es FirmaEC. → firmar.ec` (130/150).
  Credenciales en la bóveda privada.
- **Pendiente:**
  1. **Avatar** (mismo app-icon de marca) — el MCP del navegador no sube archivos → desde la app/upload manual.
  2. **Sitio web del perfil** — Instagram **solo permite editar el enlace desde la app móvil**
     (en web sale "La edición de enlaces solo está disponible en dispositivos móviles"). Por eso la URL
     va como texto en la bio. Poner `https://tienda.firmar.ec/?utm_source=instagram&utm_medium=social&utm_campaign=perfil_bio`.
  3. Primeros posts/reels (espeja el calendario de TikTok).

**Gotchas observados al crear (2026-06-28):**
- **El botón "Continuar" del formulario "Crear perfil profesional de IG" no se habilita hasta marcar el
  checkbox de consentimiento** ("Al registrarte, aceptas nuestras Condiciones…"). Es lo primero a revisar
  si el botón sigue gris pese a tener todos los campos llenos (no es un problema de validación de campos).
- **El correo de la cuenta IG no puede ser el mismo de la cuenta Meta logueada.** Se usó un **alias con `+`**
  (subaddressing): Meta lo acepta como distinto y Google Workspace lo entrega al buzón base. Los códigos de
  confirmación (alta y login) llegan ahí.
- **Iniciar sesión en instagram.com (web) dispara un checkpoint de "dispositivo nuevo"** con otro código por
  correo, aun recién creada la cuenta; y `…/accounts/edit/` puede fallar la 1ª carga → recargar.

## TikTok — `@firmar.ec` (creada 2026-06-28)

Canal **primario** del plan social. Cuenta **creada y activa**, registro **asistido sobre la
sesión real del dueño** (Edge, perfil con historial = score anti-bot alto) — nunca Playwright
headless ni IP de servidor (eso TikTok lo banea). Correo de empresa (→ memoria privada), región
**Ecuador**, **pública**, comentarios "Todo el mundo".

- **Hecho:** handle `@firmar.ec`, **pública**, **bio** (voz del portafolio) =
  `Renueva antes de que te bloquee. Cero custodia, sin formularios. No es FirmaEC` (78/80).
  Especificaciones completas del perfil (nombre, categoría, enlace, avatar, pin, hashtags) en **`tiktok-perfil-kit.md`**.
- **Pendiente:**
  1. **Nombre para mostrar** → `firmar.ec · Firma Electrónica` (marca + keyword SEO). **BLOQUEADO por cooldown de TikTok hasta 2026-07-05** (se fijó "Firmar.ec" al activar); aplicar ese día desde *Editar perfil*.
  2. **Avatar** (app/upload — el MCP de Edge no sube archivos) — logo en `Downloads\firmar-ec-avatar-tiktok.png` (la "f" Azul Fe + trazo Ámbar). Fondo **Papel `#F8FAFC`** (la ƒ NUNCA sobre azul sólido), ~15% padding, 720×720, sin wordmark.
  3. **Pasar a cuenta Business** (solo app móvil): **Perfil → ☰ → Configuración y privacidad → Cuenta → Cambiar a cuenta de empresa** → categoría **Professional Services** (2ª opción Technology/Software).
  4. **Enlace en la bio** (aparece el campo "Sitio web" **solo tras pasar a Business**): `https://tienda.firmar.ec/?utm_source=tiktok&utm_medium=social&utm_campaign=perfil_bio` (a la compra del `.p12`, con atribución).
  5. **Primer video fijado (pin #1):** *"Qué es firmar.ec (y qué NO)"* — desambiguación + cero-custodia (resuelve la colisión FirmaEC de entrada).
  6. **Contraseña → vault** `apps_firmar_ec.tiktok_password` (se entró por login-QR; la contraseña real la fija el dueño en *Configuración → Contraseña*).
- **Hashtags núcleo de marca** (uso consistente): `#FirmaElectrónica #Ecuador #SRI #FacturaElectrónica #FirmarPDF`. `#Ecuapass`/`#SENAE` SOLO en piezas de orientación (P1), nunca pegados a un CTA de venta del `.p12`.

> Apodo "Firmar.ec" en cooldown de 7 días (cambiable tras 2026-07-05). La cuenta Business **no
> es requisito** para publicar por la Content Posting API (sí para Marketing API/ads); habilita
> analítica y el enlace clicable en bio.

**Estrategia y publicación automatizada:** plan maestro en `tiktok-plan-maestro.md` (6 pilares→formatos,
calendario 4 semanas, 15 guiones listos, arquitectura del publicador en Swarm). Hallazgo a resolver
con producto: el **`.p12` se rechaza en Ecuapass/SENAE** (piden token USB) y sirve para SRI/facturación →
P1 (Ecuapass) se trata como **tráfico/orientación**, no venta directa; la venta se apoya en P5/P3/P2.

> Contexto estratégico y números de mercado: memoria `project_firmarec_social_ads_system_2026-06-24`.
> Estado operativo de Meta con IDs concretos: memoria `project_firmarec_fb_business_page_creada_2026-06-28`.
> Estado operativo de TikTok + gotchas del registro asistido: memoria `project_firmarec_tiktok_account_setup_2026-06-28`.
