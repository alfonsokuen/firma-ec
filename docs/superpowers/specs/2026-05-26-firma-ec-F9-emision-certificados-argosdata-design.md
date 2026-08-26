---
date: 2026-05-26
project: firma-ec
phase: F9
status: **Draft v0.1 — REQUIERE REVISIÓN USER + specs técnicas de Montran (§9) antes de pasar a `writing-plans`**
authors: Alfonso Kuen + Claude
supersedes: null
references:
  - EC_DSGN_API_Genérica.pdf (Montran/ArgosData, Signare, v1.00, 2026-05-15) — descripción FUNCIONAL (sin endpoints/auth/payloads)
  - docs/superpowers/specs/2026-05-10-firma-ec-F8-multi-firmante-design.md  # F8 ya nombra F9 = QES/emisión
  - apps/inbox-backend (Fastify 5 + Prisma 6 + Redis + R2 + jose + zod) — backend existente a reusar
  - LOPDP Ecuador (Ley Orgánica de Protección de Datos Personales) — datos biométricos = categoría especial
  - reference: Ecuador Art.50 LODC (paridad de precio tarjeta=efectivo) — aplica al checkout
  - ETSI EN 319 411-1/-2 (políticas de emisión de certificados), eIDAS QES (informativo)
deliverable_tag: v0.9.0-rc1 (provisional)
estimated_effort: ~3-4 semanas tras specs reales + contrato Montran
---

# F9 — Emisión y venta de certificados de firma electrónica (ArgosData/Signare)

## 0. Goal

Convertir a firmar.ec en **canal/RA (Autoridad de Registro) revendedor** de certificados `.p12` emitidos por **ArgosData (plataforma Signare, Montran)**, integrando vía su API REST `EC_DSGN`. El usuario compra un certificado en firmar.ec, completa onboarding (datos + prueba de vida facial + clave), y recibe su `.p12` — sin que firmar.ec genere ni custodie la llave privada (la genera Signare).

> **Esto es un módulo NUEVO de tienda/RA**, no una extensión del firmador local. El firmador client-side existente (F3–F8) **no se toca**: sigue siendo "tu `.p12` nunca sale del navegador". F9 añade un producto adyacente: *conseguir* el `.p12` (antes lo traías de otra ACE; ahora también lo puedes comprar aquí).

> **Out of scope (F9.0)**: firma de documentos vía Signare (§2.2/§4 del PDF — eso compite con nuestro propio firmador; lo evaluamos en F9.5), tokens HSM, QES eIDAS formal, multi-tenant whitelabel.

---

## 0.1 ⚠️ El PDF NO es implementable tal cual — PERO ya hicimos recon del API real

`EC_DSGN_API_Genérica.pdf` es **puramente funcional**. El 2026-05-26 se hizo **recon read-only** del portal mayorista real (`signare.argosdata.com.ec`, cuenta Asociado de Leandro Gorina) capturando las llamadas XHR de la SPA → **ya tenemos base URL, auth, endpoints, esquema de payload, planes y precios reales** (ver **§12 Apéndice — Hallazgos del API real**). Aun así persisten gaps que requieren a Montran (auth M2M, webhook, sandbox; ver §9). Lo que el PDF omite y el recon parcialmente resolvió:

- Base URL(s) (prod + sandbox) y versionado del API.
- Esquema de **autenticación** (¿API key? ¿OAuth2 client_credentials? ¿mTLS?).
- **Payloads** request/response de cada operación (JSON schema / OpenAPI).
- **Códigos de error** y semántica de rechazo (RC no disponible, prueba de vida fallida, etc.).
- Formato de las **URLs de prueba de vida / ingreso de clave** y su ciclo de vida (TTL, single-use).
- Mecanismo de **seguridad del WebHook** (firma HMAC, mTLS, IP allowlist — el PDF solo dice "mecanismo de seguridad").
- Formato de "**tags/etiquetas** de firma" (§3.5) — sintaxis dentro del PDF.
- **Modelo comercial**: precio mayorista por plan, facturación (prepago/postpago), SLA.

Mientras tanto, este diseño define **interfaces abstractas + stubs** (§3) para que el resto del sistema (UI, checkout, DB, webhooks, colas) se construya y testee sin depender del API real.

---

## 1. Decisiones (algunas ABIERTAS — ver §9)

