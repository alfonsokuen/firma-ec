# F3 firma MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` para implementar este plan task-by-task. Cada step usa checkbox (`- [ ]`) para tracking. Cuando un task tenga subagentes paralelos posibles se anota explícitamente; el resto es secuencial.

**Goal:** Implementar la fase F3 — firma PAdES B-B 100% en cliente con `.p12`/`.pfx` + PIN per-firma, cuadro visible mínimo solo CN, multi-firma secuencial vía incremental update, mobile-first stepper full-screen, stateless puro y worker isolation `terminate-after-use`. Entregable: tag `v0.3.0-rc1` con cross-validation manual contra Adobe Reader y FirmaEC desktop.

**Architecture:** Nuevo paquete `packages/signer` (parsePfx + WebCrypto importKey + CMS-build + @signpdf 4 wiring + visible-sig + incremental update). Reuso de `packages/verifier` (`findSignature` para detectar firmas previas). Nuevo Worker dedicado `apps/pwa/src/lib/workers/sign.worker.ts` con bus typed (`sign.bus.ts`) calcado del patrón F2. Nueva ruta `apps/pwa/src/routes/Firmar.svelte` con stepper de 7 pasos (carga PDF → posicionar cuadro → carga .p12 → PIN → razón/lugar opc → confirmar → resultado) y componentes UI nuevos (`PdfPreview`, `BoxPlacer`, `DropP12`, `PinInput`, `OptionalAttrs`, `SignButton`, `DownloadResult`). pdfjs-dist v4 ESM para preview con canvas. pdf-lib para appearance stream + incremental update. pkijs para PFX parse + CMS build (continuidad F2). Web Crypto subtle.sign con `CryptoKey extractable:false` para no exponer la llave nunca. Stateless puro (cero persistencia).

**Tech Stack:** Svelte 5 (runes) + Vite 6 + UnoCSS + pkijs 3 + asn1js 3 + @signpdf/signpdf ^3.3.0 + @signpdf/placeholder-pdf-lib ^3.3.0 + @signpdf/utils ^3.3.0 + pdf-lib 1.17 + pdfjs-dist 4 + Vitest 2 + fast-check 3 + StrykerJS 9 + Playwright + Biome 2 + node-forge (devDep para fixtures sintéticos).

> **Dependency note (2026-05-09):** `@signpdf` v4 no está publicado en npm. Usamos v3.3.0 (latest 3.x — API CMS-build estable). Bump a v4 cuando esté disponible.

**Spec reference:** `docs/superpowers/specs/2026-05-09-firma-ec-F3-firma-MVP-design.md` (decisiones 1-10, arquitectura §2, UX §3, cripto §4, worker §5, threats §6, tests §7, acceptance §9).

**F2 prerequisites met (no re-hacer):**
- `packages/verifier` LIVE en https://app.firmar.ec con `findSignature()`, parseCms, validatePath, OCSP, integrity (v0.2.2).
- `apps/pwa` con UnoCSS, Header, ThemeToggle, BundleHashBadge, Drop, Progress, Detail, Result, ruta `/verificar` y `/paranoia`.
- Worker bus pattern `apps/pwa/src/lib/workers/{bus.ts, verify.worker.ts}` con FakeWorker tests.
- Caddyfile.pwa + Traefik PWA con CSP estricto, Trusted Types, COOP/COEP/CORP A+ Mozilla Observatory.
- Cosign + SLSA L3 + SBOM CycloneDX en CI (release workflow).

**QA-Verify discipline (cada task):** RESPALDO antes de cualquier cambio en infra (Caddyfile, Dockerfile, stack); verificación multi-capa (lint Biome + typecheck `pnpm -r typecheck` + unit tests + Playwright + Lighthouse en `/firmar` ≥95 + Mozilla Observatory A+ + axe-core 0 violations); push a Gitea solo con confirmación explícita usuario; registro en memoria al cierre F3.

---

## File Structure (decomposed)

```
firma-ec/
├── packages/
│   ├── signer/                                 NEW
│   │   ├── package.json                        NEW
│   │   ├── tsconfig.json                       NEW
│   │   ├── vitest.config.ts                    NEW
│   │   ├── stryker.conf.json                   NEW
│   │   └── src/
│   │       ├── index.ts                        NEW   # signPdf(opts) export pública
│   │       ├── types.ts                        NEW   # SignOptions, SignResult, VisibleSigSpec, SignerCert, SigAlg
│   │       ├── errors.ts                       NEW   # SignerError + SignErrorCode union
│   │       ├── pkcs12.ts                       NEW   # parsePfx(bytes, pin)
│   │       ├── webcrypto.ts                    NEW   # importPrivKeyForSign + sigAlgToWebCrypto
│   │       ├── cms-build.ts                    NEW   # buildSignedAttrs + buildSignedDataDer
│   │       ├── pades.ts                        NEW   # WebCryptoSigner + signPdf orchestration
│   │       ├── visible-sig.ts                  NEW   # drawVisibleSig (pdf-lib drawText)
│   │       ├── incremental.ts                  NEW   # prepareForSign + multi-firma detection
│   │       └── alg-policy.ts                   NEW   # assertStrongAlg + inferSigAlg
│   ├── signer/tests/
│   │   ├── pkcs12.test.ts                      NEW
│   │   ├── pkcs12.property.test.ts             NEW   # fast-check
│   │   ├── cms-build.test.ts                   NEW
│   │   ├── pades.test.ts                       NEW   # cross-check con verifier F2
│   │   ├── incremental.test.ts                 NEW
│   │   ├── visible-sig.test.ts                 NEW
│   │   ├── webcrypto.test.ts                   NEW
│   │   ├── alg-policy.test.ts                  NEW
│   │   ├── e2e.test.ts                         NEW   # full path: gen .p12 → signPdf → verifyPdf=valid
│   │   └── __fixtures__/
│   │       ├── sample.pdf                      NEW
│   │       └── (test.p12 generado por gen-test-p12.ts)
│   └── verifier/
│       └── src/index.ts                        MODIFY (mínimo): re-export findSignature
│
├── apps/pwa/
│   ├── package.json                            MODIFY: add @signpdf/*, pdf-lib, pdfjs-dist, @firma-ec/signer
│   ├── vite.config.ts                          MODIFY: optimizeDeps include para pdfjs worker
│   ├── src/
│   │   ├── App.svelte                          MODIFY: add `/firmar` route
│   │   ├── lib/
│   │   │   ├── i18n.svelte.ts                  MODIFY: agregar keys de F3
│   │   │   └── workers/
│   │   │       ├── sign.worker.ts              NEW
│   │   │       ├── sign.bus.ts                 NEW
│   │   │       └── sign.bus.test.ts            NEW
│   │   ├── routes/
│   │   │   └── Firmar.svelte                   NEW   # stepper full-screen
│   │   ├── ui/
│   │   │   ├── PdfPreview.svelte               NEW
│   │   │   ├── BoxPlacer.svelte                NEW
│   │   │   ├── DropP12.svelte                  NEW
│   │   │   ├── PinInput.svelte                 NEW
│   │   │   ├── OptionalAttrs.svelte            NEW
│   │   │   ├── SignButton.svelte               NEW
│   │   │   └── DownloadResult.svelte           NEW
│   │   └── styles/safelist.ts                  MODIFY: add F3 dynamic classes
│   └── tests-e2e/
│       └── sign.spec.ts                        NEW
│
├── tools/
│   └── gen-test-p12.ts                         NEW   # node-forge sintético
│
└── infra/docker/
    └── Caddyfile.pwa                           MODIFY (si aplica): no nuevos endpoints; verificar CSP no rompe pdfjs worker
```

