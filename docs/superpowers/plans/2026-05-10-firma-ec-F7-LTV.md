# F7 LTV (PAdES B-LT / B-LTA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` para implementar este plan task-by-task. Cada step usa checkbox (`- [ ]`) para tracking. Tasks dentro de un mismo grupo (Foundation, OCSP, CRL, DSS, Signer-LT, Signer-LTA, Verifier-LT, Verifier-LTA, PWA, Tests, Docs) son secuenciales; los grupos también son secuenciales entre sí salvo Foundation A1↔A2 paralelizables.

**Goal:** Elevar las firmas de la PWA de **PAdES B-T** a **PAdES B-LT** (DSS dictionary con cadena cert + OCSP/CRL embebidos) y **PAdES B-LTA** (B-LT + document timestamp RFC 3161 sobre PDF + DSS) cerrando el ladder ETSI EN 319 142-1. OCSP/CRL fallback en cascada; cert revocado bloquea sign con error fatal. Verifier acepta los 4 niveles (B-B/B-T/B-LT/B-LTA), valida retrospectivamente con datos embebidos, fallback live cuando faltan. Entregable: tag `v0.7.0-rc1` con cross-validation Adobe Reader DC.

**Architecture:** Dos paquetes nuevos — `packages/ltv-validation` (OCSP client + CRL fetcher + DSS data builder, sin PDF) y `packages/dss-pdf` (DSS dictionary writer + document-timestamp incremental update, reusa `signer/internal/pdfIncremental.ts` factorizado). Cambios en `packages/signer/src/pades.ts` (orquesta collect → appendDss → appendDocumentTimestamp post-B-T). Cambios en `packages/verifier/src/ltv.ts` (NEW — verifyLtv consume DSS o falla a live). Profile state machine en `verifier/src/index.ts` extendida a `'B-LTA'`. PWA: 4 nuevos stages (`fetch_ocsp`, `fetch_crl`, `build_dss`, `document_timestamp`), Settings con toggles LT/LTA + URL overrides, Verificar con panel "DSS · Validación a largo plazo" + 3 badge tiers acumulables (sello + LT + LTA).

**Tech Stack:** Continuidad F3-F6 (Svelte 5 runes, Vite 6, UnoCSS, pkijs 3, asn1js 3, pdf-lib 1.17, Vitest 2, fast-check 3, Playwright, Biome 2, MSW 2 para E2E mocks). Sin nuevas deps — `pkijs.OCSPRequest`/`OCSPResponse`/`CertificateRevocationList` ya disponibles en pkijs ≥3.2 (verificar lockfile).

**Spec reference:** `docs/superpowers/specs/2026-05-10-firma-ec-F7-LTV-design.md` (decisiones 1-15, arquitectura §2, packages §3-4, signer §5, verifier §6, UI §7, fallback §8, threats §9, ARCOTEL caveats §10, out-of-scope §11, acceptance §12).

**F3-F6 prerequisites met (no re-hacer):**
- B-T LIVE en https://app.firmar.ec, cross-validated Adobe Reader (F6 v0.5.0/v0.6.0-rc8).
- `packages/tsa-client` y `packages/tsa-trust` operativos — reusados para document timestamp.
- `packages/verifier/src/timestamp.ts` reusable cambiando solo el origen del imprint (signatureValue → covered bytes).
- `packages/verifier/src/result.ts` ya declara `profile: 'B-B' | 'B-T' | 'B-LT' | 'unknown'` — F7 lo extiende a `'B-LTA'`.
- `packages/verifier/src/ocsp.ts` existe con `checkOcsp` best-effort — refactor target (mover a `ltv-validation` y dejar shim).
- `packages/signer/src/incrementalUpdate.ts` con primitivas xref/trailer/tail-assembly — factorizar a `internal/pdfIncremental.ts`.
- Worker pattern `apps/pwa/src/lib/workers/{sign.worker.ts, sign.bus.ts}` extensible con stages nuevos.
- Caddyfile.pwa CSP A+ — F7 añade `connect-src` regex para hostnames OCSP/CRL ECI Ecuador.

**QA-Verify discipline:** RESPALDO antes de tocar `signer/pades.ts`, `verifier/index.ts`, `Caddyfile.pwa` (archivos críticos productivos); verificación multi-capa (Biome lint + `pnpm -r typecheck` + unit + Playwright + Lighthouse `/firmar` + `/verificar` ≥95 + Mozilla Observatory A+ + axe-core 0); push a Gitea solo con confirmación explícita; registro en memoria al cierre F7.

---

## File Structure (decomposed)

```
firma-ec/
├── packages/
│   ├── ltv-validation/                            NEW
│   │   ├── package.json                           NEW
│   │   ├── tsconfig.json                          NEW
│   │   ├── vitest.config.ts                       NEW
│   │   └── src/
│   │       ├── index.ts                           NEW   # public API re-exports
│   │       ├── types.ts                           NEW   # OcspOutcome, CrlOutcome, DssData
│   │       ├── ocsp.ts                            NEW   # fetchOcsp + cache
│   │       ├── crl.ts                             NEW   # fetchCrl
│   │       ├── aia.ts                             NEW   # cert AIA / CDP extraction
│   │       ├── cache.ts                           NEW   # createOcspCache (TTL Map)
│   │       └── collect.ts                         NEW   # collectDssData orchestration
│   │   └── tests/
│   │       ├── ocsp.test.ts                       NEW
│   │       ├── crl.test.ts                        NEW
│   │       ├── aia.test.ts                        NEW
│   │       ├── cache.test.ts                      NEW
│   │       ├── collect.test.ts                    NEW
│   │       ├── property.test.ts                   NEW   # fast-check
│   │       └── __fixtures__/
│   │           ├── le-ocsp-good-2026-05-10.der    NEW   # Let's Encrypt OCSP good
│   │           ├── eci-ocsp-good-2026-05-10.der   NEW   # ARCOTEL ECI (or skip)
│   │           ├── eci-crl-2026-05-10.der         NEW
│   │           └── synth-ocsp-revoked.der         NEW   # generated test vector
│   │
│   ├── dss-pdf/                                   NEW
│   │   ├── package.json                           NEW
│   │   ├── tsconfig.json                          NEW
│   │   ├── vitest.config.ts                       NEW
│   │   └── src/
│   │       ├── index.ts                           NEW
│   │       ├── appendDss.ts                       NEW
│   │       ├── appendDocumentTimestamp.ts         NEW
│   │       ├── parseDss.ts                        NEW
│   │       ├── findDocumentTimestamps.ts          NEW
│   │       └── vri.ts                             NEW   # SHA-1 hex key computation
│   │   └── tests/
│   │       ├── appendDss.test.ts                  NEW
│   │       ├── appendDocumentTimestamp.test.ts    NEW
│   │       ├── parseDss.test.ts                   NEW
│   │       ├── roundtrip.test.ts                  NEW
│   │       └── __fixtures__/
│   │           └── bt-sample.pdf                  NEW   # B-T PDF for round-trip
│   │
│   ├── signer/
│   │   ├── package.json                           MODIFY: add ltv-validation + dss-pdf
│   │   └── src/
│   │       ├── internal/
│   │       │   └── pdfIncremental.ts              NEW   # factor xref/trailer primitives
│   │       ├── incrementalUpdate.ts               MODIFY: import from internal/
│   │       ├── pades.ts                           MODIFY: F7 orchestration after B-T
│   │       ├── types.ts                           MODIFY: LtvOpts + LtvMeta + SignResult.ltv
│   │       ├── errors.ts                          MODIFY: add 'certificate_revoked'
│   │       └── index.ts                           MODIFY: re-export LtvOpts/LtvMeta
│   │   └── tests/
│   │       ├── pades-ltv.test.ts                  NEW
│   │       └── pades-revoked-block.test.ts        NEW
│   │
│   └── verifier/
│       ├── package.json                           MODIFY: add ltv-validation + dss-pdf
│       └── src/
│           ├── ltv.ts                              NEW   # verifyLtv
│           ├── ocsp.ts                              MODIFY: shim → ltv-validation.fetchOcsp
│           ├── result.ts                            MODIFY: profile + LtvSummary
│           ├── timestamp.ts                        MODIFY: accept generic imprintSource
│           └── index.ts                            MODIFY: wire LTV + profile machine
│       └── tests/
│           ├── ltv.test.ts                         NEW
│           ├── ltv-offline.test.ts                 NEW
│           ├── ltv-retrospective.test.ts          NEW
│           └── profile-machine.test.ts            NEW
│
├── apps/pwa/
│   ├── package.json                                MODIFY: add ltv-validation
│   ├── src/
│   │   ├── lib/
│   │   │   ├── i18n.svelte.ts                     MODIFY: F7 keys (ES + EN)
│   │   │   ├── settings.svelte.ts                 MODIFY: ltv_enabled, lta_enabled, ocsp_url
│   │   │   └── workers/
│   │   │       ├── sign.worker.ts                 MODIFY: 4 new stages + LtvOpts pass-through
│   │   │       └── sign.bus.ts                    MODIFY: SignWorkerResponse adds ltv result
│   │   ├── routes/
│   │   │   ├── Firmar.svelte                      MODIFY: progress + 3 badge tiers + revoked error
│   │   │   ├── Verificar.svelte                   MODIFY: DSS panel, profile-aware copy
│   │   │   ├── DownloadResult.svelte              MODIFY: profile-conditional copy + badges
│   │   │   └── Configuracion.svelte               MODIFY: LTV section
│   │   └── ui/
│   │       ├── LtvBadge.svelte                    NEW
│   │       └── LtvDetailCard.svelte               NEW
│   └── tests-e2e/
│       ├── ltv.spec.ts                            NEW
│       ├── ltv-offline.spec.ts                    NEW
│       └── ltv-revoked.spec.ts                    NEW
│
└── infra/docker/
    └── Caddyfile.pwa                              MODIFY: connect-src OCSP/CRL ECI hosts
```

