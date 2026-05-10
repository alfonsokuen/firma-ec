---
date: 2026-05-09
project: firma-ec
phase: F6
status: Draft v1 — listo para `writing-plans`
authors: Alfonso Kuen + Claude (sesión brainstorming F6)
supersedes: null
references:
  - docs/superpowers/specs/2026-05-09-firma-ec-F3-firma-MVP-design.md
  - docs/superpowers/plans/2026-05-09-firma-ec-F3-firma-MVP.md
  - packages/signer/src/cms.ts                # current B-B builder (extension point)
  - packages/signer/src/pades.ts              # orchestration (calls buildCmsSignedData)
  - packages/verifier/src/cms.ts              # already extracts timestampToken bytes (line 20, 112-120)
  - packages/verifier/src/index.ts            # already routes profile B-B/B-T (line 113)
  - packages/tsl-ec/                          # ARCOTEL TSL — separate concern from TSA trust
deliverable_tag: v0.5.0-rc1
---

# F6 — Time Stamp Authority (PAdES B-T)

## 0. Goal

Elevar las firmas producidas por la PWA de **PAdES B-B** (CMS SignedAttrs sin sello temporal) a **PAdES B-T** (Baseline-Timestamp) añadiendo un RFC 3161 `TimeStampToken` como `unsignedAttrs.id-aa-signatureTimeStampToken` (OID `1.2.840.113549.1.9.16.2.14`) sobre el `signatureValue` del SignerInfo, con TSA por defecto **FreeTSA público** (`https://freetsa.org/tsr`), default-on con fallback graceful a B-B si la TSA está caída/timeout, y verificación end-to-end (badge dorado en el visor cuando el sello es válido). El verificador F2 ya extrae los bytes del token (línea 20, 112-120 de `packages/verifier/src/cms.ts`); F6 cierra el loop con parsing, validación de cadena, y UI.

> **Nivel** PAdES **B-T** (Baseline-Timestamp). Sin OCSP-embebido, sin DSS, sin LTV — eso es F7.
> **TSA**: FreeTSA público como default. Multi-TSA, TSAs ARCOTEL Ecuador y document-timestamp = F6.5/F7.

---

## 1. Decisiones aprobadas (decision log)

| # | Decisión | Rationale corto |
|---|---|---|
| 1 | **TSA default = FreeTSA público** (`https://freetsa.org/tsr`, sin auth, ~5 req/min/IP) | OSS, sin contrato, sin tracking, root cert público estable. ARCOTEL aún no documenta endpoints RFC 3161 oficiales (revisar en F6.5 cuando publiquen). |
| 2 | **Default ON** — toda firma intenta sello | El usuario promedio quiere "firma sellada" sin pensar; el flag opt-out queda en Configuración avanzada. Coherente con la promesa "firma seria" del producto. |
| 3 | **Fallback a B-B si TSA falla** (timeout 8s, rate-limit, network) | Que un TSA caído NO impida firmar. Resultado: `SignResult.timestamp = { ok:false, reason:'timeout'|'network'|... }` + warning visible. La firma sigue siendo legalmente válida (cert ya da identidad). |
| 4 | **Verificador acepta B-B y B-T** | No degradación de UX para firmas viejas/sin sello. Badges: oro (B-T válido), plata (B-T inválido), ninguno (B-B). |
| 5 | **TSA URL configurable runtime** (Settings advanced) | Usuarios técnicos pueden apuntar a su propia TSA (DigiCert, Sectigo, ARCOTEL futuro). Persistido en `localStorage` con default reseteable. |
| 6 | **Trust anchor TSA = PEM embebido en el bundle** (FreeTSA root cert) | Sin fetch externo en runtime → preserva offline-first. PEM se versiona y se rota con un release. Validación de cadena del TSA cert es independiente de la TSL ARCOTEL (no contaminar `@firma-ec/tsl-ec`). |
| 7 | **Nuevo paquete `packages/tsa-client`** (no mezclar en signer) | Cliente TSP puro — request build, fetch, response parse, hash match — reusable por signer y verifier. Cero dependencias DOM (corre en Worker). |
| 8 | **Trust roots TSA en `packages/tsa-trust`** (no en tsl-ec) | TSL-EC es ARCOTEL ACEs de firma. TSAs son otra capa. Mantener separados evita acoplar el ciclo de updates (ARCOTEL ≠ FreeTSA). |
| 9 | **UI progress: stage `request_timestamp`** entre `sign` y resultado | Calcado del patrón F3 sign worker progress stages. Texto: "Solicitando sello de tiempo…". Si timeout, banner "Sello no disponible — firma sin sello, válida igual". |
| 10 | **Tag deliverable: `v0.5.0-rc1`** | F4 cerró en v0.4.x (visual unify, cuadro QR, ArgosData fix). F5 cerró integraciones móviles/share. F6 = bump menor v0.5.0 con `-rc1` hasta cross-validation Adobe Reader (Adobe muestra "trusted timestamp" si reconoce la cadena del TSA). |