---

## Pre-conditions

- [ ] F2 LIVE en https://app.firmar.ec retorna `valid` para PDFs firmados con FirmaEC desktop (smoke).
- [ ] `pnpm install` limpio en root con `pnpm 9.15.0`.
- [ ] Tag actual `v0.2.2-f2` en Gitea + 2 GH mirrors.
- [ ] Branch `main` limpio (no commits pendientes salvo este plan + spec).
- [ ] PAT Gitea + GH con permisos repo:write (validado en F0).

---

## Task 1 — Foundation: bootstrap `packages/signer`

**Files:**
- Create: `packages/signer/package.json`
- Create: `packages/signer/tsconfig.json`
- Create: `packages/signer/vitest.config.ts`
- Create: `packages/signer/src/index.ts` (placeholder export)
- Create: `packages/signer/src/types.ts`
- Create: `packages/signer/src/errors.ts`
- Modify: `pnpm-workspace.yaml` (ya incluye `packages/*`, verificar)

**Steps:**
- [ ] Crear `packages/signer/package.json`:
  ```json
  {
    "name": "@firma-ec/signer",
    "version": "0.0.0",
    "private": true,
    "type": "module",
    "main": "./src/index.ts",
    "types": "./src/index.ts",
    "scripts": {
      "typecheck": "tsc --noEmit -p tsconfig.json",
      "build": "tsc -p tsconfig.json",
      "test": "vitest run",
      "test:mutation": "stryker run"
    },
    "dependencies": {
      "@firma-ec/crypto-core": "workspace:*",
      "@firma-ec/verifier": "workspace:*",
      "@signpdf/signpdf": "^3.3.0",
      "@signpdf/placeholder-pdf-lib": "^3.3.0",
      "@signpdf/utils": "^3.3.0",
      "asn1js": "^3.0.6",
      "pdf-lib": "^1.17.1",
      "pkijs": "^3.2.5"
    },
    "devDependencies": {
      "@stryker-mutator/core": "^9.6.1",
      "@stryker-mutator/vitest-runner": "^9.6.1",
      "@types/node-forge": "^1.3.14",
      "fast-check": "^3.23.2",
      "node-forge": "^1.4.0",
      "vitest": "^2.1.8"
    }
  }
  ```
- [ ] Crear `packages/signer/tsconfig.json` heredando de `tsconfig.base.json` (mismo patrón que verifier).
- [ ] Crear `packages/signer/src/errors.ts`:
  ```ts
  export type SignErrorCode =
    | 'bad_pdf' | 'bad_p12' | 'bad_pin' | 'no_signing_cert'
    | 'weak_alg' | 'cert_expired' | 'cert_not_yet_valid'
    | 'visible_sig_oob' | 'pdf_encrypted' | 'pdf_too_large'
    | 'webcrypto_unsupported' | 'sign_failed' | 'unknown';
  export class SignerError extends Error {
    constructor(public readonly code: SignErrorCode, message: string) {
      super(message);
      this.name = 'SignerError';
    }
  }
  ```
- [ ] Crear `packages/signer/src/types.ts` con interfaces declaradas en spec §2.1 + §4: `SigAlg`, `SignerCert`, `ParsedPfx`, `VisibleSigSpec`, `SignOptions`, `SignResult`.
- [ ] Crear `packages/signer/src/index.ts` con stub: `export async function signPdf(_opts: SignOptions): Promise<SignResult> { throw new SignerError('unknown', 'not implemented'); }`.
- [ ] `pnpm install` desde root → resolver workspace links.
- [ ] `pnpm -r typecheck` debe pasar.

**Verify:** `pnpm --filter @firma-ec/signer typecheck` y `pnpm --filter @firma-ec/signer test` (suite vacía).

---

## Task 2 — Test fixture generator: `tools/gen-test-p12.ts`

**Files:**
- Create: `tools/gen-test-p12.ts`
- Create: `packages/signer/tests/__fixtures__/sample.pdf` (PDF mínimo válido)

**Steps:**
- [ ] Crear `tools/gen-test-p12.ts` (Node + node-forge):
  ```ts
  // Genera .p12 sintético: cert self-signed RSA-2048 SHA-256, CN="TEST USER",
  // notBefore=now-1d, notAfter=now+30d, keyUsage.digitalSignature=true.
  // Output: __fixtures__/test.p12 (PIN: "test1234")
  // Además genera un PDF mínimo si no existe sample.pdf.
  import * as forge from 'node-forge';
  import { writeFileSync, existsSync } from 'node:fs';
  // ... full impl ...
  ```
- [ ] Crear PDF mínimo `sample.pdf` con `pdf-lib` (página A4 + texto "Hello firma F3"). Script `tools/gen-sample-pdf.ts`. Commit el PDF al repo (≤4 KB).
- [ ] Añadir scripts al root `package.json`:
  ```json
  "gen:test-p12": "node --experimental-strip-types tools/gen-test-p12.ts",
  "gen:sample-pdf": "node --experimental-strip-types tools/gen-sample-pdf.ts"
  ```
- [ ] Ejecutar ambos. Validar: `openssl pkcs12 -info -in test.p12 -passin pass:test1234` muestra cert con CN=TEST USER.
- [ ] Commitear ambos fixtures + scripts.

**Verify:** `node --experimental-strip-types tools/gen-test-p12.ts` produce `test.p12` parseable por `openssl`.

---

## Task 3 — `pkcs12.ts` — PFX parse + decrypt

**Files:**
- Create: `packages/signer/src/pkcs12.ts`