---

## Pre-conditions

- [ ] F6 LIVE en https://app.firmar.ec con tag ≥`v0.5.0-rc1` (B-T cross-validated Adobe).
- [ ] `pnpm install` limpio en root.
- [ ] Branch `main` limpio; spec F7 commited.
- [ ] Acceso de red: `curl -I https://r3.o.lencr.org/` (LE OCSP), `curl -I http://ocsp.eci.bce.ec/` smoke OK desde la dev box (informativo — si ECI down se marca skip).
- [ ] OpenSSL CLI ≥3 disponible para generar test vectors.

---

## Group A — Foundation: bootstrap `packages/ltv-validation` + `packages/dss-pdf`

### Task 1 — Bootstrap `packages/ltv-validation`

**Files:**
- Create: `packages/ltv-validation/package.json`
- Create: `packages/ltv-validation/tsconfig.json`
- Create: `packages/ltv-validation/vitest.config.ts`
- Create: `packages/ltv-validation/src/index.ts` (placeholder)
- Create: `packages/ltv-validation/src/types.ts`

**Steps:**
- [ ] Crear `package.json`:
  ```json
  {
    "name": "@firma-ec/ltv-validation",
    "version": "0.0.0",
    "private": true,
    "type": "module",
    "main": "./src/index.ts",
    "types": "./src/index.ts",
    "scripts": {
      "typecheck": "tsc --noEmit -p tsconfig.json",
      "build": "tsc -p tsconfig.json",
      "test": "vitest run"
    },
    "dependencies": {
      "@firma-ec/crypto-core": "workspace:*",
      "asn1js": "^3.0.6",
      "pkijs": "^3.2.5"
    },
    "devDependencies": {
      "fast-check": "^3.23.2",
      "vitest": "^2.1.8"
    }
  }
  ```
- [ ] `tsconfig.json` extiende `tsconfig.base.json`.
- [ ] `src/types.ts` con interfaces de spec §3.1 (`RevocationStatus`, `OcspResult`, `OcspError`, `OcspOutcome`, `CrlResult`, `CrlError`, `CrlOutcome`, `FetchOcspOpts`, `OcspCache`, `DssData`).
- [ ] `src/index.ts` con stubs `throw new Error('not implemented')` + re-exports de types.
- [ ] `pnpm install` desde root.
- [ ] `pnpm --filter @firma-ec/ltv-validation typecheck` verde.

**Verify:** `pnpm --filter @firma-ec/ltv-validation test` (suite vacía OK).

**Commit:** `chore(ltv-validation): bootstrap package skeleton`.

---

### Task 2 — Bootstrap `packages/dss-pdf`

**Files:**
- Create: `packages/dss-pdf/package.json`
- Create: `packages/dss-pdf/tsconfig.json`
- Create: `packages/dss-pdf/vitest.config.ts`
- Create: `packages/dss-pdf/src/index.ts`

**Steps:**
- [ ] `package.json` con deps `pdf-lib`, `@firma-ec/ltv-validation` (workspace), `@firma-ec/tsa-client`, `@firma-ec/crypto-core`.
- [ ] `tsconfig.json` extiende `tsconfig.base.json`.
- [ ] `src/index.ts` con stubs de spec §4.1: `appendDss`, `appendDocumentTimestamp`, `parseDss`, `findDocumentTimestamps`.
- [ ] `pnpm install`. Typecheck verde.

**Verify:** `pnpm --filter @firma-ec/dss-pdf test` vacío OK.

**Commit:** `chore(dss-pdf): bootstrap package skeleton`.

---

### Task 3 — Factor `pdfIncremental` primitives out of signer

**Files:**
- Create: `packages/signer/src/internal/pdfIncremental.ts`
- Modify: `packages/signer/src/incrementalUpdate.ts`

**Steps:**
- [ ] Extraer de `incrementalUpdate.ts` a `internal/pdfIncremental.ts`:
  - `parsePriorXref(pdfBytes): { prevOffset, size, rootRef, catalogRef, acroFormRef?, page0Ref }`
  - `assembleXrefSection(entries: XrefEntry[], baseOff: number): string`
  - `assembleTrailer({ size, prev, rootRef }): string`
  - `findContentsWindow(pdfBytes, sigRef): { start, end }` (helper para byteRange)
- [ ] `incrementalUpdate.ts` consume desde `./internal/pdfIncremental.js`. Behavior idéntico — validar tests existentes verde.
- [ ] Export desde `packages/signer/src/index.ts` (named: `internal__pdfIncremental` namespace) para que `dss-pdf` lo consuma vía workspace.

**Verify:** `pnpm --filter @firma-ec/signer test` verde sin regresión.

**Commit:** `refactor(signer): factor pdfIncremental primitives to internal/ for DSS reuse`.

---

## Group B — OCSP client (RFC 6960)

### Task 4 — Implement AIA / CDP extraction (`aia.ts`)

**Files:**
- Create: `packages/ltv-validation/src/aia.ts`
- Create: `packages/ltv-validation/tests/aia.test.ts`

