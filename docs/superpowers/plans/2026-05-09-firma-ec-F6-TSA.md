# F6 TSA (PAdES B-T) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` para implementar este plan task-by-task. Cada step usa checkbox (`- [ ]`) para tracking. Tasks dentro de un mismo grupo (Foundation, TSA client, etc.) son secuenciales; los grupos son secuenciales entre sí. Donde haya paralelizable se anota.

**Goal:** Elevar las firmas de la PWA de **PAdES B-B** a **PAdES B-T** añadiendo un RFC 3161 `TimeStampToken` en `unsignedAttrs.id-aa-signatureTimeStampToken` (OID `1.2.840.113549.1.9.16.2.14`). TSA por defecto: **FreeTSA público**. Default-on. Fallback graceful a B-B si la TSA falla. Verificador acepta ambos niveles, muestra badge dorado cuando el sello es válido. Entregable: tag `v0.5.0-rc1` con cross-validation Adobe Reader.

**Architecture:** Dos paquetes nuevos — `packages/tsa-client` (cliente RFC 3161 puro: build TimeStampReq, fetch, parse TimeStampResp, verify imprint+nonce) y `packages/tsa-trust` (trust roots TSA: FreeTSA root cert PEM embebido + slot ARCOTEL placeholder). Cambios en `packages/signer/src/cms.ts` (extiende `BuildCmsOpts` con `timestamp?`, `tsaUrl?`, `onTimestampResult?`; tras computar `signatureRaw` solicita sello y attach como `unsignedAttrs`). Cambios en `packages/verifier/src/timestamp.ts` (NEW — parsea token, valida imprint match, valida cadena TSA, devuelve `TimestampVerification` con badge gold/silver/none) wired en `index.ts`. PWA: nuevo stage `request_timestamp` en wizard, toast no-bloqueante en step 7, badge dorado en `/verificar`, página Settings con toggle + URL TSA + botón "Probar TSA".

**Tech Stack:** Continuidad F3 (Svelte 5 runes, Vite 6, UnoCSS, pkijs 3, asn1js 3, Vitest 2, fast-check 3, Playwright, Biome 2). Sin nuevas deps externas — `pkijs.TimeStampReq` y `pkijs.TimeStampResp` ya están en pkijs ≥3.2 (verificar lockfile).

**Spec reference:** `docs/superpowers/specs/2026-05-09-firma-ec-F6-TSA-design.md` (decisiones 1-10, arquitectura §2, paquetes nuevos §3-4, CMS integration §5, verifier §6, UI §7, threats §8, out-of-scope §9, acceptance §10).

**F3-F5 prerequisites met (no re-hacer):**
- `packages/signer` LIVE en https://app.firmar.ec, B-B funcional con `.p12` real ArgosData/BCE.
- `packages/verifier` extrae `cms.timestampToken: Uint8Array | undefined` (líneas 20, 112-120 de `verifier/src/cms.ts`) y rutea `profile: 'B-T' | 'B-B'` (línea 113 de `verifier/src/index.ts`). Solo falta wiring de validación.
- F3-v0.4.4 fix de `encodedValue empty on build` (cms.ts líneas 138-148) — patrón a reusar para unsignedAttrs si aplica patch.
- Worker pattern `apps/pwa/src/lib/workers/{sign.worker.ts, sign.bus.ts}` con FakeWorker tests.
- Caddyfile.pwa CSP A+ — F6 añade `connect-src https://freetsa.org` y validación URL TSA configurada.
- Cosign + SLSA L3 + SBOM CycloneDX en CI release.

**QA-Verify discipline:** RESPALDO antes de Caddyfile / stack-deploy / cms.ts (archivo crítico productivo); verificación multi-capa (lint Biome + `pnpm -r typecheck` + unit + Playwright + Lighthouse `/firmar` ≥95 + Mozilla Observatory A+ + axe-core 0); push a Gitea solo con confirmación explícita usuario; registro en memoria al cierre F6.

---

## File Structure (decomposed)

```
firma-ec/
├── packages/
│   ├── tsa-client/                              NEW
│   │   ├── package.json                         NEW
│   │   ├── tsconfig.json                        NEW
│   │   ├── vitest.config.ts                     NEW
│   │   └── src/
│   │       ├── index.ts                         NEW   # public API
│   │       ├── types.ts                         NEW   # TimestampResult, opts
│   │       ├── request.ts                       NEW   # build TimeStampReq + fetch
│   │       ├── response.ts                      NEW   # parse TimeStampResp + verify
│   │       └── parseToken.ts                    NEW   # parse standalone token (verifier reuse)
│   │   └── tests/
│   │       ├── request.test.ts                  NEW
│   │       ├── response.test.ts                 NEW
│   │       ├── parseToken.test.ts               NEW
│   │       ├── property.test.ts                 NEW   # fast-check
│   │       └── __fixtures__/
│   │           ├── freetsa-kat-2026-05-09.tsq   NEW   # captured request DER
│   │           └── freetsa-kat-2026-05-09.tsr   NEW   # captured response DER
│   │
│   ├── tsa-trust/                               NEW
│   │   ├── package.json                         NEW
│   │   ├── tsconfig.json                        NEW
│   │   ├── vitest.config.ts                     NEW
│   │   └── src/
│   │       ├── index.ts                         NEW   # getTsaTrustRoots, findTsaRootByIssuer
│   │       ├── roots/
│   │       │   ├── freetsa.pem                  NEW   # https://freetsa.org/files/cacert.pem
│   │       │   └── arcotel-placeholder.pem      NEW   # self-signed stub
│   │       └── manifest.ts                      NEW   # TsaTrustRoot[] config
│   │   └── tests/
│   │       └── trust.test.ts                    NEW
│   │
│   ├── signer/
│   │   ├── package.json                         MODIFY: add @firma-ec/tsa-client
│   │   └── src/
│   │       ├── cms.ts                           MODIFY: timestamp + unsignedAttrs
│   │       ├── pades.ts                         MODIFY: pass timestamp opts + propagate result
│   │       └── types.ts                         MODIFY: TimestampMeta + SignResult
│   │   └── tests/
│   │       ├── cms-timestamp.test.ts            NEW
│   │       └── pades-timestamp.test.ts          NEW
│   │
│   └── verifier/
│       ├── package.json                         MODIFY: add @firma-ec/tsa-client + tsa-trust
│       └── src/
│           ├── timestamp.ts                     NEW   # verifyTimestamp
│           ├── index.ts                         MODIFY: wire timestamp into result
│           ├── result.ts                        MODIFY: SignatureMeta.timestamp shape
│           └── pathValidation.ts                MODIFY: optional EKU id-kp-timeStamping check
│       └── tests/
│           └── timestamp.test.ts                NEW
│
├── apps/pwa/
│   ├── package.json                             MODIFY: add @firma-ec/tsa-client (for Settings probe)
│   ├── src/
│   │   ├── App.svelte                           MODIFY: add /configuracion route
│   │   ├── lib/
│   │   │   ├── i18n.svelte.ts                   MODIFY: F6 keys
│   │   │   ├── settings.svelte.ts               NEW   # localStorage settings store
│   │   │   └── workers/
│   │   │       ├── sign.worker.ts               MODIFY: add 'request_timestamp' stage + pass tsaUrl
│   │   │       └── sign.bus.ts                  MODIFY: SignWorkerResponse adds timestamp result
│   │   ├── routes/
│   │   │   ├── Firmar.svelte                    MODIFY: progress + result toast
│   │   │   ├── Verificar.svelte                 MODIFY: gold/silver badge card
│   │   │   └── Configuracion.svelte             NEW   # Settings UI
│   │   └── ui/
│   │       └── TimestampBadge.svelte            NEW
│   └── tests-e2e/
│       ├── timestamp.spec.ts                    NEW
│       └── settings.spec.ts                     NEW
│
└── infra/docker/
    └── Caddyfile.pwa                            MODIFY: connect-src https://freetsa.org
```

