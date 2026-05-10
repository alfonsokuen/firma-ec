---
date: 2026-05-10
project: firma-ec
phase: F7
status: Draft v1 — listo para `writing-plans`
authors: Alfonso Kuen + Claude (sesión brainstorming F7)
supersedes: null
references:
  - docs/superpowers/specs/2026-05-09-firma-ec-F3-firma-MVP-design.md
  - docs/superpowers/specs/2026-05-09-firma-ec-F6-TSA-design.md
  - docs/superpowers/plans/2026-05-09-firma-ec-F6-TSA.md
  - packages/signer/src/cms.ts                      # current B-T builder
  - packages/signer/src/incrementalUpdate.ts        # incremental update writer (DSS reuses this skeleton)
  - packages/signer/src/pades.ts                    # orchestration
  - packages/verifier/src/index.ts                  # profile state machine ('B-B'|'B-T'|'B-LT'|'unknown')
  - packages/verifier/src/timestamp.ts              # signature-timestamp verifier (pattern reused for doc-ts)
  - packages/verifier/src/ocsp.ts                   # current best-effort OCSP — refactor target
  - packages/tsa-client/src/                        # RFC 3161 client — reused for document timestamp
  - packages/tsa-trust/src/                         # FreeTSA + ARCOTEL trust anchors
  - ETSI EN 319 142-1 §5.4 (DSS) and §5.5 (B-LT/B-LTA)
  - ISO 32000-1 §12.8.4 (DSS, VRI, document timestamp)
  - RFC 6960 (OCSP), RFC 5280 §5 (CRLs), RFC 3161 (TSA)
deliverable_tag: v0.7.0-rc1
---

# F7 — Long-Term Validation (PAdES B-LT / B-LTA)

## 0. Goal

Elevar las firmas producidas por la PWA de **PAdES B-T** (sello RFC 3161 sobre `signatureValue`) a **PAdES B-LT (Long-Term Validation)** y **PAdES B-LTA (Long-Term Archive)** embebiendo en el PDF una **DSS dictionary** (Document Security Store, ISO 32000-1 §12.8.4) con la cadena de certificados completa + respuestas OCSP (RFC 6960) y/o CRLs (RFC 5280) que prueban el estado del firmante en el momento de firmar, y añadiendo opcionalmente un **document timestamp** RFC 3161 sobre el PDF entero (incluida la DSS) para llegar a B-LTA. Resultado: firmas verificables 5/10/20 años en el futuro aún cuando la CA emisora esté offline, los OCSP responders hayan muerto y los CRL distribution points devuelvan 404 — los datos de revocación viajan en el propio PDF.

> **Nivel** PAdES **B-LT** y **B-LTA**. Cierra el ladder ETSI EN 319 142-1 (B-B → B-T → B-LT → B-LTA).
> **Default-on** para LT y LTA, con fallback graceful: OCSP/CRL falla → degrada a B-T con warning; TSA del document timestamp falla → degrada a B-LT.
> **Out of scope (F7)**: refresh periódico de DSS (F7.5), multi-OCSP redundante (F7.6), QES eIDAS/ARCOTEL (F8).

---

## 1. Decisiones aprobadas (decision log)

| # | Decisión | Rationale |
|---|---|---|
| 1 | **DSS embebida vía incremental update** sobre PDF B-T existente (no reescribir el body original) | Compatibilidad PAdES (RFC: la DSS es un objeto `/DSS` colgando del Catalog, ETSI §5.4). Reusa la maquinaria de `packages/signer/src/incrementalUpdate.ts` (truco de slice 1 = bytes [0..fileEnd) intactos). Múltiples DSS posibles (refresh F7.5). |
| 2 | **Default ON para B-LT y B-LTA** | El usuario promedio quiere "firma que dure"; el opt-out queda en Configuración avanzada. Coherente con la promesa "firma seria" del producto. |
| 3 | **Fallback en cascada**: OCSP timeout → CRL → degrade a B-T con warning. TSA doc-ts falla → degrade a B-LT. | OCSP/CRL caída ≠ firma fallada. La firma del firmante sigue siendo legalmente válida. Mismo principio que F6 #3. |
| 4 | **OCSP "revoked" BLOQUEA la firma** (error fatal, no fallback) | Si el certificado está revocado, firmar sería fraudulento. Único caso en que F7 aborta el sign flow con error. |
| 5 | **OCSP "unknown" se acepta con warning** y se embebe la respuesta OCSP igualmente | "unknown" no significa revocado; significa que el responder no tiene info. Documentar en DSS para que verificadores externos decidan. |
| 6 | **Document timestamp = TSA reusada de F6** (FreeTSA default, configurable) | No fragmentar trust anchors. La TSA del document timestamp puede ser distinta a la del signature timestamp pero por defecto es la misma. |
| 7 | **Nuevo paquete `packages/ltv-validation`** (OCSP client + CRL fetcher + DSS builder data layer, sin PDF) | Separación de concerns: `ltv-validation` produce los bytes (`Uint8Array[]` de OCSP/CRL/Cert DER); `dss-pdf` los empaqueta en estructura PDF. Reusable desde signer y verifier. |
| 8 | **Nuevo paquete `packages/dss-pdf`** (DSS dictionary writer + document-timestamp incremental update) | Aísla la complejidad PDF (objetos, xref, /DSS, /VRI, document-timestamp /Sig dict subFilter `ETSI.RFC3161`). Reusa el skeleton de `incrementalUpdate.ts` pero NO lo extiende (DSS es un commit menos riesgoso que multi-firma). |
| 9 | **OCSP cache TTL = 1 hora en memoria**, indexada por `(issuerKeyHash, serialNumber)` | Una sesión de firma típica firma varios PDFs en minutos. Cachear evita rate-limit en responders ARCOTEL. Cache no persiste a localStorage (privacidad). Refresh F7.5 manejará TTLs largos. |
| 10 | **Verifier "retrospective validation"**: si la respuesta OCSP embebida es vieja (`producedAt` muy anterior a hoy), se acepta porque prueba el estado **al momento de firmar** | Es exactamente el propósito de B-LT/B-LTA. La DSS captura "el certificado estaba good cuando se firmó". Verificadores que rechazan OCSP > 7 días están equivocados según ETSI §5.5. |
| 11 | **Verifier sigue intentando OCSP/CRL live como fallback** si la DSS no contiene datos para algún cert de la cadena | Backward compat: PDFs B-T sin DSS deben seguir verificando como hoy. Solo cambia el orden: primero embebido, luego live. |
| 12 | **Profile state machine**: `'B-B' | 'B-T' | 'B-LT' | 'B-LTA' | 'unknown'` (5 estados) | Hoy son 4 (`'B-LT'` ya existe pero no se emite). F7 emite `'B-LT'` cuando hay DSS válida y `'B-LTA'` cuando además hay document timestamp válido. |
| 13 | **Tag deliverable: `v0.7.0-rc1`** | Major bump justificado: B-LT y B-LTA son hitos ETSI distintos, cada uno cierra una promesa de durabilidad de la firma. F6 cerró v0.5.x/v0.6.x (ramas rc8). v0.7.0 = LTV milestone. |
| 14 | **ARCOTEL ECI Ecuador OCSP**: discover URL via cert AIA extension (`authorityInfoAccess` OID `1.3.6.1.5.5.7.1.1`); documentar caveat de rate-limit y downtime conocido en `/seguridad` | No hardcodeamos URLs ECI — vienen del cert. Cuando un responder ECI esté caído, el flujo cae a CRL (también declarado en AIA si presente) o degrade a B-T. |
| 15 | **SHA-1 OCSP responses**: ACEPTAR con warning, no rechazar | Muchas CAs Ecuador (ECI ARCOTEL) aún emiten OCSP responses con `CertID.hashAlgorithm = sha1` en 2026. Rechazar implicaría no producir B-LT para la mayoría de los certs reales. Documentar en threat model. SHA-256 preferido cuando responder soporta. |