| # | Decisión | Rationale | Status |
|---|---|---|---|
| 1 | **Backend = extender `apps/inbox-backend`** (Fastify 5 + Prisma + Redis + R2), no framework nuevo | Ya existe y resuelve la duda Hono/Nest de F8. Reusa rate-limit, helmet, jose, zod, raw-body (para webhooks). | ✅ Decidida |
| 2 | **firmar.ec NUNCA toca la llave privada** | Signare genera el `.p12`. Nosotros lo **transportamos efímeramente** al navegador del usuario y lo borramos del backend. Mantiene la promesa de marca. | ✅ Decidida |
| 3 | **El `.p12` se entrega al usuario, no se custodia** | Descargado por el usuario vía link efímero; backend borra el blob tras entrega o TTL corto (≤24h). Sin "billetera de certs" en F9.0. | ⚠️ ABIERTA — ¿custodia opcional? §9.4 |
| 4 | **Datos biométricos (prueba de vida) los procesa Signare**, no firmar.ec | LOPDP: biometría = dato sensible. Mejor que el RA no lo toque; solo orquesta la URL de Signare. | ✅ Decidida |
| 5 | **Pago previo a la solicitud** (prepago), con PayPhone (ya integrado en ecosistema IDK) | No emitir contra Signare (costo mayorista) sin cobrar. PayPhone ~5% lo absorbe el PVP. | ⚠️ ABIERTA — pasarela §9.5 |
| 6 | **Paridad de precio Art.50 LODC**: mismo PVP tarjeta/transferencia/efectivo | [[reference_ecuador_art50_lodc_pagos_tarjeta]] — prohibido recargo por tarjeta o descuento exclusivo a efectivo. | ✅ Decidida |
| 7 | **WebHook receiver con verificación de firma** (raw-body + HMAC/mTLS según lo que exponga Montran) | `fastify-raw-body` ya está en deps. Nunca confiar en el webhook sin verificar origen. | ⚠️ ABIERTA — mecanismo real §9.1 |
| 8 | **Cola BullMQ (Redis HA, nueva DB)** para: poll de estado, reintentos de webhook perdido, entrega/borrado de `.p12`, emails | Reusa patrón F8. DB Redis libre (8/9/10 tomadas → usar 11). | ✅ Decidida |
| 9 | **DB Postgres Patroni16, schema `firma_ec_certs`** aislado por RLS | Reusa infra. Separado de `firma_ec_envelopes` (F8). | ✅ Decidida |
| 10 | **Secretos Signare (API key/cert) en bóveda SOPS**, inyectados como Docker secret `_FILE` | [[reference_secrets_sops_vault]]. Ojo trap `*_FILE` sin env directo ([[feedback_medusa_s3_file_secret_trap]]). | ✅ Decidida |
| 11 | **Idempotencia** en `POST /certs` con `Idempotency-Key` del cliente | Evita doble emisión (= doble cobro mayorista) si el usuario reintenta. | ✅ Decidida |
| 12 | **Estado de la solicitud espejado en nuestra DB**, no solo en Signare | Trazabilidad propia + UI de seguimiento sin depender de latencia/uptime de Signare. WebHook + poll de respaldo. | ✅ Decidida |
| 13 | **Onboarding del solicitante vía PWA existente** (nuevas rutas `/certificados/*`) | No app nueva; sigue Svelte 5 + svelte-spa-router. Cuidado hrefs `#/` ([[feedback_spa_hash_router_button_href_2026-05-10]]). | ✅ Decidida |
| 14 | **Prueba de vida y ingreso de clave**: redirigir al usuario a las URLs de Signare (webview/redirect), no reimplementar | Evita tocar biometría y la captura de clave del cert. | ✅ Decidida |

---

## 2. Arquitectura

```
  ┌────────────────────┐         ┌──────────────────────────┐        ┌─────────────────┐
  │  PWA app.firmar.ec │  HTTPS  │  inbox-backend (Fastify)  │  REST  │  Signare API    │
  │  (Svelte, existing)│ ──────▶ │  + módulo certs (NUEVO)   │ ─────▶ │  (ArgosData/    │
  │  nuevas rutas:     │         │                           │        │   Montran)      │
  │  /certificados/    │         │  • POST /certs            │        │  • crear cert   │
  │    comprar         │ ◀────── │  • GET  /certs/:id        │ ◀───── │  • prueba vida  │
  │    /:id/estado     │ redirect│  • GET  /certs/:id/p12    │ webhook│  • registro civ │
  │    /:id/descargar  │ a URLs  │  • POST /webhooks/signare │        │  • planes precio│
  └────────────────────┘ Signare └─────┬──────────┬──────────┘        └─────────────────┘
        │                              │          │
        │ redirect prueba de vida      │          │ enqueue
        │ + ingreso de clave           ▼          ▼
        └─────────────────▶  ┌──────────────┐  ┌──────────────┐
          (URLs Signare)     │  Patroni16   │  │  Redis HA    │
                             │  Postgres    │  │  BullMQ DB11 │
                             │ firma_ec_certs│ │  workers:    │
                             │  (RLS)       │  │  • poll      │
                             └──────────────┘  │  • deliver   │
                                               │  • cleanup   │
                                               └──────────────┘
  Pago: PayPhone (prepago) ──▶ webhook pago OK ──▶ libera POST /certs hacia Signare
```