---

## Pre-conditions

- [ ] F3 LIVE en https://app.firmar.ec (B-B funcional con `.p12` ArgosData verificado).
- [ ] `pnpm install` limpio en root.
- [ ] Tag actual ≥`v0.4.5-stable` en Gitea + 2 GH mirrors (F4 closure).
- [ ] Branch `main` limpio (commits del spec F6 ya presentes).
- [ ] Acceso de red a `https://freetsa.org/tsr` desde la máquina dev (curl smoke OK).

---

## Group A — Foundation: bootstrap `packages/tsa-client` + `packages/tsa-trust`

### Task 1 — Bootstrap `packages/tsa-client`

**Files:**
- Create: `packages/tsa-client/package.json`
- Create: `packages/tsa-client/tsconfig.json`
- Create: `packages/tsa-client/vitest.config.ts`
- Create: `packages/tsa-client/src/index.ts` (placeholder)
- Create: `packages/tsa-client/src/types.ts`

**Steps:**
- [ ] Crear `packages/tsa-client/package.json`:
  ```json
  {
    "name": "@firma-ec/tsa-client",
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
      "asn1js": "^3.0.6",
      "pkijs": "^3.2.5"
    },
    "devDependencies": {
      "fast-check": "^3.23.2",
      "vitest": "^2.1.8"
    }
  }
  ```
- [ ] Crear `tsconfig.json` heredando de `tsconfig.base.json` (mismo patrón que verifier/signer).
- [ ] Crear `src/types.ts` con interfaces declaradas en spec §3.1 (`TimestampOk`, `TimestampError`, `TimestampResult`, `RequestTimestampOpts`, `ParsedTimestampToken`, `HashAlgo`).
- [ ] Crear `src/index.ts` con stub `export async function requestTimestamp(): Promise<TimestampResult> { throw new Error('not implemented'); }` + re-exports de `types.ts` y `parseToken.ts` (stub).
- [ ] `pnpm install` desde root.
- [ ] `pnpm --filter @firma-ec/tsa-client typecheck` verde.

**Verify:** `pnpm --filter @firma-ec/tsa-client test` (suite vacía OK).

**Commit:** `chore(tsa-client): bootstrap package skeleton`.

---

### Task 2 — Bootstrap `packages/tsa-trust` + FreeTSA root PEM

