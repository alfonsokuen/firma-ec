# firma-ec — Deploy Log

Curated record of production deploys to `app.firmar.ec` (PWA) and `firmar.ec` (landing). Registry: `190.160.10.129:5000` (IDK Swarm). For narrative detail see [`CHANGELOG.md`](./CHANGELOG.md).

## Hotfixes (post-F7)

| Tag              | Date       | Image                                       | Highlights                                                                                                                                                                  | Commit    |
| ---------------- | ---------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `v0.7.7`         | 2026-05-15 | `firma-ec-pwa:0.7.7` (digest `d64a38b0d014`) + `firma-ec-landing:0.7.7` (digest `4cd2a6a567d4`, byte-identical) | **Security Data Real Root CA** extracted from PAdES CMS of `CONTRATO2026 SOLUCIONES…-signed.pdf` (LT-level signature carried the full chain). 6/17 ACEs real. Banner reports **6 de 9 ACEs activas** (was 5/9). Verifier regression test updated so the two SD-signed fixtures now expect `expectedRealRoot: 'securitydata'`. | `7b81911` |
| `v0.7.6`         | 2026-05-15 | `firma-ec-pwa:0.7.6` (digest `143b76b5b6cf`) + `firma-ec-landing:0.7.6` (digest `4cd2a6a567d4`, byte-identical to 0.7.5) | **BCE Real Root CA** extracted from PAdES CMS chain of a Registro Civil-signed Certificado de Matrimonio (Registro Civil signs with BCE-issued certs). 5/17 ACEs real. Banner reports **5 de 9 ACEs activas** (was 4/9). BCE WAF previously blocked the public fetch path — offline extraction was the only route. | `fe20f32` |
| `v0.7.5`         | 2026-05-14 | `firma-ec-pwa:0.7.5` (digest `ba1dff0c2b93`) + `firma-ec-landing:0.7.5` (digest `4cd2a6a567d4`) | Datil real CA loaded (4/17 ACEs real). New `isDefunct` flag → 8 inactive ACEs hidden from active denominator. Banner now reports **4 de 9 ACEs activas** (was 3/17). Landing `OperadoPor` shows official IDK Manager wordmark image instead of plain text. | `e8be5fc` |
| `pwa 0.7.0-rc9`  | 2026-05-10 | `firma-ec-pwa:0.7.0-rc9` (digest `448aa89a`) | **fix(Button):** internal `href="/x"` rewritten to `"#/x"` so Home Hero CTAs (`Verificar PDF` / `Firmar PDF`) navigate inside the installed PWA. APP_VERSION → `0.7.0-rc2`. | `96d4b90` |

## F6 — PAdES B-T (RFC 3161 timestamping)