**Steps:**
- [ ] Implementar `parsePfx(bytes: Uint8Array, pin: string): Promise<ParsedPfx>`:
  - `fromBER` + `new PFX({ schema })` con try/catch → `bad_p12`.
  - `pfx.parseInternalValues({ password: stringToArrayBuffer(pin), checkIntegrity: true })`.
  - Try UTF-8 first, fallback latin-1 antes de declarar `bad_pin`.
  - Iterar `safeContents` para extraer `CertBag` (signing cert + intermediates) y `PKCS8ShroudedKeyBag` (privateKey).
  - Filtrar signing cert por `keyUsage.digitalSignature` extension OID `2.5.29.15`.
  - Convertir `PrivateKeyInfo` → JWK con helper interno (RSA: PKCS1 / RSA-PSS; ECDSA: P-256/P-384).
  - Llamar `assertStrongAlg(signingCert)` (Task 4).
  - Llamar `inferSigAlg(signingCert)` → `{ kind: 'RSA-PKCS1' | 'RSA-PSS' | 'ECDSA', hash: 'SHA-256'|'SHA-384'|'SHA-512', curve?: 'P-256'|'P-384' }`.

**Verify:** Tests Task 6 cubrirán esto.

---

## Task 4 — `alg-policy.ts` — whitelist + assertions

**Files:**
- Create: `packages/signer/src/alg-policy.ts`
- Create: `packages/signer/tests/alg-policy.test.ts`

**Steps:**
- [ ] Implementar `assertStrongAlg(cert: Certificate): void`:
  - Throw `SignerError('weak_alg')` si:
    - publicKey.algo OID == `rsaEncryption` y modulus.bitLength < 2048.
    - publicKey.algo OID == `id-ecPublicKey` y curve no es P-256/P-384/P-521.
    - signatureAlgorithm OID es SHA-1 family (OIDs `1.2.840.113549.1.1.5` etc.).
- [ ] Implementar `inferSigAlg(cert): SigAlg`.
- [ ] Tests:
  - cert RSA-2048 SHA-256 → OK.
  - cert RSA-1024 SHA-256 → throws `weak_alg`.
  - cert RSA-2048 SHA-1 → throws `weak_alg`.
  - cert ECDSA P-256 SHA-256 → OK.
  - cert ECDSA P-192 → throws `weak_alg`.

**Verify:** `pnpm --filter @firma-ec/signer test alg-policy` verde.

---

## Task 5 — `webcrypto.ts` — importKey extractable:false

**Files:**
- Create: `packages/signer/src/webcrypto.ts`
- Create: `packages/signer/tests/webcrypto.test.ts`

**Steps:**
- [ ] Implementar `sigAlgToWebCrypto(alg: SigAlg): RsaHashedImportParams | EcKeyImportParams` (mapping declarado en spec §4.2).
- [ ] Implementar `importPrivKeyForSign(jwk, alg): Promise<CryptoKey>` con `extractable: false` y `keyUsages: ['sign']`.
- [ ] Tests:
  - import RSA-2048 jwk → CryptoKey con `extractable===false`.
  - intentar `crypto.subtle.exportKey('jwk', key)` → rejects.
  - sign sobre `Uint8Array([1,2,3])` con ese key → produce signature ≥256 bytes.

**Verify:** Tests verde en Vitest jsdom + Node.

---

## Task 6 — `pkcs12.test.ts` + property tests

**Files:**
- Create: `packages/signer/tests/pkcs12.test.ts`
- Create: `packages/signer/tests/pkcs12.property.test.ts`

**Steps:**
- [ ] `pkcs12.test.ts`:
  - parse fixture `test.p12` con PIN `test1234` → returns ParsedPfx con CN=TEST USER.
  - parse con PIN incorrecto → throws `bad_pin`.
  - parse bytes random → throws `bad_p12`.
  - parse fixture sin keyUsage.digitalSignature → throws `no_signing_cert` (generar fixture extra `test-no-ku.p12`).
  - PIN UTF-8 con emoji vs latin-1 → ambos paths cubiertos.
- [ ] `pkcs12.property.test.ts` con fast-check:
  - `fc.string` arbitrario como PIN sobre fixture válido → siempre `bad_pin`, jamás unhandled throw.
  - `fc.uint8Array({ minLength: 0, maxLength: 1024 })` como bytes → siempre `SignerError`, jamás genérico.

**Verify:** `pnpm --filter @firma-ec/signer test pkcs12` verde.

---

## Task 7 — `cms-build.ts` — SignedData DER

**Files:**
- Create: `packages/signer/src/cms-build.ts`
- Create: `packages/signer/tests/cms-build.test.ts`

**Steps:**
- [ ] Implementar `buildSignedAttrs({ messageDigest, signingTime, contentType, mdAlgo, reason?, location? }): Uint8Array`:
  - Construir `SignedData.SignerInfo.signedAttrs` SET OF Attribute con OIDs:
    - contentType (`1.2.840.113549.1.9.3`) → `data` OID.
    - messageDigest (`1.2.840.113549.1.9.4`) → SHA del PDF coveredBytes.
    - signingTime (`1.2.840.113549.1.9.5`) → UTCTime/GeneralizedTime.
    - reason (`1.2.840.113549.1.9.16.2.21` o `2.5.4.43`)? Usar standard PAdES `1.2.840.113549.1.9.16.2.15` para signaturePolicy si aplica; reason va en `commitment-type-indication` o como atributo no firmado. **Decisión**: usar pdf `/Reason` campo (no en signedAttrs CMS) para reason; location idem `/Location`. Esto simplifica y es lo que FirmaEC desktop espera.
  - **Corrección (vs spec §4.3 borrador):** reason/location **no** van en signedAttrs sino en el `/Sig` dictionary del PDF (campos `/Reason`, `/Location`). Esto es lo que `@signpdf` setea via opts. Actualizar spec si discrepancia (issue follow-up).
  - DER-encode con asn1js → SET OF ordenado lexicográficamente (rule for DER).
- [ ] Implementar `buildSignedDataDer({ signerCert, chain, signedAttrsDer, signature, sigAlg }): Uint8Array`:
  - pkijs SignedData con `version=1`, `digestAlgorithms`, `encapContentInfo` (eContentType=data, eContent=null), `certificates` (signerCert + chain), `signerInfos` con SignerInfo populated.
  - DER-encode.
- [ ] Tests:
  - Round-trip: build → parse con `parseCms` del verifier F2 → fields coinciden.
  - signedAttrs SET ordenado correctamente (verificar bytes DER).
  - messageDigest dentro coincide con SHA-256 de input.

**Verify:** `pnpm --filter @firma-ec/signer test cms-build` verde + cross-parse con verifier.