---

## 2. Architecture overview

### 2.1 PAdES baseline ladder (recordatorio ETSI EN 319 142-1)

```
B-B   ── CMS SignedData con SignedAttrs (signingTime, messageDigest, signing-certificate-v2)
        + SignerInfo.signature                                 ✅ F3
B-T   ── B-B + unsignedAttrs.id-aa-signatureTimeStampToken
        (RFC 3161 sobre SHA-256(signatureValue))               ✅ F6
B-LT  ── B-T + DSS dictionary embebida (ISO 32000-1 §12.8.4)
        con cadena cert completa + OCSP/CRL responses          🟧 F7 esta fase
B-LTA ── B-LT + document timestamp /Sig dict (subFilter
        ETSI.RFC3161) cubriendo PDF + DSS                      🟧 F7 esta fase
```

### 2.2 DSS structure (ISO 32000-1 §12.8.4 + ETSI §5.4)

La DSS es un **objeto PDF** referenciado desde el Catalog:

```
%PDF-1.7
... (B-T existing) ...
xxx 0 obj                                    ← signature object (B-T)
<< /Type /Sig /SubFilter /ETSI.CAdES.detached
   /ByteRange [...] /Contents <PKCS#7 con TimeStampToken> >>
endobj
... rest of B-T body, xref, trailer ...
%%EOF                                        ← end of B-T file

============ INCREMENTAL UPDATE (F7 LT) ============
yyy 0 obj                                    ← Catalog (bumped generation)
<< /Type /Catalog /AcroForm yyy /DSS zzz 0 R /Pages ... >>
endobj
zzz 0 obj                                    ← DSS dictionary
<< /Type /DSS
   /Certs [aaa 0 R bbb 0 R ccc 0 R]          ← cert chain (signer + intermediates + roots)
   /OCSPs [ddd 0 R eee 0 R]                  ← BasicOCSPResponse DER streams
   /CRLs [fff 0 R]                           ← CertificateList DER streams (optional)
   /VRI <<                                   ← Validation Related Info, keyed by sig hash
     /HEXSIGHASH << /Cert [aaa 0 R ...] /OCSP [ddd 0 R] /CRL [fff 0 R] /TS ggg 0 R >>
   >>
>>
endobj
aaa 0 obj << /Length N >> stream <DER cert bytes> endstream endobj
ddd 0 obj << /Length N >> stream <DER OCSP response bytes> endstream endobj
... more streams ...
xref ... trailer ... startxref ... %%EOF

============ INCREMENTAL UPDATE (F7 LTA) ============
hhh 0 obj                                    ← Catalog (bumped again)
<< ... /AcroForm jjj 0 R ... >>
endobj
jjj 0 obj                                    ← AcroForm with new widget for doc-ts
<< /Fields [...existing... kkk 0 R] /SigFlags 3 >>
endobj
iii 0 obj                                    ← Document Timestamp Sig dict
<< /Type /DocTimeStamp
   /Filter /Adobe.PPKLite
   /SubFilter /ETSI.RFC3161
   /ByteRange [0 P1 P2 L]                    ← covers everything except /Contents
   /Contents <hex of TimeStampToken DER> >>
endobj
kkk 0 obj                                    ← Widget for doc-ts (invisible)
<< /Type /Annot /Subtype /Widget /T (doc-ts-1) /V iii 0 R /F 132 /Rect [0 0 0 0] >>
endobj
xref ... trailer ... startxref ... %%EOF
```

Cada entrada de `/Certs`, `/OCSPs`, `/CRLs` es **una indirect reference a un PDF stream object** cuyo body son los bytes DER del item (cert X.509 DER, BasicOCSPResponse DER, CertificateList DER). El `/VRI` (Validation Related Information) es un dict cuyas keys son **el hex uppercase del SHA-1 del signature `/Contents`** (ETSI §5.4 — sí, SHA-1, por compat histórica con Adobe Reader; verifier ETSI 319 102-1 lo computa así) y cuyo value es un sub-dict con las refs específicas a esa firma. Permite múltiples firmas en el mismo PDF compartiendo arrays globales pero atribuyendo a cada una sus datos.

### 2.3 Document timestamp (B-LTA)

Un document timestamp es **otra firma /Sig dict** en el PDF, pero con `subFilter = /ETSI.RFC3161` (no `/ETSI.CAdES.detached`). El `/Contents` es **directamente el TimeStampToken** RFC 3161 (ContentInfo de SignedData con TSTInfo dentro), NO un PKCS#7 detached firmado por una clave del usuario. El `/ByteRange` cubre todo el PDF excepto la propia ventana `/Contents`. El imprint sellado por la TSA es `SHA-256(bytes covered by ByteRange)`. Adobe Reader DC reconoce este patrón y muestra "Long Term Validation" / "Document is timestamped".

Pipeline:

```
[B-LT PDF]
   │  bytes: [B-T] + [DSS incremental update]
   │
   ├─► compute imprint = SHA-256( bytes covered by /ByteRange of doc-ts )
   ├─► requestTimestamp(imprint)                ← reuses F6 packages/tsa-client
   ├─► token = TimeStampToken DER
   └─► assemble incremental update with doc-ts /Sig dict + new Widget + bumped Catalog/AcroForm
   ▼
[B-LTA PDF]
```

### 2.4 Signer flow (sign.worker.ts orchestration)

