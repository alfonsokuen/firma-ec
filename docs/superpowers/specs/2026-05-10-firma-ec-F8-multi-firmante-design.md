---
date: 2026-05-10
project: firma-ec
phase: F8
status: **Draft v0.1 — REQUIERE REVISIÓN USER + decisiones abiertas en §9 antes de pasar a `writing-plans`**
authors: Alfonso Kuen + Claude (sesión autónoma post-F7)
supersedes: null
references:
  - docs/superpowers/specs/2026-05-09-firma-ec-F3-firma-MVP-design.md
  - docs/superpowers/specs/2026-05-09-firma-ec-F3.5-whatsapp-inbox-design.md  # patrón Evolution
  - docs/superpowers/specs/2026-05-10-firma-ec-F7-LTV-design.md
  - infraestructura IDK swarm (Evolution + BullMQ infra existente)
  - LOPDP Ecuador (Ley Orgánica de Protección de Datos Personales)
  - ETSI EN 319 142-1 §6 (multiple signatures), §A.2 (workflow patterns)
  - eIDAS AdES Workflow Protocol (informativo, no QES en F8)
deliverable_tag: v0.8.0-rc1 (provisional)
estimated_effort: ~2 semanas implementación (post-spec-approval)
---

# F8 — Multi-firmante con flujo orchestration

## 0. Goal

Permitir que un usuario inicie un **sobre de firma** (signing envelope) con un PDF y una lista ordenada o paralela de firmantes (por correo o WhatsApp), reciba notificaciones en cada paso, y termine con un PDF firmado por todos los participantes según ETSI EN 319 142-1 §6 (multiple signatures: cada firma es una entrada independiente en el AcroForm, con cadena de incremental updates).