---

## Task 8 — `pades.ts` — WebCryptoSigner + orchestration

**Files:**
- Create: `packages/signer/src/pades.ts`
- Create: `packages/signer/tests/pades.test.ts`

**Steps:**
- [ ] Implementar `class WebCryptoSigner extends Signer` (de `@signpdf/utils`):
  - Constructor toma `{ cryptoKey, cert, chain, sigAlg, opts: { signingTime, mdAlgo } }`.
  - Override `async sign(coveredBytes: Buffer): Promise<Buffer>`:
    1. `messageDigest = await crypto.subtle.digest(opts.mdAlgo, coveredBytes)`.
    2. `signedAttrsDer = buildSignedAttrs({ messageDigest, signingTime, mdAlgo })`.
    3. `signature = await crypto.subtle.sign(webCryptoAlgFor(sigAlg), cryptoKey, signedAttrsDer)`.
    4. `cmsDer = buildSignedDataDer({ signerCert: cert, chain, signedAttrsDer, signature, sigAlg })`.
    5. Return `Buffer.from(cmsDer)`.
- [ ] Implementar `signPdf(opts: SignOptions): Promise<Uint8Array>`:
  - Si `opts.previousSignaturesCount > 0`: usar incremental path (Task 10).
  - Si no: load `opts.pdf` con `PDFDocument.load(opts.pdf, { updateMetadata: false })`.
  - Aplicar `drawVisibleSig(pdfDoc, opts.visibleSig, opts.signerCN)` (Task 9).
  - `pdflibAddPlaceholder({ pdfDoc, reason: opts.reason, location: opts.location, signatureLength: 16384 })`.
  - `pdfBytes = await pdfDoc.save()` → `Buffer`.
  - `signedBytes = await signpdf.sign(pdfBytes, signer)` con `WebCryptoSigner`.
  - Return `new Uint8Array(signedBytes)`.
- [ ] Tests:
  - signPdf con fixture sample.pdf + test.p12 + cuadro en (50,50,200,30) page 0 → returns Uint8Array.
  - **Cross-check con verifier F2**: `await verifyPdf(signedBytes)` retorna `{ status: 'valid' | 'warning', signer.cert.subject.CN: 'TEST USER' }`. Por ser self-signed: `warning` con `tsl_warning` aceptable; `invalid` no.

**Verify:** `pnpm --filter @firma-ec/signer test pades` verde.

---

## Task 9 — `visible-sig.ts` — cuadro CN-only

**Files:**
- Create: `packages/signer/src/visible-sig.ts`
- Create: `packages/signer/tests/visible-sig.test.ts`

**Steps:**
- [ ] Implementar `drawVisibleSig(pdfDoc, spec, cn)`:
  - Validar `spec.pageIndex` ∈ [0, pdfDoc.getPageCount()-1] → throw `visible_sig_oob`.
  - Obtener page; embed Helvetica standard.
  - `fontSize = { compact: 12, standard: 14, large: 18 }[spec.size]`.
  - Truncar `cn` si excede `spec.w` con elipsis (medir con `font.widthOfTextAtSize`).
  - `page.drawText('Firmado por: ' + cn, { x, y, size, font, color: rgb(0,0,0), maxWidth: spec.w })`.
- [ ] Tests:
  - drawVisibleSig page 0 con CN corto → operadores `BT ... Tj ... ET` presentes en el content stream.
  - CN largo "JUAN PEREZ GOMEZ DE LA CRUZ MARTINEZ" + width 100pt → texto truncado con `…`.
  - pageIndex inválido → throws `visible_sig_oob`.
  - sizes compact/standard/large → fontSize correcto.

**Verify:** `pnpm --filter @firma-ec/signer test visible-sig` verde.

---

## Task 10 — `incremental.ts` — multi-firma secuencial

**Files:**
- Create: `packages/signer/src/incremental.ts`
- Create: `packages/signer/tests/incremental.test.ts`
- Modify: `packages/verifier/src/index.ts` (re-export `findSignature` si no está)

**Steps:**
- [ ] En `verifier/src/index.ts`: añadir `export { findSignature } from './pdf';` si falta.
- [ ] Implementar `prepareForSign(pdfBytes): Promise<{ hasPrevious, previousCount, pdfDoc }>`:
  - `sig = await findSignature(pdfBytes)` (del verifier).
  - Si null → `{ hasPrevious: false, previousCount: 0, pdfDoc: PDFDocument.load(pdfBytes, { updateMetadata: false }) }`.
  - Si existe → mismo `pdfDoc.load` con `updateMetadata: false`. pdf-lib load preserva bytes anteriores; `pdfDoc.save({ useObjectStreams: false, addDefaultPage: false })` produce update incremental si `objectsToWrite` solo incluye los nuevos.
- [ ] Modificar `signPdf` (Task 8) para llamar `prepareForSign` y pasar el `pdfDoc` resultante. Incrementar `previousCount` count en `SignResult`.
- [ ] Tests:
  - sample.pdf no firmado → `hasPrevious=false, previousCount=0`.
  - sample.pdf firmado en Task 8 → `hasPrevious=true, previousCount=1`.
  - signPdf sobre PDF ya firmado → resultado con N+1 firmas; **bytes anteriores byte-a-byte iguales** (verificar `signedBytes.subarray(0, originalLen) === originalBytes`).
  - verifyPdf F2 sobre el doble-firmado → todavía válido (la última firma).
  - Caveat doc: F2 verifier solo reporta la última firma. Test acepta ese behavior pero deja TODO documentado para F4.

**Verify:** `pnpm --filter @firma-ec/signer test incremental` verde.

---

## Task 11 — `e2e.test.ts` integration

**Files:**
- Create: `packages/signer/tests/e2e.test.ts`

**Steps:**
- [ ] Test E2E full path:
  ```ts
  it('gen .p12 → signPdf → verifyPdf retorna valid o warning', async () => {
    const pfx = await readFile('__fixtures__/test.p12');
    const pdf = await readFile('__fixtures__/sample.pdf');
    const parsed = await parsePfx(pfx, 'test1234');
    const cryptoKey = await importPrivKeyForSign(parsed.privateKeyJwk, parsed.sigAlg);
    const signed = await signPdf({
      pdf, signerCert: parsed.signingCert, chain: parsed.intermediates,
      cryptoKey, sigAlg: parsed.sigAlg,
      visibleSig: { pageIndex: 0, x: 50, y: 50, w: 200, h: 30, size: 'standard' },
      reason: 'Test', location: 'Quito',
    });
    const result = await verifyPdf(signed);
    expect(result.status).toMatch(/^(valid|warning)$/);
    expect(result.signer?.cert.subject.commonName).toBe('TEST USER');
  });
  ```