```
load PDF → parse PFX → import key → build CMS B-B
                                       │
                                       ▼
                       request signature timestamp (F6)  ──► CMS B-T
                                       │
                                       ▼
                       assemble B-T PDF (incremental update with /Sig dict)
                                       │
                                       ▼ (F7 starts here)
                       fetch_ocsp: for cert in [signer, intermediates, tsaCert]:
                                       │     1. cache lookup
                                       │     2. live fetch via AIA OCSP URL (POST)
                                       │     3. on miss → fetch_crl from cRLDistributionPoints
                                       │     4. cache result (TTL 1h)
                                       ▼
                       build_dss: assemble Cert[] / OCSP[] / CRL[] + VRI keyed by SHA-1(signatureContents)
                                       │
                                       ▼
                       append DSS as incremental update              ──► PDF B-LT
                                       │
                                       ▼ (LTA path)
                       document_timestamp:
                                       │     1. assemble doc-ts placeholder + widget + bumped Catalog
                                       │     2. compute /ByteRange + SHA-256(covered bytes)
                                       │     3. requestTimestamp(imprint, tsaUrl)
                                       │     4. write hex token into /Contents
                                       ▼
                                                                     ──► PDF B-LTA
```

### 2.5 Verifier flow

```
findSignature → parseCms → existing F3-F6 checks (integrity, sigValue, path, OCSP, timestamp)
                                       │
                                       ▼
                       parseDss(pdfBytes):
                            extract /DSS dict, decode each /Certs|/OCSPs|/CRLs stream
                            decode /VRI keyed sub-dicts
                                       │
                                       ▼
                       for each cert in path [signer, intermediates...]:
                            embedded OCSP for that cert?  ──► validate OCSP response (sig + chain + status)
                                       │  no
                                       └► embedded CRL?  ──► validate CRL (sig + chain + status)
                                                  │ no
                                                  └► live OCSP/CRL fetch (existing F-? code)
                                                           │ all fail
                                                           └► warn 'no_revocation_info'
                                       ▼
                       parseDocumentTimestamp(pdfBytes):
                            findAdditionalSignatures filtering subFilter=/ETSI.RFC3161
                            verifyTimestamp(token, coveredBytes) — same as F6 timestamp.ts
                                       │
                                       ▼
                       compute profile:
                            DSS valid + LTV checks pass + doc-ts valid    → 'B-LTA'
                            DSS valid + LTV checks pass                   → 'B-LT'
                            sig timestamp valid                           → 'B-T'
                            else                                          → 'B-B'
                                       │
                                       ▼
                       result.signature.ltv = { profile, dssPresent, embeddedOcspCount,
                                                embeddedCrlCount, documentTimestamp?,
                                                retrospectiveValid, expiresOn? }
```

---

## 3. New package: `packages/ltv-validation`

### 3.1 Public API

```ts
// packages/ltv-validation/src/index.ts

export type RevocationStatus = 'good' | 'revoked' | 'unknown';

export interface OcspResult {
  ok: true;
  /** RFC 6960 BasicOCSPResponse DER bytes — embed in DSS as-is. */
  responseDer: Uint8Array;
  status: RevocationStatus;
  /** OCSP producedAt timestamp. */
  producedAt: Date;
  /** thisUpdate of the matching SingleResponse. */
  thisUpdate: Date;
  /** nextUpdate when present. */
  nextUpdate?: Date;
  /** Responder URL actually queried. */
  responderUrl: string;
}
export interface OcspError {
  ok: false;
  reason: 'no_aia' | 'timeout' | 'network' | 'malformed' | 'http_error' | 'sig_invalid';
  detail?: string;
}
export type OcspOutcome = OcspResult | OcspError;

export interface CrlResult {
  ok: true;
  crlDer: Uint8Array;
  status: RevocationStatus;            // 'good' | 'revoked'; CRL no expone 'unknown'
  thisUpdate: Date;
  nextUpdate?: Date;
  distributionPointUrl: string;
}
export interface CrlError {
  ok: false;
  reason: 'no_cdp' | 'timeout' | 'network' | 'malformed' | 'http_error' | 'sig_invalid' | 'too_large';
  detail?: string;
}
export type CrlOutcome = CrlResult | CrlError;

export interface FetchOcspOpts {
  /** Override URL (else discovered from cert AIA). */
  url?: string;
  /** Timeout ms (default 8000). */
  timeoutMs?: number;
  /** Use SHA-256 CertID when responder advertises support; default 'auto'. */
  hashAlgo?: 'sha1' | 'sha256' | 'auto';
  /** AbortSignal. */
  signal?: AbortSignal;
}

export async function fetchOcsp(
  cert: ParsedCert,
  issuerCert: ParsedCert,
  opts?: FetchOcspOpts,
): Promise<OcspOutcome>;

export async function fetchCrl(
  cert: ParsedCert,
  opts?: { url?: string; timeoutMs?: number; signal?: AbortSignal },
): Promise<CrlOutcome>;

/** OCSP response cache (per-process, in-memory, TTL 1h). */
export interface OcspCache {
  get(certKey: string): OcspResult | undefined;
  set(certKey: string, value: OcspResult): void;
  clear(): void;
}
export function createOcspCache(ttlMs?: number): OcspCache;

/** Build the data layer for a DSS — collects bytes for embedding.
 *  PDF assembly happens in @firma-ec/dss-pdf.
 */
export interface DssData {
  certs: Uint8Array[];        // DER cert bytes (deduped by SHA-256)
  ocsps: Uint8Array[];        // BasicOCSPResponse DER
  crls: Uint8Array[];         // CertificateList DER
  vri: Record<string, {       // hex SHA-1(signatureContents) → refs
    certIndices: number[];
    ocspIndices: number[];
    crlIndices: number[];
    timestampTokenIndex?: number;  // index into ocsps[] when ts cert OCSP present
  }>;
}

export async function collectDssData(input: {
  signerCert: ParsedCert;
  intermediates: ParsedCert[];
  tsaCert?: ParsedCert;
  signatureContents: Uint8Array;       // /Contents bytes of the B-T sig (used for VRI key)
  cache?: OcspCache;
  timeoutMs?: number;
}): Promise<{ data: DssData; warnings: string[]; revoked: false } | { revoked: true; revokedCertCN: string }>;
```

### 3.2 Implementation notes