**Principio rector**: el backend es un **orquestador + caché de estado + caja registradora**. No genera criptografía, no custodia llaves, no procesa biometría. Signare hace lo pesado; nosotros vendemos, cobramos, seguimos el estado y entregamos.

---

## 3. Mapeo del API (funcional → contrato concreto + stub)

El PDF enumera operaciones por nombre. Definimos una **interfaz `SignareClient`** que abstrae el API real; hoy con un **stub/fake** que devuelve fixtures, mañana con el adaptador HTTP real cuando llegue el OpenAPI.

| PDF (sección) | Operación funcional | Método del cliente (propuesto) |
|---|---|---|
| §2.1 paso 3 / §3 | Solicitar creación de certificado | `createCertificate(input): { certId, status }` |
| §3.1 | Obtener información del certificado | `getCertificate(certId)` |
| §3.2 | Aprobar información del certificado (por id o certCode) | `approveCertificate(certId \| certCode)` |
| §3.3 | Consultar certificados por usuario (email, paginado) | `listCertificatesByUser(email, page)` |
| §3.4 | Descargar `.p12` por identificador | `downloadP12(certId): Uint8Array` |
| §4.2 | Listar planes de precio | `listPricingPlans()` |
| §4.3 | WebHook "certificado creado" | (entrante) `POST /webhooks/signare` |
| §3.5.* | Gestión documentos (firma) | **diferido a F9.5** |
| §3.6.* / §4 | Invitaciones / firma con cert existente | **diferido a F9.5** |

```ts
// packages/signare-client/src/types.ts  (NUEVO paquete)
export interface CreateCertificateInput {
  cedula: string;
  codigoDactilar: string;
  nombres: string;
  apellidos: string;
  direccion: string;
  pais: string;
  provincia: string;
  ciudad: string;
  telefono: string;
  codigoPaisTelefono: string;     // ej. "593"
  tipoPersona: 'NATURAL' | 'JURIDICA';  // confirmar enum real con Montran
  email: string;
  planPrecioId: string;
  claveIngresadaPorCliente: boolean; // §12 del flujo: ¿clave manual o auto?
  idempotencyKey: string;
}

export type CertStatus =
  | 'CREATED' | 'RC_VALIDATING' | 'RC_REJECTED'
  | 'LIVENESS_PENDING' | 'LIVENESS_URL_READY' | 'LIVENESS_REJECTED'
  | 'FACE_MATCH_REJECTED' | 'KEY_PENDING' | 'KEY_URL_READY'
  | 'GENERATING' | 'ISSUED' | 'FAILED';

export interface CreateCertificateResult {
  certId: string;
  certCode?: string;
  status: CertStatus;
  livenessUrl?: string;   // URL a la que redirigimos al usuario (§6.1/§8 PDF)
  keyEntryUrl?: string;   // URL de ingreso de clave (§12.1 PDF), si aplica
}

export interface SignareClient {
  createCertificate(i: CreateCertificateInput): Promise<CreateCertificateResult>;
  getCertificate(certId: string): Promise<{ status: CertStatus; /* … */ }>;
  approveCertificate(ref: { certId?: string; certCode?: string }): Promise<void>;
  listCertificatesByUser(email: string, page?: number): Promise<unknown>;
  downloadP12(certId: string): Promise<Uint8Array>;
  listPricingPlans(): Promise<Array<{ id: string; nombre: string; costoMayorista?: number }>>;
}
```

```ts
// packages/signare-client/src/fake.ts  — permite construir TODO sin el API real
export class FakeSignareClient implements SignareClient { /* fixtures + transiciones simuladas */ }
// packages/signare-client/src/http.ts   — adaptador real (RELLENAR con OpenAPI de Montran)
```

> Esta separación es lo que destraba el trabajo: UI, checkout, DB, colas y webhooks se desarrollan y testean contra `FakeSignareClient`. El día que llegue el OpenAPI, solo se implementa `http.ts` y se cambia la inyección.

---

## 4. Modelo de datos (Prisma, schema `firma_ec_certs`)