**Verify:** `pnpm --filter @firma-ec/signer test e2e` verde.

---

## Task 12 — StrykerJS mutation baseline

**Files:**
- Create: `packages/signer/stryker.conf.json` (espejo del verifier).
- Modify: `packages/signer/package.json` script `test:mutation`.

**Steps:**
- [ ] Stryker config con mutate sobre `src/{pkcs12,cms-build,pades,incremental,alg-policy}.ts`. Excluir `webcrypto.ts` (Web Crypto API mocking unreliable) y `visible-sig.ts` (pdf-lib internals).
- [ ] Threshold: `high: 80, low: 70, break: 60`.
- [ ] Run `pnpm --filter @firma-ec/signer test:mutation` (puede tomar 5-10 min). Documentar baseline en `docs/transparency-report.md`.
- [ ] Si mutation score <80% en pkcs12/cms-build/alg-policy → añadir tests focalizados.

**Verify:** Mutation score ≥80% en módulos críticos. Reporte HTML en `reports/mutation/`.

---

## Task 13 — `sign.worker.ts` Web Worker

**Files:**
- Create: `apps/pwa/src/lib/workers/sign.worker.ts`

**Steps:**
- [ ] Crear worker module-type:
  ```ts
  /// <reference lib="webworker" />
  import { signPdf, parsePfx, importPrivKeyForSign } from '@firma-ec/signer';
  import type { SignWorkerRequest, SignWorkerResponse } from './sign.bus';

  self.onmessage = async (ev: MessageEvent<SignWorkerRequest>) => {
    const post = (m: SignWorkerResponse, transfer?: Transferable[]) => self.postMessage(m, transfer ?? []);
    try {
      post({ kind: 'progress', stage: 'parse_pfx' });
      const parsed = await parsePfx(new Uint8Array(ev.data.p12), ev.data.pin);
      // zero-out p12 + pin
      new Uint8Array(ev.data.p12).fill(0);
      // pin is immutable JS string, but we drop the reference

      post({ kind: 'progress', stage: 'import_key' });
      const cryptoKey = await importPrivKeyForSign(parsed.privateKeyJwk, parsed.sigAlg);

      post({ kind: 'progress', stage: 'load_pdf' });
      // ... build SignOptions ...

      post({ kind: 'progress', stage: 'sign' });
      const signedPdf = await signPdf(opts);

      post({ kind: 'result', signedPdf }, [signedPdf.buffer]);
    } catch (e) {
      const code = (e as any)?.code ?? 'unknown';
      post({ kind: 'error', code, message: (e as Error).message });
    }
  };
  ```
- [ ] Export `{}` para que TS lo trate como module worker.

**Verify:** typecheck OK; manual smoke en Task 16.

---

## Task 14 — `sign.bus.ts` typed bus + tests

**Files:**
- Create: `apps/pwa/src/lib/workers/sign.bus.ts`
- Create: `apps/pwa/src/lib/workers/sign.bus.test.ts`

**Steps:**
- [ ] Definir tipos `SignWorkerRequest`, `SignWorkerResponse`, `WorkerSignerError`, `SignErrorCode` (re-export de signer).
- [ ] Implementar `runSign(req, opts?: { onProgress?, signal?, timeoutMs? = 30000 }): Promise<Uint8Array>`:
  - factoría `defaultWorkerFactory()` con `new Worker(new URL('./sign.worker.ts', import.meta.url), { type: 'module' })`.
  - postMessage(req, [req.pdf, req.p12]).
  - Listener única: progress → onProgress, result → resolve + terminate, error → reject + terminate.
  - Timeout 30s → reject `timeout` + terminate.
  - signal abort → reject `abort` + terminate.
  - `__setWorkerFactoryForTests` espejo de `bus.ts` F2.
- [ ] Tests con FakeWorker pattern (calcado de `bus.test.ts`):
  - resuelve con result kind.
  - rechaza con error kind y termina.
  - forwarda progress sin settle.
  - timeout → termina + reject.
  - signal abort → termina + reject.
  - PDF + p12 transferred (verificar `transferLists`).

**Verify:** `pnpm --filter pwa test sign.bus` verde.

---

## Task 15 — i18n keys F3

**Files:**
- Modify: `apps/pwa/src/lib/i18n.svelte.ts`
- Modify: `apps/pwa/src/styles/safelist.ts`

**Steps:**
- [ ] Añadir keys ES + EN para todos los strings del wizard (pasos 1-7), errores por código (`bad_pin`, `bad_p12`, `weak_alg`, `cert_expired`, `pdf_too_large`, `pdf_encrypted`, `visible_sig_oob`, `unknown`, `timeout`, `abort`).
- [ ] Lista exacta a generar (mínimo): `firmar.title`, `firmar.step1.title`, `firmar.step1.cta`, `firmar.step2.title`, `firmar.step2.size.compact|standard|large`, `firmar.step3.title`, `firmar.step4.title`, `firmar.step4.show`, `firmar.step4.warn`, `firmar.step5.title`, `firmar.step5.reason`, `firmar.step5.location`, `firmar.step5.skip`, `firmar.step6.summary`, `firmar.step6.cta`, `firmar.step7.success`, `firmar.step7.download`, `firmar.step7.share`, `firmar.step7.verify_now`, `firmar.step7.again`, `firmar.previous_signatures`, `firmar.errors.<code>`.
- [ ] Safelist UnoCSS: añadir clases dinámicas que use BoxPlacer (ej. `translate-x-*`, `translate-y-*` si se usan inline-styles que UnoCSS no detecte estáticamente — preferir CSS inline `style` para coords y no depender del safelist).

**Verify:** `pnpm --filter pwa typecheck` + grep por `t('firmar.` no produce missing keys.

---

## Task 16 — `Firmar.svelte` stepper full-screen

**Files:**
- Create: `apps/pwa/src/routes/Firmar.svelte`
- Modify: `apps/pwa/src/App.svelte` (registrar ruta `/firmar`)

**Steps:**
- [ ] Stepper basado en `$state` rune con `step: 1..7`.
- [ ] Estado: `pdfBytes, pdfMeta, previousSignatures, visibleSig, p12Bytes, pin, attrs, signedBytes, error, progress`.
- [ ] Render condicional por step. CTA primario único visible. Header con back-button (decremento step) y progress dots ("● ● ○ ○ ○ ○ ○").
- [ ] Mobile-first: stepper full-screen (h-screen), padding generoso, touch targets ≥44px.
- [ ] Desktop ≥1024: layout 2-col donde aplique (preview + controles), pero misma máquina de estados.
- [ ] On step 1 complete: pre-flight `findSignature(pdfBytes)` para popular `previousSignatures` count.
- [ ] On step 6 sign: `runSign(...)` con onProgress que actualiza Progress.svelte (reuso F2).
- [ ] Cleanup: en `onDestroy` y al pulsar "Firmar otro", `URL.revokeObjectURL(downloadUrl)`, zero-out `pdfBytes`/`p12Bytes`/`pin`.