**OCSP request**:
- Build `OCSPRequest` via `pkijs.OCSPRequest`, populate `tbsRequest.requestList[0].reqCert` with `CertID { hashAlgorithm, issuerNameHash, issuerKeyHash, serialNumber }`. Try SHA-256 first; if responder rejects (`malformed_request` or sig fails), retry with SHA-1.
- POST to AIA URL with `Content-Type: application/ocsp-request`. GET fallback per RFC 6960 §A.1 (base64url(req) appended to URL).
- Parse `OCSPResponse`. `responseStatus` MUST be 0 (successful). Validate `BasicOCSPResponse.signature` against responder cert (delegated cert in `BasicOCSPResponse.certs`, verified up to the issuer of the cert being checked — RFC 6960 §4.2.2.2 "Authorized Responders").
- Match `SingleResponse.certID` to the requested cert. Read `certStatus` choice: `[0] good`, `[1] revoked`, `[2] unknown`.

**CRL request**:
- Read `cRLDistributionPoints` extension OID `2.5.29.31`. First HTTP/HTTPS URL wins (skip LDAP).
- Cap at 8 MB to defend against `too_large` attack.
- Parse `CertificateList`. Verify signature with issuer cert. Iterate `revokedCertificates` looking for serial match.

**No DOM dependencies**: `globalThis.fetch`, `globalThis.crypto`. Funciona en Worker, Node 18+, Vite browser bundle.

**Bundle size target**: ≤18 KB gzip (suma OCSP + CRL + cache + DSS data builder; pkijs.OCSPRequest/Response añade ~6 KB extra al chunk lazy de `/firmar`).

### 3.3 KAT vectors