**Files:**
- Create: `packages/tsa-trust/package.json`
- Create: `packages/tsa-trust/tsconfig.json`
- Create: `packages/tsa-trust/vitest.config.ts`
- Create: `packages/tsa-trust/src/index.ts`
- Create: `packages/tsa-trust/src/manifest.ts`
- Create: `packages/tsa-trust/src/roots/freetsa.pem` (downloaded from https://freetsa.org/files/cacert.pem)
- Create: `packages/tsa-trust/src/roots/arcotel-placeholder.pem` (self-signed via openssl)

**Steps:**
- [ ] Descargar FreeTSA root: `curl -fsSL https://freetsa.org/files/cacert.pem -o packages/tsa-trust/src/roots/freetsa.pem`. Verificar SHA-256 anotándolo en `manifest.ts`.
- [ ] Generar placeholder self-signed:
  ```sh
  openssl req -x509 -newkey rsa:2048 -days 3650 -nodes -keyout /tmp/arcotel-ph.key \
    -out packages/tsa-trust/src/roots/arcotel-placeholder.pem \
    -subj "/CN=ARCOTEL TSA (placeholder)/O=firma-ec/C=EC"
  rm /tmp/arcotel-ph.key
  ```
- [ ] `package.json` (similar a tsa-client, deps: `asn1js`, `pkijs`, `@firma-ec/crypto-core` workspace).
- [ ] `src/manifest.ts`:
  ```ts
  export const TSA_TRUST_MANIFEST: ReadonlyArray<{
    slug: string; commonName: string; tsaUrlHints: string[]; pemPath: string; isPlaceholder: boolean;
  }> = [
    { slug: 'freetsa', commonName: 'FreeTSA Root CA', tsaUrlHints: ['https://freetsa.org/tsr'],
      pemPath: './roots/freetsa.pem', isPlaceholder: false },
    { slug: 'arcotel-placeholder', commonName: 'ARCOTEL TSA (placeholder)', tsaUrlHints: [],
      pemPath: './roots/arcotel-placeholder.pem', isPlaceholder: true },
  ];
  ```
- [ ] `src/index.ts`: implementar `getTsaTrustRoots()` que:
  - Lee cada PEM via `import { readFileSync }` (Node) **O** `import.meta.glob` (Vite) según runtime — usar pattern dual: en tests Node, en bundle Vite usar `?raw` import. Decisión: usar **inline string constants** generadas al build (script `tools/embed-tsa-roots.ts` que lee los `.pem` y los inyecta en `manifest.ts`). Más simple, sin runtime IO.
- [ ] Crear `tools/embed-tsa-roots.ts` que escribe `src/manifest-embedded.ts` con strings PEM literales. Añadir al `prepare` script: `pnpm --filter @firma-ec/tsa-trust prepare`.
- [ ] `findTsaRootByIssuer(issuerDn)`: parsea cada cert, compara `subject` con `issuerDn` (Distinguished Name comparison via pkijs `Certificate.subject.isEqual`).

**Verify:** `pnpm --filter @firma-ec/tsa-trust test` (suite vacía + smoke `getTsaTrustRoots()` retorna 2 roots).

**Commit:** `chore(tsa-trust): bootstrap with FreeTSA root + ARCOTEL placeholder`.

---

## Group B — TSA client implementation

### Task 3 — `request.ts` — build TimeStampReq + fetch

**Files:**
- Create: `packages/tsa-client/src/request.ts`

**Steps:**
- [ ] Implementar helper `buildTimeStampReq(imprint: Uint8Array, hashAlgo: HashAlgo, nonce: Uint8Array): Uint8Array`:
  ```ts
  import * as pkijs from 'pkijs';
  import * as asn1js from 'asn1js';

  const HASH_OID: Record<HashAlgo, string> = {
    'SHA-256': '2.16.840.1.101.3.4.2.1',
    'SHA-384': '2.16.840.1.101.3.4.2.2',
  };

  export function buildTimeStampReq(imprint, hashAlgo, nonce) {
    const tsq = new pkijs.TimeStampReq({
      version: 1,
      messageImprint: new pkijs.MessageImprint({
        hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: HASH_OID[hashAlgo] }),
        hashedMessage: new asn1js.OctetString({ valueHex: imprint.buffer }),
      }),
      nonce: new asn1js.Integer({ valueHex: nonce.buffer }),
      certReq: true,
    });
    return new Uint8Array(tsq.toSchema().toBER(false));
  }
  ```
- [ ] Implementar `postTimeStampReq(url: string, tsqDer: Uint8Array, signal: AbortSignal): Promise<Uint8Array>`:
  - `fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/timestamp-query', 'Accept': 'application/timestamp-reply' }, body: tsqDer, signal })`.
  - Si HTTP 429 → throw `Object.assign(new Error('rate_limited'), { code: 'rate_limited' })`.
  - Si !ok → throw with code `'network'` and `detail: ${status} ${statusText}`.
  - Si `Content-Length > 32768` o `arrayBuffer().byteLength > 32768` → throw `'malformed', detail: 'response too large'`.
  - Return `new Uint8Array(await resp.arrayBuffer())`.

**Verify:** Typecheck OK; tests en Task 6.

**Commit:** `feat(tsa-client): build + post TimeStampReq`.

---

### Task 4 — `response.ts` — parse + validate TimeStampResp

**Files:**
- Create: `packages/tsa-client/src/response.ts`

**Steps:**
- [ ] Implementar `parseTimeStampResp(tsrDer: Uint8Array): { token: Uint8Array; statusOk: boolean; statusString?: string }`:
  - `asn1js.fromBER(tsrDer)`. Si `offset === -1` → throw `'malformed'`.
  - `new pkijs.TimeStampResp({ schema: parsed.result })`.
  - `resp.status.status` (0=granted, 1=grantedWithMods, others=fail).
  - Si `resp.timeStampToken` ausente y status > 1 → throw `'rejected', detail: status.statusString.join('; ')`.
  - `token = new Uint8Array(resp.timeStampToken!.toSchema().toBER(false))`.
- [ ] Implementar `verifyResponseAgainstRequest(token, expectedImprint, expectedNonce): { ok: true } | { ok: false, reason: string }`:
  - Parse token → TSTInfo (eContent del SignedData inside ContentInfo).
  - Compare `tstInfo.messageImprint.hashedMessage` (OctetString valueHex) con `expectedImprint` byte-a-byte.
  - Compare `tstInfo.nonce.valueBlock.valueHex` con `expectedNonce` byte-a-byte (only if request had nonce).
  - Si mismatch → `{ ok: false, reason: 'imprint_mismatch' | 'nonce_mismatch' }`.

**Verify:** Tests en Task 6.

**Commit:** `feat(tsa-client): parse + validate TimeStampResp`.

---

### Task 5 — `parseToken.ts` — standalone token parser (verifier reuse)

**Files:**
- Create: `packages/tsa-client/src/parseToken.ts`

**Steps:**
- [ ] Implementar `parseTimestampToken(token: Uint8Array): ParsedTimestampToken`:
  - `asn1js.fromBER(token.buffer)` → `pkijs.ContentInfo`.
  - Verify `contentType === '1.2.840.113549.1.7.2'` (signedData).
  - `signedData = new pkijs.SignedData({ schema: contentInfo.content })`.
  - `eContent = signedData.encapContentInfo.eContent` → DER bytes.
  - Verify `eContentType === '1.2.840.113549.1.9.16.1.4'` (id-ct-TSTInfo).
  - Parse TSTInfo schema (manual asn1js — pkijs no expone TSTInfo class directamente; usar SEQUENCE manualmente).
  - Extract: `version, policyOID, messageImprint{hashAlgo, hashedMessage}, serialNumber, genTime, [accuracy], [ordering], [nonce], [tsa], [extensions]`.
  - Extract TSA cert(s) from `signedData.certificates` → DER bytes.
  - Extract inner SignerInfo: `signedAttrsDer` (rebuild via `toSchema().toBER(false)` + 0xa0→0x31 patch — mismo trap F3 v0.4.4), `signatureValue`, `digestAlgoOid`, `signatureAlgoOid`.
  - Return `ParsedTimestampToken`.

**Verify:** Tests en Task 6 sobre fixture `freetsa-kat-2026-05-09.tsr`.

**Commit:** `feat(tsa-client): standalone token parser for verifier reuse`.

---

### Task 6 — Tests + KAT capture

**Files:**
- Create: `packages/tsa-client/tests/__fixtures__/freetsa-kat-2026-05-09.tsq`
- Create: `packages/tsa-client/tests/__fixtures__/freetsa-kat-2026-05-09.tsr`
- Create: `packages/tsa-client/tests/request.test.ts`
- Create: `packages/tsa-client/tests/response.test.ts`
- Create: `packages/tsa-client/tests/parseToken.test.ts`
- Create: `packages/tsa-client/tests/property.test.ts`

**Steps:**
- [ ] **Capture KAT (one-time)**: script `tools/capture-tsa-kat.ts` que:
  ```ts
  const imprint = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('firma-ec-F6-test-vector'));
  const tsq = buildTimeStampReq(new Uint8Array(imprint), 'SHA-256', new Uint8Array([1,2,3,4,5,6,7,8]));
  await writeFile('packages/tsa-client/tests/__fixtures__/freetsa-kat-2026-05-09.tsq', tsq);
  const tsr = await postTimeStampReq('https://freetsa.org/tsr', tsq, AbortSignal.timeout(10000));
  await writeFile('packages/tsa-client/tests/__fixtures__/freetsa-kat-2026-05-09.tsr', tsr);
  ```
- [ ] Ejecutar capture-tsa-kat una sola vez. Commit los binarios a `__fixtures__/`.
- [ ] `request.test.ts`:
  - `buildTimeStampReq(imprint, 'SHA-256', nonce)` produce DER que parsea con `pkijs.TimeStampReq`.
  - Round-trip: parse el output → `messageImprint.hashedMessage` byte-equal a input.
  - Mock `fetch` returning 429 → `postTimeStampReq` throws con `code: 'rate_limited'`.
  - Mock fetch 200 + body 64KB → throws `code: 'malformed', detail: 'response too large'`.
- [ ] `response.test.ts`:
  - `parseTimeStampResp(fixture.tsr)` → `statusOk: true, token: Uint8Array(>0)`.
  - Manualmente flip 1 byte del status field en una copia → `statusOk: false`.
  - `verifyResponseAgainstRequest(token, correctImprint, correctNonce)` → `ok: true`.
  - Imprint flipped → `ok: false, reason: 'imprint_mismatch'`.
  - Nonce flipped → `ok: false, reason: 'nonce_mismatch'`.
- [ ] `parseToken.test.ts`:
  - Parse fixture token → `signingTime` is Date, `tsaCertDers.length >= 1`, `imprint` length 32 bytes.
- [ ] `property.test.ts` (fast-check):
  - `fc.uint8Array({ minLength: 32, maxLength: 32 })` como imprint random + mocked fetch returning fixture.tsr (cuyo imprint es fijo) → siempre `{ error: 'malformed', detail: 'imprint mismatch' }` en `requestTimestamp`.

**Verify:** `pnpm --filter @firma-ec/tsa-client test` verde (todos los suites).

**Commit:** `test(tsa-client): KAT vector + unit + property tests`.

---

### Task 7 — `requestTimestamp` orchestration

**Files:**
- Modify: `packages/tsa-client/src/index.ts`

**Steps:**
- [ ] Implementar `requestTimestamp(messageImprint, opts?)`:
  ```ts
  export async function requestTimestamp(messageImprint, opts = {}) {
    const url = opts.url ?? 'https://freetsa.org/tsr';
    const timeoutMs = opts.timeoutMs ?? 8000;
    const hashAlgo = opts.hashAlgo ?? 'SHA-256';
    const nonce = crypto.getRandomValues(new Uint8Array(8));
    const signal = opts.signal ?? AbortSignal.timeout(timeoutMs);
    const tsqDer = buildTimeStampReq(messageImprint, hashAlgo, nonce);
    let tsrDer: Uint8Array;
    try {
      tsrDer = await postTimeStampReq(url, tsqDer, signal);
    } catch (e: any) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return { error: 'timeout' };
      if (e?.code === 'rate_limited') return { error: 'rate_limited' };
      if (e?.code === 'malformed') return { error: 'malformed', detail: e.detail };
      return { error: 'network', detail: e?.message ?? String(e) };
    }
    let parsed;
    try { parsed = parseTimeStampResp(tsrDer); }
    catch (e: any) {
      if (e?.code === 'rejected') return { error: 'rejected', detail: e.detail };
      return { error: 'malformed', detail: e?.message };
    }
    const verified = verifyResponseAgainstRequest(parsed.token, messageImprint, nonce);
    if (!verified.ok) return { error: 'malformed', detail: verified.reason };
    const tokenInfo = parseTimestampToken(parsed.token);
    return {
      token: parsed.token, tsaUrl: url, hashAlgo,
      signingTime: tokenInfo.signingTime,
      tsaCert: parseCertFromDer(tokenInfo.tsaCertDers[0]!),
      serialNumberHex: tokenInfo.serialNumberHex,
    };
  }
  ```

**Verify:** Test integración con mocked fetch retornando fixture.tsr.

**Commit:** `feat(tsa-client): requestTimestamp orchestration`.

---

## Group C — TSA trust validation

### Task 8 — `tsa-trust` validate chain helper

**Files:**
- Modify: `packages/tsa-trust/src/index.ts`
- Create: `packages/tsa-trust/tests/trust.test.ts`

**Steps:**
- [ ] Añadir `validateTsaChain(tsaCertDer: Uint8Array, intermediateDers: Uint8Array[]): Promise<{ ok: boolean; reason?: string; matchedRoot?: TsaTrustRoot }>`:
  - Reusar `validatePath` de `@firma-ec/verifier` con roots = `getTsaTrustRoots()`.
  - Adicional: verificar `tsaCert.extensions` incluye EKU `1.3.6.1.5.5.7.3.8` (id-kp-timeStamping). Si falta → `{ ok: false, reason: 'tsa_eku_missing' }`.
  - Verificar `notBefore <= now <= notAfter` de cada cert. Si expirado → `{ ok: false, reason: 'expired' }`.
- [ ] Tests:
  - Cargar fixture `freetsa-kat-2026-05-09.tsr` → parse → extract TSA cert → `validateTsaChain` retorna `{ ok: true, matchedRoot.slug === 'freetsa' }`.
  - Cert sin EKU timeStamping (mock manualmente) → `{ ok: false, reason: 'tsa_eku_missing' }`.

**Verify:** `pnpm --filter @firma-ec/tsa-trust test` verde.

**Commit:** `feat(tsa-trust): chain validation with EKU timeStamping check`.

---

## Group D — Signer integration

### Task 9 — Extend `cms.ts` with timestamp + unsignedAttrs

**Files:**
- Modify: `packages/signer/src/cms.ts`
- Modify: `packages/signer/src/types.ts`
- Modify: `packages/signer/package.json` (add `@firma-ec/tsa-client`)

**Steps:**
- [ ] **RESPALDO**: `cp packages/signer/src/cms.ts packages/signer/src/cms.ts.bak.20260509-F6`.
- [ ] En `types.ts`, añadir:
  ```ts
  export interface TimestampMeta {
    ok: boolean;
    signingTime?: Date;
    tsaUrl?: string;
    tsaIssuerCN?: string;
    reason?: 'timeout' | 'rate_limited' | 'malformed' | 'rejected' | 'network' | 'disabled';
    detail?: string;
  }
  ```
- [ ] En `cms.ts`, extender `BuildCmsOpts`:
  ```ts
  timestamp?: boolean;       // default true
  tsaUrl?: string;
  onTimestampResult?: (r: import('@firma-ec/tsa-client').TimestampResult) => void;
  ```
- [ ] Tras `signatureRaw = await signWithKey(...)` (línea ~151), añadir bloque:
  ```ts
  let unsignedAttrs: pkijs.SignedAndUnsignedAttributes | undefined;
  if (opts.timestamp !== false) {
    const { requestTimestamp } = await import('@firma-ec/tsa-client');
    const sigBuf = signatureRaw instanceof ArrayBuffer ? signatureRaw : signatureRaw.buffer;
    const imprint = new Uint8Array(await crypto.subtle.digest('SHA-256', sigBuf));
    const tsr = await requestTimestamp(imprint, { url: opts.tsaUrl, timeoutMs: 8000, hashAlgo: 'SHA-256' });
    opts.onTimestampResult?.(tsr);
    if ('token' in tsr) {
      const tokenAb = tsr.token.buffer.slice(tsr.token.byteOffset, tsr.token.byteOffset + tsr.token.byteLength);
      const tokenAsn1 = asn1js.fromBER(tokenAb as ArrayBuffer);
      if (tokenAsn1.offset !== -1) {
        unsignedAttrs = new pkijs.SignedAndUnsignedAttributes({
          type: 1,
          attributes: [new pkijs.Attribute({
            type: '1.2.840.113549.1.9.16.2.14',
            values: [tokenAsn1.result],
          })],
        });
      }
    }
  } else {
    opts.onTimestampResult?.({ error: 'timeout', detail: 'disabled' } as any);
  }
  ```
- [ ] Pasar `unsignedAttrs` al `new pkijs.SignerInfo({ ..., ...(unsignedAttrs ? { unsignedAttrs } : {}) })`.

**Verify:** `pnpm --filter @firma-ec/signer typecheck` verde. Tests en Task 11.

**Commit:** `feat(signer): attach RFC 3161 timestamp as CMS unsignedAttrs`.

---

### Task 10 — Extend `pades.ts` to propagate timestamp result

**Files:**
- Modify: `packages/signer/src/pades.ts`

**Steps:**
- [ ] **RESPALDO**: `cp packages/signer/src/pades.ts packages/signer/src/pades.ts.bak.20260509-F6`.
- [ ] Añadir a `PadesSignOptions`:
  ```ts
  timestamp?: boolean;
  tsaUrl?: string;
  ```
- [ ] Modificar `signPdfPades` para capturar el resultado del timestamp:
  ```ts
  let timestampMeta: TimestampMeta = { ok: false, reason: 'disabled' };
  const cmsDer = await buildCmsSignedData({
    ...,
    timestamp: opts.timestamp,
    tsaUrl: opts.tsaUrl,
    onTimestampResult: (r) => {
      if ('token' in r) {
        timestampMeta = {
          ok: true,
          signingTime: r.signingTime,
          tsaUrl: r.tsaUrl,
          tsaIssuerCN: r.tsaCert.subjectCN,
        };
      } else {
        timestampMeta = { ok: false, reason: r.error, detail: r.detail };
      }
    },
  });
  ```
- [ ] Cambiar return type a `Promise<{ signedPdf: Uint8Array; timestamp: TimestampMeta }>` o adjuntar como propiedad. **Decisión**: cambiar la firma del retorno (breaking interno, tests del signer se ajustan) — los callers actuales (PWA worker) se actualizan en Task 14.

**Verify:** Tests en Task 11.

**Commit:** `feat(signer): propagate timestamp result through pades pipeline`.

---

### Task 11 — Signer tests for timestamp

**Files:**
- Create: `packages/signer/tests/cms-timestamp.test.ts`
- Create: `packages/signer/tests/pades-timestamp.test.ts`

**Steps:**
- [ ] `cms-timestamp.test.ts`:
  - Mock `@firma-ec/tsa-client` → `requestTimestamp` retorna fixture `TimestampOk` con token de KAT.
  - Build CMS con `timestamp: true` → DER resultado contiene `unsignedAttrs` con OID `1.2.840.113549.1.9.16.2.14`. Verificar parseando el output con pkijs.
  - Build CMS con `timestamp: false` → `unsignedAttrs` ausente.
  - Mock `requestTimestamp` retorna `{ error: 'timeout' }` → `unsignedAttrs` ausente, `onTimestampResult` invocado con error.
- [ ] `pades-timestamp.test.ts`:
  - End-to-end con `.p12` test fixture + timestamp mocked OK → PDF firmado tiene `cms.timestampToken` no-undefined al verificar.
  - timestamp `false` → `cms.timestampToken === undefined`.
  - timeout → PDF firmado válido B-B + `result.timestamp.ok === false, reason === 'timeout'`.

**Verify:** `pnpm --filter @firma-ec/signer test` verde.

**Commit:** `test(signer): timestamp attach + fallback paths`.

---

## Group E — Verifier integration

### Task 12 — `verifier/src/timestamp.ts` — verifyTimestamp

**Files:**
- Create: `packages/verifier/src/timestamp.ts`
- Create: `packages/verifier/tests/timestamp.test.ts`
- Modify: `packages/verifier/package.json` (add `@firma-ec/tsa-client`, `@firma-ec/tsa-trust`)

**Steps:**
- [ ] Implementar `verifyTimestamp(cmsTimestampToken, signerSignatureValue)`:
  ```ts
  export async function verifyTimestamp(token, signerSig): Promise<TimestampVerification> {
    if (!token) return { present: false, badge: 'none' };
    const parsed = parseTimestampToken(token);
    const expectedImprint = new Uint8Array(await crypto.subtle.digest('SHA-256', signerSig));
    const imprintMatches = bytesEqual(parsed.imprint, expectedImprint);
    const tsaCertDer = parsed.tsaCertDers[0];
    const chain = await validateTsaChain(tsaCertDer, parsed.tsaCertDers.slice(1));
    const sigValid = await verifyTsaSignature(parsed, tsaCertDer);
    let badge: 'gold' | 'silver';
    let reason: TimestampVerification['reason'];
    if (!imprintMatches) { badge = 'silver'; reason = 'imprint_mismatch'; }
    else if (!sigValid)  { badge = 'silver'; reason = 'sig_invalid'; }
    else if (!chain.ok)  { badge = 'silver'; reason = chain.reason === 'expired' ? 'expired' : 'chain_invalid'; }
    else                 { badge = 'gold'; }
    return {
      present: true,
      signingTime: parsed.signingTime,
      tsaIssuerCN: extractCN(tsaCertDer),
      imprintMatches, signatureValid: sigValid, chainValid: chain.ok,
      badge, ...(reason ? { reason } : {}),
    };
  }
  ```
- [ ] `verifyTsaSignature`: similar a `verifySignatureValue` del verifier (mismo módulo `integrity.ts`) — verifica que `parsed.innerSignatureValue` corresponde a `parsed.innerSignedAttrsDer` con la public key del TSA cert.
- [ ] Tests:
  - Token KAT real + signerSig real (capturado durante el KAT) → `badge === 'gold'`.
  - Imprint flipped → `badge === 'silver', reason === 'imprint_mismatch'`.
  - TSA cert fuera de `notAfter` (mock fecha actual con `vi.useFakeTimers`) → `badge === 'silver', reason === 'expired'`.
  - Token undefined → `{ present: false, badge: 'none' }`.

**Verify:** `pnpm --filter @firma-ec/verifier test timestamp` verde.

**Commit:** `feat(verifier): verifyTimestamp with gold/silver/none badge`.

---

### Task 13 — Wire timestamp into `verifier/src/index.ts`

**Files:**
- Modify: `packages/verifier/src/index.ts`
- Modify: `packages/verifier/src/result.ts`

**Steps:**
- [ ] **RESPALDO**: `cp packages/verifier/src/index.ts packages/verifier/src/index.ts.bak.20260509-F6`.
- [ ] En `result.ts`, extender `SignatureMeta`:
  ```ts
  timestamp?: {
    present: boolean;
    valid: boolean;
    badge: 'gold' | 'silver' | 'none';
    signingTime?: string;
    tsaIssuer?: string;
    reason?: 'imprint_mismatch' | 'sig_invalid' | 'chain_invalid' | 'expired' | 'malformed';
  };
  ```
- [ ] En `index.ts`, después de `verifySignatureValue` (línea ~38):
  ```ts
  const tsaResult = await verifyTimestamp(cms.timestampToken, cms.signatureValue);
  ```
- [ ] Después de armar `result.signature`, asignar `result.signature!.timestamp = { present: tsaResult.present, valid: tsaResult.badge === 'gold', badge: tsaResult.badge, ...(tsaResult.signingTime ? { signingTime: tsaResult.signingTime.toISOString() } : {}), ...(tsaResult.tsaIssuerCN ? { tsaIssuer: tsaResult.tsaIssuerCN } : {}), ...(tsaResult.reason ? { reason: tsaResult.reason } : {}) }`.
- [ ] Si `tsaResult.present && tsaResult.badge === 'silver'`: añadir `warnings.push({ code: 'timestamp_invalid', message: ... })`.
- [ ] No degradar status a `invalid` por timestamp falla.

**Verify:** Run verifier tests existentes — todos verde + nuevo test que firma B-B legacy preserva `timestamp.badge === 'none'`.

**Commit:** `feat(verifier): expose timestamp metadata in VerificationResult`.

---

## Group F — PWA UI

### Task 14 — Sign worker + bus: add `request_timestamp` stage

**Files:**
- Modify: `apps/pwa/src/lib/workers/sign.worker.ts`
- Modify: `apps/pwa/src/lib/workers/sign.bus.ts`

**Steps:**
- [ ] En `sign.bus.ts`, extender `SignWorkerResponse`:
  ```ts
  | { kind: 'progress'; stage: '... | request_timestamp' }
  | { kind: 'result'; signedPdf: Uint8Array; timestamp: TimestampMeta }
  ```
- [ ] En `sign.worker.ts`:
  - Antes de llamar `signPdfPades`, post `{ kind: 'progress', stage: 'request_timestamp' }` cuando el callback `onTimestampResult` se dispare. Usar opt-in: `signPdfPades(pdf, parsed, { timestamp: ev.data.timestampEnabled, tsaUrl: ev.data.tsaUrl })`.
  - Emitir `progress request_timestamp` justo antes (orquestación), o engancharse al `onTimestampResult` callback para emitir progress al recibir respuesta.
  - Result post: incluir `timestamp` field.
- [ ] `runSign` en bus.ts: añadir opciones `timestampEnabled?: boolean; tsaUrl?: string` (resueltas desde `settings.svelte.ts`).

**Verify:** `pnpm --filter pwa test sign.bus` verde con FakeWorker que emite el nuevo stage.

**Commit:** `feat(pwa): wire timestamp progress + result through sign worker`.

---

### Task 15 — Settings store + Configuracion route

**Files:**
- Create: `apps/pwa/src/lib/settings.svelte.ts`
- Create: `apps/pwa/src/routes/Configuracion.svelte`
- Modify: `apps/pwa/src/App.svelte` (añadir ruta `/configuracion`)

**Steps:**
- [ ] `settings.svelte.ts` (Svelte 5 runes):
  ```ts
  const KEY = 'firma_ec_settings_v1';
  const DEFAULTS = { timestampEnabled: true, tsaUrl: 'https://freetsa.org/tsr' };
  function load() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return DEFAULTS; } }
  let _state = $state(load());
  export function getSettings() { return _state; }
  export function updateSettings(p: Partial<typeof DEFAULTS>) {
    _state = { ..._state, ...p };
    localStorage.setItem(KEY, JSON.stringify(_state));
  }
  export function resetSettings() { _state = { ...DEFAULTS }; localStorage.removeItem(KEY); }
  ```
- [ ] `Configuracion.svelte`:
  - Toggle "Sellar firmas con sello de tiempo" (bind a `settings.timestampEnabled`).
  - Input URL con validación `^https://`.
  - Botón "Probar TSA" → invoca `requestTimestamp(SHA-256('test-firma-ec'), { url })` y muestra OK con CN o error code.
  - Botón "Restaurar valores por defecto" → `resetSettings()`.
- [ ] Registrar `/configuracion` en `App.svelte`. Link desde Header (icono engrane).

**Verify:** `pnpm dev` smoke; toggle persiste tras reload.

**Commit:** `feat(pwa): add Configuracion route with TSA toggle + URL + probe`.

---

### Task 16 — Firmar.svelte: progress stage + result toast

**Files:**
- Modify: `apps/pwa/src/routes/Firmar.svelte`
- Modify: `apps/pwa/src/lib/i18n.svelte.ts`

**Steps:**
- [ ] Mapear progress stage `request_timestamp` a copy `firmar.progress.request_timestamp` (ES "Solicitando sello de tiempo…", EN "Requesting timestamp…").
- [ ] Pasar `settings.timestampEnabled, settings.tsaUrl` a `runSign`.
- [ ] Tras resolución de runSign, si `result.timestamp.ok === false && settings.timestampEnabled`, mostrar toast:
  - `firmar.timestamp.failed.<reason>` keys ES+EN según mapping spec §7.1.
- [ ] Si `result.timestamp.ok === true`, mostrar tarjeta `<TimestampBadge variant="gold" />` en step 7 con CN del TSA + signingTime.
- [ ] Añadir keys i18n nuevas:
  - `firmar.progress.request_timestamp`
  - `firmar.timestamp.gold` ("Sellada por {tsa} · {datetime}")
  - `firmar.timestamp.failed.timeout` / `network` / `rate_limited` / `rejected` / `malformed`

**Verify:** Smoke manual con TSA real + offline (DevTools Offline).

**Commit:** `feat(pwa): timestamp progress stage and post-sign toast`.

---

### Task 17 — TimestampBadge component

**Files:**
- Create: `apps/pwa/src/ui/TimestampBadge.svelte`

**Steps:**
- [ ] Props: `variant: 'gold' | 'silver' | 'none', signingTime?: string, tsaIssuer?: string, reason?: string`.
- [ ] Render:
  - `gold`: tarjeta amarillo-suave con borde dorado, icono lucide `BadgeCheck`, texto "Firma sellada · Emitido por {tsaIssuer} · {signingTime fmt}".
  - `silver`: tarjeta gris con icono lucide `AlertTriangle`, "Sello presente pero inválido · {reason traducido}".
  - `none`: render nothing (return null vía `{#if variant !== 'none'}`).
- [ ] A11y: `role="status"`, `aria-live="polite"`. Touch target ≥44px en mobile.

**Verify:** Storybook-style smoke (manualmente render las 3 variantes en página dev).

**Commit:** `feat(pwa): TimestampBadge component`.

---

### Task 18 — Verificar.svelte: render badge

**Files:**
- Modify: `apps/pwa/src/routes/Verificar.svelte`

**Steps:**
- [ ] Tras render del verdict principal, si `result.signature?.timestamp?.present`, render `<TimestampBadge variant={result.signature.timestamp.badge} signingTime={result.signature.timestamp.signingTime} tsaIssuer={result.signature.timestamp.tsaIssuer} reason={result.signature.timestamp.reason} />`.
- [ ] Format `signingTime` con `Intl.DateTimeFormat` locale-aware.

**Verify:** Smoke con PDF B-T producido en Task 16 → badge gold render.

**Commit:** `feat(pwa): render timestamp badge in Verificar result`.

---

## Group G — Tests + infra

### Task 19 — Caddyfile.pwa CSP

**Files:**
- Modify: `infra/docker/Caddyfile.pwa`

**Steps:**
- [ ] **RESPALDO**: `cp infra/docker/Caddyfile.pwa{,.bak.20260509-F6}`.
- [ ] Localizar la directiva `Content-Security-Policy`. Añadir `https://freetsa.org` al `connect-src`. Si CSP usa `connect-src 'self'` actualmente, expandir a `connect-src 'self' https://freetsa.org`.
- [ ] **Nota**: si el usuario configura una TSA URL custom (Configuracion), CSP no la cubre. Decisión: documentar como limitación (Settings muestra warning si URL ≠ freetsa.org); F7 puede mover a un proxy local /api/tsa.
- [ ] Smoke local con `caddy run --config Caddyfile.pwa` y verificar que TSA request no es bloqueada por CSP en console.
- [ ] Mozilla Observatory: que siga A+.

**Verify:** Smoke + Observatory.

**Commit:** `chore(infra): allow freetsa.org in CSP connect-src`.

---

### Task 20 — Playwright E2E

**Files:**
- Create: `apps/pwa/tests-e2e/timestamp.spec.ts`
- Create: `apps/pwa/tests-e2e/settings.spec.ts`

**Steps:**
- [ ] `timestamp.spec.ts`:
  - Test "golden path B-T": completar wizard de firma con fixture `.p12` de tests + sample.pdf. Mock o intercepta el fetch a freetsa.org devolviendo el KAT fixture. Tras descargar, dropear en `/verificar` → assertion `[data-testid="timestamp-badge"]` visible con clase variant `gold`.
  - Test "offline fallback": `await page.context().setOffline(true)` antes de step 6. Firma completa con toast warning `firmar.timestamp.failed.network`. PDF descargado verifica como `valid` con `timestamp.badge === 'none'`.
  - Test "B-B legacy compat": cargar fixture pre-existente `legacy-b-b.pdf` (firmado en F3) en `/verificar` → status valid + sin badge timestamp.
  - Mobile: chromium-desktop + iPhone 13 + Pixel 5.
- [ ] `settings.spec.ts`:
  - Toggle off → siguiente firma no llama a TSA (verify network: 0 calls a freetsa).
  - Cambiar URL a `https://invalid.example/tsr` → "Probar TSA" muestra error.
  - Reset → URL vuelve a default.

**Verify:** `pnpm --filter pwa test:e2e --project chromium --grep timestamp` verde.

**Commit:** `test(pwa): e2e timestamp golden + offline + settings`.

---

### Task 21 — Lighthouse + axe + Mozilla Observatory

**Files:** —

**Steps:**
- [ ] `pnpm --filter pwa build` → verificar bundle delta. Documentar `du -h dist/assets/firmar-*.js | gzip -c | wc -c` antes y después. Acceptance: ≤15 KB gz.
- [ ] Lighthouse `/firmar` (mobile + desktop): ≥95.
- [ ] axe-playwright: 0 violations en `/firmar` y `/configuracion`.
- [ ] Mozilla Observatory + securityheaders.com: A+ post-deploy.

**Verify:** Tres badges + bundle delta documentado.

**Commit:** `docs(transparency): F6 audit metrics (lighthouse + bundle)`.

---

## Group H — Docs, version bump, deploy

### Task 22 — CHANGELOG + version bumps

**Files:**
- Modify: `packages/tsa-client/package.json` → `0.5.0-rc1`
- Modify: `packages/tsa-trust/package.json` → `0.5.0-rc1`
- Modify: `packages/signer/package.json` → bump
- Modify: `packages/verifier/package.json` → bump
- Modify: `apps/pwa/package.json` → `0.5.0-rc1`
- Modify: `CHANGELOG.md`

**Steps:**
- [ ] CHANGELOG entry:
  ```md
  ## [0.5.0-rc1] - 2026-05-09
  ### Added
  - F6: PAdES B-T (RFC 3161 timestamp) default-on con FreeTSA público.
  - packages/tsa-client (RFC 3161 client with KAT-tested parser).
  - packages/tsa-trust (FreeTSA root + ARCOTEL placeholder slot).
  - packages/verifier: verifyTimestamp + gold/silver/none badge in result.
  - apps/pwa: /configuracion route (toggle + URL + probe), Firmar progress
    stage, Verificar timestamp badge.
  ### Notes
  - Firmas B-B legacy siguen verificando como valid (regresión cero).
  - TSA caída → fallback B-B con toast (firma legalmente válida).
  - ARCOTEL TSAs: F6.5 cuando publiquen endpoints RFC 3161.
  ```
- [ ] Bump versions.

**Verify:** `pnpm -r typecheck` + `pnpm -r test` verde.

**Commit:** `chore(release): v0.5.0-rc1 — F6 TSA`.

---

### Task 23 — Build image + push registry

**Files:**
- Modify: `infra/compose/stack-firma-ec.deploy.yml` (image tag)

**Steps:**
- [ ] **RESPALDO**: `cp infra/compose/stack-firma-ec.deploy.yml{,.bak.20260509-F6}`.
- [ ] `pnpm --filter pwa build`.
- [ ] `docker buildx build` `infra/docker/pwa.Dockerfile` → tag `registry.idkmanager.com/firma-ec/pwa:0.5.0-rc1`.
- [ ] `docker push`.
- [ ] Update stack-deploy.yml image tag.

**Verify:** Imagen visible en registry; SHA256 anotado.

**Commit:** `chore(infra): bump pwa image to 0.5.0-rc1`.

---

### Task 24 — GATE: confirmación usuario

**Files:** —

**Steps:**
- [ ] Mostrar al usuario:
  - SHA imagen.
  - Diff stack-deploy.yml.
  - Resultados Playwright + Lighthouse + axe + Observatory.
  - Bundle delta gz.
- [ ] **Esperar confirmación explícita** (regla #2 CLAUDE.md). No avanzar a Task 25 sin "OK".

**Verify:** Usuario firma off.

---

### Task 25 — Deploy + smoke

**Files:** —

**Steps:**
- [ ] `docker stack deploy -c stack-firma-ec.deploy.yml firma-ec --with-registry-auth` desde IAS01.
- [ ] `docker service ls | grep firma-ec_pwa` → 1/1.
- [ ] `curl -I https://app.firmar.ec/firmar` 200 + headers A+.
- [ ] Smoke manual: completar wizard de firma con `.p12` real, verificar badge gold; offline, verificar fallback toast.

**Verify:** Servicio LIVE; smoke OK.

**Commit:** N/A (deploy step).

---

### Task 26 — Cross-validation Adobe Reader

**Files:** —

**Steps:**
- [ ] Firma B-T producida en Task 25 → abrir en **Adobe Acrobat Reader DC**: panel de firmas debe mostrar "Signature includes embedded timestamp" o equivalente con la fecha del TSA (no la signing-time del cert). Capturar screenshot.
- [ ] Abrir en **FirmaEC desktop** (validador): firma válida; sello visible si soporta B-T (FirmaEC desktop puede o no — documentar).
- [ ] Capturar screenshots a `docs/reports/F6-cross-validation-2026-05-09/`.

**Verify:** Adobe muestra timestamp; FirmaEC behavior documentado.

**Commit:** `docs(reports): F6 cross-validation screenshots`.

---

### Task 27 — Tag v0.5.0-rc1 + Cosign + mirrors

**Files:** —

**Steps:**
- [ ] Commit final: `chore(release): v0.5.0-rc1 — F6 TSA closure`.
- [ ] `git tag -s v0.5.0-rc1 -m "F6 TSA — PAdES B-T en cliente"`.
- [ ] `git push origin main && git push origin v0.5.0-rc1`.
- [ ] CI: Cosign + SLSA L3 + SBOM.
- [ ] Verificar release page en Gitea + 2 GH mirrors.

**Verify:** Release v0.5.0-rc1 visible en los 3 remotos.

---

### Task 28 — Memoria F6 closure + handoff F7

**Files:**
- Create: `~/.claude/projects/.../memory/project_firma_ec_F6_completed_2026-05-09.md`
- Create: `docs/superpowers/notes/F6-handoff-to-F7.md`

**Steps:**
- [ ] Memoria F6: tag, FreeTSA default, fallback paths, badges, KAT fixture, bundle delta, Adobe screenshot, ARCOTEL TBD F6.5.
- [ ] Handoff F7 (LTV): DSS dictionary, OCSP-stapled (id-aa-ets-revocationValues), CRL fallback, archive-timestamp B-LTA, multi-TSA, ARCOTEL TSAs si publican.

**Verify:** Memoria + handoff registrados.

**Commit:** `docs(memory): F6 closure + F7 LTV handoff`.

---

## Self-review (post-write)

- **Spec coverage**: cada decisión 1-10 del spec §1 mapeada a tasks (1→T2 trust manifest, 2→T9 default, 3→T10 fallback, 4→T13 verifier accept both, 5→T15 settings, 6→T2 PEM embedded, 7→T1 tsa-client package, 8→T2 tsa-trust package, 9→T16 progress stage, 10→T22 tag bump). ✅
- **Architecture coverage**: §2.1 TSP flow → T3+T4+T7; §2.2 CMS insert → T9; §2.3 fallback → T10+T11; §2.4 verifier → T12+T13. ✅
- **API surface**: spec §3 (tsa-client) → T1+T3-7; §4 (tsa-trust) → T2+T8; §5 (CMS) → T9; §6 (verifier) → T12+T13; §7 (PWA) → T14-18. ✅
- **Bite-sized**: 28 tasks. Tasks de cripto core (T3-7, T9, T12) son los más densos pero sub-stepped. Tasks UI (T15-18) split por componente. ✅
- **Type consistency**: `TimestampMeta` (signer/types.ts) ≠ `TimestampVerification` (verifier) ≠ `TimestampResult` (tsa-client) — 3 tipos distintos por capa, claramente diferenciados. ✅
- **Placeholder scan**: 0 TBD/TODO/FIXME. Hay un "TBD" en el manifest TSA URL hint para `arcotel-placeholder` que es **placeholder declarado**, no defecto. ✅
- **Comandos exactos**: pnpm filter, docker buildx, curl freetsa cacert, openssl req, etc. ✅
- **Trampa F3-v0.4.4 (encodedValue empty)**: documentada en Task 5 (parseToken) y Task 9 (cms.ts unsignedAttrs). El patch 0xa0→0x31 NO aplica a unsignedAttrs (tag implícito [1] = 0xa1 — no firmamos sobre ellos), pero sí aplica al inner SignerInfo del TimeStampToken cuando el verifier reconstruye signedAttrs para verificar la firma del TSA. ✅
- **Privacy claim integrity**: TSA recibe SHA-256 de signatureValue, NO el documento. Documentado en Task 21 transparency report. ✅
- **Deploy gating**: Task 24 = GATE explícito (regla #2 CLAUDE.md). ✅

---

## Acceptance final checklist (mirrors spec §10)

- [ ] tsa-client tests verde (unit + KAT + property).
- [ ] tsa-trust tests verde (PEM parse + EKU).
- [ ] signer tests verde (CMS unsignedAttrs + pades fallback).
- [ ] verifier tests verde (gold/silver/none + reason).
- [ ] PWA → firma B-T → re-verificada → `badge: 'gold'`.
- [ ] Adobe Reader DC reconoce timestamp (screenshot).
- [ ] B-B legacy regresión cero (`badge: 'none'`).
- [ ] Offline fallback genera B-B + warning toast.
- [ ] Bundle delta `/firmar` ≤15 KB gz.
- [ ] Lighthouse ≥95.
- [ ] axe 0 violations en /firmar + /configuracion.
- [ ] Mozilla Observatory + securityheaders + SSL Labs A+.
- [ ] CSP `connect-src` permite freetsa.org sin warnings.
- [ ] Playwright E2E verde en chromium + iPhone 13 + Pixel 5.
- [ ] Transparency report actualizado.
- [ ] CHANGELOG + bumps + tag firmado en 3 remotos.
- [ ] Memoria F6 + handoff F7 registrados.

---

**Fin del plan F6 — listo para ejecutar con `subagent-driven-development` o `executing-plans`.**