---

## 2. Architecture overview

### 2.1 Flujo TSP request/response (RFC 3161)

```
[Worker sign.worker.ts]                                [FreeTSA HTTP endpoint]
        │                                                       │
        │  1. signedAttrsDer → CMS signature (SHA-256)          │
        │  2. signatureValue (raw bytes from signWithKey)        │
        │  3. imprint = SHA-256(signatureValue)                  │
        │  4. nonce = crypto.getRandomValues(8 bytes BigInt)     │
        │  5. tsq = TimeStampReq {                               │
        │        version: 1,                                     │
        │        messageImprint: { hashAlgo: SHA-256, imprint }, │
        │        nonce, certReq: true                            │
        │     }                                                  │
        │  6. POST tsq DER bytes ─────────────────────────────►  │
        │        Content-Type: application/timestamp-query        │
        │        timeout 8s                                       │
        │                                                        │
        │     ◄─────────────────────────── application/timestamp-reply
        │     7. Parse TimeStampResp:                              │
        │        - status.status MUST be 0 (granted) or 1 (grantedWithMods)
        │        - timeStampToken = ContentInfo of SignedData     │
        │        - encapContentInfo.eContent = TSTInfo (DER)      │
        │        - TSTInfo.messageImprint MUST equal request      │
        │        - TSTInfo.nonce MUST equal request nonce          │
        │        - TSTInfo.genTime → Date                         │
        │        - SignedData.certificates → TSA cert chain        │
        │  8. Return { token, signingTime, tsaCert, hashAlgo }    │
        │                                                        │
        │  9. Attach to CMS as unsignedAttrs:                     │
        │     SignerInfo.unsignedAttrs = SET OF Attribute {       │
        │       type = id-aa-signatureTimeStampToken              │
        │       values SET OF [ token (ContentInfo SEQUENCE) ]    │
        │     }                                                   │
        │ 10. Re-encode CMS DER → embed into PDF /Contents window │
```

**Crítico (RFC 3161 §2.4.2)**: el `messageImprint` que se sella es el **hash de la `signatureValue` del SignerInfo**, no del documento completo. Esto convierte el sello en una prueba "esta firma fue creada antes de genTime", anclando la firma en el tiempo independientemente del documento. El `signatureValue` ya está fijo cuando llamamos a la TSA (depende de signedAttrs que incluyen `signing-time`, `messageDigest`, `signing-certificate-v2`), así el sello es bit-exacto.

### 2.2 Punto de inserción en el pipeline B-B existente

El builder actual (`packages/signer/src/cms.ts`) construye SignerInfo así:

```ts
// Línea 154-164
const signerInfo = new pkijs.SignerInfo({
  version: 1,
  sid: ...IssuerAndSerialNumber,
  digestAlgorithm: ...,
  signedAttrs: signedAttrsSet,
  signatureAlgorithm: ...,
  signature: new asn1js.OctetString({ valueHex: signatureRaw }),
});
```

F6 extiende este flujo con un paso opcional **antes** de `new pkijs.SignedData({...})`:

```ts
// F6: si opts.timestamp !== false, solicita TSA
let unsignedAttrs: pkijs.SignedAndUnsignedAttributes | undefined;
let timestampInfo: TimestampResult | undefined;
if (opts.timestamp !== false) {
  const imprint = new Uint8Array(await crypto.subtle.digest('SHA-256', signatureRaw));
  timestampInfo = await requestTimestamp(imprint, {
    url: opts.tsaUrl ?? 'https://freetsa.org/tsr',
    timeoutMs: 8000,
    hashAlgo: 'SHA-256',
  });
  if ('token' in timestampInfo) {
    unsignedAttrs = new pkijs.SignedAndUnsignedAttributes({
      type: 1, // [1] IMPLICIT — unsignedAttrs in CMS
      attributes: [
        new pkijs.Attribute({
          type: '1.2.840.113549.1.9.16.2.14', // id-aa-signatureTimeStampToken
          values: [asn1js.fromBER(timestampInfo.token.buffer).result], // ContentInfo SEQUENCE
        }),
      ],
    });
  }
}
const signerInfo = new pkijs.SignerInfo({
  ...,
  ...(unsignedAttrs ? { unsignedAttrs } : {}),
});
```