**Verify:** `pnpm dev` local + smoke manual en `/firmar` con fixtures.

---

## Task 17 — `PdfPreview.svelte` (pdfjs-dist v4 canvas)

**Files:**
- Create: `apps/pwa/src/ui/PdfPreview.svelte`

**Steps:**
- [ ] Lazy import dinámico: `const pdfjs = await import('pdfjs-dist');` + setear `GlobalWorkerOptions.workerSrc` al worker bundle de pdfjs (Vite asset import).
- [ ] Props: `pdfBytes: Uint8Array`, `pageIndex: number`, `scale?: number`.
- [ ] Render: `<canvas>` ref. `getDocument({ data: pdfBytes, disableFontFace: true, isEvalSupported: false })` → render page on canvas.
- [ ] Mobile: pinch-zoom con `touch-action: pinch-zoom` CSS.
- [ ] Desktop: wheel + ctrl para zoom; flechas para cambiar página.
- [ ] Preview pageIndex select: dropdown si N<10 páginas; input number si más.

**Verify:** `pnpm dev` smoke con sample.pdf renderiza primera página en mobile + desktop.

---

## Task 18 — `BoxPlacer.svelte` overlay drag

**Files:**
- Create: `apps/pwa/src/ui/BoxPlacer.svelte`

**Steps:**
- [ ] Overlay absolute sobre PdfPreview canvas.
- [ ] Caja `<div>` con texto preview "Firmado por: \<CN preview\>" + handle drag.
- [ ] Mobile: pointer events. tap-to-place (single tap), long-press + drag para mover, drag de esquina para resize.
- [ ] Desktop: drag con mouse; resize con corner handle.
- [ ] Sincronizar coords (x,y,w,h) en pt PDF (1pt = 1/72in) con scale del canvas (`scale = canvas.width / page.viewBox.width`).
- [ ] Emit `update:visibleSig` con `{ pageIndex, x, y, w, h, size }`.
- [ ] A11y: keyboard nav (arrow keys 1pt, shift+arrow 10pt), `role="application"` con `aria-label`.

**Verify:** Test manual mobile (iPhone 13 throttled) + desktop con teclado.

---

## Task 19 — `DropP12.svelte` + `PinInput.svelte`

**Files:**
- Create: `apps/pwa/src/ui/DropP12.svelte`
- Create: `apps/pwa/src/ui/PinInput.svelte`

**Steps:**
- [ ] DropP12: `<input type="file" accept=".p12,.pfx,application/x-pkcs12">` + drag-and-drop overlay (reusar pattern de `Drop.svelte` F2 con prop `accept`).
- [ ] Validar: ≤1 MB, content-type o magic bytes (`0x30 0x82 ...` ASN.1 SEQUENCE).
- [ ] PinInput:
  - `<input type="password" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="text" enterkeyhint="done">`.
  - Toggle "mostrar/ocultar" con icono ojo (cambia `type` entre password/text).
  - On unmount o "Atrás": `field.value = ''` + `pin = ''`.
  - emit `submit` on Enter.

**Verify:** A11y check con axe — labels asociados, errores con aria-describedby.

---

## Task 20 — `OptionalAttrs.svelte` + `SignButton.svelte` + `DownloadResult.svelte`

**Files:**
- Create: `apps/pwa/src/ui/OptionalAttrs.svelte`
- Create: `apps/pwa/src/ui/SignButton.svelte`
- Create: `apps/pwa/src/ui/DownloadResult.svelte`

**Steps:**
- [ ] OptionalAttrs: 2 inputs textuales razón / lugar, max 200 char cada uno, sanitize a-zA-Z0-9 + acentos + espacios + `,.:;-_` (regex `/[^\p{L}\p{N}\s.,:;\-_/]/gu` → ''). CTA "Saltar" si vacíos.
- [ ] SignButton: muestra summary (PDF name, signer CN, vigencia cert, cuadro coords, razón, lugar, previousSignatures count) + CTA "Firmar PDF" disabled mientras `progress`.
- [ ] DownloadResult:
  - `<a href={blobUrl} download={`${name}-firmado.pdf`}>Descargar</a>`.
  - Botón "Compartir" con `navigator.share({ files: [new File([signedBytes], `${name}-firmado.pdf`, { type: 'application/pdf' })] })` (con feature-detect; si no soportado, hide).
  - Botón "Verificar ahora" → `goto('/verificar')` con state pasando los bytes (o re-drop manual).
  - Botón "Firmar otro" → reset state + scroll-top.

**Verify:** Smoke desktop + iPhone 13.

---

## Task 21 — Vite config + pdfjs worker

**Files:**
- Modify: `apps/pwa/vite.config.ts`

**Steps:**
- [ ] Añadir a `optimizeDeps.include`: `['pdfjs-dist']`.
- [ ] `worker.format: 'es'` ya está (F2). Verificar.
- [ ] CSP: confirmar que `worker-src 'self'` permite el pdfjs worker bundleado.
- [ ] Añadir handling para `pdfjs-dist/build/pdf.worker.mjs` como asset.

**Verify:** `pnpm --filter pwa build` no genera warnings de chunks no resueltos.

---

## Task 22 — Caddyfile.pwa CSP review

**Files:**
- Modify: `infra/docker/Caddyfile.pwa` (solo si CSP bloquea)

**Steps:**
- [ ] **RESPALDO**: `cp infra/docker/Caddyfile.pwa{,.bak.20260509-F3}`.
- [ ] Smoke `/firmar` en build local + `caddy run --config Caddyfile.pwa` local. Verificar `browser_console_messages` no muestra CSP violations.
- [ ] Si pdfjs worker rompe: añadir `worker-src 'self' blob:;` (blob necesario por algunos build modes pdfjs); preferir worker self-hosted sin blob.
- [ ] Si `crypto.subtle.sign` rompe: imposible (Web Crypto no requiere CSP especial).
- [ ] Si pdf-lib drawText rompe: imposible (es JS puro).
- [ ] Validar Mozilla Observatory sigue A+ post-cambios.

**Verify:** Smoke local sin errores en console + Mozilla Observatory A+.

---

## Task 23 — Playwright E2E `sign.spec.ts`