**Steps:**
- [ ] `extractOcspUrls(cert): string[]` — parse `authorityInfoAccess` (OID `1.3.6.1.5.5.7.1.1`), filter `accessMethod == id-ad-ocsp` (`1.3.6.1.5.5.7.48.1`), return URIs from `accessLocation`.
- [ ] `extractCaIssuersUrls(cert): string[]` — same extension, `accessMethod == id-ad-caIssuers` (`1.3.6.1.5.5.7.48.2`).
- [ ] `extractCrlDistributionPoints(cert): string[]` — parse `cRLDistributionPoints` (OID `2.5.29.31`), traverse `distributionPoint.fullName.[0]`, filter `uniformResourceIdentifier` choice, prefer http/https over ldap.
- [ ] Tests con fixtures: parse 1 BCE cert (sample stored), 1 LE cert, 1 sin AIA → empty array.

**Verify:** `pnpm --filter @firma-ec/ltv-validation test aia` verde.

**Commit:** `feat(ltv-validation): cert AIA + CDP URL extraction`.

---

### Task 5 — Implement OCSP request build + fetch (`ocsp.ts` part 1)

**Files:**
- Create: `packages/ltv-validation/src/ocsp.ts` (part 1 — build + fetch)
- Create: `packages/ltv-validation/tests/ocsp-request.test.ts`

**Steps:**
- [ ] `buildOcspRequest(cert, issuerCert, hashAlgo: 'sha1'|'sha256'): { requestDer: Uint8Array; nonce: Uint8Array | null }`:
  - Build `pkijs.OCSPRequest`. Populate `tbsRequest.requestList[0].reqCert = CertID { hashAlgorithm, issuerNameHash: hash(issuer.subject DER), issuerKeyHash: hash(issuer.SPKI bitstring), serialNumber }`.
  - Skip nonce by default (decisión spec §9 F7-2).
  - DER encode.
- [ ] `fetchOcsp(cert, issuerCert, opts?): Promise<OcspOutcome>`:
  - Call `extractOcspUrls(cert)`. If empty + no `opts.url` → `{ ok: false, reason: 'no_aia' }`.
  - Try SHA-256 first (when `hashAlgo === 'auto'` default). On `malformedRequest` (status code 1 or sig fail) retry SHA-1 once.
  - POST to URL with `Content-Type: application/ocsp-request`, body = requestDer. Timeout via `AbortSignal.timeout(opts.timeoutMs ?? 8000)`.
  - Handle: HTTP 429 → `{ ok: false, reason: 'http_error', detail: 'rate_limited' }`. Other non-2xx → `{ ok: false, reason: 'http_error' }`. Network/timeout → `{ ok: false, reason: 'timeout' | 'network' }`.
- [ ] Tests with mocked `fetch`: assert request body parses back to OCSPRequest with correct CertID; assert SHA-256 retry to SHA-1 on malformed.

**Verify:** `pnpm --filter @firma-ec/ltv-validation test ocsp-request` verde.

**Commit:** `feat(ltv-validation): OCSP request builder + HTTP transport`.

---

### Task 6 — Implement OCSP response parse + verify (`ocsp.ts` part 2)

**Files:**
- Modify: `packages/ltv-validation/src/ocsp.ts`
- Create: `packages/ltv-validation/tests/ocsp-response.test.ts`
- Create: `packages/ltv-validation/tests/__fixtures__/le-ocsp-good-2026-05-10.der`

**Steps:**
- [ ] Capturar fixture LE OCSP `good` real:
  ```sh
  # Use a public LE-issued site cert
  openssl s_client -connect example-le-site.com:443 -servername X -showcerts < /dev/null \
    > /tmp/chain.pem 2>/dev/null
  openssl ocsp -issuer /tmp/issuer.pem -cert /tmp/cert.pem \
    -url http://r3.o.lencr.org -respout packages/ltv-validation/tests/__fixtures__/le-ocsp-good-2026-05-10.der
  ```
  Documentar SHA-256 del fixture en `tests/__fixtures__/README.md`.
- [ ] `parseOcspResponse(der: Uint8Array): { responseStatus, basicResponseDer, signedData }` via `pkijs.OCSPResponse`. Reject if `responseStatus !== 0`.
- [ ] `verifyOcspResponse(basicResponse, requestedCertID, issuerCert): { status, producedAt, thisUpdate, nextUpdate, responderCert, sigValid }`:
  - Match `tbsResponseData.responses[].certID` to `requestedCertID` (issuerNameHash + issuerKeyHash + serial).
  - Read `certStatus` choice → 'good'|'revoked'|'unknown'.
  - Validate `BasicOCSPResponse.signature` over `tbsResponseData` using responder cert (from `certs[]` if present, else issuerCert per RFC 6960 §4.2.2.2).
  - Verify Authorized Responder: responder cert MUST be issued by issuerCert (or be issuerCert itself) AND have `extendedKeyUsage` containing `id-kp-OCSPSigning` (`1.3.6.1.5.5.7.3.9`) when delegated.
- [ ] Wire into `fetchOcsp`: on 2xx parse + verify; return `OcspResult` (ok=true) or `{ ok: false, reason: 'malformed' | 'sig_invalid' }`.
- [ ] Tests:
  - LE fixture parses → status `good`, sig valid, producedAt parseable.
  - Tampered fixture (flip 1 byte in signature) → `{ ok: false, reason: 'sig_invalid' }`.
  - Fixture with serial mismatch (different cert) → `{ ok: false, reason: 'malformed', detail: 'serial mismatch' }`.

**Verify:** `pnpm --filter @firma-ec/ltv-validation test ocsp-response` verde.

**Commit:** `feat(ltv-validation): OCSP response parse + signature verification`.

---

### Task 7 — OCSP cache (`cache.ts`)

**Files:**
- Create: `packages/ltv-validation/src/cache.ts`
- Create: `packages/ltv-validation/tests/cache.test.ts`

**Steps:**
- [ ] `createOcspCache(ttlMs = 3_600_000): OcspCache` — `Map<string, { value: OcspResult; expiresAt: number }>`. Eviction perezosa en `get` (return undefined si expired).
- [ ] Key: `sha256(issuerKeyHash || serialNumber)` hex.
- [ ] Wire into `fetchOcsp(... opts.cache?)`: lookup pre-fetch, set on success.
- [ ] Tests:
  - `set` then `get` returns value.
  - `get` after TTL elapsed → undefined.
  - `clear` empties.
  - Property-based: any (issuerKeyHash, serial) pair stable round-trip.

**Verify:** `pnpm --filter @firma-ec/ltv-validation test cache` verde.

**Commit:** `feat(ltv-validation): in-memory OCSP cache (TTL 1h)`.

---

## Group C — CRL fetcher (RFC 5280 §5)

### Task 8 — Implement CRL fetch + parse (`crl.ts`)

**Files:**
- Create: `packages/ltv-validation/src/crl.ts`
- Create: `packages/ltv-validation/tests/crl.test.ts`
- Create: `packages/ltv-validation/tests/__fixtures__/eci-crl-2026-05-10.der`

**Steps:**
- [ ] Capturar fixture CRL real ARCOTEL (best-effort — si responder down, skip-marked):
  ```sh
  curl -fsSL http://crl.eci.bce.ec/crl/AC-BCE.crl \
    -o packages/ltv-validation/tests/__fixtures__/eci-crl-2026-05-10.der || echo SKIP
  ```
- [ ] `fetchCrl(cert, opts?): Promise<CrlOutcome>`:
  - `extractCrlDistributionPoints(cert)`. Empty + no override → `{ ok: false, reason: 'no_cdp' }`.
  - GET first http/https URL. Cap response 8 MB (`Content-Length` header check OR streaming with `getReader()` stop).
  - Parse `pkijs.CertificateRevocationList`. Verify sig with issuer cert (caller passes it).
  - Search `revokedCertificates[].userCertificate` for `cert.serialNumber` match → status 'revoked' (record `revocationDate`); else 'good'.
  - Return `CrlResult` with thisUpdate/nextUpdate.