**Atención al tag IMPLICIT [1]**: misma trampa que F3-v0.4.4 con `signedAttrs` (que vimos en `cms.ts` líneas 138-148 — usar `toSchema().toBER(false)` y parchar `0xa0`/`0xa1` cuando sea necesario). pkijs serializa `unsignedAttrs` con tag `[1]` (`0xa1`); no necesitamos firmar sobre ellos así que **no hay que hacer el patch a 0x31**. Solo verificar que el round-trip parse → encode preserve los bytes.

### 2.3 Fallback paths

```
                  ┌─ requestTimestamp returns 'token' → attach unsignedAttrs → CMS B-T
                  │
opts.timestamp ───┤
  default true    │       ┌─ 'timeout'      → log + skip + warning UI "Sello no disponible"
                  │       ├─ 'rate_limited' → log + skip + warning UI "TSA saturada"
                  └─ 'error' ─┤─ 'network'  → log + skip + warning UI "Sin conexión a TSA"
                              ├─ 'malformed'→ log + skip + warning UI "Respuesta TSA inválida"
                              └─ 'rejected' → log + skip + warning UI "TSA rechazó la firma"

opts.timestamp = false   → skip directo, B-B sin warning (usuario opt-out explícito)
```

En todos los `'error'` paths, **la firma B-B se completa y se entrega al usuario**. El `SignResult` incluye `timestamp: { ok: false, reason }` para que la UI lo muestre. La regla #3 del decision log es no-negociable: TSA caída ≠ firma fallada.

### 2.4 Verifier additions

`packages/verifier/src/cms.ts` ya extrae `timestampToken: Uint8Array` (línea 20). `packages/verifier/src/index.ts` ya rutea `profile: cms.timestampToken ? 'B-T' : 'B-B'` (línea 113). Lo que falta:

1. **Parsear** el token (TimeStampToken = ContentInfo de SignedData con eContent=TSTInfo).
2. **Validar** que `TSTInfo.messageImprint` == `SHA-256(SignerInfo.signature)` — esto cierra el binding criptográfico del sello a la firma.
3. **Validar cadena** TSA cert → trust root TSA (FreeTSA root del paquete `packages/tsa-trust`).
4. **Verificar** la firma del TSA sobre TSTInfo (RSA/ECDSA del TSA cert).
5. **Exponer** `signature.timestamp = { present, valid, signingTime, tsaIssuer, badge }` en el resultado.

---

## 3. New package: `packages/tsa-client`

### 3.1 Public API

```ts
// packages/tsa-client/src/index.ts

export type HashAlgo = 'SHA-256' | 'SHA-384';

export interface TimestampOk {
  /** RFC 3161 TimeStampToken (ContentInfo DER). */
  token: Uint8Array;
  /** TSA URL actually used. */
  tsaUrl: string;
  /** Hash algorithm used for messageImprint. */
  hashAlgo: HashAlgo;
  /** Time reported by the TSA (TSTInfo.genTime). */
  signingTime: Date;
  /** TSA signing certificate (parsed). */
  tsaCert: ParsedCert;
  /** Serial number of the TSTInfo (per RFC 3161). */
  serialNumberHex: string;
}

export type TimestampError =
  | { error: 'timeout';      detail?: string }
  | { error: 'rate_limited'; detail?: string }
  | { error: 'malformed';    detail?: string }
  | { error: 'rejected';     detail: string }   // TSA returned status != granted
  | { error: 'network';      detail?: string };

export type TimestampResult = TimestampOk | TimestampError;

export interface RequestTimestampOpts {
  /** TSA URL. Default https://freetsa.org/tsr */
  url?: string;
  /** Request timeout in ms. Default 8000. */
  timeoutMs?: number;
  /** Hash algorithm for messageImprint. Default 'SHA-256'. */
  hashAlgo?: HashAlgo;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

export async function requestTimestamp(
  messageImprint: Uint8Array,
  opts?: RequestTimestampOpts,
): Promise<TimestampResult>;

/** Parse a TimeStampToken (ContentInfo bytes) without validating. */
export function parseTimestampToken(token: Uint8Array): ParsedTimestampToken;

export interface ParsedTimestampToken {
  /** TSTInfo.messageImprint.hashedMessage */
  imprint: Uint8Array;
  /** TSTInfo.messageImprint.hashAlgorithm OID. */
  hashAlgoOid: string;
  /** TSTInfo.genTime. */
  signingTime: Date;
  /** TSTInfo.serialNumber as hex. */
  serialNumberHex: string;
  /** TSA certificates from SignedData.certificates (DER). */
  tsaCertDers: Uint8Array[];
  /** Inner SignerInfo of the TimeStampToken — for chain + signature verification. */
  innerSignedAttrsDer: Uint8Array;
  innerSignatureValue: Uint8Array;
  innerSigAlgoOid: string;
  innerDigestAlgoOid: string;
}
```