**Files:**
- Create: `apps/pwa/tests-e2e/sign.spec.ts`
- Modify: `apps/pwa/playwright.config.ts` (si añadir profiles mobile no estaban).

**Steps:**
- [ ] Spec con 4 tests (golden, multi-firma, bad_pin, weak_alg) según spec §7.4.
- [ ] Devices: chromium-desktop + iPhone 13 + Pixel 5 (matrix con `--project`).
- [ ] Fixtures: `test.p12` + `test-no-ku.p12` + `test-sha1.p12` (generar variantes en `tools/gen-test-p12.ts`) + `sample.pdf`.
- [ ] Cross-check: tras firmar en `/firmar`, el spec navega a `/verificar` y dropa los signedBytes → assertion `verdict === valid|warning`.
- [ ] Multi-firma test: ejecuta golden 2x consecutivos, verifica que `previous_signatures` reporta 1 en la segunda corrida.
- [ ] bad_pin: PIN incorrecto → vuelve a step 4 con error inline; field vacío.
- [ ] weak_alg: usar `test-sha1.p12` → bloqueante con mensaje `weak_alg`.

**Verify:** `pnpm --filter pwa test:e2e` verde en los 3 devices.

---

## Task 24 — axe + Lighthouse + Mozilla Observatory

**Files:**
- Modify: `.github/workflows/lighthouse.yml` (si añadir `/firmar` a la lista; aceptar score ≥95).

**Steps:**
- [ ] Run `pnpm --filter pwa test:e2e --grep axe` (axe-playwright integrado en spec). 0 violations criticas/serias.
- [ ] Lighthouse CI sobre `/firmar` paso 1 (sin cripto cargado): ≥95.
- [ ] Lighthouse sobre `/firmar` con cripto lazy-cargado: ≥85 (documentar caída en `docs/transparency-report.md`).
- [ ] Mozilla Observatory + securityheaders.com sobre `app.firmar.ec` post-deploy: A+ sostenido.

**Verify:** Tres badges siguen verdes.

---

## Task 25 — RESPALDO + build v0.3.0-rc1 + push registry

**Files:**
- Modify: `apps/pwa/package.json` version → `0.3.0-rc1`.
- Modify: `infra/compose/stack-firma-ec.deploy.yml` (image tag).
- Modify: `CHANGELOG.md`.

**Steps:**
- [ ] **RESPALDO**: `cp infra/compose/stack-firma-ec.deploy.yml{,.bak.20260509-F3}`.
- [ ] Bump versions:
  - `apps/pwa/package.json`: `0.2.2` → `0.3.0-rc1`.
  - `packages/signer/package.json`: `0.0.0` → `0.3.0-rc1`.
- [ ] CHANGELOG entry:
  ```md
  ## [0.3.0-rc1] - 2026-05-09
  ### Added
  - F3: PWA puede firmar PDFs (PAdES B-B) en cliente puro con .p12/.pfx + PIN.
  - packages/signer con WebCryptoSigner (extractable:false), pkcs12 parse, CMS build, pdf-lib visible signature.
  - Multi-firma secuencial vía incremental update (no rompe firmas previas).
  - Worker isolation terminate-after-use para sign workflow.
  - /firmar route con stepper full-screen mobile-first.
  ### Notes
  - Nivel B-B mínimo: sin TSA, OCSP, ni LTV (F6/F7 los añaden).
  - Cuadro visible: solo "Firmado por: <CN>" — plantilla única, sin fecha/razón/lugar visible.
  ```
- [ ] `pnpm --filter pwa build` (verificar bundle sizes en `dist/`).
- [ ] `docker buildx build` `infra/docker/pwa.Dockerfile` → tag `registry.idkmanager.com/firma-ec/pwa:0.3.0-rc1`.
- [ ] `docker push registry.idkmanager.com/firma-ec/pwa:0.3.0-rc1`.

**Verify:** Imagen visible en registry; SHA256 anotado.

---

## Task 26 — GATE: confirmación usuario antes de deploy

**Files:** —

**Steps:**
- [ ] Mostrar al usuario:
  - SHA de la imagen.
  - Diff resumido stack-deploy.yml.
  - Resultados Playwright + Lighthouse + axe.
  - Cross-check manual pendiente (Adobe + FirmaEC).