> **Nivel** PAdES **B-LT** por defecto en cada firma individual (B-LTA opcional al cerrar el sobre con un document timestamp final).
> **Default flow** WhatsApp-first (Evolution + plantilla "Firma pendiente: <doc>") con fallback email (SMTP, IDK ya tiene infra).
> **Backend nuevo**: firma.ec deja de ser PWA-only y gana un servicio backend (Nest o Hono — decisión #§9.1) — esto es un cambio arquitectónico mayor con implicaciones LOPDP que esta spec debe resolver antes de implementarse.
> **Out of scope (F8)**: QES eIDAS (F9), firmas remotas con HSM (F9), workflows conditional/branching tipo Adobe Sign (F8.5), SAML/OIDC SSO (F8.5).

---

## 1. Decisiones (algunas ABIERTAS — ver §9)

| # | Decisión | Rationale | Status |
|---|---|---|---|
| 1 | **Backend nuevo** (no se puede hacer browser-only) | Coordinación entre firmantes asíncronos requiere estado server-side, queue, webhooks. | ✅ Decidida |
| 2 | **Cada firmante usa la PWA existente** para firmar (con su propio `.p12`) — el backend NUNCA toca claves privadas | LOPDP + promesa "firma con tu propio certificado". Backend solo orquesta, no firma. | ✅ Decidida |
| 3 | **Sobres efímeros**: PDF en backend máx 30 días, autodestruye tras último firmante o expiración | LOPDP minimización + reduce blast radius si DB se compromete. | ✅ Decidida |
| 4 | **Storage** S3-compatible (R2 ya en uso para Chatwoot/Medusa). Cifrado AES-256-GCM en reposo, key por sobre. | Defense in depth: aún si R2 se compromete, sin la key el PDF es ruido. Key vive en Postgres encrypted, separada del blob. | ✅ Decidida |
| 5 | **Cola** BullMQ sobre Redis HA existente (DB 10 — DB 8/9 tomadas por microtk/chatwoot) | Reusa infra IDK. Workers: invite-sender, expiry-checker, completion-notifier. | ✅ Decidida |
| 6 | **DB** Postgres en Patroni16 existente. Schema dedicado `firma_ec_envelopes` aislado por RLS. | Reusa infra. RLS evita cross-tenant leak si hay multi-tenant futuro. | ✅ Decidida |
| 7 | **Notificación primaria WhatsApp** vía Evolution instance `firma-ec` (nueva, no reutilizar bots existentes) | Política IDK: 1 chip = 1 producto. Evita confundir audiencias. | ⚠️ ABIERTA — chip phone? §9.2 |
| 8 | **Notificación fallback email** SMTP (Gmail App Password en bóveda) | Hay usuarios sin WhatsApp. | ✅ Decidida |
| 9 | **Identificación firmantes** por **correo o teléfono E.164 + nombre** + (opcional) cédula. Validación cédula→firma en el moment de firmar comparando contra CN del cert. | El backend no necesita pre-validar cédulas (no es HSM). La identidad real es el cert .p12 del firmante. | ✅ Decidida |
| 10 | **Orden** soporta secuencial y paralelo (mixto en F8.5) | Casos de uso reales: contratos lineales (vendedor → comprador → notario), aprobaciones paralelas (3 directores firman a la vez). | ✅ Decidida |
| 11 | **Cuando todos firmaron**, el backend emite un **document timestamp final** (RFC 3161, TSA reusada de F6) sobre el PDF agregado → resulta en PAdES B-LTA. | Promesa "firma archivable a largo plazo" se mantiene incluso para sobres multi-firmante. | ✅ Decidida |
| 12 | **No reCAPTCHA, no analytics, no SSO de terceros** en el frontend público | Mantener postura privacy-first. SSO solo si lo pide cliente enterprise (F8.5). | ✅ Decidida |
| 13 | **Backend stack** TypeScript + ¿Hono o Nest? | Hono = pequeño/edge-friendly, Nest = patrón conocido del workspace (microtk, moneccu). | ⚠️ ABIERTA §9.1 |
| 14 | **Hosting** ¿Docker Swarm IDK o Cloudflare Workers? | Swarm = infra IDK conocida. Workers = scale-to-zero + ya hay CF Tunnel/Access. Pero Workers complica BullMQ. | ⚠️ ABIERTA §9.3 |
| 15 | **Auth firmantes**: magic-link por email/WhatsApp con TTL 24h, no password | UX más simple, igual de seguro que password reset (mismo vector). | ✅ Decidida |
| 16 | **Auditoría** cada acción (create, view, sign, complete, expire) emite event al `evidence trail` (JSON append-only en DB + hash chained) | LOPDP + valor legal: hash-chain demuestra integridad del trail si va a juicio. | ✅ Decidida |

---

## 2. Arquitectura

```
┌──────────────────┐         ┌────────────────────┐         ┌──────────────┐
│  PWA app.firmar  │  HTTPS  │  Backend (¿Hono?)  │  fetch  │  Patroni16   │
│  .ec  (existing) │ ─────▶  │  envelope service  │ ─────▶  │  Postgres    │
│                  │         │                    │         │  DB firma_ec │
│  + new pages:    │         │  • POST /envelopes │         └──────────────┘
│  /sobres/nuevo   │         │  • GET  /envelopes │
│  /sobres/:id     │         │  • POST /sign      │         ┌──────────────┐
│  /firmar/:token  │         │  • webhook EV      │  enq    │  Redis HA    │
└──────────────────┘         └─────────┬──────────┘ ─────▶  │  DB 10       │
                                       │                    │  BullMQ      │
                                       │                    └──────┬───────┘
                                       │                           │
                                       │                           ▼
                                       │                    ┌──────────────┐
                                       │           consume  │  Worker pool │
                                       │ ◀────────────────  │  invite,     │
                                       ▼                    │  expiry,     │
                              ┌────────────────┐            │  notify      │
                              │  R2 storage    │            └──────┬───────┘
                              │  blobs cifrados│                   │
                              │  AES-256-GCM   │                   ▼
                              └────────────────┘            ┌──────────────┐
                                                            │  Evolution   │
                                                            │  firma-ec    │
                                                            │  instance    │
                                                            └──────────────┘
```

---

## 3. Modelo de datos (Postgres schema `firma_ec_envelopes`)

```sql
CREATE TABLE envelopes (
  id            uuid PRIMARY KEY,
  creator_email text NOT NULL,
  title         text NOT NULL,
  pdf_blob_url  text NOT NULL,           -- R2 path, cifrado AES-256-GCM
  pdf_key       bytea NOT NULL,           -- key cifrada con KEK derivada del envelope id
  status        text NOT NULL,            -- 'pending'|'in_progress'|'completed'|'expired'|'cancelled'
  order_mode    text NOT NULL,            -- 'sequential'|'parallel'
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,     -- created_at + 30d
  completed_at  timestamptz,
  ltv_profile   text                      -- 'B-LT'|'B-LTA' resultado final
);

CREATE TABLE signers (
  id            uuid PRIMARY KEY,
  envelope_id   uuid NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  email         text,
  phone_e164    text,
  cedula        text,                     -- opcional
  order_index   int NOT NULL,             -- 0,1,2... para secuencial
  status        text NOT NULL,            -- 'pending'|'invited'|'signed'|'declined'|'expired'
  magic_token   text,                     -- TTL 24h, regen al reenviar
  magic_token_expires timestamptz,
  signed_at     timestamptz,
  signature_cn  text,                     -- CN del cert que firmó, para verificación post-hoc
  signature_serial_hex text,
  decline_reason text,
  CONSTRAINT unique_signer_per_envelope UNIQUE (envelope_id, order_index)
);

CREATE TABLE events (
  id            bigserial PRIMARY KEY,
  envelope_id   uuid NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
  signer_id     uuid REFERENCES signers(id) ON DELETE SET NULL,
  kind          text NOT NULL,            -- 'created'|'invited'|'viewed'|'signed'|'declined'|'expired'|'completed'
  payload       jsonb NOT NULL,
  hash_prev     bytea,                    -- SHA-256(prev event hash || this row)
  hash_self     bytea NOT NULL,           -- chained, append-only
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- RLS policy: solo el creator y los signers del envelope pueden leer.
ALTER TABLE envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE signers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE events    ENABLE ROW LEVEL SECURITY;
-- Policies se definen al implementar (depende de cómo se autentique el backend).
```

---

## 4. Flujos

### 4.1 Crear sobre (creator → PWA → backend)

1. Creator entra a `/sobres/nuevo` en la PWA, ya autenticado vía `.p12` local (la PWA tiene su cert).
2. Sube PDF + agrega firmantes (display_name, email/phone, cedula?, order).
3. PWA cifra PDF client-side con clave aleatoria, sube a `POST /envelopes` (multipart o pre-signed URL).
4. Backend persiste envelope + signers, crea hash-chain event `created`, encola job `invite-first-signer` (si secuencial) o `invite-all` (si paralelo).
5. Backend devuelve `envelopeId` → PWA redirige a `/sobres/:id` con estado en tiempo real (SSE o polling 5s).

### 4.2 Invitar firmante (worker → Evolution / SMTP)

1. Worker `invite-sender` toma job de BullMQ.
2. Genera magic_token (32 bytes random base64url, TTL 24h), persiste.
3. Envía WhatsApp template via Evolution `firma-ec` instance: `"Hola {nombre}, tienes un documento pendiente de firmar: {titulo}. Firma aquí: https://app.firmar.ec/firmar/{token}"`. Si falla → fallback SMTP.
4. Event log `invited`.

### 4.3 Firmar (firmante → PWA → backend)

1. Firmante abre magic-link, PWA carga `/firmar/:token`.
2. Backend valida token + devuelve `envelopeId` + `signerId` (no devuelve PDF directamente todavía — el flujo confirma identidad primero).
3. PWA pide al firmante su `.p12` + password (igual que firma single-signer).
4. PWA descarga PDF cifrado del backend (`GET /envelopes/:id/pdf?token=`) + key (junto, una sola request authenticated por token).
5. PWA descifra in-memory, firma (PAdES B-LT con DSS), re-cifra, sube vía `POST /envelopes/:id/signatures {token, signed_pdf, signer_cn, signer_serial_hex}`.
6. Backend valida que CN del cert coincida con `display_name` o `cedula` declarada (warn si no coincide, no bloquea — es info para el creator).
7. Backend actualiza `signers.status='signed'`, event log `signed`, encola siguiente firmante (secuencial) o checkea si todos firmaron (paralelo).
8. Si todos firmaron → encola `finalize-envelope`.

### 4.4 Finalizar (worker → TSA → notify)

1. Worker `finalize-envelope` toma último PDF firmado, agrega document timestamp (RFC 3161 vía F6 TSA) → B-LTA.
2. Encola notificación a creator + todos los firmantes con el link final.
3. Marca envelope `completed`.
4. Programa job `cleanup-envelope` para `expires_at` (T+30d).

### 4.5 Expirar/Cancelar

- `expiry-checker` corre cada 1h, marca envelopes pasados de `expires_at` como `expired`, borra blob R2.
- Creator puede `DELETE /envelopes/:id` antes de completion → cancela, borra blob.

---

## 5. Privacidad / LOPDP

**Cambio arquitectónico crítico**: hasta F7, firma.ec era 100% client-side, ZERO PII en backend (no había backend). F8 introduce backend que custodia PDFs + datos de firmantes durante hasta 30 días. Esto NO es opcional para multi-firmante (físicamente imposible coordinar sin estado). Pero debe ser **honesto en el marketing**: actualizar landing + README diciendo que "firma multi-firmante usa backend cifrado, single-signer sigue siendo browser-only".

Controles:

| Control | Implementación |
|---|---|
| Minimización | PDFs autodestruyen tras 30d (configurable per-envelope a 7/14/30d max) |
| Cifrado en reposo | AES-256-GCM blob R2 + KEK derivada del envelope id + master key vault SOPS |
| Cifrado en tránsito | TLS 1.3 only (Caddy ya configurado) |
| Pseudoanonimización | Logs nunca contienen PII (envelopeId/signerId solamente) |
| Derecho de acceso | `GET /envelopes/:id/export?creator_jwt` devuelve JSON con todo el envelope + events + signed PDFs |
| Derecho de supresión | `DELETE /envelopes/:id` también purga events (excepto entrada audit "deleted by request" sin PII) |
| Hash-chain audit | Events append-only, chained — modificar pasado se detecta |
| RLS | Postgres RLS por envelopeId/signerId scope |
| Acceso operativo IDK | Solo alfonso vía SOPS para emergencias. Justificar uso por escrito (log fuera de DB). |
| Aviso LOPDP | Página `/privacidad/multi-firmante` específica explicando flujo + derechos + retención |

---

## 6. API surface (REST, JSON)

```
POST   /api/v1/envelopes              # crear sobre
GET    /api/v1/envelopes/:id          # estado + signers + events (auth: creator JWT o signer token)
DELETE /api/v1/envelopes/:id          # cancelar (creator)
GET    /api/v1/envelopes/:id/pdf      # descargar PDF cifrado (auth)
GET    /api/v1/envelopes/:id/key      # descargar key cifrada (auth)
POST   /api/v1/envelopes/:id/signatures  # subir PDF firmado (auth: signer token)
POST   /api/v1/envelopes/:id/decline  # rechazar firma
POST   /api/v1/envelopes/:id/resend   # reenviar invite a un signer
GET    /api/v1/envelopes/:id/export   # export JSON+PDFs (creator JWT)
GET    /api/v1/health                 # healthcheck (no auth)

POST   /api/v1/webhooks/evolution     # callback Evolution (signed, validated)
```

Auth: JWT HS256 para creator (15 min TTL + refresh 7d), magic_token short-lived (24h) para signer. Tokens en cookie httpOnly + SameSite=Strict.

---

## 7. Seguridad

- **SSRF**: backend NUNCA hace fetch a URLs user-controlled. PDFs vienen vía multipart, no URL.
- **Magic token brute force**: rate limit 5 attempts / IP / token / hora.
- **PDF malicioso**: backend NO ejecuta JS embebido. Storage es opaco. Validación: solo content-type + size cap (50 MiB).
- **OAuth-style XSRF**: doble cookie + SameSite=Strict + Origin header check en mutaciones.
- **Worker DoS**: BullMQ con concurrency cap 10 + dead-letter queue.
- **Magic-link phishing**: dominio `app.firmar.ec` único, no soportar redirect open. Cabecera de email firmada DKIM (SMTP) + WhatsApp template approved.
- **Replay attacks**: nonce en cada sign endpoint, server validates uniqueness.

---

## 8. Out of scope (F8)

- F8.5: Workflows condicionales (if/else, paralelo dentro de secuencial), Adobe-Sign-style.
- F8.5: SAML / OIDC SSO para enterprise.
- F8.6: WebAuthn como segundo factor (firmar con cert + WebAuthn).
- F9: QES eIDAS (HSM remoto, cert ETSI EN 319 411 QC).
- F9: Firma masiva (un PDF firmado por 50+ firmantes a la vez).
- F9: Versionado de PDFs durante el flujo (cambios al PDF post-firma-1).

---

## 9. PREGUNTAS ABIERTAS — bloquean `writing-plans`

### 9.1 Stack backend: **Hono** o **Nest**?

- **Hono**: ~14kb, edge-first (Workers), TypeScript-first, mejor TTFB, menos boilerplate. Pero requiere reimplementar patrones que Nest da gratis (auth guards, DI).
- **Nest**: usado en microtk/moneccu, patrón conocido del workspace, ecosistema rico (Prisma, BullMQ-Nest), pero más pesado (~70mb image).

**Recomendación**: Nest por consistency con workspace y ecosistema BullMQ-Nest oficial. Pero si se quiere Workers (§9.3) → Hono.

### 9.2 Chip WhatsApp para Evolution `firma-ec`

¿Chip dedicado o reusar Evolution `cum` / Evolution01? Política IDK = 1 chip/producto. ¿Comprar chip nuevo o piggy-back inicial sobre `cum` para MVP y dedicar después?

### 9.3 Hosting: **Swarm IDK** o **Cloudflare Workers**?

- **Swarm**: infra conocida, BullMQ trivial, Patroni co-locado. Pero scale-to-zero no existe (mínimo 1 réplica idle).
- **Workers**: scale-to-zero, latencia edge, ya hay CF Tunnel/Access. Pero BullMQ no corre en Workers (no Node runtime para workers). Requiere Cloudflare Queues o cron triggers.

**Recomendación**: Swarm. Costo idle es despreciable, BullMQ-Nest es maduro, Patroni co-locado evita egress.

### 9.4 Pricing

¿Es F8 gratis o de pago? Implicaciones:
- Si gratis: max sobres/mes por creator (rate limit pa' evitar abuse).
- Si pago: Stripe/PayPhone, plan tier (free 3 sobres/mes, pro 50, business unlimited).

**Recomendación**: free MVP con cap 5 sobres activos simultáneos por creator. Decisión de pricing diferida a post-launch real.

### 9.5 Branding del email/WhatsApp

¿Plantillas dicen "firma.ec" o "firmar.ec"? (decisión histórica del proyecto). ¿Logo IDK Manager o firma.ec stand-alone?

### 9.6 ¿Implementar verificación cédula→cert en F8 o diferir?

Validar que CN del cert del firmante contenga la cédula declarada al crear el sobre es defense in depth pero falsea positivos (firmas legítimas con persona jurídica donde CN ≠ cédula). ¿Bloquear o solo warn?

**Recomendación**: solo warn. Mantener UX permisivo, dejar la decisión al creator.

### 9.7 Estimación esfuerzo

- Backend nuevo + tests + deploy + docs LOPDP: ~8 días-persona
- PWA pages nuevas (creator + signer flow) + integración: ~3 días
- Worker pool + cola + evolution wiring: ~2 días
- QA E2E real con .p12 ECI + smoke 3-firmantes: ~1 día
- Margen + iteración: ~2 días
- **Total ~16 días-persona = ~2-3 semanas calendario sólo F8**

---

## 10. Criterio de éxito (release v0.8.0)

- [ ] Sobre con 3 firmantes secuenciales completable end-to-end con 3 `.p12` reales (1 RSA-2048 AES-256, 1 RSA-2048 3DES legacy, 1 ECDSA P-256).
- [ ] PDF final verifica `sigValid=true` para las 3 firmas en verificador firma.ec + Adobe Reader.
- [ ] Profile final = B-LTA.
- [ ] WhatsApp + email invites entregan <30s.
- [ ] Expiración 7d funciona (sobre + blob borrados, audit preservado).
- [ ] LOPDP page publicada + DPIA breve completada.
- [ ] 0 PII en logs (verificado con grep regex emails/teléfonos/cédulas en logs de 1 semana).
- [ ] Cosign-signed release + Rekor tlog.

---

## 11. Próximo paso

Revisar §9 (preguntas abiertas) → cerrar decisiones → cambiar status a "Approved" → invocar `writing-plans` para generar plan de implementación granular tarea-por-tarea.

**No proceder a writing-plans con preguntas abiertas pendientes** — el hard-gate del skill brainstorming aplica.