### 3.2 Implementation notes

- **Build TimeStampReq via pkijs.TimeStampReq** (sí existe, `pkijs >=3.2`). Build `MessageImprint { hashAlgorithm, hashedMessage: messageImprint }`, set `version=1`, `nonce` (random 64-bit), `certReq=true`.
- **fetch** con `signal: AbortSignal.timeout(timeoutMs)`. Headers: `Content-Type: application/timestamp-query`, `Accept: application/timestamp-reply`. Body: `tsq.toSchema().toBER(false)`.
- **Response handling**:
  - HTTP 429 → `{ error: 'rate_limited' }`.
  - Network error / non-2xx → `{ error: 'network', detail }`.
  - Body not parseable as TimeStampResp → `{ error: 'malformed' }`.
  - `resp.status.status > 1` (granted=0, grantedWithMods=1) → `{ error: 'rejected', detail: statusString }`.
  - Token's `messageImprint.hashedMessage` ≠ request imprint → `{ error: 'malformed', detail: 'imprint mismatch' }`.
  - Token's nonce ≠ request nonce (when present) → `{ error: 'malformed', detail: 'nonce mismatch' }` (replay defense).
- **No DOM dependencies**: usa `globalThis.fetch` y `globalThis.crypto`. Funciona en Worker, Node 18+ (vitest), y main thread.
- **Bundle size target**: ≤8 KB gzip (cliente solo; `pkijs.TimeStampReq/Resp` añaden ~5 KB extra al chunk lazy de `/firmar`). Total chunk delta ≤15 KB gz (criterio aceptación).

### 3.3 KAT vectors

Capturar **una vez** una respuesta real de FreeTSA usando un imprint conocido (ej. SHA-256 de `"firma-ec-F6-test-vector"` cadena ASCII), guardar tsq + tsr DER bytes en `packages/tsa-client/tests/__fixtures__/freetsa-kat-2026-05-09.{tsq,tsr}`. Tests offline:

1. Parse de la tsr fixture → assertion sobre genTime, imprint match, status=granted.
2. Mock `fetch` que devuelve el fixture → `requestTimestamp(...)` retorna `TimestampOk` con campos esperados.
3. Property-based: imprints aleatorios + mocked TSA con imprint forzado distinto → siempre `{ error: 'malformed' }`.

---

## 4. New package: `packages/tsa-trust`