| Tag             | Date       | PWA image digest                                                          | Landing image digest                                                      | Highlights                                                                                                              | Commit    |
| --------------- | ---------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------- |
| `v0.6.0-rc7`    | 2026-05-10 | `sha256:d71885e39a6a3a6856057c90d578af42f83ba1d454ab10d1c429971a3e915036` | `sha256:70d15a76020931a93a046879f2bd1baf05ebd0552b80a02c4ec1b448082fa4bb` | F6.7 TSL real PEM fetch (2/17 ACEs: Eclipsoft + Uanataca). Granular `TRUST_PARTIAL` banner. Landing hero `.p12` copy.   | `08f65fd` |
| `v0.6.0-rc6`    | 2026-05-10 | `sha256:08c56592dcef668d29e7998d99dc2a3f2c5a5eb9d58c3583c74c6265bb3b3c8e` | (unchanged v0.1.8)                                                        | F6.6 TimestampBadge gold variant `success-green` — cosmetic only.                                                       | `af69a93` |
| `v0.6.0-rc5`    | 2026-05-10 | `sha256:0e1927e90f7fef9ea266bd1ad715014c040100a7d540edba897db4917c26d6ae` | (unchanged)                                                               | F6.5 verifier extracts B-T timestamp + bumps engine version. New `@firma-ec/tsa-client` + `@firma-ec/tsa-trust`.        | `f9b2b02` |
| `v0.6.0-rc4`    | 2026-05-10 | `sha256:779846679998f5cb67b913fda4233d17e93659d351a2e90509aa3cfc757c3fc5` | (unchanged)                                                               | F6.4 signer 0.5.0-rc3 — TSA timestamp embedding in PAdES.                                                               | `37dad8a` |
| `v0.6.0-rc3`    | 2026-05-10 | `sha256:2bff022e94fc522bc8a6b8e28c4b08b335a459ff6db274b907a903da04b7da2c` | `sha256:6ccd3483d6bbef955fbed5a01549bb169fa2c63937f5185d1b06dff4c804e968` | F6.3 redirect after sign + landing v0.1.8 partner.                                                                      | `640cdaa` |
| `v0.6.0-rc2`    | 2026-05-10 | `sha256:93af81b60e2bf331502e72946b8d2a2c1ef3cbdd69ceb2c558acd96ab6dfbbbc` | (unchanged)                                                               | F6.2 — Configuración TSA pane + post-deploy QR deep-link verified.                                                      | `5137c5e` |
| (rc1 untagged)  | 2026-05-10 | `sha256:aea860ce4299b23a7714531c74ed3bb1188c371647551f041ea93b6e912ba621` | (unchanged)                                                               | F6 T25 infra — `/api/tsa` proxy route block + SPA fallback. (no formal tag — superseded by rc2.)                        | `2205f7b` |

## F5 — Visual parity & light default

| Tag       | Date       | Highlights                                                              | Commit    |
| --------- | ---------- | ----------------------------------------------------------------------- | --------- |
| `v0.5.1`  | 2026-05-09 | Landing v0.1.7 light default + CHANGELOG.                               | `1b4c065` |
| `v0.5.0`  | 2026-05-09 | Deep visual parity landing↔PWA (tokens + Hero/Footer/Button patterns). | `fc41784` |
| `v0.4.9`  | 2026-05-09 | Landing v0.1.6 — UnoCSS Wind4 container fix (flush-left bug).           | `47b04fd` |
| `v0.4.8`  | 2026-05-09 | Landing↔App linkage + UI Pro Max P0 polish.                             | `f8e759b` |
| `v0.4.7`  | 2026-05-09 | ECDSA P-256/P-384/P-521 PFX signing.                                    | `fb967a2` |
| `v0.4.6`  | 2026-05-09 | Polish bundle.                                                          | `d9d5f22` |
| `v0.4.5`  | 2026-05-09 | F3+F4 LIVE — visible signature with QR (FirmaEC-style 240×72pt).        | `f97934e` |

## Live verification (rc7)

- Landing ES h1: `Firma y verifica PDFs con tu certificado electrónico .p12.` ✓
- Landing EN h1: `Sign and verify PDFs with your .p12 electronic certificate.` ✓
- App `/configuracion` footer: `versión 0.6.0-rc7` ✓
- App `/verificar` con `sample-b-t-freetsa.pdf`: TSA stamp `Sellada por TSA · Emitido por www.freetsa.org`, PAdES `B-T`, banner `TRUST_PARTIAL` 2/17 ✓
- CSP includes `https://freetsa.org` in `connect-src` ✓

## Caveats

- **SW cache**: existing PWA users on rcN-1 must accept the in-app update prompt or hard-reload to pick up rcN (precache hash changes per release).
- **TSL trust**: 15/17 ACEs ARCOTEL still self-signed placeholders; `TRUST_PARTIAL` banner surfaces this. See `CHANGELOG.md` rc7 TODOs.
- **Tags**: `v0.6.0-rc1` was never formally tagged (commit `2205f7b` was superseded by `5137c5e` rc2 within the same hour).