```prisma
model CertOrder {
  id              String   @id @default(uuid())
  // identidad del comprador (mínima — NO biometría)
  email           String
  cedula          String
  nombres         String
  apellidos       String
  planId          String
  // comercial
  pvp             Decimal  @db.Decimal(10,2)   // precio al público (Art.50: único por método)
  paymentStatus   PaymentStatus @default(PENDING)
  paymentRef      String?
  idempotencyKey  String   @unique
  // espejo del estado Signare
  signareCertId   String?  @unique
  signareCertCode String?
  status          String   // CertStatus espejado
  livenessUrl     String?
  keyEntryUrl     String?
  // entrega del .p12 (efímero)
  p12Key          String?  // ruta R2 cifrada; null tras entrega/cleanup
  p12DeliveredAt  DateTime?
  p12ExpiresAt    DateTime?
  // auditoría (LOPDP + valor legal): trail hash-chained como en F8
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  events          CertEvent[]
}

model CertEvent {
  id        String   @id @default(uuid())
  orderId   String
  order     CertOrder @relation(fields: [orderId], references: [id])
  type      String   // CREATED, PAID, RC_OK, LIVENESS_OK, ISSUED, DELIVERED, FAILED…
  payload   Json
  prevHash  String?  // hash-chain append-only
  hash      String
  at        DateTime @default(now())
}

enum PaymentStatus { PENDING PAID FAILED REFUNDED }
```