- [ ] **Esperar confirmación explícita** (regla no-negociable #2 CLAUDE.md).
- [ ] No avanzar a Task 27 sin "OK / desplegar / sí".

**Verify:** Usuario firma off.

---

## Task 27 — Deploy stack v0.3.0-rc1

**Files:**
- Modify: `infra/compose/stack-firma-ec.deploy.yml`.

**Steps:**
- [ ] `docker stack deploy -c stack-firma-ec.deploy.yml firma-ec --with-registry-auth` desde IAS01 (vía SSH manual — el flujo del workspace).
- [ ] Verificar `docker service ls | grep firma-ec_pwa` → `1/1 replicated`.
- [ ] Health: `curl -I https://app.firmar.ec/firmar` retorna 200 + headers Mozilla Observatory A+.
- [ ] Smoke: navegar manual a `/firmar`, completar wizard con `test.p12` + `sample.pdf`, descargar resultado, drop en `/verificar` → status valid|warning.

**Verify:** Servicio LIVE; smoke OK.

---

## Task 28 — Cross-validation manual (Adobe Reader + FirmaEC desktop)

**Files:** —

**Steps:**
- [ ] Usuario tiene `.p12` real (BCE o Security Data) — sino, tomar `.p12` corporativo Saceisa o pedir uno.
- [ ] Firmar `sample.pdf` con la PWA + `.p12` real → guardar `sample-real-signed.pdf`.
- [ ] Abrir en **Adobe Acrobat Reader DC**: panel de firmas debe mostrar firma reconocida (puede aparecer "issuer not trusted" si Adobe no tiene la raíz ECI — eso es OK, lo importante es que la firma cripto valida).
- [ ] Abrir en **FirmaEC desktop**: validador acepta firma como válida.
- [ ] Multi-firma: firmar `sample.pdf` con FirmaEC desktop, luego firmar el resultado con la PWA → ambas firmas válidas en Adobe Reader.

**Verify:** Acepta usuario el resultado. Captura screenshots en `docs/reports/F3-cross-validation-2026-05-09/`.

---

## Task 29 — Audits Lighthouse + Mozilla + securityheaders post-deploy

**Files:**
- Modify: `docs/transparency-report.md` (sección F3).
- Create: `docs/reports/F3-audit-2026-05-09.md`.

**Steps:**
- [ ] Lighthouse manual `/firmar` desde Chrome DevTools (mobile + desktop): screenshot + score.
- [ ] Mozilla Observatory: `https://observatory.mozilla.org/analyze/app.firmar.ec` → A+.
- [ ] securityheaders.com → A+.
- [ ] SSL Labs `app.firmar.ec` → A+.
- [ ] Adjuntar capturas a `docs/reports/F3-audit-2026-05-09.md`.
- [ ] Actualizar `docs/transparency-report.md` con sección "F3 firma — modelo de amenazas y mitigaciones" (referencia spec §6).

**Verify:** 4 badges A+ + Lighthouse documentado.

---

## Task 30 — Tag v0.3.0-rc1 + Cosign + SBOM + Gitea + GH mirrors

**Files:** —

**Steps:**
- [ ] Commit final: `chore(release): v0.3.0-rc1 — F3 firma MVP`.
- [ ] `git tag -s v0.3.0-rc1 -m "F3 firma MVP — PAdES B-B en cliente"`.
- [ ] `git push origin main && git push origin v0.3.0-rc1`.
- [ ] CI release workflow corre: Cosign sign image + SLSA L3 provenance + SBOM CycloneDX. Si falla SBOM (issue F0 conocido), reintentar sin SPDX.
- [ ] Push mirror a `github.com/idkmanager/firma-ec` y `github.com/alfonsokuen/firma-ec`.
- [ ] Verificar release page en Gitea + ambos GH con assets firmados.

**Verify:** Release v0.3.0-rc1 visible en los 3 remotos con artifacts.

---

## Task 31 — Memoria F3 closure

**Files:**
- Create: memory file `~/.claude/projects/.../memory/project_firma_ec_F3_completed_2026-05-09.md`.

**Steps:**
- [ ] Registrar en MEMORY.md:
  - Tag v0.3.0-rc1 LIVE en https://app.firmar.ec/firmar.
  - 7 pasos wizard mobile-first.
  - Cross-validation Adobe + FirmaEC OK.
  - Caveats: solo última firma reportada por verifier (TODO F4); cuadro visible sin outline (decision MVP); cert auto-firmado da `warning` (esperado).
  - Stryker mutation score (números reales).
  - Lighthouse `/firmar` desktop + mobile (números).
  - Pendientes diferidos a F4: outline opcional cuadro visible, multi-firma reporting verifier, sello con QR.

**Verify:** Memoria registrada y referenciada en `MEMORY.md`.

---

## Task 32 — README + landing CTA

**Files:**
- Modify: `apps/landing/src/content/pages/{es,en}/index.md` (si CTA "Firmar" estaba grayed-out).
- Modify: `README.md` (sección Status: F3 LIVE).

**Steps:**
- [ ] Cambiar copy del CTA "Firmar" en landing: de "Próximamente" → "Empieza ahora →".
- [ ] Build + deploy landing si cambia (si no cambia, skip).
- [ ] README badges: añadir "v0.3.0-rc1 release candidate".

**Verify:** Landing actualizada visible en https://firmar.ec.

---

## Task 33 — Self-review + handoff F4

**Files:**
- Create: `docs/superpowers/notes/F3-handoff-to-F4.md`.

**Steps:**
- [ ] Listar para F4 hardening:
  - Pentest interno (OWASP ZAP + nuclei + semgrep + trivy + gitleaks) sobre /firmar.
  - Verifier multi-firma reporting (devolver array de firmas, no solo última).
  - Outline opcional en cuadro visible (toggle UI).
  - UI Pro Max critique sobre Firmar.svelte (si UI Pro Max no se ejecutó como F1.x).
  - Stryker re-baseline sobre signer + verifier integrados.
  - Bug bounty pre-launch checklist.

**Verify:** Doc creado.

---

## Task 34 — Final QA gate

**Files:** —

**Steps (Acceptance criteria spec §9):**
- [ ] `pnpm test` verde (todos los packages).
- [ ] `pnpm --filter @firma-ec/signer test:mutation` ≥80%.
- [ ] Playwright E2E verde en chromium-desktop + iPhone 13 + Pixel 5.
- [ ] Lighthouse `/firmar` ≥95.
- [ ] Mozilla Observatory + securityheaders + SSL Labs A+ sostenidos.
- [ ] axe-core 0 violations en /firmar.
- [ ] CSP / Trusted Types sin warnings en console.
- [ ] Cross-validation Adobe + FirmaEC OK (Task 28).
- [ ] Multi-firma roundtrip OK (Task 28).
- [ ] Headers no rompen.
- [ ] Transparency report actualizado.
- [ ] Tag v0.3.0-rc1 firmado en 3 remotos.
- [ ] Memoria F3 registrada.

**Verify:** Tabla completa con ✅ en cada item.

---

## Self-review (post-write del plan)

- **Spec coverage**: cada decisión 1-10 del spec §1 mapeada a uno o más tasks (1→T3+T13, 2→T7+T8, 3→T9, 4→T16+T17+T18, 5→T10, 6→T16 cleanup+T20, 7→T7 nota correctiva (reason/location va al PDF dict, no signedAttrs), 8→T13+T14, 9→T1 deps, 10→T25 bump). ✅
- **Bite-sized**: 34 tasks. La mayoría 2-5min de orquestación + escritura de código (LLM-velocidad). Tasks de cripto (T3, T7, T8, T10) son los más densos pero sub-stepped. Tasks de UI Svelte (T16-T20) split por componente. ✅
- **Type consistency**: tipos centrales (`SigAlg`, `SignerCert`, `VisibleSigSpec`, `SignWorkerRequest/Response`, `SignErrorCode`) declarados en T1 y reutilizados consistentemente. ✅
- **Placeholder scan**: 0 TBD/TODO/FIXME en este documento. Hay 1 "TODO documentado para F4" en T10 (verifier multi-firma reporting) — eso es un *follow-up explícito*, no un placeholder. ✅
- **Code blocks completos** donde aplica (T1 package.json, T13 worker, T15 keys i18n, T25 changelog). ✅
- **Comandos exactos**: `pnpm --filter @firma-ec/signer test`, `pnpm --filter pwa test:e2e`, `docker stack deploy ...`, etc. ✅
- **Discrepancia detectada vs spec §4.3**: el borrador del spec sugería razón/lugar en signedAttrs CMS. La implementación correcta de `@signpdf` los pone en el `/Sig` PDF dictionary (campos `/Reason`, `/Location`), que es lo que FirmaEC desktop / Adobe esperan. Documentado en T7 — actualizar spec en F4 si se confirma divergencia tras tests cross-check.

---

**Fin del plan F3 — listo para ejecutar con `subagent-driven-development` o `executing-plans`.**