- [ ] Tests:
  - Fixture parses → revokedCertificates count > 0; sig valid.
  - 8 MB cap: mock fetch returning 10 MB → `{ ok: false, reason: 'too_large' }`.
  - Cert serial in CRL → 'revoked'.
  - Cert serial NOT in CRL → 'good'.

**Verify:** `pnpm --filter @firma-ec/ltv-validation test crl` verde.

**Commit:** `feat(ltv-validation): CRL fetcher + verifier (8 MB cap)`.

---

## Group D — DSS data builder

### Task 9 — Implement `collectDssData` orchestration

**Files:**
- Create: `packages/ltv-validation/src/collect.ts`
- Create: `packages/ltv-validation/tests/collect.test.ts`

**Steps:**
- [ ] `collectDssData(input): Promise<{ data: DssData; warnings; revoked: false } | { revoked: true; revokedCertCN }>`:
  1. Build cert list: `[signerCert, ...intermediates, ...(tsaCert ? [tsaCert] : [])]`. Dedup by SHA-256 of DER.
  2. For each cert, lookup issuer in list; if no issuer (root) skip OCSP/CRL — root no se valida vía OCSP.
  3. For each non-root cert: try `fetchOcsp` (with cache). If `ok && status === 'revoked'` → return `{ revoked: true, revokedCertCN: subjectCn(cert) }` immediately (decisión #4).
  4. If OCSP `ok && status === 'good'|'unknown'` → push response to `ocsps[]`, record warning if 'unknown'.
  5. If OCSP failed → try `fetchCrl`. If `ok && status === 'good'` → push CRL. If `revoked` → return revoked.
  6. If both failed → push warning `ltv_no_revocation_for_<cn>`.
  7. Compute `vri[hexSha1(signatureContents)] = { certIndices: [all], ocspIndices: matched, crlIndices: matched, timestampTokenIndex: maybe }`.
  8. Return `data`.
- [ ] Tests:
  - All-good chain (mocked `fetchOcsp` → all `good`) → `data.ocsps.length === chainSize - 1`, no warnings.
  - One-revoked chain → returns `{ revoked: true }` short-circuit.
  - One-OCSP-down + CRL-good → 1 OCSP + 1 CRL embedded.
  - Both-down → warning + empty arrays for that cert.

**Verify:** `pnpm --filter @firma-ec/ltv-validation test collect` verde.

**Commit:** `feat(ltv-validation): collectDssData orchestration with cascade fallback`.

---

### Task 10 — Property-based + integration tests

**Files:**
- Create: `packages/ltv-validation/tests/property.test.ts`

**Steps:**
- [ ] `fast-check`: random byte sequences for `responseDer` → parser never throws (returns malformed).
- [ ] `fast-check`: random `(issuerKeyHash, serial)` pairs → cache key collisions = 0 in 10K iterations.
- [ ] Integration: real LE OCSP fixture round-trip through full `collectDssData` with mocked single-cert chain.

**Verify:** `pnpm --filter @firma-ec/ltv-validation test property` verde.

**Commit:** `test(ltv-validation): property-based + integration coverage`.

---

## Group E — DSS PDF writer

### Task 11 — Implement `parseDss` (verifier helper)

**Files:**
- Create: `packages/dss-pdf/src/parseDss.ts`
- Create: `packages/dss-pdf/tests/parseDss.test.ts`

**Steps:**
- [ ] Parse PDF via pdf-lib; navigate `Catalog → /DSS`.
- [ ] Extract arrays `/Certs`, `/OCSPs`, `/CRLs`. For each indirect ref, dereference stream, return raw bytes.
- [ ] Extract `/VRI` dict: keys are hex strings, values are sub-dicts → return `Record<string, { certIndices, ocspIndices, crlIndices, timestampTokenIndex? }>` mapping refs to indices in the global arrays.
- [ ] Tests:
  - Adobe-generated B-LT PDF (manually captured fixture) → parses correctly.
  - PDF without DSS → returns `null`.
  - PDF with malformed DSS (missing /Certs) → throws or returns partial — choose: throw `DssParseError`.

**Verify:** `pnpm --filter @firma-ec/dss-pdf test parseDss` verde.

**Commit:** `feat(dss-pdf): parseDss extractor`.

---

### Task 12 — Implement `appendDss` (writer)

**Files:**
- Create: `packages/dss-pdf/src/vri.ts`
- Create: `packages/dss-pdf/src/appendDss.ts`
- Create: `packages/dss-pdf/tests/appendDss.test.ts`
- Create: `packages/dss-pdf/tests/__fixtures__/bt-sample.pdf`

**Steps:**
- [ ] `vri.ts`: `vriKey(signatureContents: Uint8Array): string` → uppercase hex of SHA-1.
- [ ] `appendDss({ pdfBytes, dss }): Promise<Uint8Array>`:
  1. Use factored `parsePriorXref` from `@firma-ec/signer/internal/pdfIncremental`.
  2. Compute next object number `next = size`.
  3. Layout: certs[] streams (next..next+N-1), ocsps[] (next+N..), crls[], DSS dict, updated Catalog.
  4. Build tail string concatenating `<n> 0 obj\n<< /Length L >> stream\n<bytes>\nendstream\nendobj\n` for each item.
  5. DSS dict: `<< /Type /DSS /Certs [...] /OCSPs [...] /CRLs [...] /VRI <<<vriKeyHex> << /Cert [...] /OCSP [...] /CRL [...] >>>> >>`.
  6. Updated Catalog (same object number, bumped generation): `<< /Type /Catalog /Root ... /AcroForm ... /DSS <dssRef> /Pages ... >>`.
  7. xref subsection covering new + updated Catalog. Trailer `<< /Size <next+M> /Prev <prevOff> /Root <catRef> >>`.
  8. `startxref <newXrefOff>\n%%EOF`.
  9. Concat input bytes + tail. Return.
- [ ] Tests:
  - Round-trip: B-T PDF → `appendDss(dss)` → `parseDss(out)` recovers the same Cert/OCSP/CRL byte arrays (DER-equal).
  - Slice 1 invariant: `out.slice(0, pdfBytes.length) === pdfBytes` byte-perfect (preserves prior signature integrity).
  - PDF still opens in pdf-lib without errors after append.

**Verify:** `pnpm --filter @firma-ec/dss-pdf test appendDss` verde.

**Commit:** `feat(dss-pdf): appendDss incremental update writer`.

---

### Task 13 — Implement `findDocumentTimestamps` (verifier helper)

**Files:**
- Create: `packages/dss-pdf/src/findDocumentTimestamps.ts`
- Create: `packages/dss-pdf/tests/findDocumentTimestamps.test.ts`

**Steps:**
- [ ] Reuse `findSignature` style (verifier/pdf.ts) but iterate ALL `/Sig` dicts in the AcroForm and filter `subFilter === 'ETSI.RFC3161'` AND `Type === 'DocTimeStamp'`.
- [ ] For each, extract `/ByteRange` array, hex-decode `/Contents` to TimeStampToken DER bytes, compute `coveredBytes = pdfBytes` minus the contents window.
- [ ] Return array (could be 0, 1, or N if multiple LTAs from refresh).
- [ ] Tests:
  - PDF without doc-ts → `[]`.
  - PDF with one doc-ts → array length 1, byteRange parses, coveredBytes hash matches expected.
  - PDF with two doc-ts (synthesized) → array length 2.

**Verify:** `pnpm --filter @firma-ec/dss-pdf test findDocumentTimestamps` verde.

**Commit:** `feat(dss-pdf): findDocumentTimestamps extractor`.

---

### Task 14 — Implement `appendDocumentTimestamp` (writer + TSA call)

**Files:**
- Create: `packages/dss-pdf/src/appendDocumentTimestamp.ts`
- Create: `packages/dss-pdf/tests/appendDocumentTimestamp.test.ts`

**Steps:**
- [ ] `appendDocumentTimestamp({ pdfBytes, tsaUrl, timeoutMs }): Promise<DocTimestampResult|DocTimestampError>`:
  1. Parse prior xref (factored helper).
  2. Layout: new /Sig dict (DocTimeStamp), new Widget annotation (invisible Rect [0 0 0 0]), updated Catalog + AcroForm + Page0 (per `incrementalUpdate.ts` pattern).
  3. Sig dict body: `<< /Type /DocTimeStamp /Filter /Adobe.PPKLite /SubFilter /ETSI.RFC3161 /ByteRange [0 ******** ******** ********] /Contents <0...0 (8192 bytes hex placeholder)> >>`.
  4. Compute /ByteRange after layout: `[0, contentsStart, contentsEnd, fileLen - contentsEnd]`.
  5. Hash covered bytes (SHA-256). Call `requestTimestamp(imprint, { url: tsaUrl ?? freetsa, timeoutMs })` from `@firma-ec/tsa-client`.
  6. On error: bubble up as `{ ok: false, reason }`. On success: hex-encode token DER, write into /Contents window (zero-pad to 8192 bytes hex = 4096 bytes DER cap; if token > 4096 DER bytes fail with `malformed` — FreeTSA tokens are ~3 KB so margin is comfortable).
  7. Return `{ ok: true, pdfBytes, tsaIssuerCN, signingTime }`.
- [ ] Tests:
  - Mock `requestTimestamp` returning fixture token → output PDF has /DocTimeStamp dict; `findDocumentTimestamps` recovers it; covered bytes hash matches imprint sealed in TSTInfo.
  - Mock TSA timeout → `{ ok: false, reason: 'timeout' }`.
  - Tampering: mutate 1 byte after append → re-`findDocumentTimestamps` → imprint mismatch (test the verifier path will catch this).

**Verify:** `pnpm --filter @firma-ec/dss-pdf test appendDocumentTimestamp` verde.

**Commit:** `feat(dss-pdf): appendDocumentTimestamp writer (B-LTA)`.

---

### Task 15 — End-to-end DSS round-trip test

**Files:**
- Create: `packages/dss-pdf/tests/roundtrip.test.ts`

**Steps:**
- [ ] Test sequence:
  1. Start with fixture B-T PDF.
  2. `appendDss(...)` → B-LT PDF.
  3. `appendDocumentTimestamp(...)` (mocked TSA) → B-LTA PDF.
  4. Verify slice invariants: `bLta.slice(0, bLt.length) === bLt`; `bLt.slice(0, bT.length) === bT`.
  5. `parseDss(bLta)` recovers original DSS data.
  6. `findDocumentTimestamps(bLta)` returns 1 doc-ts.
- [ ] Optional: open output in pdf-lib `PDFDocument.load` to validate xref tables don't break parsers.

**Verify:** `pnpm --filter @firma-ec/dss-pdf test roundtrip` verde.

**Commit:** `test(dss-pdf): full B-T → B-LT → B-LTA round-trip`.

---

## Group F — Signer LT/LTA orchestration

### Task 16 — Extend signer types + errors

**Files:**
- Modify: `packages/signer/src/types.ts`
- Modify: `packages/signer/src/errors.ts`

**Steps:**
- [ ] In `types.ts`: add `LtvOpts` and `LtvMeta` from spec §5.1; extend `SignResult` with `ltv: LtvMeta`.
- [ ] In `errors.ts`: add `'certificate_revoked'` to error code union; export factory `revokedError(cn: string)`.
- [ ] Re-export from `index.ts`.

**Verify:** `pnpm --filter @firma-ec/signer typecheck` verde.

**Commit:** `feat(signer): LtvOpts + LtvMeta types + certificate_revoked error`.

---

### Task 17 — Wire B-LT step in `pades.ts`

**Files:**
- Modify: `packages/signer/src/pades.ts`
- Create: `packages/signer/tests/pades-ltv.test.ts`

**Steps:**
- [ ] After current B-T pipeline produces `bTpdfBytes`, add (per spec §5.2):
  - Extract signature contents from B-T PDF (helper: parse last `/Sig` dict, hex-decode `/Contents`).
  - Call `collectDssData({ signerCert, intermediates, tsaCert, signatureContents, cache, timeoutMs })`.
  - On `revoked: true` → `throw revokedError(revokedCertCN)`.
  - On data with at least 1 OCSP or CRL → `pdfBytes = await appendDss({ pdfBytes: bTpdfBytes, dss: data })`; set `ltvMeta.longTermAchieved = true`.
- [ ] Plumb `LtvOpts` through `signPdfPades` signature; default-on (`opts.ltv?.longTerm !== false`).
- [ ] Tests (mocked `collectDssData`):
  - All-good chain → output is B-LT (parseDss recovers data).
  - Revoked path → throws `SignerError('certificate_revoked')`.
  - No-revocation-data → output stays B-T, warning recorded.
  - LT opt-out (`ltv.longTerm: false`) → output is B-T verbatim.

**Verify:** `pnpm --filter @firma-ec/signer test pades-ltv` verde.

**Commit:** `feat(signer): orchestrate B-LT (DSS append) after B-T`.

---

### Task 18 — Wire B-LTA step in `pades.ts`

**Files:**
- Modify: `packages/signer/src/pades.ts`
- Create: `packages/signer/tests/pades-lta.test.ts`

**Steps:**
- [ ] After successful B-LT step, if `opts.ltv?.longTermArchive !== false`:
  - `dts = await appendDocumentTimestamp({ pdfBytes: bLtPdfBytes, tsaUrl: opts.ltv?.documentTsaUrl ?? opts.tsaUrl, timeoutMs: 8000 })`.
  - `dts.ok` → `pdfBytes = dts.pdfBytes`; `ltvMeta.archiveAchieved = true`; record `documentTimestampTime` + `documentTimestampTsaIssuer`.
  - `!dts.ok` → push warning `lta_doc_ts_<reason>`; output stays at B-LT.
- [ ] Tests (mocked TSA):
  - TSA OK → output is B-LTA; `findDocumentTimestamps(out).length === 1`.
  - TSA timeout → output is B-LT; warning recorded.
  - LTA opt-out + LT on → output is B-LT.

**Verify:** `pnpm --filter @firma-ec/signer test pades-lta` verde.

**Commit:** `feat(signer): orchestrate B-LTA (document timestamp append) after B-LT`.

---

## Group G — Verifier LT

### Task 19 — Refactor existing `verifier/src/ocsp.ts` to shim

**Files:**
- Modify: `packages/verifier/src/ocsp.ts`
- Modify: `packages/verifier/package.json`

**Steps:**
- [ ] Add dep `@firma-ec/ltv-validation`.
- [ ] Replace internal OCSP build/parse with delegation to `ltv-validation.fetchOcsp`. Keep `checkOcsp(cert, issuer): Promise<OcspStatus>` API intact for backward compat.
- [ ] Validate existing tests pass without modifications.

**Verify:** `pnpm --filter @firma-ec/verifier test ocsp` verde sin regresión.

**Commit:** `refactor(verifier): delegate OCSP to @firma-ec/ltv-validation`.

---

### Task 20 — Implement `verifyLtv`

**Files:**
- Create: `packages/verifier/src/ltv.ts`
- Modify: `packages/verifier/src/result.ts`

**Steps:**
- [ ] In `result.ts`: extend `SignatureMeta.profile` to include `'B-LTA'`; add `LtvSummary` interface (spec §6.1); add optional `ltv` field on `SignatureMeta`.
- [ ] Create `verifyLtv(pdfBytes, cms, signerCertChain): Promise<LtvSummary>`:
  1. `parseDss(pdfBytes)` from `@firma-ec/dss-pdf`. If null → return `{ dssPresent: false, embeddedCertCount: 0, embeddedOcspCount: 0, embeddedCrlCount: 0, revocationChecks: [], retrospectiveValid: false }`.
  2. For each cert in chain (skip root):
     - Find embedded OCSP whose `certID` matches issuer/serial → validate sig + chain → add `revocationChecks` entry with `source: 'embedded_ocsp'`.
     - Else find embedded CRL whose issuer matches cert.issuer + serial in revokedCerts.
     - Else live `fetchOcsp` (best-effort, tolerate failure with `not_checked`).
  3. `findDocumentTimestamps(pdfBytes)` → for each, `verifyTimestamp(token, coveredBytes)` (extended F6 helper — see Task 21).
  4. `retrospectiveValid` = every non-root cert has `status === 'good'` from embedded source.
  5. `expiresOn` = min(signerCert.notAfter, max(embedded OCSPs.nextUpdate)).

**Verify:** `pnpm --filter @firma-ec/verifier typecheck` verde.

**Commit:** `feat(verifier): verifyLtv extracts and validates DSS + retrospective check`.

---

### Task 21 — Extend `verifyTimestamp` to accept generic imprint source

**Files:**
- Modify: `packages/verifier/src/timestamp.ts`

**Steps:**
- [ ] Refactor `verifyTimestamp(token, signerSigValue)` → `verifyTimestamp(token, imprintSource: Uint8Array, opts?: { hashAlgo?: 'SHA-256' | 'SHA-384' })`.
- [ ] Caller computes `SHA-256(imprintSource)` and compares against `TSTInfo.messageImprint.hashedMessage`.
- [ ] Existing F6 callers (signature timestamp): pass `cms.signatureValue` (unchanged behavior).
- [ ] New F7 caller (document timestamp): pass `coveredBytes` (entire PDF minus contents window).

**Verify:** existing F6 timestamp tests verde; new doc-ts test in next task.

**Commit:** `refactor(verifier): generalize verifyTimestamp imprint source`.

---

### Task 22 — Wire LTV into `verifier/src/index.ts`

**Files:**
- Modify: `packages/verifier/src/index.ts`
- Create: `packages/verifier/tests/profile-machine.test.ts`

**Steps:**
- [ ] After `tsaResult` and `path` validation, call `const ltvSummary = await verifyLtv(pdfBytes, cms, [cms.signerCert, ...cms.intermediates, ...path.roots])`.
- [ ] Compute profile per spec §6.3 helper:
  ```ts
  function resolveProfile(cmsTimestampValid, ltv): 'B-B'|'B-T'|'B-LT'|'B-LTA' {
    if (ltv?.documentTimestamp?.valid && ltv.dssPresent) return 'B-LTA';
    if (ltv?.dssPresent && ltv.retrospectiveValid)       return 'B-LT';
    if (cmsTimestampValid)                                return 'B-T';
    return 'B-B';
  }
  ```
- [ ] Set `result.signature.ltv = ltvSummary` when `dssPresent || hasDocTs`.
- [ ] Apply status semantics from spec §6.4 (warnings for partial DSS, doc-ts invalid, etc.).
- [ ] Profile-machine test:
  - 4 fixture PDFs (B-B, B-T, B-LT, B-LTA, hand-crafted) → each resolves to its expected profile.

**Verify:** `pnpm --filter @firma-ec/verifier test profile-machine` verde.

**Commit:** `feat(verifier): wire LTV into result + profile state machine`.

---

### Task 23 — Offline / retrospective regression test

**Files:**
- Create: `packages/verifier/tests/ltv-offline.test.ts`
- Create: `packages/verifier/tests/ltv-retrospective.test.ts`

**Steps:**
- [ ] `ltv-offline.test.ts`: load synthesized B-LT PDF; mock `globalThis.fetch` to throw on every call (simulate offline); call `verifyPdf(pdfBytes, { fetchOcsp: false })` → result `status: 'valid'`, `profile: 'B-LT'`, `retrospectiveValid: true`.
- [ ] `ltv-retrospective.test.ts`: synthesize B-LT with embedded OCSP `producedAt: 2024-01-01` (2+ years old). Verify in 2026 → still `'valid'` (decisión #10).

**Verify:** both verde.

**Commit:** `test(verifier): offline + retrospective LTV verification regression`.

---

## Group H — PWA UI

### Task 24 — Settings store + Configuracion.svelte

**Files:**
- Modify: `apps/pwa/src/lib/settings.svelte.ts`
- Modify: `apps/pwa/src/routes/Configuracion.svelte`
- Modify: `apps/pwa/src/lib/i18n.svelte.ts`

**Steps:**
- [ ] Add to settings store: `ltv_enabled: boolean (default true)`, `lta_enabled: boolean (default true)`, `ocsp_url_override: string (default '')`, `document_tsa_url: string (default same as TSA url)`.
- [ ] Persist in `localStorage.firma_ec_settings` (existing pattern).
- [ ] In `Configuracion.svelte`: new section "Validez a largo plazo (avanzado)" with 2 toggles + 2 URL inputs + "Probar OCSP" button (calls `fetchOcsp` if a draft PFX is loaded; otherwise disabled).
- [ ] i18n keys (ES + EN): `settings.ltv.section_title`, `settings.ltv.toggle_lt`, `settings.ltv.toggle_lta`, `settings.ltv.ocsp_url_label`, `settings.ltv.test_ocsp_button`.

**Verify:** Playwright E2E settings.spec.ts updated covers the new toggles persisting on reload.

**Commit:** `feat(pwa): Configuracion → LTV section (toggles + OCSP/TSA URLs + probe button)`.

---

### Task 25 — Sign worker stages + LtvOpts pass-through

**Files:**
- Modify: `apps/pwa/src/lib/workers/sign.worker.ts`
- Modify: `apps/pwa/src/lib/workers/sign.bus.ts`

**Steps:**
- [ ] Extend `SignStage` union with `'fetch_ocsp' | 'fetch_crl' | 'build_dss' | 'document_timestamp'`.
- [ ] Worker reads settings, builds `LtvOpts { longTerm, longTermArchive, ocspUrl, documentTsaUrl, onLtvResult: postProgress }`.
- [ ] Pass `ltv` to `signPdfPades(opts)`.
- [ ] Bus message: `SignWorkerResponse` adds `ltv: LtvMeta`.
- [ ] Progress messages emitted at the start of each stage so the UI shows the descriptive label.

**Verify:** Worker FakeWorker tests (existing pattern) updated to assert new stages fire when `ltv.longTerm: true`.

**Commit:** `feat(pwa): sign worker emits LTV stages + pipes LtvOpts/LtvMeta`.

---

### Task 26 — `Firmar.svelte` UI: progress + 3 badges + revoked error

**Files:**
- Modify: `apps/pwa/src/routes/Firmar.svelte`
- Create: `apps/pwa/src/ui/LtvBadge.svelte`
- Modify: `apps/pwa/src/lib/i18n.svelte.ts`

**Steps:**
- [ ] In progress UI, show stage labels for `fetch_ocsp`, `fetch_crl`, `build_dss`, `document_timestamp`.
- [ ] On `runSign()` returning `error.code === 'certificate_revoked'`: render fatal-error step with title "Tu certificado está revocado", body explaining what revocation means, CTA "Renovar certificado" linking to ECI ARCOTEL portal.
- [ ] On success: render badges based on `result.timestamp.badge`, `result.ltv.longTermAchieved`, `result.ltv.archiveAchieved`. `LtvBadge.svelte` props: `tier: 'gold' | 'teal' | 'emerald'`, `label`, `subtitle`. Stack vertically with `gap: var(--space-2)`.
- [ ] i18n keys: `firmar.badge.lta`, `firmar.badge.lt`, `firmar.badge.tsa`, `firmar.error.revoked.title`, `firmar.error.revoked.body`, `firmar.error.revoked.cta`.

**Verify:** Storybook (or manual): badge tier matrix renders correctly. Playwright `ltv.spec.ts` golden path covers B-LTA badge stack.

**Commit:** `feat(pwa): Firmar wizard — LTV progress, 3-badge stack, revoked fatal error`.

---

### Task 27 — `Verificar.svelte` UI: DSS detail panel + profile-aware copy

**Files:**
- Modify: `apps/pwa/src/routes/Verificar.svelte`
- Modify: `apps/pwa/src/routes/DownloadResult.svelte`
- Create: `apps/pwa/src/ui/LtvDetailCard.svelte`

**Steps:**
- [ ] `LtvDetailCard.svelte` renders the panel from spec §7.3: profile badge, embedded counts, doc-ts info, retrospective status, expiresOn projection, per-cert revocation status with source badge ("OCSP embebido", "CRL embebida", "OCSP en vivo", etc.).
- [ ] In `Verificar.svelte`: render `<LtvDetailCard>` only if `result.signature?.ltv?.dssPresent`.
- [ ] In `DownloadResult.svelte` and any post-sign success copy: profile-conditional copy per spec §7.4.
- [ ] Tooltip on "Verificable hasta": i18n.

**Verify:** Playwright `ltv.spec.ts` step "verify B-LTA result" assertions on copy + counts visible.

**Commit:** `feat(pwa): Verificar — DSS detail panel + profile-aware success copy`.

---

### Task 28 — Caddyfile.pwa CSP update

**Files:**
- Modify: `infra/docker/Caddyfile.pwa`

**Steps:**
- [ ] Backup current `Caddyfile.pwa` to `_backups/F7-csp-2026-05-10/`.
- [ ] Update `connect-src` directive to allow:
  - `https://freetsa.org` (existing F6).
  - `https://r3.o.lencr.org https://r10.o.lencr.org` (LE OCSP — for testing/E2E).
  - ARCOTEL ECI hosts: `http://ocsp.eci.bce.ec http://crl.eci.bce.ec` (HTTP plano por estándar OCSP).
  - User-defined OCSP URL: documentar limitación (CSP estática no permite wildcard arbitrario; user-overrides solo funcionan si el dominio está pre-listado o se sirve la app via Caddy con dynamic CSP — out of scope F7, document).
- [ ] Validate Caddy config: `docker exec caddy caddy validate --config /etc/caddy/Caddyfile`.
- [ ] Reload: `docker exec caddy caddy reload --config /etc/caddy/Caddyfile`.

**Verify:** Mozilla Observatory rerun: A+ score sostenido. `securityheaders.com` A+. Live `/firmar` makes successful OCSP fetch (network tab) with no CSP violations in console.

**Commit:** `infra(pwa): CSP connect-src — OCSP/CRL ECI Ecuador + LE responders for LTV`.

---

## Group I — End-to-end + cross-validation

### Task 29 — Playwright E2E: golden, offline, revoked

**Files:**
- Create: `apps/pwa/tests-e2e/ltv.spec.ts`
- Create: `apps/pwa/tests-e2e/ltv-offline.spec.ts`
- Create: `apps/pwa/tests-e2e/ltv-revoked.spec.ts`

**Steps:**
- [ ] `ltv.spec.ts` (golden path):
  - MSW intercept OCSP/TSA fetches with `good` + valid TS responses.
  - Sign sample PDF with default settings (LT + LTA on).
  - Assert progress stages fire in order: `fetch_ocsp → build_dss → document_timestamp`.
  - Assert 3 badges render (TSA gold + LT teal + LTA emerald).
  - Download PDF, re-upload to `/verificar`, assert `profile: 'B-LTA'` panel visible with embedded counts > 0.
- [ ] `ltv-offline.spec.ts`:
  - Sign a PDF online (full B-LTA).
  - Set browser to `context.setOffline(true)`.
  - Re-upload to `/verificar`, assert `profile: 'B-LTA'`, `retrospectiveValid: true`, no live fetch made (intercept proves zero outbound).
- [ ] `ltv-revoked.spec.ts`:
  - MSW intercept OCSP returning `revoked`.
  - Attempt sign → wizard shows fatal error step with CTA, no PDF emitted.
- [ ] Mobile viewports: iPhone 13 + Pixel 5 — repeat golden path.

**Verify:** All E2E green in CI.

**Commit:** `test(pwa): E2E LTV golden + offline + revoked paths (mobile + desktop)`.

---

### Task 30 — Adobe Reader DC cross-validation

**Files:**
- Create: `docs/reports/F7-cross-validation-2026-05-10/README.md`
- Create: `docs/reports/F7-cross-validation-2026-05-10/blt-acrobat.png`
- Create: `docs/reports/F7-cross-validation-2026-05-10/blta-acrobat.png`

**Steps:**
- [ ] Sign a real test PDF in https://app.firmar.ec with a real PFX (ArgosData test cert), LT + LTA on.
- [ ] Open output in Adobe Acrobat Reader DC (Windows).
- [ ] Capture "Signature Properties" → "Show Signer's Certificate" → tab "Long-Term Validation" / "Document Integrity Properties".
- [ ] Document expected indicators:
  - B-LT: "The signature includes embedded revocation information" (or local equivalent).
  - B-LTA: "Document is timestamped" (gold seal icon top-bar).
- [ ] Save screenshots.

**Verify:** Adobe Reader recognizes B-LT and B-LTA correctly. If Adobe complains about chain (e.g., trust anchor not in Adobe AATL), document the limitation in the report — it's expected for ECI Ecuador certs not in Adobe AATL.

**Commit:** `docs(reports): F7 Adobe Reader DC cross-validation B-LT + B-LTA`.

---

## Group J — Docs + version bump + release

### Task 31 — Transparency report + threat-model docs

**Files:**
- Modify: `docs/transparency-report.md`
- Modify: `apps/pwa/src/routes/Seguridad.svelte`

**Steps:**
- [ ] In transparency report: append section "F7 LTV — DSS, OCSP, CRL, document timestamp, threat model" summarizing spec §9 + §10.
- [ ] In `Seguridad.svelte`: add user-facing privacy section per spec §9.1 ("Validación a largo plazo"), with toggle reminder.

**Verify:** Lighthouse `/seguridad` ≥95.

**Commit:** `docs: F7 LTV transparency report + Seguridad page updates`.

---

### Task 32 — CHANGELOG + version bump

**Files:**
- Modify: root `CHANGELOG.md`
- Modify: `apps/pwa/package.json` (version → `0.7.0-rc1`)
- Modify: `packages/verifier/src/index.ts` (`ENGINE_VERSION = '0.7.0-rc1'`)
- Modify: each package `package.json` to `0.7.0-rc1` if previously rc8

**Steps:**
- [ ] CHANGELOG entry:
  ```
  ## v0.7.0-rc1 — 2026-05-10 — F7 LTV (B-LT + B-LTA)

  Added:
  - PAdES B-LT (Long-Term Validation) — DSS dictionary embebida con cadena cert + OCSP/CRL.
  - PAdES B-LTA (Long-Term Archive) — document timestamp RFC 3161 sobre PDF + DSS.
  - 2 nuevos paquetes: @firma-ec/ltv-validation, @firma-ec/dss-pdf.
  - Verifier: profile state machine 'B-B'|'B-T'|'B-LT'|'B-LTA', retrospective validation usando datos embebidos.
  - PWA: 4 nuevos progress stages, 3-badge stack (sello/LT/LTA), Settings con toggles LT/LTA, Verificar con panel DSS detail.

  Changed:
  - verifier: ENGINE_VERSION 0.5.x → 0.7.0-rc1.
  - signer: pades.ts orchestrates B-T → B-LT → B-LTA cascada.
  - infra: Caddyfile.pwa CSP connect-src añade hosts OCSP/CRL ECI Ecuador.

  Security:
  - Cert revocado bloquea sign con SignerError('certificate_revoked').
  - DSS embebida = verificación offline 5/10/20 años en el futuro.
  - Threat model addendum: 10 nuevos vectores documentados (mirror, replay, privacy, downgrade, CRL bomb, etc.).
  ```
- [ ] Bump `apps/pwa/package.json`, all `packages/*/package.json` que se modifican o son nuevos.
- [ ] Update `ENGINE_VERSION` constant.

**Verify:** `pnpm -r typecheck` y `pnpm -r test` verde global.

**Commit:** `chore(release): bump v0.7.0-rc1 — F7 LTV milestone`.

---

### Task 33 — Bundle size + Lighthouse + a11y gates

**Files:**
- Run only.

**Steps:**
- [ ] `pnpm --filter pwa build` → verify `/firmar` lazy chunk delta vs v0.6.x baseline ≤25 KB gz. Use `du -b dist/assets/firmar-*.js | gzip -c | wc -c` script.
- [ ] Lighthouse CI: `/firmar` ≥95, `/verificar` ≥95.
- [ ] axe-core 0 violations on Firmar + Verificar + Configuracion + Seguridad.
- [ ] Mozilla Observatory + securityheaders.com A+ post-deploy (after Caddyfile reload from Task 28).

**Verify:** All gates green. If chunk size exceeds 25 KB → investigate (probable: pkijs OCSPRequest tree-shaking failure → add `sideEffects: false` to package.json).

**Commit:** `perf(pwa): verify F7 bundle/Lighthouse/a11y gates green`.

---

### Task 34 — Tag, sign, push, mirrors verify

**Files:**
- Run only.

**Steps:**
- [ ] After all groups verde: `git tag -a v0.7.0-rc1 -m "F7 LTV milestone — B-LT + B-LTA"`.
- [ ] Cosign sign tag: `cosign sign --key cosign.key v0.7.0-rc1` (existing F6 pattern).
- [ ] SBOM CycloneDX: `pnpm sbom > sbom-v0.7.0-rc1.cdx.json`. SLSA L3 provenance via existing GH Actions release workflow.
- [ ] Push tag to all 3 remotes:
  ```sh
  git push origin v0.7.0-rc1   # multi-push: gitea + 2 GitHub mirrors
  ```
- [ ] Verify SHAs converge:
  ```sh
  git ls-remote https://git.idkmanager.com/alfonso/firma-ec.git refs/tags/v0.7.0-rc1
  git ls-remote https://github.com/alfonsokuen/firma-ec.git refs/tags/v0.7.0-rc1
  git ls-remote https://github.com/idkmanager/firma-ec.git refs/tags/v0.7.0-rc1
  ```
  Los 3 SHAs MUST match.

**Verify:** Tag visible en las 3 forjas; cosign signature verificable.

**Commit:** `release: tag v0.7.0-rc1 — F7 LTV (cosign + SBOM + SLSA L3)`.

---

### Task 35 — Memoria F7 closure + handoff doc

**Files:**
- Create: `~/.claude/projects/c--Users-alfon-Nextcloud-Documentos-Claude-md/memory/project_firma_ec_F7_LTV_complete_2026-05-10.md`
- (optional) Create: `firma-ec/HANDOFF_F7_2026-05-10.md`

**Steps:**
- [ ] Memory entry:
  ```
  # firma.ec F7 LTV (B-LT + B-LTA) closure 2026-05-10

  Tag: v0.7.0-rc1
  Live: https://app.firmar.ec
  Profile: B-LTA default-on para toda firma con datos de revocación disponibles.
  Packages new: @firma-ec/ltv-validation, @firma-ec/dss-pdf.

  Key gotchas:
  - SHA-1 CertID required by ARCOTEL ECI OCSP responders (decisión #15 spec).
  - Adobe Reader DC valida B-LT/B-LTA pero puede fallar trust anchor si ECI no está en AATL.
  - CSP connect-src debe permitir http (no https) para responders ECI Ecuador.
  - DSS append preserva slice 1 byte-perfect — invariante crítica para multi-firma futura.
  - Cert revocado BLOQUEA sign (única excepción a "siempre fallback").

  Out-of-scope (entradas para próximas fases):
  - F7.5 — refresh periódico DSS (renovar validación).
  - F7.6 — multi-OCSP redundancia.
  - F7.7 — stapled OCSP en signedAttrs.
  - F8 — QES eIDAS / firma cualificada ARCOTEL.
  ```
- [ ] Update `MEMORY.md` index.

**Verify:** memory archivo creado y MEMORY.md actualizado.

**Commit:** `docs: memoria F7 LTV closure + MEMORY.md index update`.

---

## Self-review (post-write)

- **Task count**: 35 tasks across 10 groups (A Foundation, B OCSP, C CRL, D DSS data, E DSS PDF, F Signer, G Verifier, H PWA, I E2E + cross-val, J Release). ✅
- **Bite-sized steps**: cada task tiene ≤8 sub-steps ejecutables; código sample inline donde reduce ambigüedad. ✅
- **Verification gates**: cada task lista comando exacto (`pnpm --filter ... test ...`) y expected output. ✅
- **Commit messages**: Conventional Commits (feat/refactor/test/docs/chore/infra/perf/release). ✅
- **Spec coverage**: las 15 decisiones del spec aparecen en tasks concretos (decisión #4 revoked → Tasks 16/17/26/29; #9 cache → Task 7; #10 retrospective → Task 23; #15 SHA-1 → Task 5). ✅
- **Backward compat**: Task 19 (refactor ocsp.ts → shim) preserva API existente; Task 20-22 añaden sin remover; Task 23 (retrospective) cubre regresión legacy. ✅
- **Risk hot-spots flagged**: Task 28 CSP (Caddy reload riesgoso → backup obligatorio); Task 17/18 (signer pades.ts es archivo crítico productivo → backup); Task 33 (bundle size posible miss → tree-shaking troubleshoot inline). ✅
- **F6 reuse explícito**: Tasks 14, 21 reusan `@firma-ec/tsa-client` y `verifyTimestamp` sin fork. ✅
- **Acceptance criteria mapping**: cada acceptance #1-#20 del spec §12 cae en al menos una task (acceptance #1 → Tasks 4-10; #5/#6 Adobe → Task 30; #8 offline crítico → Task 23+29; #9 revoked → Task 17+29; #10 bundle → Task 33; #14 CSP → Task 28; #19 cosign tag → Task 34). ✅
- **Time-box realism**: 35 tasks × ~30-90 min cada uno = ~25-50 horas trabajo concentrado. Realista para 2-3 días de subagent-driven-development con review checkpoints cada grupo. ✅

---

**Fin del plan F7 — listo para `executing-plans` o `subagent-driven-development`.**