> **No** guardamos: fotos de prueba de vida, la clave del cert, ni la llave privada. El `.p12` vive en R2 cifrado (AES-256-GCM, key por orden, patrón F8 decisión #4) solo entre `ISSUED` y entrega, máx 24h.

---

## 5. Flujos

### 5.1 Compra + emisión (flujo principal, mapea §2.1 del PDF)

1. Usuario en PWA `/certificados/comprar` → elige plan (de `listPricingPlans`), ingresa datos (§1 PDF), acepta términos + tratamiento de datos (LOPDP).
2. PWA → `POST /certs` (backend crea `CertOrder` status `PENDING`, genera `Idempotency-Key`).
3. Backend → checkout PayPhone (prepago). Usuario paga. Webhook pago `PAID`.
4. Backend → `signare.createCertificate(...)`. Guarda `signareCertId`, status `CREATED`.
5. Signare valida RC → si OK devuelve `livenessUrl`. Backend la espeja (vía webhook o poll).
6. PWA redirige al usuario a `livenessUrl` (prueba de vida en Signare). El usuario vuelve a `/certificados/:id/estado`.
7. Signare compara fotos vs RC. Si clave manual → `keyEntryUrl` → redirigir; si auto → Signare la genera.
8. Signare genera `.p12` → dispara **WebHook "certificado creado"**.
9. Backend recibe webhook (verifica firma), `downloadP12(certId)`, lo cifra en R2, status `ISSUED`, encola email + notifica PWA.
10. Usuario descarga en `/certificados/:id/descargar` (link efímero). Backend marca `DELIVERED`, programa cleanup.

### 5.2 Rechazos
Cada rechazo del PDF (RC no disponible 5.1, info incorrecta 6.1, no-vivo 10.1, face mismatch 11.2) → status terminal + evento + **política de reembolso** (¿se cobró antes de emitir? si Signare no cobra por intento fallido, reembolsar PayPhone; si cobra, definir con Montran — §9.6).

### 5.3 Diferidos a F9.5
Firma de documentos vía Signare (§2.2/§4 PDF). **Decisión estratégica pendiente**: esto *compite* con nuestro firmador client-side. Solo tiene sentido si Signare ofrece algo que no tenemos (p.ej. firma server-side con cert recién emitido sin que el user maneje el `.p12`). Evaluar en §9.7.

---

## 6. Comercial (paridad legal + márgenes)

- **Base de costos = precios ACTUALES de la cuenta de Leandro** (actualizados 2026-05-26, IVA 15% incl.): 7D **$5.50** · 1m **$8.75** · 1A **$14.50** · 2A **$22.00** · 3A **$33.00** · 4A **$38.85** · 5A **$47.65**. ⚠️ Los precios que capturé del portal ($8/$23.60/$35.90…) quedaron **desactualizados** — en runtime usar `listPricingPlans()`. Codificado como `COSTOS_ACTUALES`.
- **Comisión PayPhone = costo.** 5% + IVA 15% sobre la comisión = **5.75% efectivo** del PVP. Neto = `PVP × 0.9425`. PVP para ganancia objetivo `G`: **`PVP = (costo + G) / 0.9425`**. Calculadora en `signare-client/pricing-calc.ts` (`pvpForProfit`, `profitAtPvp`, `netAfterGateway`). Si en cambio cobra Signare vía Paymentez, la comisión la asume ArgosData (no PayPhone propio).
- **Modelo de negocio: COMPRA al costo Leandro, VENDE al precio "Asociado".** El PVP = precio Asociado. IVA pass-through (firmar.ec acredita el IVA pagado en costo + comisión y remite el cobrado). Margen REAL (`marginTableAsociado()` en `signare-client/margins.ts`):

**Modelo de margen CONFIRMADO por el usuario (2026-05-26)** — `netMargin()` en `pricing-calc.ts`:
**`margen = venta − IVA_venta − comisiónPayPhone − costo + IVA_costo(crédito)`** = `venta×0.81207 − costo/1.15`.
(De la venta se resta el IVA contenido y la comisión PayPhone 5.75%; del costo se ACREDITA su IVA. No acredita el IVA de la comisión PayPhone — opción menor disponible.)

| Plan | Costo | PVP (Asociado) | IVA venta | PayPhone | IVA costo (créd.) | **Margen neto** |
|---|---|---|---|---|---|---|
| 7D | 5.50 | 8.00 | 1.04 | 0.46 | +0.72 | **1.71** |
| 1m | 8.75 | 12.30 | 1.60 | 0.71 | +1.14 | **2.38** |
| 1A | 14.50 | 23.60 | 3.08 | 1.36 | +1.89 | **6.56** |
| 2A | 22.00 | 35.90 | 4.68 | 2.06 | +2.87 | **10.02** |
| 3A | 33.00 | 52.40 | 6.83 | 3.01 | +4.30 | **13.86** |
| 4A | 38.85 | 64.70 | 8.44 | 3.72 | +5.07 | **18.76** |
| 5A | 47.65 | 75.50 | 9.85 | 4.34 | +6.22 | **19.88** |

> ⚠️ **Privacidad comercial**: el endpoint público `/api/certificados/planes` devuelve SOLO el PVP. `costoMayorista` + `margen` se exponen únicamente con `?view=operator` (en prod gatear con auth) — NO se filtran al cliente.
- **Art.50 LODC** ([[reference_ecuador_art50_lodc_pagos_tarjeta]]): un **único PVP** para todos los métodos de pago; prohibido recargo por tarjeta o descuento solo-efectivo. El margen se ajusta vía PVP uniforme, nunca por método.
- Listar planes desde `listPricingPlans()` pero **mostrar nuestro PVP**, no el mayorista.

---

## 7. Privacidad / LOPDP y resolución de la tensión de marca

- **Tensión**: la marca dice "100% client-side, tu `.p12` nunca sale del navegador". F9 es server-side por naturaleza.
- **Resolución narrativa**: separar claramente dos productos en la UI y el copy:
  - **Firmar/Verificar** (F3–F8) → "100% local, tu llave nunca sale de tu equipo". **Sin cambios.**
  - **Comprar certificado** (F9) → "emitido por ArgosData (ACE acreditada); firmar.ec es el canal. Tu llave se genera en la ACE y se te entrega; firmar.ec no la conserva."
  - Nunca mezclar los claims. El firmador local **no** depende de F9.
- **LOPDP**: biometría (prueba de vida) = dato de categoría especial → la procesa **Signare** (el responsable del tratamiento biométrico es la ACE). firmar.ec actúa como RA/encargado de datos de identidad básica; requiere: aviso de privacidad específico de F9, consentimiento explícito, minimización (no almacenar fotos ni clave), DPA con Montran.
- **`.p12` efímero**: borrado verificable tras entrega; cifrado en reposo; key separada del blob.

---

## 8. Seguridad

- **WebHook**: `fastify-raw-body` + verificación de firma (HMAC sobre raw body, o mTLS, o IP allowlist — según §9.1). Rechazar todo lo no verificado. Idempotencia por `signareCertId` (webhook puede repetirse).
- **Secretos**: API key/cert Signare en SOPS → Docker secret `_FILE` (cuidar el trap: setear también el env directo si la lib lo exige, [[feedback_medusa_s3_file_secret_trap]]).
- **Rate-limit** en `POST /certs` (anti-abuso de emisión = anti-fraude de costo mayorista).
- **Idempotency-Key** obligatoria hacia Signare y desde la PWA.
- **CSP**: las URLs de Signare (prueba de vida) probablemente exijan abrir dominio externo → ajustar CSP/`form-action`/`frame-src` solo en las rutas `/certificados/*`, sin relajar la CSP del firmador.

---

## 9. Preguntas abiertas / info BLOQUEANTE de Montran

| # | Pregunta | Para |
|---|---|---|
| 9.1 | OpenAPI/Swagger/Postman: base URLs (prod+sandbox), **auth**, payloads, errores, **firma del webhook** | Implementar `http.ts` real (§3) |
| 9.2 | Costo **mayorista** por plan + modelo de facturación (prepago/postpago, SLA) | Fijar PVP (§6) |
| 9.3 | TTL y ciclo de vida de `livenessUrl` / `keyEntryUrl` (single-use, expiración) | Flujo redirect (§5) |
| 9.4 | ¿Custodia opcional del `.p12` o siempre entrega-y-olvida? | Decisión #3 |
| 9.5 | Pasarela de pago: ¿PayPhone, o Signare ya factura al usuario final? | Decisión #5 |
| 9.6 | ¿Signare cobra por intentos **fallidos** (RC/vida/face)? Política de reembolso | §5.2 |
| 9.7 | ¿Vale la pena firmar documentos vía Signare (§2.2/§4) vs nuestro firmador? | Scope F9.5 |
| 9.8 | Contrato/DPA Montran: rol RA, responsabilidades LOPDP, marca | §7 legal |
| 9.9 | Sintaxis de "tags/etiquetas" de firma en el PDF (§3.5) | Solo si F9.5 |

---

## 10. Fases de entrega

| Sub-fase | Alcance | Depende de |
|---|---|---|
| **F9.0a** ✅ | Paquete `signare-client` (tipos reales + `FakeSignareClient` + pricing/márgenes/PayPhone calc). 15/15 tests. | hecho |
| **F9.0b** ✅ | Módulo backend `certs` (rutas planes/solicitudes, fake) + ruta PWA `/certificados`. 8/8 tests. | hecho |
| **F9.0c** ✅ | Checkout: abstracción PayPhone + orquestación orden→pago→Signare (`cert-orders`), rutas `/checkout`; UI PWA `/certificados/comprar` (form + docs + redirect pago). 6/6 tests. Todo contra fakes; sin montar en server.ts ni pago real. | hecho |
| **F9.2** 🟡 | Persistencia: modelos Prisma `cert_orders`/`cert_order_events` (migración `0002_cert_orders` creada, **NO aplicada**), `CertOrderStore` (InMemory + Prisma) + `CertFileVault` (archivos fuera de BD, purga LOPDP tras enviar). 17/17 tests cert; 138/138 backend sin regresión. Falta: aviso/consentimiento LOPDP en UI, reembolsos, observabilidad, R2 real para la bóveda. | parcial |
| **F9.1** 🟡 | Adaptador `http.ts` real: **lectura VERIFICADA en vivo** con creds de Leandro (`listPricingPlans` público server-side ✅ test `http.live.test.ts`; `certificate-requests`/`certificates` autenticados 200 vía navegador). **Falta**: creación (necesita M2M o login server-side con cookies name-only) + adapter PayPhone real + webhook + sandbox. | parcial — gap auth M2M |
| **F9.3** | Bóveda R2 real (cifrado AES-GCM + TTL purge), entrega `.p12`/CSR, hardening LOPDP UI | F9.2 |
| **F9.5** | (Opcional) Firma de documentos vía Signare | §9.7 |

> **Lo accionable hoy** = F9.0a/b/c con `FakeSignareClient`. No bloqueado por Montran. Todo lo que toca el API real (F9.1+) espera el OpenAPI.

---

## 11. Próximo paso

Tras revisión de este draft y respuestas a §9 (faltantes: 9.1 auth M2M, webhook, sandbox), pasar a `writing-plans` para el plan de implementación de **F9.0a** (el paquete `signare-client` + stub es el primer entregable y destraba todo lo demás). El recon (§12) ya permite tipar `signare-client` contra el contrato REAL, no inventado.

---

## 12. Apéndice — Hallazgos del API real (recon read-only 2026-05-26)

> Capturado vía portal `signare.argosdata.com.ec` (cuenta mayorista "Asociado", Leandro Gorina), inspeccionando XHR de la SPA. **No se emitió ningún certificado** (sin llamadas `POST` de creación). Credenciales cifradas en SOPS: `apps_firma_ec.signare_argosdata_*`.

### 12.1 Infraestructura
- **Base URL API**: `https://api.argosdata.com.ec`
- **Portal (SPA)**: `https://signare.argosdata.com.ec` — v.1.11.0, Powered by Montran.
- **Backend**: **Spring Boot** (respuestas con `pageable`/`Sort`/`totalElements` = Spring Data Page; OAuth2 Spring Authorization Server).
- **Auth** (detallado por recon en vivo 2026-05-26 con creds de Leandro):
  - **Login**: `POST /auth/public/users/login?username=<email>&type=PUBLIC&g-recaptcha-response=` con body JSON `{"email","password","g-recaptcha-response":""}` (password en **texto plano**, sin cifrado cliente; el email va en query Y body). reCAPTCHA viaja vacío y aun así pasa.
  - **Dance OAuth**: login → `GET /sso/login` (302) → `/auth/oauth/authorize?client_id=api-gateway` (302) → `/sso/login?code=…` (302) → cookie de sesión.
  - ⚠️ **Cookies anómalas**: las de sesión tienen el **nombre = token opaco y valor vacío** (`Set-Cookie: NjM5…; HttpOnly`). El jar Netscape de curl las descarta → replicar el dance en Node es frágil. El navegador (y un cliente que preserve Set-Cookie verbatim) sí funciona.
  - ✅ **`pricing-plans` es PÚBLICO** (sin auth): el adaptador `listPricingPlans` funciona server-side HOY (test live `http.live.test.ts`, gated por `SIGNARE_LIVE=1`).
  - ✅ **Endpoints de lectura autenticados verificados en vivo** (200): `certificate-requests` (165), `certificates` (155) — formas = tipos del paquete.
  - ⚠️ **Gap server-to-server**: para `createCertificateRequest` y descargas autenticadas falta **OAuth `client_credentials` (M2M)** de Montran, o un login server-side que preserve las cookies name-only. Sigue siendo el gap #1 (§9.1).
  - Los tiers de costo distribuidor NO se exponen por `acronym` público (devuelve vacío) → atados al contrato de la cuenta; `COSTOS_ACTUALES` es la fuente.

### 12.2 Endpoints observados (todos GET salvo login)
| Endpoint | Uso |
|---|---|
| `GET /auth/public/users/keys?keys=PUBLIC_GOOGLE_RECAPTCHA_API` | config pública (reCAPTCHA key) |
| `POST /auth/public/users/login?username=&type=PUBLIC&g-recaptcha-response=` | login |
| `GET /auth/oauth/authorize?client_id=api-gateway&...` → `/sso/login?code=&state=` | flujo OAuth |
| `GET /users/operator/validator?email=` | valida que el usuario es operador |
| `GET /api/cert/certificate-requests?currentPage=&pageSize=` | **solicitudes** (PDF §3) — paginado Spring |
| `GET /api/cert/certificates?currentPage=&pageSize=` | **certificados emitidos** (PDF §3.3) |
| `GET /api/cert/config/certificate-request?isOperator=true&allowFaceLiveness=false` | **schema dinámico del formulario de creación** |
| `GET /api/cert/config/person-nature` | tipos de persona |
| `GET /api/cert/countries` | catálogo de países |
| `GET /api/cert/public/pricing-plans/nature?personNature=natural&acronym=Asociado` | **planes + precios** (PDF §4.2) |
| `GET /api/cert/parameters/name?name=physical.token.price` | precio de token físico |
| `GET /api/cert/national-registry/bypass` | bypass de validación Registro Civil (modo operador) |

> El namespace de negocio es **`/api/cert/...`**. Probable Swagger en `/api/cert/swagger-ui.html` o `/api/cert/v3/api-docs` (NO verificado aún — read-only pendiente).

### 12.3 Precios REALES tier mayorista "Asociado" (IVA 15% incluido)
`GET /api/cert/public/pricing-plans/nature?personNature=natural&acronym=Asociado`:

| planId | Título | Total (PVP mayorista) | Base imponible | IVA | Periodo |
|---|---|---|---|---|---|
| 345 | 7 días AS | **$8.00** | 6.96 | 1.04 | 7 DAYS |
| 346 | One Shot AS | **$12.30** | 10.70 | 1.60 | 1 MONTH |
| 347 | 1 año AS | **$23.60** | 20.52 | 3.08 | 1 YEAR |
| 348 | 2 años AS | **$35.90** | 31.22 | 4.68 | 2 YEARS |
| 349 | 3 años AS | **$52.40** | 45.57 | 6.83 | 3 YEARS |
| 350 | 4 años AS | **$64.70** | 56.26 | 8.44 | 4 YEARS |
| 351 | 5 años AS | **$75.50** | 65.65 | 9.85 | 5 YEARS |

> Estos son los **costos mayoristas** (lo que paga el revendedor). El PVP al público de firmar.ec se fija sobre estos (§6), con paridad Art.50 LODC. Para revender hay que cubrir además la comisión de la pasarela (PayPhone ~5%). El operador `sasgorina` ya registra **165 solicitudes** históricas.

### 12.4 Esquema REAL del payload de creación (`config/certificate-request`)
Dos `personNature`: **`natural`** y **`legalRepresentative`**. Campos (`name` = clave del payload):

**natural** — `idType` (radio: `citizen`), `idNumber` `^[0-9]{10}$` (cédula), `fingerPrintId` `^[A-Z0-9]{6,10}$` (código dactilar), `idRuc` `^[0-9]{13}$` (opcional), `names`, `surNames`, `country` (select), `province`, `city`, `homeAddress`, `phoneExtension` (select), `phoneNumber` `^[0-9]{10}$`, `requestorEmail`.

**legalRepresentative** — todo lo anterior + `position`, `companyName`, `companySocialReason`, `idRuc` `^[0-9]{10}001$`, `companyRup`.

**Documentos (multipart, imágenes ≤5MB c/u)**:
- natural: `citizenDoc` (jpg/png), `lifeTest` (jpg/png), `photo` (jpg/png) — todos `required`.
- legalRepresentative: + `docMercantileRegistry` (.pdf), `authLetter` (.pdf).

> 🔑 **Diferencia clave vs el PDF**: en el **flujo de operador/mayorista** la "prueba de vida" **NO es un redirect a una URL de Signare** (como narra el PDF §2.1 paso 7-8) — el operador **sube una foto `lifeTest`** + `citizenDoc` + `photo`, con `allowFaceLiveness=false` y `national-registry/bypass`. La verificación puede ser `manualVerification`/`automaticVerification` (campos vistos en `certificate-requests`). **Esto cambia el flujo §5.1**: firmar.ec como operador recolecta documentos/fotos del solicitante y los sube, en vez de redirigir. Implica que **firmar.ec SÍ tocaría imágenes de identidad/biometría** → revisar decisión #4 y la postura LOPDP (§7) con esta realidad.

### 12.5 Estados reales (`status`) observados en `certificate-requests`
`COMPLETE`, `WAITING_KEYSTORE`, `REJECTED`. Otros campos del registro: `certificateRequestId`, `certCode` (formato `CR<AAAAMMDD><seq>`), `cost` (centavos string), `periodType` (`DAYS|MONTHS|YEARS|NOT_APPLY`), `duration`, `score`/`similarity`/`score2`/`similarity2` (resultados biométricos), `reason` (motivo rechazo), `manualVerification`, `automaticVerification`, `needPayment`, `paymentUrl`, `paymentInformation{paymentId, amount, status, ...}`, `personNature`, `physicalToken`, `csr`, `keyStore`.

> `WAITING_KEYSTORE` ≈ el "ingreso de clave" del PDF (§13). `needPayment`/`paymentUrl` confirman que el pago lo orquesta Signare (revisar decisión #5: quizá no necesitamos PayPhone propio, sino consumir su `paymentUrl`).

### 12.6 OpenAPI (`/api/cert/v3/api-docs`) — DTOs reales
OpenAPI 3.0.1 disponible (guardado en `argosdata-openapi/cert-api-docs-2026-05-26.json`). 23 paths (grupo de gestión: filter, reject, payment, pricing-plans, coupon, faceliveness; el `POST` de creación NO está en este grupo — filtrado/otro servicio). Server interno leakeado: `http://<SERVIDOR-INTERNO-ARGOSDATA>`. DTOs clave:

- **`CertificateRequestCreationDTO`**: `email`, `properties` (object — los campos personales del §12.4), `files[]` (docs), `acceptedWill`, `acceptedContract`, `faceLiveness` (bool), **`csr` / `csrFile` / `csrContent`**, `couponCode`/`couponDiscount`, `certCode`, `videoCodec`.
- **`CertificateRequestDTO`** / **`CertificateResponse`**: este último con `subjectDN`, `issuerDN`, `notValidBefore/After`, `serialNumber`, `status`, `personNature`, **`renewalStatus`/`renewalCertCode`/`renewalCondition`** (soporta renovaciones).
- **Pago = Paymentez**: `POST /payment/init_reference` con `InitReferenceDTO{ order:InitReferenceOrderDTO(amount, taxable_amount, tax_percentage, vat, dev_reference), user:PaymentezUserDto(email), conf, locale }` + `/payment/refund-transaction/{ref}` + `/payment/refunds`.
- **Cupones**: `GET/POST /coupon`, `CouponDTO{ code, discount, numberUses, personNature, domain, status }`.
- **Pricing**: `GET/POST/PUT/DELETE /pricing-plans` (`PricingPlanDTO` = el §12.3).
- **Face liveness pública**: `GET /public/certificate-requests/find-faceliveness/{certCode}`, `reject-faceliveness/{certCode}`, `/public/certificate-requests/url`, `verify-certcode`.

> 🔑🔑 **3 hallazgos que cambian el diseño**:
> 1. **CSR propio soportado** (`csr`/`csrContent`) → el keypair se genera **en el navegador**, se envía solo el CSR, Signare devuelve el cert firmado (no un `.p12` con la llave). **Esto preserva la promesa "tu llave nunca sale del navegador"** y reescribe la decisión #2/#3 y §7 (tensión de marca casi disuelta). **Confirmar con Montran** que el flujo operador admite CSR (vimos `csr:false`/`keyStore:false` en los registros → hoy usan keystore, pero el DTO lo permite).
> 2. **Pago vía Paymentez ya integrado** → revisar decisión #5: podríamos NO necesitar PayPhone propio; consumir `init_reference` o cobrar nuestro PVP aparte y pagar el mayorista con su flujo.
> 3. **Cupones + renovación** nativos → palancas comerciales (descuento mayorista por volumen, recompra).

### 12.7 Acción pendiente de recon (read-only, no ejecutado)
- El `POST` de creación real **observando** una solicitud que haga el operador (sin que la dispare Claude) — para ver `properties` poblado y el manejo de `files`.
- Confirmar con Montran: cliente OAuth M2M, seguridad webhook, sandbox, y soporte CSR en flujo operador.