Capturar:
- 1× OCSP response real de **una CA pública** (Let's Encrypt) para un cert de prueba — `packages/ltv-validation/tests/__fixtures__/le-ocsp-good-2026-05-10.der`.
- 1× OCSP response real de **ARCOTEL ECI** si responder accesible (mejor effort; documentar URL + fecha) — `eci-ocsp-good-2026-05-10.der`. Si no accesible, dejar slot y marcar test `it.skip`.
- 1× CRL real de **ARCOTEL ECI** — `eci-crl-2026-05-10.der`.
- 1× respuesta OCSP `revoked` (sintetizada con cert dummy + responder dummy via node-forge) para test del path "revoked → block".

---

## 4. New package: `packages/dss-pdf`

### 4.1 Public API

```ts
// packages/dss-pdf/src/index.ts

import type { DssData } from '@firma-ec/ltv-validation';

export interface AppendDssOptions {
  /** B-T PDF bytes (input). */
  pdfBytes: Uint8Array;
  /** DSS data layer collected by @firma-ec/ltv-validation. */
  dss: DssData;
}

/** Append a DSS dictionary as an incremental update. Output is B-LT. */
export async function appendDss(opts: AppendDssOptions): Promise<Uint8Array>;

export interface AppendDocumentTimestampOptions {
  /** B-LT PDF bytes (input). */
  pdfBytes: Uint8Array;
  /** TSA URL (default https://freetsa.org/tsr). */
  tsaUrl?: string;
  /** Timeout ms (default 8000). */
  timeoutMs?: number;
}
export interface DocTimestampResult {
  ok: true;
  pdfBytes: Uint8Array;
  tsaIssuerCN: string;
  signingTime: Date;
}
export interface DocTimestampError {
  ok: false;
  reason: 'timeout' | 'network' | 'rate_limited' | 'malformed' | 'rejected';
  detail?: string;
}
/** Append a document timestamp /Sig dict (subFilter ETSI.RFC3161). Output is B-LTA. */
export async function appendDocumentTimestamp(
  opts: AppendDocumentTimestampOptions,
): Promise<DocTimestampResult | DocTimestampError>;

/** Verifier helper — extract DSS from a PDF if present. */
export interface ParsedDss {
  certsDer: Uint8Array[];
  ocspsDer: Uint8Array[];
  crlsDer: Uint8Array[];
  vri: Record<string, { certIndices: number[]; ocspIndices: number[]; crlIndices: number[]; timestampTokenIndex?: number }>;
}
export function parseDss(pdfBytes: Uint8Array): ParsedDss | null;

/** Verifier helper — extract document timestamp(s). */
export interface ParsedDocumentTimestamp {
  byteRange: [number, number, number, number];
  contents: Uint8Array;        // raw TimeStampToken DER
  coveredBytes: Uint8Array;    // for SHA-256(covered) imprint check
}
export function findDocumentTimestamps(pdfBytes: Uint8Array): ParsedDocumentTimestamp[];
```

### 4.2 Implementation notes

- Reuso de la maquinaria de bajo nivel de `packages/signer/src/incrementalUpdate.ts` — pero **factorizada**: extraer `parseTrailer`, `assembleIncremental`, `writeXrefSection` a `packages/signer/src/internal/pdfIncremental.ts` (NEW) y exportarlas. `dss-pdf` y `signer` consumen las primitivas.
- DSS streams: cada item DER se envuelve `<< /Length N >> stream\n<bytes>\nendstream\nendobj`. Sin filtros (no FlateDecode — los PDFs DSS de Adobe los emiten sin filtro y verificadores lo asumen así; ETSI no exige compresión).
- VRI key: hex uppercase de `SHA-1(signature.contents)` donde `signature.contents` son los **bytes hex-decoded del /Contents** del SignerInfo (NO los bytes hex). Esto es lo que hace Adobe Reader para resolver `/VRI/<hex>`.
- Document timestamp `/ByteRange`: `[0, contentsStart, contentsEnd, fileLength - contentsEnd]`. Mismo patrón que `/Sig` normal pero el `/Contents` es DIRECTAMENTE el TimeStampToken DER (no PKCS#7).
- Document timestamp signature length placeholder: 16384 bytes hex (8192 bytes DER) — suficiente para FreeTSA (~3 KB) con margen.

### 4.3 Tests

- Round-trip: B-T PDF → `appendDss` → `parseDss` → DSS data igual al input.
- Round-trip: B-LT PDF → `appendDocumentTimestamp` → `findDocumentTimestamps` → 1 doc-ts encontrado.
- Cross-validation Adobe: PDF B-LT generado abre en Adobe Reader DC, panel "Signature Properties" muestra "Long Term Validation" en revision history.
- Tampering: modificar 1 byte del DSS post-doc-ts → verifier detecta `documentTimestamp.imprintMatches: false`.

---

## 5. CMS / signer integration (`packages/signer/src/`)

### 5.1 New `BuildLtvOpts` (in `packages/signer/src/types.ts`)

```ts
export interface LtvOpts {
  /** When true (default), attempt to build B-LT after B-T. */
  longTerm?: boolean;
  /** When true (default), attempt to build B-LTA after B-LT. */
  longTermArchive?: boolean;
  /** OCSP request timeout ms (default 8000). */
  ocspTimeoutMs?: number;
  /** Override OCSP URL (else discovered via cert AIA). */
  ocspUrl?: string;
  /** TSA URL for document timestamp (default reuses signature TSA url). */
  documentTsaUrl?: string;
  /** Callback fired after LTV stage with status/warnings. */
  onLtvResult?: (r: LtvMeta) => void;
}

export interface LtvMeta {
  longTermAchieved: boolean;          // true iff DSS appended successfully
  archiveAchieved: boolean;           // true iff doc-ts appended successfully
  embeddedOcspCount: number;
  embeddedCrlCount: number;
  warnings: Array<{ code: string; detail?: string }>;
  /** When archiveAchieved=true. */
  documentTimestampTime?: Date;
  documentTimestampTsaIssuer?: string;
  /** Set when the flow aborted because a cert was revoked. */
  revoked?: { cn: string };
}
```

### 5.2 `pades.ts` flow extension

```ts
// After B-T pdf bytes are produced (current end of pades.signPdfPades):
let pdfBytes = bTpdfBytes;
const ltvMeta: LtvMeta = { longTermAchieved: false, archiveAchieved: false,
                            embeddedOcspCount: 0, embeddedCrlCount: 0, warnings: [] };

if (opts.ltv?.longTerm !== false) {
  const collect = await collectDssData({
    signerCert: cms.signerCert,
    intermediates: cms.intermediates,
    tsaCert: tsResult.ok ? tsResult.tsaCert : undefined,
    signatureContents: extractSignatureContents(bTpdfBytes),
    cache: ltvCache,
    timeoutMs: opts.ltv?.ocspTimeoutMs ?? 8000,
  });
  if ('revoked' in collect && collect.revoked) {
    throw new SignerError('certificate_revoked',
      `El certificado del firmante (${collect.revokedCertCN}) está revocado y no puede usarse para firmar.`);
  }
  if (collect.data.ocsps.length > 0 || collect.data.crls.length > 0) {
    pdfBytes = await appendDss({ pdfBytes, dss: collect.data });
    ltvMeta.longTermAchieved = true;
    ltvMeta.embeddedOcspCount = collect.data.ocsps.length;
    ltvMeta.embeddedCrlCount = collect.data.crls.length;
  } else {
    ltvMeta.warnings.push({ code: 'ltv_no_revocation_data' });
  }

  if (ltvMeta.longTermAchieved && opts.ltv?.longTermArchive !== false) {
    const dts = await appendDocumentTimestamp({
      pdfBytes,
      tsaUrl: opts.ltv?.documentTsaUrl ?? opts.tsaUrl,
      timeoutMs: 8000,
    });
    if (dts.ok) {
      pdfBytes = dts.pdfBytes;
      ltvMeta.archiveAchieved = true;
      ltvMeta.documentTimestampTime = dts.signingTime;
      ltvMeta.documentTimestampTsaIssuer = dts.tsaIssuerCN;
    } else {
      ltvMeta.warnings.push({ code: 'lta_doc_ts_' + dts.reason, detail: dts.detail });
    }
  }
}
opts.ltv?.onLtvResult?.(ltvMeta);
return { signedPdf: pdfBytes, ..., ltv: ltvMeta };
```

### 5.3 `SignResult` delta

```ts
export interface SignResult {
  signedPdf: Uint8Array;
  // ... existing F3-F6 fields ...
  timestamp: TimestampMeta;        // F6
  ltv: LtvMeta;                    // F7 — always present, may be { longTermAchieved: false, ... }
}
```

---

## 6. Verifier integration (`packages/verifier/src/`)

### 6.1 New `result.ts` extension

```ts
export interface LtvSummary {
  /** True iff a /DSS dictionary was found. */
  dssPresent: boolean;
  /** Count of cert/OCSP/CRL streams embedded. */
  embeddedCertCount: number;
  embeddedOcspCount: number;
  embeddedCrlCount: number;
  /** Per-cert revocation status using embedded data (preferred) or live (fallback). */
  revocationChecks: Array<{
    subjectCn: string;
    status: 'good' | 'revoked' | 'unknown' | 'not_checked';
    source: 'embedded_ocsp' | 'embedded_crl' | 'live_ocsp' | 'live_crl' | 'none';
    checkedAt?: string;
  }>;
  /** Document timestamp summary when present. */
  documentTimestamp?: {
    present: boolean;
    valid: boolean;
    badge: 'gold' | 'silver' | 'none';
    signingTime?: string;
    tsaIssuer?: string;
    reason?: string;
  };
  /** True iff embedded OCSP/CRL prove signer cert was good at signing time even if responders are now offline. */
  retrospectiveValid: boolean;
  /** Projected validity end (min of: sig cert notAfter, last embedded OCSP nextUpdate). */
  expiresOn?: string;
}

export interface SignatureMeta {
  profile: 'B-B' | 'B-T' | 'B-LT' | 'B-LTA' | 'unknown';   // ← extended
  // ... rest unchanged ...
  timestamp?: TimestampSummary;   // F6
  ltv?: LtvSummary;               // F7 — present when DSS or doc-ts found
}
```

### 6.2 New `packages/verifier/src/ltv.ts`

```ts
export async function verifyLtv(
  pdfBytes: Uint8Array,
  cms: ParsedCms,
  signerCertChain: ParsedCert[],
): Promise<LtvSummary>;
```

Steps inside:
1. `parseDss(pdfBytes)` from `@firma-ec/dss-pdf`.
2. For each cert in chain, look up matching OCSP/CRL in DSS by issuer/serial.
3. If embedded found: validate response signature + chain (using DSS-embedded responder cert if present), accept the embedded timestamp regardless of "freshness" (decision #10 retrospective).
4. If embedded missing: live fallback (`fetchOcsp` / `fetchCrl` from `@firma-ec/ltv-validation`).
5. `findDocumentTimestamps(pdfBytes)`. For each, `verifyTimestamp(token, coveredBytes)` (reuse F6 timestamp.ts but with covered bytes as imprint source instead of `signatureValue`).
6. Compute `retrospectiveValid`: true iff every cert in path has either embedded OCSP `good` or embedded CRL not-listed.
7. Compute `expiresOn`: min over (signer cert notAfter, max embedded OCSP nextUpdate).

### 6.3 Profile state machine in `index.ts`

Replace current `'B-T' | 'B-B'` resolution with:

```ts
function resolveProfile(
  cmsTimestampValid: boolean,
  ltv: LtvSummary | undefined,
): 'B-B' | 'B-T' | 'B-LT' | 'B-LTA' {
  if (ltv?.documentTimestamp?.valid && ltv.dssPresent) return 'B-LTA';
  if (ltv?.dssPresent && ltv.retrospectiveValid)       return 'B-LT';
  if (cmsTimestampValid)                                return 'B-T';
  return 'B-B';
}
```

### 6.4 Status semantics

- `B-LTA` valid and revocation good → `status: 'valid'`, no warnings.
- `B-LT` valid + signature timestamp absent → `status: 'valid'`, warning `code: 'lta_missing'` (informational only).
- `B-LT` with embedded OCSP `unknown` → `status: 'warning'`, code `revocation_unknown`.
- DSS present but doc-ts invalid → degrade to `B-LT`, warning `code: 'doc_timestamp_invalid'`.
- DSS missing on a B-T sig → unchanged from F6 (B-T result, no LTV warnings).

---

## 7. PWA UI changes

### 7.1 Wizard `Firmar.svelte` — new stages

```ts
type SignStage = 'parse_pfx' | 'import_key' | 'load_pdf' | 'build_cms' | 'sign'
  | 'request_timestamp'      // F6
  | 'fetch_ocsp'             // F7 NEW
  | 'fetch_crl'              // F7 NEW
  | 'build_dss'              // F7 NEW
  | 'document_timestamp'     // F7 NEW
  | 'assemble_pades' | 'incremental';
```

i18n keys (ES default):
- `firmar.progress.fetch_ocsp`: "Validando estado del certificado…"
- `firmar.progress.fetch_crl`: "Descargando lista de revocación…"
- `firmar.progress.build_dss`: "Empaquetando datos de validación…"
- `firmar.progress.document_timestamp`: "Sellando archivo a largo plazo…"

Toasts (no bloqueantes, sobre el step 7 resultado):
- `firmar.ltv.failed.no_revocation`: "No se pudieron obtener datos de revocación. Tu firma es válida pero no incluye validación a largo plazo."
- `firmar.ltv.failed.lta_doc_ts`: "No se pudo añadir el sello de archivo. Firma con validez a largo plazo (LT) sin archivo (LTA)."
- `firmar.ltv.failed.revoked` (BLOQUEANTE — error fatal en wizard): "Tu certificado está revocado y no puede usarse para firmar. Contacta a tu ECI para reemplazarlo."

Badge tier en step 7 success summary:
- B-LTA → 📦 emerald "Archivo a largo plazo · Verificable por X años"
- B-LT  → ⏳ teal    "Validez a largo plazo · Verificable offline"
- B-T   → 📜 gold    "Sellada por TSA" (existing F6)
- B-B   → (sin badge)

Tres badges acumulables (no excluyentes): un PDF B-LTA muestra los tres badges (sello + LT + LTA). UI los apila verticalmente con `gap: var(--space-2)`.

### 7.2 Settings page (`Configuracion.svelte`)

Sección "Validez a largo plazo (avanzado)":
- **Toggle**: "Incluir validación a largo plazo (LT)" (default: ON). `localStorage.firma_ec_settings.ltv_enabled`.
- **Toggle**: "Incluir sello de archivo (LTA)" (default: ON, deshabilitado si LTV off). `localStorage.firma_ec_settings.lta_enabled`.
- **Input URL**: "URL OCSP override" (vacío por default — usa AIA del cert). Validar `^https://`.
- **Input URL**: "URL TSA para sello de archivo" (default: hereda de Settings F6 TSA).
- Botón "Probar OCSP del certificado actual" (si hay PFX en draft): ejecuta `fetchOcsp(signerCert, issuerCert)` con la URL configurada; muestra status + producedAt + responderUrl.
- Reset: botón "Restaurar valores por defecto".

### 7.3 Verificar / DownloadResult — nuevo panel "DSS · Validación a largo plazo"

Cuando `result.signature.ltv.dssPresent === true`, renderizar tarjeta:

```
┌─────────────────────────────────────────────────────────┐
│ 📦 Archivo a largo plazo (B-LTA)                        │
│ ✓ Datos de validación embebidos: 3 OCSP, 1 CRL, 4 cert │
│ ✓ Sello de archivo: FreeTSA · 10/05/2026 14:32 UTC      │
│ ✓ Verificable hasta: 09/05/2031 (proyección)            │
│ ▸ Estado al firmar:                                     │
│     • Firmante (Juan Perez): good · OCSP embebido       │
│     • CA Intermedia (BCE): good · OCSP embebido         │
│     • CA Raíz (ARCOTEL): good · CRL embebida            │
└─────────────────────────────────────────────────────────┘
```

Tooltip sobre "Verificable hasta": "Proyección basada en la validez de la cadena embebida en el momento de firmar. La firma puede seguir verificando después de esta fecha si los certificados raíz siguen confiables."

Si `dssPresent === false` y `profile === 'B-T'`: NO renderizar la tarjeta (no es un error).

### 7.4 DownloadResult — copy refresh

Reemplazar el bloque de éxito hardcoded a "B-T" por una secuencia condicional:

```svelte
{#if result.profile === 'B-LTA'}
  <h2>Tu firma es de archivo a largo plazo</h2>
  <p>Verificable durante años aún sin conexión, gracias a la validación y el sello embebidos.</p>
{:else if result.profile === 'B-LT'}
  <h2>Tu firma incluye validación a largo plazo</h2>
  <p>Los datos de revocación viajan en el PDF — verificable offline.</p>
{:else if result.profile === 'B-T'}
  <h2>Tu firma está sellada</h2>
  <p>El sello de tiempo prueba cuándo se firmó.</p>
{:else}
  <h2>Tu firma es válida</h2>
{/if}
```

---

## 8. Failure / fallback policy (cascada normativa)

| Stage | Falla | Comportamiento | Resultado |
|---|---|---|---|
| OCSP responder timeout | Network/8s | Intentar CRL para ese cert | Embedded CRL → B-LT |
| OCSP `unknown` | Status code 2 | Embeber respuesta + warning `revocation_unknown` | B-LT con warning |
| OCSP `revoked` | Status code 1 | **ABORTAR firma con `SignerError('certificate_revoked')`** | NO se produce PDF |
| CRL no presente en cert | No `cRLDistributionPoints` extension | Skip CRL, mark cert sin revocación info | B-T (degrade) con warning `ltv_no_revocation_data` |
| Todos los OCSPs y CRLs fallan | Cascada completa | Skip DSS, output queda en B-T | B-T con warning `ltv_unavailable` |
| TSA falla en document timestamp | Timeout/network/etc | Skip DSS-on-doc-ts, output queda en B-LT | B-LT con warning `lta_doc_ts_<reason>` |
| Cert chain incompleta (intermediate missing) | No issuer found | Skip OCSP de ese cert, intentar resto | Parcial — flag `ltv_chain_incomplete` |
| OCSP responder cert no firma con CA del firmante (delegated) | Authorized Responder check falla | Embed igual + warning `ltv_responder_unverified` (para que verificadores externos decidan) | B-LT con warning |
| User opt-out (Settings LTV off) | Toggle = false | Skip todo el flujo F7 | B-T (silencioso) |

**Regla maestra (decisión #3)**: salvo "revoked", ninguna falla F7 puede impedir entregar la firma. La firma ya válida en B-T se entrega; F7 es enriquecimiento.

---

## 9. Threat model addendum (delta sobre F3 §6 + F6 §8)

| # | Amenaza F7 | Vector | Control | Norma |
|---|---|---|---|---|
| F7-1 | Trusted-mirror attack en OCSP responder | DNS/BGP hijack devuelve respuesta `good` falsa | Respuesta OCSP firmada por delegated cert emitido por el mismo CA del firmante (RFC 6960 §4.2.2.2). Verifier valida sig + chain — `good` falso requiere comprometer la CA, no solo el responder. Embebido en DSS = verificable offline. | RFC 6960 §4.2.2 |
| F7-2 | Replay de OCSP response viejo (`good` antes de revocación) | MITM cachea + reusa | OCSP `producedAt` + `thisUpdate` indican vintage. Aceptamos retrospectivo (decisión #10): si la firma es del 2026-05-10 y la OCSP `producedAt: 2026-05-10`, "replay" no aporta — exactamente el estado al momento de firmar. Para firmas frescas: `nonce` opcional (RFC 6960 §4.4.1) NO se setea por defecto (muchos responders ARCOTEL no lo soportan). | RFC 6960 §2.2 |
| F7-3 | Privacy leak via OCSP query | Responder ve `(issuerKeyHash, serial)` del usuario | Stapled OCSP via cert AIA cuando CA lo soporta — F7.5. F7 acepta la fuga (estándar de la industria). Documentar en `/seguridad`. Worker → fetch directo, sin proxy. | OWASP ASVS A8 |
| F7-4 | OCSP responder downgrade SHA-1 | Responder solo emite respuestas con CertID SHA-1 | Aceptar con warning `ltv_sha1_certid` (decisión #15). SHA-256 preferido cuando el responder soporta. Adobe Reader 11+ acepta SHA-1 CertID. | NIST SP 800-131A nota histórica |
| F7-5 | CRL bomb (responder devuelve 50 MB CRL) | DoS bandwidth/CPU | Cap `Content-Length ≤ 8 MB` o lectura streaming con cap; excede → `{ ok: false, reason: 'too_large' }`. | OWASP ASVS 12.5 |
| F7-6 | TSA del document timestamp pertenece a infra del atacante | Firma B-LTA con TSA bajo control adversario | Mismo control F6: trust roots TSA en `packages/tsa-trust`. TSA URL configurable en Settings — usuario puede cambiar a TSA confiable. Multi-TSA en F7.6. | RFC 3161 §4 |
| F7-7 | DSS post-firma corrompida (atacante muta /OCSP) | Modifica DSS sin re-sellar | Document timestamp B-LTA cubre la DSS — cualquier mutación rompe el imprint. Verifier marca `documentTimestamp.valid: false`. **B-LT (sin LTA) NO protege contra esto** — solo B-LTA. Documentado. | ETSI EN 319 142-1 §5.5 |
| F7-8 | Cert chain mal embebida (falta intermediate) | Verificador externo no puede armar cadena | `collectDssData` embebe TODA la cadena hasta root inclusive. Tests cubren completitud. | ETSI §5.4 |
| F7-9 | OCSP responder firma con cert revocado | El responder mismo está comprometido | Verifier valida cadena del responder cert hasta root TSL. Si responder cert revocado en CRL/OCSP del padre → marca `responder_invalid`. | RFC 6960 §3.2 |
| F7-10 | Future-proofing: SHA-256 deprecation | En 10 años SHA-256 OCSP es legacy | Diseño permite añadir SHA-3/SHA-512 future via `hashAlgo: 'auto'`. Roadmap F8+. | NIST SP 800-208 |

### 9.1 Privacy disclosure user-facing

En `/seguridad` añadir sección "Validación a largo plazo":

> **Validación a largo plazo (LT/LTA)**: cuando firmas con LT activado, la app contacta los servidores de revocación de tu CA (OCSP, CRL) para incluir en el PDF la prueba de que tu certificado estaba vigente en ese momento. Estos servidores ven que un certificado con tu serial fue consultado, pero NO ven el contenido del documento, ni quién es el destinatario, ni cuándo abriste la app. Puedes desactivar LT en Configuración → Avanzado (la firma seguirá siendo válida, solo no llevará validación embebida).

---

## 10. ARCOTEL ECI Ecuador — caveats operativos

**Discovery vía cert AIA**: cada cert ECI Ecuador (BCE, Security Data, Anf, Lazzate, Datil, Consejo Judicatura, etc.) declara su responder en la extensión `authorityInfoAccess` (OID `1.3.6.1.5.5.7.1.1`) con `accessMethod = id-ad-ocsp` (OID `1.3.6.1.5.5.7.48.1`). Ejemplo BCE:

```
authorityInfoAccess:
    OCSP - URI:http://ocsp.eci.bce.ec
    CA Issuers - URI:http://www.eci.bce.ec/cert/AC-BCE.cer
```

**Caveats observados**:
- **Rate limit**: algunos responders ECI rechazan >2 req/s/IP con HTTP 429. Cache TTL 1h mitiga durante una sesión. Producción real verá ráfagas si usuario firma 10+ PDFs seguidos.
- **Downtime histórico**: ocsp.eci.bce.ec ha tenido outages de 6-12h en 2024-2025. Fallback a CRL es crítico.
- **HTTP no HTTPS**: muchos responders ECI sirven OCSP por HTTP plano (estándar RFC 6960 lo permite — la respuesta va firmada). Documentar en CSP: `connect-src http://ocsp.eci.bce.ec` permitido para ese host específico (mejor: regex de dominios `.eci.bce.ec`).
- **CRL grandes**: `crl.eci.bce.ec/crl/AC-BCE.crl` puede pesar 4-8 MB. Cap 8 MB en `fetchCrl` ajustado.
- **SHA-1 CertID**: ARCOTEL responders mayoritariamente requieren SHA-1 CertID en OCSP request. Decisión #15.

URLs documentar en `/seguridad` y en code comments — NO hardcodear (se obtienen del cert).

---

## 11. Out of scope (F7.5 / F7.6 / F8 territory)

- **F7.5 — Refresh periódico de DSS**: re-ejecutar `collectDssData` y append nueva DSS al PDF para extender validez más allá del `nextUpdate` original. Pattern: PDF B-LTA puede seguir siendo refrescado durante años, cada refresh añade una capa DSS + doc-ts. UI: botón "Renovar validación" en Verificar.svelte.
- **F7.6 — Multi-OCSP redundancia**: pedir OCSP a 2-3 responders en paralelo (cuando AIA declara multiples) y elegir el primero válido. Mitiga F7-1 (mirror attack) y rate-limit.
- **F7.7 — Stapled OCSP** (`id-aa-ets-revocationValues` en signedAttrs): respuesta OCSP DENTRO de la firma CMS (no en DSS externa). Adobe Reader prefiere stapled para B-LT. Considerar para v0.8.x.
- **F8 — QES eIDAS / firma cualificada ARCOTEL**: distinto topic (HSM, supervisor cert, conformidad CEN EN 419 241), no atacable en F7.
- **F9 — Sello visible LTV en cuadro de firma**: badge "📦 Long-term" embedded en el visible signature appearance. F8 si se pide.
- **F10 — Notarización blockchain** (anclar el hash del PDF B-LTA en una chain pública): out of ETSI scope, posible feature comercial separada.

---

## 12. Acceptance criteria — v0.7.0-rc1

Para declarar F7 cerrado y tagear `v0.7.0-rc1`:

1. [ ] `pnpm --filter @firma-ec/ltv-validation test` verde (unit + KAT vectors LE + ARCOTEL [or skip] + property-based mocks).
2. [ ] `pnpm --filter @firma-ec/dss-pdf test` verde (round-trip DSS, round-trip doc-ts, tampering detection, Adobe-shape DSS structure tests).
3. [ ] `pnpm --filter @firma-ec/signer test` verde con nuevos tests B-LT/B-LTA orchestration + revoked-cert abort path.
4. [ ] `pnpm --filter @firma-ec/verifier test` verde con `verifyLtv` cubriendo embedded-only, live-fallback, retrospective, doc-ts gold/silver/none.
5. [ ] **Adobe Reader DC** abre PDF B-LT generado por la PWA y muestra "Long-Term Validation" en Signature Properties → "Last Checked" timestamp visible. Captura en `docs/reports/F7-cross-validation-2026-05-10/`.
6. [ ] **Adobe Reader DC** abre PDF B-LTA y muestra adicionalmente "Document is timestamped — DD/MM/YYYY". Captura.
7. [ ] **Verificador propio** muestra `profile: 'B-LT'` post-sign con LT default-on, `profile: 'B-LTA'` con LTA default-on.
8. [ ] **Test offline crítico**: B-LT PDF → red desconectada (DevTools Network → Offline) → `verifyPdf` resuelve `valid` con `retrospectiveValid: true` usando OCSPs embebidos. **Sin esto, F7 no aporta nada.**
9. [ ] **Revoked path**: cert dummy con OCSP `revoked` mock → sign abort con `SignerError('certificate_revoked')` + UI muestra error fatal con CTA "Renovar certificado".
10. [ ] Bundle delta `/firmar` lazy chunk ≤25 KB gz contra v0.6.x baseline (`pnpm --filter pwa build` + size-limit script).
11. [ ] Lighthouse `/firmar` ≥95, `/verificar` ≥95.
12. [ ] axe-core 0 violations en wizard + Settings + Verificar (incluido nuevo panel DSS).
13. [ ] Mozilla Observatory + securityheaders.com sostienen A+ post-deploy.
14. [ ] **CSP update**: `connect-src` añade hostnames OCSP/CRL ECI (regex via `*.eci.bce.ec` documentado en Caddyfile.pwa). Test que CSP no bloquea fetch real.
15. [ ] Playwright E2E: golden path con OCSP/TSA mocked (MSW) → B-LTA badge; offline-after-sign path → verificación reusa DSS sin live; revoked path → wizard error. Mobile (iPhone 13, Pixel 5).
16. [ ] **Regresión F3-F6**: 300+ tests existentes verde. Firmas B-T legacy verifican como `valid` con `profile: 'B-T'`.
17. [ ] `docs/transparency-report.md` actualizado: sección "F7 LTV — DSS, OCSP, CRL, document timestamp, threat model".
18. [ ] CHANGELOG entry v0.7.0-rc1.
19. [ ] Tag `v0.7.0-rc1` firmado con Cosign + SLSA L3 provenance + SBOM CycloneDX.
20. [ ] Memoria F7 closure registrada en `~/.claude/.../memory/`.

---

## 13. Self-review (post-write)

- **Placeholder scan**: 0 TBD/TODO/FIXME en este documento. ✅
- **Internal consistency**: decisiones 1-15 (§1) reflejadas en arquitectura (§2), packages (§3-4), signer (§5), verifier (§6), UI (§7), fallback (§8), threats (§9), ARCOTEL caveats (§10), out-of-scope (§11), acceptance (§12). ✅
- **Scope check**: foco en **B-LT y B-LTA**, sin DSS-refresh (F7.5), sin multi-OCSP (F7.6), sin stapled (F7.7), sin QES (F8). ✅
- **Norma alignment**: ETSI EN 319 142-1 §5.4-5.5 (PAdES B-LT/B-LTA), ISO 32000-1 §12.8.4 (DSS, /VRI, /DocTimeStamp), RFC 6960 (OCSP), RFC 5280 §5 (CRL), RFC 3161 (TSA reuse). ✅
- **Backward compat**: B-T legacy verifies sin cambios (decisión #11). Profile state machine añade niveles, no remueve. SignResult añade campo `ltv` opcional. ✅
- **Privacy**: OCSP query reveals (issuerKeyHash, serial) — F7-3 documentado, mitigation stapled F7.7. Documento contenido NO leak. ✅
- **ARCOTEL realism**: caveats §10 reconocen rate limit, downtime histórico, HTTP plano, SHA-1 CertID — F7 no rompe contra realidad ECI Ecuador. Decisión #14-15 documentadas. ✅
- **Critical "revoked" path**: única excepción al "siempre fallback" — decisión #4. Documentado en flow (§5.2), failure table (§8), acceptance #9. ✅
- **F6 reuse**: `tsa-client` y `tsa-trust` reusados sin fork para document timestamp. `verifyTimestamp` reusable cambiando solo el origen del imprint (signatureValue → coveredBytes). ✅
- **Bundle budget**: 25 KB gz aggregate (ltv-validation ~18 KB + dss-pdf ~7 KB) declarado y verificable. ✅

---

**Fin del spec F7 — listo para `writing-plans`.**