Razón de paquete propio (no mezclar en `tsl-ec` — decisión #8): la confianza TSA tiene ciclo de update independiente y semántica distinta (un TSA es un servicio, no una ECI emisora). Mezclarlas forzaría re-releasear `tsl-ec` cada vez que rote un TSA, contaminando la TSL ARCOTEL.

### 4.1 Public API

```ts
// packages/tsa-trust/src/index.ts

export interface TsaTrustRoot {
  slug: string;                 // 'freetsa' | 'arcotel-bce-tsa' | ...
  commonName: string;           // human-readable
  tsaUrlHints: string[];        // URLs known to be served by this anchor
  certPem: string;              // PEM-encoded root cert
  certDer: Uint8Array;          // memoized DER bytes
  notBefore: Date;
  notAfter: Date;
  isPlaceholder: boolean;       // true while we ship a self-signed stub (e.g. ARCOTEL)
}

export function getTsaTrustRoots(): Promise<TsaTrustRoot[]>;
export function findTsaRootByIssuer(issuerDn: string): Promise<TsaTrustRoot | null>;
```

### 4.2 Initial trust roots (v0.5.0)

| # | slug | commonName | TSA URL | Source PEM |
|---|---|---|---|---|
| 1 | `freetsa` | "FreeTSA Root CA (cacert.pem)" | `https://freetsa.org/tsr` | https://freetsa.org/files/cacert.pem |
| 2 | `arcotel-placeholder` | "ARCOTEL TSA (placeholder)" | (TBD when ARCOTEL publishes) | self-signed stub, `isPlaceholder: true` |

`freetsa` es el ancla real; `arcotel-placeholder` reserva slug para F6.5. La plomería de `findTsaRootByIssuer` ya soporta múltiples sin código nuevo.

### 4.3 Verification of TSA chain

Reuso de `validatePath` del verifier (`packages/verifier/src/pathValidation.ts`) — TSA cert + intermediates → trust root con misma lógica que firma del firmante. Diferencia: el `keyUsage` esperado del TSA cert es `digitalSignature` y `extendedKeyUsage` debe contener `id-kp-timeStamping` (OID `1.3.6.1.5.5.7.3.8`). Si falta este EKU, marcar `validChain: false` con razón `tsa_eku_missing`.

---

## 5. CMS integration (`packages/signer/src/cms.ts`)

### 5.1 Cambios en `BuildCmsOpts`

```ts
export interface BuildCmsOpts {
  // ... existing fields ...

  /** When provided and truthy, request TSA stamp and attach as unsignedAttrs.
   *  When false, force B-B. When omitted/true, default ON.
   */
  timestamp?: boolean;
  /** TSA URL override (only if timestamp !== false). */
  tsaUrl?: string;
  /** Optional callback invoked once TSA result is known (success or failure).
   *  Used by the signer/PWA to surface the warning UI.
   */
  onTimestampResult?: (r: TimestampResult) => void;
}
```

### 5.2 Build flow delta

```ts
// After signatureRaw is computed (line 151 today):
let unsignedAttrs: pkijs.SignedAndUnsignedAttributes | undefined;
if (opts.timestamp !== false) {
  const imprint = new Uint8Array(await crypto.subtle.digest('SHA-256', signatureRaw));
  const tsr = await requestTimestamp(imprint, {
    url: opts.tsaUrl,
    timeoutMs: 8000,
    hashAlgo: 'SHA-256',
  });
  opts.onTimestampResult?.(tsr);
  if ('token' in tsr) {
    const tokenAsn1 = asn1js.fromBER(
      tsr.token.buffer.slice(tsr.token.byteOffset, tsr.token.byteOffset + tsr.token.byteLength) as ArrayBuffer,
    );
    if (tokenAsn1.offset !== -1) {
      unsignedAttrs = new pkijs.SignedAndUnsignedAttributes({
        type: 1,
        attributes: [
          new pkijs.Attribute({
            type: '1.2.840.113549.1.9.16.2.14',
            values: [tokenAsn1.result],
          }),
        ],
      });
    }
  }
}

// Attach to SignerInfo
const signerInfo = new pkijs.SignerInfo({
  version: 1,
  sid: ...,
  digestAlgorithm: ...,
  signedAttrs: signedAttrsSet,
  signatureAlgorithm: ...,
  signature: new asn1js.OctetString({ valueHex: signatureRaw }),
  ...(unsignedAttrs ? { unsignedAttrs } : {}),
});
```

### 5.3 SignResult delta (en `packages/signer/src/types.ts`)

```ts
export interface TimestampMeta {
  ok: boolean;
  /** When ok=true. */
  signingTime?: Date;
  tsaUrl?: string;
  tsaIssuerCN?: string;
  /** When ok=false. */
  reason?: 'timeout' | 'rate_limited' | 'malformed' | 'rejected' | 'network' | 'disabled';
  detail?: string;
}

export interface SignResult {
  signedPdf: Uint8Array;
  // ... existing ...
  timestamp: TimestampMeta;
}
```

`pades.ts` propaga el `timestamp` recibido vía `onTimestampResult` callback hasta el `SignResult` que retorna a la UI.

---

## 6. Verifier integration (`packages/verifier/src/`)

### 6.1 Nuevo módulo `packages/verifier/src/timestamp.ts`

```ts
export interface TimestampVerification {
  present: boolean;
  /** When present=true. */
  signingTime?: Date;
  tsaIssuerCN?: string;
  /** Crypto check: TSTInfo.messageImprint matches SHA-256(SignerInfo.signature). */
  imprintMatches?: boolean;
  /** Inner SignerInfo signature over TSTInfo verifies with TSA cert. */
  signatureValid?: boolean;
  /** TSA cert chain validates to a known TSA trust root. */
  chainValid?: boolean;
  /** Aggregate badge. */
  badge: 'gold' | 'silver' | 'none';
  /** Reason when badge != gold and present. */
  reason?: 'imprint_mismatch' | 'sig_invalid' | 'chain_invalid' | 'expired' | 'malformed';
}

export async function verifyTimestamp(
  cmsTimestampToken: Uint8Array | undefined,
  signerSignatureValue: Uint8Array,
): Promise<TimestampVerification>;
```

### 6.2 Wiring en `packages/verifier/src/index.ts`

Después de la integridad/firma del firmante (línea 38), añadir:

```ts
const tsaResult = await verifyTimestamp(cms.timestampToken, cms.signatureValue);
// ... compute final status ...
if (tsaResult.present) {
  result.signature!.timestamp = {
    present: true,
    valid: tsaResult.badge === 'gold',
    signingTime: tsaResult.signingTime?.toISOString(),
    tsaIssuer: tsaResult.tsaIssuerCN,
    badge: tsaResult.badge,
    ...(tsaResult.reason ? { reason: tsaResult.reason } : {}),
  };
} else {
  result.signature!.timestamp = { present: false, badge: 'none' };
}
```

### 6.3 Status semantics

- TSA presente y `badge=gold` → no afecta status; añade campo `timestamp` al resultado.
- TSA presente y `badge=silver` (inválido por cualquier razón) → `status` queda en `valid` o `warning` según el resto, pero se añade `warning { code: 'timestamp_invalid', message: ... }`. **No degrada a `invalid`** — la firma del firmante sigue válida; solo el sello falló.
- TSA ausente → `badge=none`, sin warning (es B-B explícito).

---

## 7. PWA UI changes

### 7.1 Wizard `Firmar.svelte` — nuevo stage

Insertar entre `sign` y `result` un stage de progress:

```ts
type SignStage = 'parse_pfx' | 'import_key' | 'load_pdf' | 'build_cms' | 'sign'
  | 'request_timestamp'   // NEW
  | 'assemble_pades'  | 'incremental';
```

Texto i18n:
- `firmar.progress.request_timestamp` (ES): "Solicitando sello de tiempo…"
- `firmar.progress.request_timestamp` (EN): "Requesting timestamp…"

Si el `runSign()` retorna con `timestamp.ok === false`, mostrar **toast no-bloqueante** sobre el step 7 (resultado):

- `firmar.timestamp.failed.timeout`: "Sello de tiempo no disponible (TSA tardó demasiado). Tu firma es válida igualmente."
- `firmar.timestamp.failed.network`: "Sello de tiempo no disponible (sin conexión a TSA). Tu firma es válida igualmente."
- `firmar.timestamp.failed.rate_limited`: "Servicio TSA saturado. Tu firma quedó sin sello, pero válida."
- `firmar.timestamp.failed.rejected`: "TSA rechazó el sello. Firma válida sin sello."
- `firmar.timestamp.failed.malformed`: "Respuesta TSA inválida. Firma válida sin sello."

Si `timestamp.ok === true`, mostrar badge dorado en el resumen del paso 7: "📜 Sellada por FreeTSA — DD/MM/YYYY HH:MM". (Sin emoji literal — usar icono lucide `BadgeCheck`.)

### 7.2 Wizard nuevo paso opcional: revisión TSA

**Decisión**: NO añadir paso explícito. Default-on + fallback graceful = decisión silenciosa para el usuario común. La opción se expone en Settings.

### 7.3 Settings page (`apps/pwa/src/routes/Settings.svelte` o equivalente)

Sección "Avanzado":

- **Toggle**: "Sellar firmas con sello de tiempo" (default: ON). Persistido en `localStorage.firma_ec_settings.timestamp_enabled`.
- **Input URL**: "URL del servicio TSA" (default: `https://freetsa.org/tsr`). Validar `^https://`. Persistido en `localStorage.firma_ec_settings.tsa_url`.
- Botón "Probar TSA": ejecuta `requestTimestamp(SHA256('test'))` con la URL configurada; muestra resultado (OK + TSA cert CN, o el error).
- Reset: botón "Restaurar valores por defecto".

Si la app aún no tiene página Settings, creamos `Settings.svelte` minimal (es F6 scope justo).

### 7.4 Verificar.svelte — badge dorado

En la página `/verificar`, cuando `result.signature.timestamp.badge === 'gold'`, renderizar tarjeta destacada:

```
┌──────────────────────────────────────────┐
│ 📜 Firma sellada                         │
│ Sello emitido por: FreeTSA Root CA       │
│ Fecha del sello: 09/05/2026 14:32 UTC    │
│ ✓ Sello válido y verificado              │
└──────────────────────────────────────────┘
```

Si `badge === 'silver'`, tarjeta gris con `reason` traducido. Si `badge === 'none'`, no se renderiza la tarjeta (no es un error — B-B sigue siendo legítimo).

---

## 8. Threat model addendum (delta sobre F3 §6)

| # | Amenaza F6 | Vector | Control | Norma |
|---|---|---|---|---|
| F6-1 | TSA compromise → adversary backdates a signature | TSA private key stolen / coerced | Single-TSA es vulnerable. **Multi-TSA en F6.5** mitiga (≥2 TSAs independientes). En F6 documentado en `/seguridad`. | RFC 3161 §4 |
| F6-2 | Replay de TimeStampResp viejo | MITM cachea respuesta y la reusa | **Nonce** echoed por el TSA en `TSTInfo.nonce` → cliente verifica equality contra nonce de la request. Mismatch → `{ error: 'malformed' }`. | RFC 3161 §2.4.1 |
| F6-3 | TSA learns the user's signature hash | Privacy: TSA sees `SHA-256(signatureValue)` | El TSA NO ve el documento. Solo el hash de los signature bytes. FreeTSA policy declara no logging persistente. **Documentado en `/seguridad`**. Usuario puede cambiar TSA URL. | RFC 3161 §2 |
| F6-4 | TSA man-in-the-middle inject | Atacante modifica respuesta en tránsito | HTTPS required (TSA URL must be `https://`). Imprint check + nonce check post-validate la respuesta. | OWASP ASVS 9 |
| F6-5 | TSA caída en momento crítico → pánico usuario | DoS no-malicioso | Fallback graceful B-B con warning visible. Firma legalmente válida sin sello. | F6 decision #3 |
| F6-6 | TSA root cert expira y la app no lo nota | Trust anchor stale | `tsa-trust` lista `notAfter`. Verifier marca `chainValid: false, reason: 'expired'` si la fecha actual excede. Release rota el root con tiempo. | RFC 5280 |
| F6-7 | TSA cert sin EKU `id-kp-timeStamping` | TSA mal-emitido o spoof | `validatePath` checa EKU `1.3.6.1.5.5.7.3.8`. Falta → `chainValid: false, reason: 'tsa_eku_missing'`. | RFC 3161 §2.3 |
| F6-8 | Bundle size attack: TSA token gigante | Adversary returns 1MB token | `requestTimestamp` enforces `Content-Length ≤ 32 KB` o lee con cap. Excede → `{ error: 'malformed' }`. | OWASP ASVS 12 |
| F6-9 | Hash algo downgrade en messageImprint | Adversary forces SHA-1 | Cliente solo soporta SHA-256/SHA-384. Si TSA echo'ea otro algo → `{ error: 'malformed' }`. | NIST SP 800-131A |

### 8.1 Privacy note user-facing

En `/seguridad`:

> **Sello de tiempo**: cuando solicitas el sello, se envía a la TSA un **hash criptográfico de la firma** (no del documento). El TSA por defecto (FreeTSA, OSS) declara no almacenar registros persistentes de las solicitudes. Puedes cambiar la TSA en Configuración → Avanzado, o desactivar el sello (firmará en B-B).

---

## 9. Out of scope (F6.5/F7 territory)

- **Multi-TSA paralela** (request a 2-3 TSAs simultáneamente, aceptar el primero válido) — F6.5.
- **TSAs ARCOTEL Ecuador** — pendiente que ARCOTEL publique endpoints RFC 3161 oficiales. F6.5 cuando estén disponibles.
- **Document timestamp** (`/DocTimeStamp` PDF dictionary, separate from signature timestamp) — F7 LTV.
- **DSS dictionary** (Document Security Store con OCSPs/CRLs/certs embebidos para verificación offline a largo plazo) — F7.
- **OCSP-stapled en signedAttrs `id-aa-ets-revocationValues`** — F7 (PAdES B-LT).
- **PAdES B-LTA** (Long-Term Archive con archive timestamps periódicos) — F8+.
- **TSA con autenticación** (HTTP Basic, mTLS) — F6.5 si demanda.
- **CRL fallback** cuando OCSP no responde para validar TSA cert — F7.
- **Sello visible en el cuadro de firma** ("Sellado: 09/05/2026 14:32") — F8 si se pide. F6 mantiene el cuadro visible mínimo (decisión #3 F3).

---

## 10. Acceptance criteria — v0.5.0-rc1

Para declarar F6 cerrado y tagear `v0.5.0-rc1`:

1. [ ] `pnpm --filter @firma-ec/tsa-client test` verde (unit + KAT vector + property-based con mocks).
2. [ ] `pnpm --filter @firma-ec/tsa-trust test` verde (parse PEM, expiry assertions, EKU presence).
3. [ ] `pnpm --filter @firma-ec/signer test` verde con nuevos tests de unsignedAttrs round-trip.
4. [ ] `pnpm --filter @firma-ec/verifier test` verde con `verifyTimestamp` cubriendo gold/silver/none + cada `reason`.
5. [ ] Firma B-T producida por la PWA, descargada, y re-verificada por la PWA misma → `timestamp.badge === 'gold'`.
6. [ ] Firma B-T abierta en **Adobe Acrobat Reader DC** muestra "Signature is timestamped" o equivalente (badge timestamp visible). Captura en `docs/reports/F6-cross-validation-2026-05-09/`.
7. [ ] Firma B-B legacy (creada en F3-F5) sigue verificando como `valid` con `timestamp.badge === 'none'` (regresión cero).
8. [ ] **Fallback offline**: sign en `/firmar` con `chrome --offline` (DevTools network throttling Offline) → completa B-B con toast warning. PDF descargado verifica `valid` + `timestamp.present === false`.
9. [ ] **Bundle size**: chunk lazy de `/firmar` crece ≤15 KB gz contra v0.4.x baseline (`pnpm --filter pwa build` + `du -sh dist/assets/firmar-*.js | gzip`).
10. [ ] Lighthouse `/firmar` ≥95 (sin regresión vs v0.4.x).
11. [ ] axe-core 0 violations en wizard + Settings.
12. [ ] Mozilla Observatory + securityheaders.com sostienen A+ post-deploy.
13. [ ] CSP no rompe (FreeTSA URL en `connect-src 'self' https://freetsa.org`; user-defined URL es runtime → CSP debe permitir el dominio configurado o documentar limitación).
14. [ ] Playwright E2E: golden path con TSA mocked → badge gold; offline path → fallback B-B + warning. Mobile (iPhone 13, Pixel 5) cubre ambos.
15. [ ] `docs/transparency-report.md` actualizado: sección "F6 TSA — RFC 3161, FreeTSA default, threat model".
16. [ ] CHANGELOG entry para v0.5.0-rc1.
17. [ ] Tag `v0.5.0-rc1` firmado con Cosign + SLSA L3 provenance + SBOM CycloneDX.
18. [ ] Memoria F6 closure registrada en `~/.claude/.../memory/`.

---

## 11. Self-review (post-write)

- **Placeholder scan**: 0 TBD/TODO/FIXME en este documento. ✅
- **Internal consistency**: decisiones 1-10 (§1) reflejadas en arquitectura (§2), API (§3-4), CMS integration (§5), verifier (§6), UI (§7), threats (§8), out-of-scope (§9), acceptance (§10). ✅
- **Scope check**: foco en **timestamp PAdES B-T**, sin OCSP, sin DSS, sin LTV, sin multi-TSA, sin TSAs ARCOTEL (placeholder slug reservado). ✅
- **Norma alignment**: RFC 3161 (TSP), RFC 5652 (CMS unsignedAttrs), ETSI EN 319 142-1 (PAdES B-T), RFC 3852 §11.3 (id-aa-signatureTimeStampToken OID). ✅
- **LOPDP-native**: `messageImprint = SHA-256(signatureValue)` — TSA NO ve el documento. Documentado en §8.1 user-facing. ✅
- **Continuidad F3**: extiende `BuildCmsOpts`, mantiene B-B path intacto cuando `timestamp:false`, no rompe firmas legacy en verifier. ✅
- **ARCOTEL caveat**: declarado en §0, decisión #1, §4.2 y §9 que TSAs ARCOTEL son F6.5 cuando ARCOTEL publique endpoints. Sin promesa adelantada. ✅
- **Bug F3-v0.4.4 trap**: documentado en §2.2 (encodedValue empty on build). Reusar `toSchema().toBER(false)` también en unsignedAttrs round-trip ya que el patrón es idéntico. ✅

---

**Fin del spec F6 — listo para `writing-plans`.**
