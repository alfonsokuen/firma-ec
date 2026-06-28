# Runbook de cuentas y activos sociales

Registro vivo de las cuentas, páginas y activos publicitarios reales de firmar.ec, y el
orden en que se crean. Los **identificadores concretos** (IDs de Business Manager, Página,
Pixel, tokens) **no viven aquí**: este repo es público (AGPL-3.0). Viven en la **memoria
privada del proyecto** (`_memory/project_firmarec_fb_business_page_creada_2026-06-28.md`) y
los secretos en la **bóveda SOPS** (`apps_firmar_ec.*`). Aquí va la arquitectura, el estado
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
| Instagram Business | — | ⛔ Pendiente (vincular a la Página) | — |
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

- **@usuario** (todas las redes, reservar aunque no se usen): `firmarec` (sin punto; el `.`
  no siempre se permite en handles). Desambiguar SIEMPRE de **FirmaEC** (app del Estado).
- **Sitio web** del perfil: `https://firmar.ec`.
- **Botón de acción / CTA** del perfil: "Usar app" → `https://app.firmar.ec` (nunca a un
  formulario de captura — ver `guardrails.md`).
- **Presentación / About**: herramienta que firma y verifica PDF + privacidad local +
  **desambiguación explícita de FirmaEC**; sin claims legales (gate YMYL de `guardrails.md`).

## Pendientes inmediatos (personalizar la Página Firmar.ec)

1. Foto de perfil + portada con el sistema visual (Azul Fe `#1E3A8A`, Sello Ámbar `#C9821E`).
2. Fijar @usuario `firmarec`, sitio web, botón "Usar app".
3. Sección "Información"/About con desambiguación de FirmaEC.
4. Vincular Instagram Business (espeja TikTok/Reels).
5. Fase de pauta (cuando gerencia lo decida): Ad Account → Pixel (con CSP + banner LOPDP,
   ver `medicion.md` §3) → secretos a SOPS `apps_firmar_ec.*`.

> Contexto estratégico y números de mercado: memoria `project_firmarec_social_ads_system_2026-06-24`.
> Estado operativo con IDs concretos: memoria `project_firmarec_fb_business_page_creada_2026-06-28`.
