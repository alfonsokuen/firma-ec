---
date: 2026-05-09
project: firma-ec
phase: F3
status: Draft v1 — listo para `writing-plans`
authors: Alfonso Kuen + Claude (sesión brainstorming F3)
supersedes: null
references:
  - docs/superpowers/specs/2026-05-08-firma-ec-design.md  # spec general (workspace root)
  - docs/superpowers/plans/2026-05-08-firma-ec-F2-verification-mvp.md
  - apps/pwa (F2 LIVE en https://app.firmar.ec, v0.2.2)
  - packages/verifier (reuso para detectar firmas previas)
deliverable_tag: v0.3.0-rc1
---

# F3 — Firma MVP (PAdES B-B en cliente puro)

## 0. Goal

Invertir el flujo: además de **verificar** (F2), la PWA produce **firmas PAdES B-B** completamente en el navegador a partir del `.p12`/`.pfx` del usuario y su PIN, con cuadro visible mínimo (solo `Firmado por: <CN>`), soporte multi-firma secuencial sobre PDFs ya firmados, mobile-first, stateless puro y worker isolation con `terminate-after-use`. Resultado: PDF firmado que el verificador F2 mismo (en este PWA o en cualquier validador PAdES — Adobe Reader, FirmaEC desktop, Minka) acepta como firma válida.

> **Nivel** PAdES **B-B mínimo** — sin TSA (timestamp), sin OCSP-embebido, sin LTV. Eso es F6 / F7.

---

## 1. Decisiones aprobadas (decision log resumido)

Las 10 decisiones consolidadas tras el brainstorm 2026-05-09:

| # | Decisión | Rationale corto |
|---|---|---|
| 1 | **Key source: solo `.p12`/`.pfx` upload + PIN per-firma** (sin WebUSB / PKCS#11 / HSM, sin caché de sesión) | Simplicidad, compatibilidad universal con certs ECI Ecuador (BCE, Security Data, ANFAC, etc.), zero-state real. WebUSB excluiría iOS y rompería mobile-first. |
| 2 | **PAdES B-B mínimo** | El cert ya provee identidad legal (ETSI EN 319 102-1 §5.1). TSA/OCSP/LTV son mejoras de no-repudio temporal, no requisito legal LCE. Reduce superficie cripto y de red en MVP. |
| 3 | **Cuadro visible obligatorio, plantilla única, solo CN** ("Firmado por: <CN>") | Compatibilidad visual con FirmaEC desktop. Cero PII extra (sin fecha/razón/lugar visible — eso ya va en signedAttrs CMS, técnicamente verificable). Una sola plantilla = menos código, menos bugs, UX consistente. |
| 4 | **Mobile-first desde MVP** | Principio rector. La gran promesa frente a FirmaEC desktop (que requiere Java) es funcionar en móvil. Si no lo hace en móvil, el proyecto pierde su razón de ser. |
| 5 | **Multi-firma secuencial vía incremental update** | F2 ya parsea firmas existentes. F3 reutiliza ese parsing para construir incremental update preservando la(s) firma(s) anterior(es). No multi-firma paralela (mismo byte-range con varios firmantes simultáneos) — eso es PAdES extendido. |
| 6 | **Stateless puro: cero persistencia** | LOPDP-native (spec §0, §5). PDF firmado = blob URL local descargable. Cero cookies, IndexedDB, localStorage, SW cache de PDFs/keys. |
| 7 | **Razón + Lugar opcionales en UI → signedAttrs CMS, NO al cuadro visible** | Quien quiera trazabilidad rica los completa; quedan en metadatos firmados (verificables). El cuadro visible se mantiene minimalista. |
| 8 | **Worker isolation: `terminate-after-use` por firma** | Mismo modelo que F2 verifier (continuidad). Cada firma = un Worker dedicado nuevo + `worker.terminate()` al finalizar (éxito o error). Mitiga side-channels y persistencia accidental de bytes en el heap del worker. |
| 9 | **Stack: `@signpdf` ^3.3.0 + `pdf-lib` + `pkijs` + `pdfjs-dist` v4** | Continuidad con F2 (`pkijs` ya wired). `@signpdf` 3.3.0 (latest 3.x — API CMS-build estable; v4 aún no publicado en npm a 2026-05-09, bump cuando esté disponible) es ESM-friendly, modular, soporta Signer custom (necesario para Web Crypto). `pdf-lib` para incremental update + appearance stream. `pdfjs-dist v4` ESM para preview en `<canvas>`. |
| 10 | **Tag deliverable: `v0.3.0-rc1`** | Bump menor sobre v0.2.x (F2). `-rc1` señala que F3 entra como release candidate hasta validación con `.p12` real del usuario y cross-check FirmaEC desktop / Adobe Reader. |

---

## 2. Architecture

### 2.1 Componentes nuevos

```
firma-ec/
├── packages/
│   ├── signer/                       NEW
│   │   ├── package.json              # @firma-ec/signer (workspace:*)
│   │   ├── src/
│   │   │   ├── index.ts              # signPdf(opts): Promise<Uint8Array>
│   │   │   ├── pkcs12.ts             # parsePfx(bytes, pin) → { cert, chain, privateKey, alg }
│   │   │   ├── webcrypto.ts          # importPrivKeyForSign(...) → CryptoKey extractable:false
│   │   │   ├── cms-build.ts          # build SignedData (signedAttrs + signature) via pkijs
│   │   │   ├── pades.ts              # @signpdf 4 wiring + ByteRange + /Contents
│   │   │   ├── visible-sig.ts        # plantilla "Firmado por: <CN>" (pdf-lib drawText)
│   │   │   ├── incremental.ts        # detectar firmas previas (re-uso F2) + append update
│   │   │   ├── errors.ts             # SignerError (códigos: bad_pin, bad_p12, weak_alg, ...)
│   │   │   └── types.ts              # SignOptions, SignResult, VisibleSigSpec, SignerCert
│   │   └── tests/
│   │       ├── pkcs12.test.ts        # vectores sintéticos node-forge + fast-check
│   │       ├── pades.test.ts         # firma → re-parse con verifier (cross-check)
│   │       ├── incremental.test.ts   # PDF ya firmado + segunda firma
│   │       ├── visible-sig.test.ts   # cuadro renderiza, posición, CN extraído
│   │       └── e2e.test.ts           # full path: p12 sintético → signPdf → verifyPdf=valid
│   │
│   └── verifier/                     REUSE (no se modifica salvo export helper)
│       └── src/index.ts              # exporta findSignature() para detectar firmas previas
│
├── apps/pwa/
│   ├── src/
│   │   ├── routes/
│   │   │   └── Firmar.svelte         NEW   # stepper full-screen mobile-first
│   │   ├── ui/
│   │   │   ├── PdfPreview.svelte     NEW   # pdfjs-dist canvas + overlay placement
│   │   │   ├── BoxPlacer.svelte      NEW   # tap+drag (mobile) / drag (desktop) del cuadro
│   │   │   ├── DropP12.svelte        NEW   # picker .p12/.pfx
│   │   │   ├── PinInput.svelte       NEW   # type=password, autocomplete=off, autoComplete cleared
│   │   │   ├── OptionalAttrs.svelte  NEW   # razón + lugar (UI → signedAttrs)
│   │   │   ├── SignButton.svelte     NEW   # CTA único + summary
│   │   │   ├── DownloadResult.svelte NEW   # blob URL + Web Share API + verify-now CTA
│   │   │   ├── Drop.svelte           REUSE # F2 ya tiene el componente para PDF
│   │   │   └── Progress.svelte       REUSE # F2 stepper indeterminado
│   │   └── lib/
│   │       └── workers/
│   │           ├── sign.worker.ts    NEW   # single-shot, terminate-after-use
│   │           ├── sign.bus.ts       NEW   # runSign() helper typed (espejo de bus.ts F2)
│   │           └── sign.bus.test.ts  NEW   # FakeWorker pattern (calcado F2)
│   └── tests-e2e/
│       └── sign.spec.ts              NEW   # Playwright golden path
│
├── tools/
│   └── gen-test-p12.ts               NEW   # node-forge → fixture .p12 sintético + cert chain
│
└── infra/
    └── docker/
        └── Caddyfile.pwa             MODIFY  # agregar `/firmar` en CSP / cache buckets si aplica
```

### 2.2 Reutilización del verifier F2

`packages/verifier` exporta `findSignature(pdfBytes)` (ya existe en `src/pdf.ts`). El `signer` lo importa para:

1. **Detectar firmas previas** antes de firmar — informa al UI ("este PDF ya tiene N firma(s) anteriores; tu firma se añadirá sin invalidarlas").
2. **Validar el resultado** post-firma en tests E2E (`signPdf(...)` → `verifyPdf(...)` debe retornar `status: 'valid'` o `'warning'` por OCSP/no-TSA — nunca `'invalid'`).

No se duplica parsing de PDFs ni de CMS. La lógica de firma es **constructiva** (build); la lógica de verificación es **destructiva** (parse) — comparten OIDs y tipos vía `@firma-ec/crypto-core`.

### 2.3 Diagrama de flujo de la llave (privacy-by-design)

```
.p12 file (User device)
   │  (File API → ArrayBuffer)
   ▼
[Web Worker: sign.worker.ts]   ─── borde de aislamiento ───
   │
   │  1. parsePfx(bytes, pin)        pkijs.PFX.fromBER + decrypt
   │  2. importPrivKeyForSign(jwk)   crypto.subtle.importKey({ extractable:false })
   │  3. zero-out  bytes & pin       fill(0) + null deref
   │  4. build CMS SignedData        pkijs SignedData + signedAttrs (signingTime, mdAlgo, …)
   │  5. compute messageDigest       crypto.subtle.digest sobre coveredBytes
   │  6. sign signedAttrs            crypto.subtle.sign(CryptoKey, signedAttrsDer)
   │  7. assemble PAdES              @signpdf 3.3.0 Signer custom → /Contents + /ByteRange
   │  8. (multi-firma) incremental   pdf-lib append update sin tocar previas
   │  9. (visible) drawText "CN"     pdf-lib AcroForm /Sig + /AP appearance stream
   │
   ▼
PDF firmado (Uint8Array)  ──postMessage Transferable──►  main thread
   │
   ▼
worker.terminate()  ←─── el Worker se destruye; CryptoKey + pin + bytes ya están fuera del heap
   │
   ▼
Blob URL local → <a download> / navigator.share({ files })
                                                 │
                                                 ▼
                                          Cero tráfico saliente
```

---

## 3. UX flow — mobile-first stepper full-screen

> **Principio**: el usuario móvil debe completar el flujo con una sola mano y dedos gordos. Cada paso ocupa el viewport completo, con un solo CTA primario visible y el botón "Atrás" como secundario en el header.

### 3.1 Steps (1 → 6)

```
┌─ Paso 0: HOME PWA (ya existe) ──────────────────────────────────┐
│  [ Verificar ]   [ Firmar ]   ← tap "Firmar" navega a /firmar   │
└──────────────────────────────────────────────────────────────────┘

┌─ Paso 1: Cargar PDF ─────────────────────────────────────────────┐
│   ⬆ Subir PDF                                                    │
│   ┌──────────────────────┐                                       │
│   │   Arrastra o toca    │   ← reuso de Drop.svelte (F2)         │
│   │   para elegir PDF    │                                       │
│   └──────────────────────┘                                       │
│   "Tu PDF nunca sale de tu dispositivo."                         │
│                                                                  │
│   [Continuar →] (disabled hasta que haya PDF válido)             │
└──────────────────────────────────────────────────────────────────┘
       │
       │  (worker pre-flight: findSignature → ¿N firmas previas?)
       ▼
┌─ Paso 2: Posicionar cuadro de firma ─────────────────────────────┐
│   Página [ < 1 / 5 > ]                                           │
│   ┌────────────────────────────────────────┐                     │
│   │                                         │                    │
│   │       PDF Preview (pdfjs-dist)         │                     │
│   │   ┌─────────────────┐                  │                     │
│   │   │ Firmado por:    │  ← BoxPlacer    │                     │
│   │   │ <CN preview>    │     drag/tap    │                     │
│   │   └─────────────────┘                  │                     │
│   │                                         │                    │
│   └────────────────────────────────────────┘                     │
│   Tamaño: [— compact —][ standard ][— large —]                   │
│                                                                  │
│   ⓘ Si este PDF ya está firmado, tu firma se añadirá sin         │
│     romper las anteriores. (mostrado solo si N > 0)              │
│                                                                  │
│   [← Atrás]                              [Continuar →]            │
└──────────────────────────────────────────────────────────────────┘

┌─ Paso 3: Cargar certificado ─────────────────────────────────────┐
│   🔐 Tu certificado .p12 / .pfx                                  │
│   ┌──────────────────────┐                                       │
│   │   Arrastra o toca    │                                       │
│   │   para elegir .p12   │                                       │
│   └──────────────────────┘                                       │
│   "Tu llave nunca sale de tu dispositivo. Se descarta tras firmar."
│                                                                  │
│   [← Atrás]                              [Continuar →]            │
└──────────────────────────────────────────────────────────────────┘

┌─ Paso 4: PIN ────────────────────────────────────────────────────┐
│   🔑 Contraseña del certificado                                  │
│   ┌──────────────────────┐                                       │
│   │ • • • • • • • •      │  type=password autocomplete=off       │
│   └──────────────────────┘  inputmode=text  enterkeyhint=done    │
│                                                                  │
│   ▢ Mostrar caracteres                                           │
│                                                                  │
│   ⚠ Tu contraseña se borra inmediatamente tras importar la       │
│     llave. No se guarda. No se envía.                            │
│                                                                  │
│   [← Atrás]                              [Continuar →]            │
└──────────────────────────────────────────────────────────────────┘
       │
       │  (worker: parsePfx + importPrivKey; si bad_pin → vuelve aquí
       │   con error inline; pin field se limpia automáticamente)
       ▼
┌─ Paso 5: Razón / Lugar (opcionales) ─────────────────────────────┐
│   ✏ Detalles opcionales                                          │
│                                                                  │
│   Razón:    [________________________]   ej. "Aprobado"          │
│   Lugar:    [________________________]   ej. "Quito, Ecuador"    │
│                                                                  │
│   ⓘ Estos datos van como metadatos firmados (signedAttrs CMS).   │
│     No aparecen en el cuadro visible.                            │
│                                                                  │
│   [← Atrás]                              [Continuar →]            │
│                                          [Saltar →] (si vacíos)  │
└──────────────────────────────────────────────────────────────────┘

┌─ Paso 6: Confirmar y firmar ─────────────────────────────────────┐
│   📋 Resumen                                                     │
│                                                                  │
│   • Documento: facturas-mayo.pdf  (245 KB)                       │
│   • Firmas previas: 0  ▸                                         │
│   • Certificado: JUAN PEREZ GOMEZ                                │
│     Emitido por: BCE — Banco Central del Ecuador                 │
│     Vigencia: hasta 2027-08-15  ✓                                │
│   • Cuadro visible: página 1, esquina inf-derecha, std           │
│   • Razón: (vacío)                                               │
│   • Lugar: Quito, Ecuador                                        │
│                                                                  │
│   [← Atrás]                            [ ✍ Firmar PDF ]          │
└──────────────────────────────────────────────────────────────────┘
       │
       │  (worker: build CMS + sign + assemble PAdES; UI muestra
       │   Progress.svelte indeterminado con stepper de stages)
       ▼
┌─ Paso 7: Resultado ──────────────────────────────────────────────┐
│   ✅ PDF firmado correctamente                                   │
│                                                                  │
│   facturas-mayo-firmado.pdf  (248 KB)                            │
│                                                                  │
│   [⬇ Descargar]   [📤 Compartir]   [🔍 Verificar ahora]          │
│                                                                  │
│   ⓘ Pasos siguientes:                                            │
│     1. Verifica tu firma en /verificar antes de enviar.          │
│     2. Tu llave y contraseña ya fueron descartadas.              │
│                                                                  │
│   [Firmar otro PDF]                                              │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Variantes desktop

- Pasos 1, 3: drop zone real (drag-and-drop highlight + click).
- Paso 2: drag con cursor sobre el preview (no tap-and-hold). Wheel para cambiar página.
- Paso 4: PIN ocupa una columna lateral, con preview del cert metadata visible al confirmar.
- Layout: el stepper se condensa en una sola pantalla con secciones colapsables si el viewport ≥1024px (no obligamos a clicks adicionales en desktop). Los hitos lógicos siguen siendo los mismos.

### 3.3 Estados de error en cada paso

| Paso | Error | Comportamiento |
|---|---|---|
| 1 | PDF inválido / >50 MB / encriptado | Inline error en el dropzone, no avanza, ofrece volver a elegir |
| 1 | PDF ya firmado y firmas inválidas | Banner amarillo: "Las firmas anteriores parecen inválidas. Tu nueva firma se añadirá igualmente." (no bloquea — usuario decide) |
| 2 | Página seleccionada inválida | Auto-clamp a [1, lastPage] |
| 3 | `.p12` no parsea (no es PKCS#12) | Inline error: "Este archivo no parece un certificado .p12 válido." |
| 4 | PIN incorrecto | Inline error: "Contraseña incorrecta. Intenta de nuevo." Field se limpia. |
| 4 | Cert con algoritmo débil (RSA<2048, SHA-1) | Bloqueante: "Tu certificado usa un algoritmo deprecado y no se puede firmar con seguridad." Sin retry. |
| 4 | Cert expirado al momento de firmar | Bloqueante: "Tu certificado está expirado (venció YYYY-MM-DD). Renuévalo con tu ECI." |
| 5 | Razón/Lugar con caracteres no UTF-8 válidos | Sanitizar silenciosamente |
| 6 | Worker timeout (>30 s) | Banner rojo + retry. Worker terminado. |
| 6 | crypto.subtle.sign falla | Banner rojo genérico ("Error al firmar. Intenta de nuevo.") + log dev-only en console. |

---

## 4. Cripto core — detalle por subsistema

### 4.1 PKCS#12 decrypt (`packages/signer/src/pkcs12.ts`)

```ts
import { PFX, PrivateKeyInfo, Certificate, Attribute } from 'pkijs';
import { fromBER } from 'asn1js';
import { SignerError } from './errors';
import type { SignerCert, ParsedPfx } from './types';

/**
 * Parse PKCS#12 (.p12 / .pfx) and decrypt with PIN.
 * Returns: signing cert + chain (intermediates) + private key as JWK + alg metadata.
 *
 * Throws SignerError(code='bad_pin') si la integridad no valida.
 * Throws SignerError(code='bad_p12') si el ASN.1 no parsea.
 * Throws SignerError(code='no_signing_cert') si no encuentra cert con keyUsage.digitalSignature.
 * Throws SignerError(code='weak_alg') si RSA<2048 / ECDSA<P-256 / hash<SHA-256.
 */
export async function parsePfx(bytes: Uint8Array, pin: string): Promise<ParsedPfx> {
  const asn1 = fromBER(bytes);
  if (asn1.offset === -1) throw new SignerError('bad_p12', 'PFX no parsea como ASN.1');
  let pfx: PFX;
  try { pfx = new PFX({ schema: asn1.result }); } catch { throw new SignerError('bad_p12', 'PFX schema inválido'); }

  // Verify outer MAC con PIN
  try { await pfx.parseInternalValues({ password: stringToArrayBuffer(pin), checkIntegrity: true }); }
  catch { throw new SignerError('bad_pin', 'PIN incorrecto o integridad PFX inválida'); }

  // Extraer certs + privKey de safeContents
  const { signingCert, intermediates, privateKeyInfo } = extractMaterial(pfx);
  if (!signingCert) throw new SignerError('no_signing_cert', 'No hay cert con keyUsage.digitalSignature');

  // Validar suite cripto (ETSI TS 119 312)
  assertStrongAlg(signingCert);   // throws weak_alg si SHA-1, RSA<2048, ECDSA<P-256

  // PrivateKeyInfo → JWK (Web Crypto-friendly)
  const jwk = privateKeyInfoToJwk(privateKeyInfo);
  const alg = inferSigAlg(signingCert);  // RSASSA-PKCS1-v1_5 / RSA-PSS / ECDSA + SHA-256/384/512

  return { signingCert, intermediates, privateKeyJwk: jwk, sigAlg: alg };
}
```

**Notas**:
- `pkijs.PFX.parseInternalValues` ya implementa MAC validation; la única forma robusta de detectar PIN incorrecto.
- `safeContents` puede tener orden arbitrario de bags. Iterar todos.
- Soportar PIN en latin-1 y UTF-8 (algunos generadores Java codifican distinto). Probar primero UTF-8; si falla MAC, reintentar con latin-1 antes de declarar `bad_pin`.

### 4.2 Web Crypto importKey (`packages/signer/src/webcrypto.ts`)

```ts
export async function importPrivKeyForSign(jwk: JsonWebKey, sigAlg: SigAlg): Promise<CryptoKey> {
  const algParams = sigAlgToWebCrypto(sigAlg);  // { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } | { name: 'ECDSA', namedCurve: 'P-256' }
  return crypto.subtle.importKey('jwk', jwk, algParams, /* extractable */ false, ['sign']);
}
```

**`extractable: false`** es no-negociable. Una vez importada la llave queda opaca al JS, no hay `exportKey('jwk')` posible. El JWK temporal se zero-out manualmente tras `importKey` resolver.

### 4.3 `@signpdf` 3.3.0 wiring (`packages/signer/src/pades.ts`)

> **Dependency note (2026-05-09):** `@signpdf` v4 no está publicado en npm; usamos v3.3.0 (latest 3.x). API CMS-build estable. Bump a v4 cuando se publique.


```ts
import { signpdf } from '@signpdf/signpdf';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { Signer } from '@signpdf/utils';
import { PDFDocument } from 'pdf-lib';
import { buildSignedAttrs, buildSignedDataDer } from './cms-build';

export class WebCryptoSigner extends Signer {
  constructor(
    private readonly cryptoKey: CryptoKey,
    private readonly cert: Certificate,
    private readonly chain: Certificate[],
    private readonly sigAlg: SigAlg,
    private readonly opts: { signingTime: Date; reason?: string; location?: string },
  ) { super(); }

  async sign(coveredBytes: Buffer): Promise<Buffer> {
    // 1. Hash sobre coveredBytes (todo excepto /Contents)
    const messageDigest = new Uint8Array(await crypto.subtle.digest(this.opts.mdAlgo, coveredBytes));
    // 2. Build signedAttrs DER (incluye signingTime, mdAlgo, contentType, messageDigest, [reason], [location])
    const signedAttrsDer = buildSignedAttrs({ messageDigest, ...this.opts });
    // 3. Sign signedAttrs con la llave Web Crypto opaca
    const signature = new Uint8Array(await crypto.subtle.sign(webCryptoAlgFor(this.sigAlg), this.cryptoKey, signedAttrsDer));
    // 4. Build CMS SignedData (cert + chain + signedAttrs + signature) → DER bytes que van en /Contents
    return Buffer.from(buildSignedDataDer({ signerCert: this.cert, chain: this.chain, signedAttrsDer, signature, sigAlg: this.sigAlg }));
  }
}
```

**Por qué Signer custom y no el RSA built-in de @signpdf**: `@signpdf/signer-p12` espera la llave RSA en `node-forge` privKey object. Eso (a) requiere la llave en plaintext en JS-land, **violando** `extractable:false`; (b) limita a RSA. Nuestro Signer pasa por `crypto.subtle.sign` con `CryptoKey` opaca → cumple modelo de amenazas (§5).

### 4.4 Multi-firma incremental (`packages/signer/src/incremental.ts`)

```ts
import { findSignature } from '@firma-ec/verifier';

/**
 * Detecta firmas previas y prepara el PDF para incremental update.
 * - Si N=0: usa pdf-lib normal con placeholder + ByteRange completo.
 * - Si N≥1: NO modifica los bytes anteriores; añade nuevo /Sig + nuevo Annot + nuevo xref incremental
 *   tras el %%EOF anterior. La nueva firma cubre TODOS los bytes hasta su /Contents (incluye
 *   las firmas anteriores como contenido inmutable).
 */
export async function prepareForSign(pdfBytes: Uint8Array): Promise<{
  hasPrevious: boolean;
  previousCount: number;
  pdfDoc: PDFDocument;        // pdf-lib doc cargado (o cargado con updateMetadata=false para preservar bytes)
}> {
  const sig = await findSignature(pdfBytes);
  const hasPrevious = sig !== null;
  const pdfDoc = await PDFDocument.load(pdfBytes, {
    updateMetadata: false,    // CRÍTICO: no mutar bytes existentes
    ignoreEncryption: false,
  });
  return { hasPrevious, previousCount: hasPrevious ? 1 : 0, pdfDoc };
}
```

**Invariante**: tras `signPdf(...)` sobre un PDF con N firmas, `verifyPdf(...)` debe retornar `valid` (o `warning` por OCSP) para **cada una** de las N+1 firmas. Hay que reportar todas en el resultado del verificador. (Nota: F2 solo reporta la última firma encontrada — esto es un follow-up natural de F3 / F4.)

### 4.5 Visible signature (`packages/signer/src/visible-sig.ts`)

```ts
/**
 * Plantilla única, minimalista:
 *   Firmado por: <CN>
 *
 * Sin border, sin fecha, sin logo, sin razón/lugar, sin QR (eso es F8+).
 * Fuente: Helvetica (built-in PDF) para garantizar render universal sin embed.
 * Tamaño: compact (12pt), standard (14pt), large (18pt).
 * Coords: usuario elige page (1..N) y (x, y, w, h) en puntos PDF (1pt = 1/72 pulgada).
 *
 * Render via pdf-lib drawText sobre AcroForm /Sig appearance stream (/AP /N).
 */
export function drawVisibleSig(pdfDoc: PDFDocument, spec: VisibleSigSpec, cn: string): void {
  const page = pdfDoc.getPage(spec.pageIndex);
  const font = pdfDoc.embedStandardFont(StandardFonts.Helvetica);
  const fontSize = SIZE_MAP[spec.size];           // 12 / 14 / 18
  const text = `Firmado por: ${cn}`;
  page.drawText(text, {
    x: spec.x,
    y: spec.y,
    size: fontSize,
    font,
    color: rgb(0, 0, 0),
    maxWidth: spec.w,
  });
  // Sin border (decision #3).
  // El AcroForm /Sig field con appearance stream lo añade @signpdf/placeholder-pdf-lib.
}
```

**Decisión abierta**: ¿incluir un outline ligero (1pt gris claro) alrededor del texto?
- Pro: ayuda al ojo del verificador humano a ver "aquí hay una firma".
- Contra: rompe minimalismo declarado en decisión #3.
- **Resolución**: NO en MVP. Si F4 hardening / UI Pro Max critique pide outline, se añade entonces (toggle opcional).

---

## 5. Worker isolation strategy

### 5.1 Contrato (postMessage discriminated union)

Calcado del patrón F2 (`apps/pwa/src/lib/workers/bus.ts`), pero para firma:

```ts
// sign.worker.ts → main thread
export type SignWorkerResponse =
  | { kind: 'progress'; stage: 'parse_pfx' | 'import_key' | 'load_pdf' | 'build_cms' | 'sign' | 'assemble_pades' | 'incremental' }
  | { kind: 'result'; signedPdf: Uint8Array }    // transferable
  | { kind: 'error'; code: SignErrorCode; message: string };

// main thread → sign.worker.ts
export type SignWorkerRequest = {
  kind: 'sign';
  pdf: ArrayBuffer;            // transferable
  p12: ArrayBuffer;            // transferable
  pin: string;                 // string (no es transferable; nos resignamos al copy, pero se zero-out tras parse)
  visibleSig: VisibleSigSpec;
  signedAttrs: { reason?: string; location?: string; signingTime: number /* epoch ms */ };
};
```

### 5.2 Lifecycle

```
main: const worker = new Worker(new URL('./sign.worker.ts', import.meta.url), { type: 'module' });
main: worker.postMessage(req, [req.pdf, req.p12]);
worker: ...trabajo...
worker: postMessage({ kind: 'result', signedPdf }, [signedPdf.buffer]);
main: receives result;
main: worker.terminate();   ← UNCONDITIONAL en finally; el worker NO se reusa.
```

`runSign(...)` (en `sign.bus.ts`) es Promise-wrapped, con timeout 30 s, listener único, `terminate()` en `success | error | timeout | abort`.

### 5.3 Por qué single-shot terminate-after-use

- **Sin caché de sesión** (decisión #1): cada firma es un proceso aislado. Aunque un atacante exfiltrara el handle de `CryptoKey`, al terminar el worker el GC del navegador reclama el contexto del worker, incluyendo el slot de claves del Web Crypto subsystem asociado.
- **Side-channels Spectre-class**: se mitigan por (a) cross-origin isolation (COOP/COEP/CORP, ya activos en `app.firmar.ec`), (b) Worker dedicated context, (c) terminate elimina el thread.
- **Continuidad mental**: F2 verifier ya entrenó al usuario y al equipo en este patrón. Mismo modelo.

---

## 6. Security & threat model (delta sobre §4 del spec general)

| # | Amenaza específica de F3 | Vector | Control | Norma |
|---|---|---|---|---|
| F3-1 | `.p12` exfiltrado vía XSS antes de entrar al worker | Inyección de script en main thread + intercepción del File API | Trusted Types ON, CSP estricto, transfer ArrayBuffer (Transferable) → main thread pierde el handle, fast-path zero-out tras transfer | OWASP ASVS 7,14 |
| F3-2 | PIN keyloggeado en el `<input>` | Extensión del navegador maliciosa | `autocomplete="off"`, `inputmode=text`, advertencia visible. **No es totalmente mitigable** sin password manager — documentado en `/seguridad`. | OWASP ASVS 8 |
| F3-3 | PIN persistido en autocomplete del browser | Browser store | `autocomplete="off"` + `autocapitalize="off"` + form sin `name=` en field + clear value tras submit | OWASP ASVS 8 |
| F3-4 | CryptoKey re-exportado por bug de pkijs | Vulnerabilidad supply-chain | `extractable: false` hace `exportKey` rejecten en el subsystem nativo, no en JS-land. Renovate + audit en CI. Worker terminate. | NIST SP 800-57 |
| F3-5 | Side-channel timing en `crypto.subtle.sign` | Análisis temporal | Web Crypto subsystem usa constant-time impl en WebKit/Blink/Gecko. Worker dedicated reduce contention. Documentado en /paranoia. | OWASP ASVS 7 |
| F3-6 | PDF malicioso explota pdfjs / pdf-lib | Parsing bug | pdfjs-dist v4 (ESM, sandboxed por default), `disableFontFace`, `disableCreateObjectURL`; pdf-lib bounded en worker (no DOM access). Renovate + osv-scanner. | OWASP ASVS 5 |
| F3-7 | Bytes residuales del .p12 en heap del worker | GC delay | Zero-out explícito (`new Uint8Array(buf).fill(0)`) sobre cada referencia conocida + `worker.terminate()` (libera el contexto entero). | OWASP ASVS 8.2 |
| F3-8 | Cert revocado al momento de firmar | OCSP no consultado en MVP (B-B) | Aceptado como riesgo del nivel B-B. Se documenta en `/seguridad` y en el resumen del paso 6. F6 (B-T+) y F7 (LTV) lo resuelven. | LCE art. 14, ETSI 319 102-1 |
| F3-9 | Algoritmos débiles (SHA-1, RSA<2048) | Cert antiguo | `assertStrongAlg(cert)` rechaza en parsePfx. Lista blanca explícita: SHA-256/384/512, RSA≥2048, ECDSA P-256/P-384. | NIST SP 800-131A r2 |
| F3-10 | Worker reutilizado leak entre firmas distintas | Implementación errónea | `terminate-after-use` enforced por test. **No** se cachea Worker. | OWASP ASVS 8 |

### 6.1 Datos sensibles — política de manejo

| Dato | Vida | Storage | Cleanup |
|---|---|---|---|
| `.p12` ArrayBuffer | Solo durante step 4-6 worker exec | Heap del worker | Zero-out tras `parsePfx` resolver; `worker.terminate()` lo aniquila |
| PIN string | Solo step 4-5 worker exec | Heap del worker (string immutable JS — pero al terminate se libera) | Reasignar variable a `''` tras `parsePfx`; worker terminate |
| `CryptoKey` | Solo step 5-6 worker exec | Subsystem cripto del navegador (no en JS heap) | `extractable:false` impide leak; worker terminate suelta el handle |
| PDF original bytes | Step 1-6 (workers + main) | Heap | Liberados por GC al cerrar pestaña / firmar otro |
| PDF firmado bytes | Hasta que el usuario navegue fuera o cierre | Blob URL local | `URL.revokeObjectURL` en `onbeforeunload` y al "Firmar otro" |
| Razón / Lugar | Step 5-6 | Heap | Liberados al firmar otro |

---

## 7. Test strategy

### 7.1 Unit tests (Vitest + fast-check)

| Suite | Cobertura objetivo |
|---|---|
| `pkcs12.test.ts` | parse OK con PIN correcto; `bad_pin` con PIN incorrecto; `bad_p12` con bytes random; PIN UTF-8 vs latin-1; safeBags fuera de orden; cert sin keyUsage = `no_signing_cert`; SHA-1 cert = `weak_alg`. **fast-check**: PIN aleatorio (incluye unicode, emojis, vacío) → siempre `bad_pin` o `bad_p12`, jamás throw no-tipado |
| `cms-build.test.ts` | DER round-trip: build → parse con verifier F2 → fields equivalentes; signedAttrs ordenados (DER SET OF rules); messageDigest consistente con SHA del input |
| `pades.test.ts` | ByteRange cubre todo excepto /Contents; /Contents hex-encoded; SubFilter `adbe.pkcs7.detached`; firma re-validada por verifier F2 retorna `status: 'valid' \| 'warning'` |
| `incremental.test.ts` | PDF con 1 firma previa + signPdf → 2 firmas detectables; primera firma sigue válida (ByteRange original intacto); pdf bytes anteriores byte-a-byte iguales |
| `visible-sig.test.ts` | drawText emite operadores correctos en /AP stream; CN truncado a maxWidth sin overflow; tamaños compact/standard/large producen heights esperados |
| `webcrypto.test.ts` | importKey con `extractable:false`; intentar `exportKey` rechaza; sign sobre data trivial round-trip via verify con cert |

### 7.2 Property-based (fast-check)

- **PIN aleatorio**: unicode, emojis, vacío, 1KB → `bad_pin` o `bad_p12`, jamás unhandled throw.
- **PDF bytes aleatorios**: pdf-lib lanza error parseable; signer falla con `bad_pdf` no con generic Error.
- **Coords visible-sig fuera de página**: clamp o error `out_of_bounds`, nunca produce PDF con anotación rota.

### 7.3 Mutation testing (StrykerJS)

Aplicar a `packages/signer/src/{pkcs12,cms-build,pades,incremental}.ts`. Threshold: ≥80% mutation score (continuidad con F2). Excluir `visible-sig` y `webcrypto` (lógica trivial / no apta para mutation real).

### 7.4 E2E Playwright (`apps/pwa/tests-e2e/sign.spec.ts`)

```ts
test('Firma .p12 sintético + verificación cross-F2', async ({ page }) => {
  // 1. Generar .p12 sintético con node-forge (tools/gen-test-p12.ts) → fixture `__fixtures__/test.p12`
  await page.goto('/firmar');
  await page.locator('[data-testid="drop-pdf"]').setInputFiles('__fixtures__/sample.pdf');
  await page.locator('[data-testid="next"]').click();

  // Posicionar cuadro
  await page.locator('[data-testid="box-placer"]').click({ position: { x: 400, y: 600 } });
  await page.locator('[data-testid="next"]').click();

  // .p12 + PIN
  await page.locator('[data-testid="drop-p12"]').setInputFiles('__fixtures__/test.p12');
  await page.locator('[data-testid="pin"]').fill('test1234');
  await page.locator('[data-testid="next"]').click();

  // Skip optional attrs
  await page.locator('[data-testid="skip"]').click();

  // Firmar
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-testid="sign"]').click();
  await page.locator('[data-testid="download"]').click();
  const download = await downloadPromise;
  const signedBytes = await download.body();

  // Cross-check: drop el resultado en /verificar del MISMO PWA
  await page.goto('/verificar');
  // ...drop signedBytes...
  await expect(page.locator('[data-testid="verdict"]')).toHaveText(/Válida|Advertencia/);
  await expect(page.locator('[data-testid="signer-cn"]')).toHaveText('TEST USER');
});

test('Multi-firma: PDF con firma previa + segunda firma → verifier ve 2 firmas válidas', async ({ page }) => {
  // ...usar el output de la prueba anterior como input...
});

test('PIN incorrecto → vuelve al paso 4 con error inline + field limpio', async ({ page }) => { /* ... */ });
test('Cert con SHA-1 → bloquea con weak_alg', async ({ page }) => { /* ... */ });
```

Mobile profiles: iPhone 13 + Pixel 5 (throttling 4G), repetir golden path.

### 7.5 Cross-validation manual (pre-tag v0.3.0-rc1)

- Firmar PDF con `.p12` real del usuario (BCE o Security Data) → abrir resultado en **Adobe Acrobat Reader** y **FirmaEC desktop** — ambos deben reconocer la firma.
- Firmar PDF previamente firmado con FirmaEC desktop → verificar que las dos firmas coexisten en Acrobat.
- Verificar cross-check con Minka / FirmaEC desktop validator.

---

## 8. Out of scope (F3 explícitamente NO incluye)

- **TSA (Time-Stamping Authority) / PAdES B-T**: F6.
- **OCSP-embebido / PAdES B-LT (LTV)**: F7.
- **Multi-firma paralela** (mismo ByteRange firmado por varios firmantes simultáneos — esquema cooperativo PAdES extendido): no en roadmap actual.
- **Plantillas custom** del cuadro visible (logo, foto, QR, fecha visible, multi-línea con razón): F8+.
- **WebUSB / PKCS#11 / token físico**: descartado (decisión #1).
- **Persistencia de sesión, account-based, recordar último PDF**: viola decisión #6.
- **Firma masiva** (1 PIN → N PDFs): F8+ (requiere repensar #1 con caché temporal + UX consent).
- **Sello con QR** (mencionado en spec general §7.2): se posterga a F8 — no es bloqueante para validez legal y añade superficie (CodeQR libs, render).
- **Razón/Lugar visibles en el cuadro**: explícitamente excluido (decisión #3, #7).
- **API JS embebible** para firmar desde sitios terceros: requiere análisis de seguridad propio, F8+.
- **F3.5 — WhatsApp inbox/outbox**: recepción de PDFs vía Evolution API webhook → cola por usuario → notificación PWA → usuario firma local → outbox vía Evolution API. Implica auth (link mágico WA/OTP), backend con storage temporal, breaking del 100% stateless. Spec separado en F3.5 cuando F3 esté estable.

---

## 9. Acceptance criteria — v0.3.0-rc1

Para declarar F3 cerrado y tagear `v0.3.0-rc1`:

- [ ] `pnpm test` verde en `packages/signer` (unit + fast-check).
- [ ] `pnpm test:mutation` ≥80% mutation score en signer.
- [ ] Playwright E2E: golden path + multi-firma + bad-pin + weak-alg pasan en chromium-desktop, iPhone 13, Pixel 5.
- [ ] Lighthouse ≥95 en `/firmar` (acepta degradación documentada por bundle cripto en `/seguridad`).
- [ ] Mozilla Observatory A+ sostenido en `app.firmar.ec`.
- [ ] axe-core 0 violations en `/firmar` (todos los pasos del wizard).
- [ ] CSP / Trusted Types siguen sin warnings en consola del navegador con flujo de firma completo.
- [ ] Cross-validation manual: PDF firmado por la PWA es aceptado por **Adobe Reader** y **FirmaEC desktop** (con `.p12` real del usuario).
- [ ] Multi-firma: PDF firmado por FirmaEC desktop + segunda firma por la PWA → ambas válidas en Adobe Reader.
- [ ] CSP / headers no introducen regresiones (Mozilla Observatory + securityheaders.com siguen A+).
- [ ] `docs/transparency-report.md` actualizado con sección "F3 firma — modelo de amenazas y mitigaciones".
- [ ] Tag `v0.3.0-rc1` firmado con Cosign + SLSA L3 provenance + SBOM CycloneDX.
- [ ] Memoria F3 closure registrada en `~/.claude/.../memory/`.

---

## 10. Self-review (obligatorio post-write)

- **Placeholder scan**: 0 TBD / TODO / FIXME en este documento. ✅
- **Internal consistency**: decisiones 1-10 en §1 están reflejadas en arquitectura §2, UX §3, cripto §4, threats §6 y out-of-scope §8. ✅
- **Scope check**: foco en **firma** PAdES B-B, sin TSA, sin OCSP, sin LTV, sin persistencia, sin tokens hardware. Verificación se reusa pero no se modifica (salvo export de `findSignature` que ya existe). ✅
- **Ambiguity check**: única decisión abierta es "¿outline en cuadro visible?" — **resuelta a NO** en §4.5. Resto sin ambigüedad.
- **Norma alignment**: ETSI EN 319 142-1 (PAdES B-B), RFC 5652 (CMS), RFC 7292 (PKCS#12), NIST SP 800-131A (suites cripto), OWASP ASVS 7/8/14, MASVS-CRYPTO. ✅
- **LOPDP-native**: stateless puro (decisión #6), zero retention, sin third-party requests durante firma, datos sensibles con cleanup explícito (§6.1). ✅

---

**Fin del spec F3 — listo para `writing-plans`.**

---

## Apéndice: Adendum UI Pro Max (Sprint B, 2026-05-09)

Ver `docs/ui-pro-max-f3-design-adendum-2026-05-09.md` para design tokens consolidados, wireframes ASCII (7 mobile + 7 desktop), copy ES/EN bloqueado (~210 strings), micro-interactions con timings exactos, mini-specs de los 4 componentes complejos (PdfPreview, BoxPlacer, PinInput, DownloadResult), 10 componentes nuevos identificados y critique completo (38 findings P0/P1/P2).

**Decisions del adendum que son obligatorias al implementar Sprint C** (no sugerencias):

- **Mobile-first dominante**: cada step se diseña para 390×844 PRIMERO; desktop sólo agrega split-pane en step 2 y ajustes de layout — no cambia la máquina de estados.
- **Stepper progress**: dots ●─●─○─○─○─○─○ en desktop; **barra lineal + texto "Paso N de 7"** en mobile (7 dots no caben con padding).
- **PIN — banner amarillo ANTES de tipear** (no después), CTA dice **"Verificar contraseña"** (no "Continuar"); inputs con `data-1p-ignore` + `data-lpignore="true"` + `name=""`; cleanup explícito `inputEl.value=''; pin=''` al transitar back-out.
- **BoxPlacer MVP**: tap-to-place + drag-to-move + corner-handle resize. **Sin pinch-resize** en mobile (rompía pinch-zoom del PdfPreview). Preview usa **Helvetica** (no Geist) para WYSIWYG con el PDF firmado.
- **`color-scheme: light` forzado** en wrapper PdfPreview — el PDF nunca se oscurece con dark theme. Cero emojis en UI strings (reemplazar 🔐 🔑 ✍ por iconos lucide).
- **Worker timeout dinámico**: `15000 + (pdfBytes.length / 1024)` ms, cap 60s. **Affects Task 14.**
- **navigator.share feature-detect**: si no aplica, el botón **se oculta** (no greyed-out — Emil-tier).
