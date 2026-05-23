# firmar.ec

> Firmador web de PDFs para Ecuador. 100% open source (Apache 2.0), 100% del lado del cliente. Tu `.p12` nunca sale del navegador.

[![App](https://img.shields.io/badge/app-firmar.ec-0F172A?style=flat-square)](https://app.firmar.ec)
[![Mozilla Observatory](https://img.shields.io/badge/Mozilla_Observatory-A%2B-success?style=flat-square)](https://observatory.mozilla.org/analyze/firmar.ec)
[![SSL Labs](https://img.shields.io/badge/SSL_Labs-A%2B-success?style=flat-square)](https://www.ssllabs.com/ssltest/analyze.html?d=firmar.ec)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square)](LICENSE)

## ¿Qué es?

Una PWA que firma y verifica PDFs con certificado digital `.p12` emitido por las ACEs acreditadas por **ARCOTEL**. Toda la criptografía corre en el navegador (Web Crypto + WebAssembly); el archivo y la llave nunca tocan un servidor.

- **App**: <https://app.firmar.ec>
- **Sitio institucional**: <https://firmar.ec>
- **Comparación honesta vs FirmaEC (MINTEL)**: [`docs/COMPARATIVA.md`](docs/COMPARATIVA.md)

> **Sobre el panorama OSS en Ecuador**: FirmaEC del MINTEL también es open-source (publicada en [MINKA](https://minka.gob.ec)). firmar.ec **no es la única OSS**; es la primera **web/PWA** OSS auditable con foco en privacidad client-side estricta. Ambas son complementarias — ver comparativa.

![PWA home](docs/screenshots/pwa-home.png)

## Estado del proyecto

| Fase  | Descripción                                              | Estado                              |
| ----- | -------------------------------------------------------- | ----------------------------------- |
| F1    | Landing pública (firmar.ec)                              | ✅ LIVE — v0.1.12                   |
| F2    | Verificación PDF (PAdES B-B)                             | ✅ LIVE                             |
| F3    | Firma con `.p12` (PAdES B-B + cuadro QR estilo FirmaEC)  | ✅ LIVE — v0.5.1                    |
| F4    | Hardening (Mozilla A+, SSL Labs A+, CSP estricta)        | ✅ LIVE                             |
| F3.5  | WhatsApp inbox/outbox bidireccional                      | 🟡 Código completo, deploy pendiente |
| F6    | Sello de tiempo (RFC 3161, FreeTSA) → PAdES B-T          | ✅ LIVE — v0.6.0                    |
| F7    | LTV (DSS + OCSP + document timestamp) → PAdES B-LT/B-LTA | ✅ LIVE — v0.7.0-rc1                |
| F8    | Multi-firmante con flujo (workflow orchestration)        | ⏳ Scope abierto                    |

## Características LIVE

- **Firma local** — `.p12` jamás sale del navegador. Web Crypto + node-forge (`.p12` legacy 3DES).
- **Perfiles PAdES** — B-B, **B-T** (TSA), **B-LT** (DSS+OCSP+CRL), **B-LTA** (document timestamp).
- **Verificación offline** — TSL local con **17 ACEs ARCOTEL** ancladas (SHA-256 + SRI).
- **Compatible** — firmas verificables en Adobe Reader, FirmaEC y MINKA (MINTEL).
- **PWA instalable** — funciona offline. Share Target API: recibe PDFs desde WhatsApp/Gmail.
- **Cuadro de firma con QR** — 240×72pt, URL `firmar.ec/#/verificar?h=<hash>`.
- **3 modos**: Firmar, Verificar, Paranoia (verificación estricta sin red).

## Qué NO hace (out of scope hoy)

- **XAdES / comprobantes SRI** — el SRI usa XAdES, no PAdES; usa FirmaEC del MINTEL.
- **Tokens USB criptográficos** — solo `.p12` (WebUSB en evaluación).
- **Firma en lote** — un PDF a la vez (roadmap F8 contempla flujos).
- **Quipux integración nativa** — testable manualmente; sin workflow oficial.

### Capturas

| Vista                    | Imagen                                                         |
| ------------------------ | -------------------------------------------------------------- |
| Landing — desktop        | ![landing desktop](docs/screenshots/landing-home-desktop.png)  |
| Landing — móvil          | ![landing mobile](docs/screenshots/landing-home-mobile.png)    |
| PWA — Firmar (paso 1)    | ![firmar](docs/screenshots/pwa-firmar-step1.png)               |
| PWA — Verificar (paso 1) | ![verificar](docs/screenshots/pwa-verificar-step1.png)         |
| PWA — Paranoia           | ![paranoia](docs/screenshots/pwa-paranoia.png)                 |
| PWA — Acerca             | ![about](docs/screenshots/pwa-about.png)                       |

## Stack

- **Landing**: Astro 5 + UnoCSS + tokens compartidos (`@firma-ec/ui-tokens`).
- **PWA**: Svelte 5 (runes) + Vite 6 + UnoCSS + svelte-spa-router.
- **Crypto**: pkijs 3.x + asn1js + node-forge (3DES legacy) + @noble/curves + Web Crypto.
- **PDF**: pdf-lib + @signpdf v3.3.0 + pdfjs-dist v4.
- **Tests**: Vitest + fast-check + Playwright + Stryker.
- **Infra**: Docker Swarm IDK + Caddy 2 + Cloudflare Tunnel.

## Privacidad y seguridad

- Sin telemetría. Sin analytics de terceros.
- CSP estricta (sin `unsafe-inline` en scripts, sin `eval`).
- Service Worker custom intercepta `/share` para evitar enviar PDF al servidor.
- 17 raíces ARCOTEL ancladas con SHA-256 y verificación SRI.
- Threat model y críticas UI Pro Max disponibles bajo [`docs/`](docs/).
- Política de divulgación responsable: [`SECURITY.md`](SECURITY.md).
- Reportes privados: [GitHub Security Advisories](https://github.com/idkmanager/firma-ec/security/advisories/new).

## Supply chain (SLSA L2 con elementos L3)

Resumen ejecutivo — assessment completo en [`docs/slsa-conformance.md`](docs/slsa-conformance.md).

- **Build Track L2 (verificado)**: provenance signed via `actions/attest-build-provenance@v2`, cosign keyless OIDC, Rekor public tlog, SBOM CycloneDX 1.6 + SPDX 2.3.
- **L3 elements cumplidos**: ephemeral runner, non-falsifiable provenance, service-generated attestations.
- **L3 strict gaps**: (a) hermeticidad — `pnpm install` aún accede al registry npm; (b) Source Track L3 requiere branch protection con 2-reviewer review (decisión pendiente — hoy somos solo-maintainer); (c) auditoría externa independiente del build platform.
- **Verificación pública**: `gh attestation verify --owner idkmanager --signer-workflow .github/workflows/release.yml <artifact>`.

## Reproducible Builds (roadmap, quick wins aplicados)

Estado completo + verificación local en [`docs/reproducible-builds.md`](docs/reproducible-builds.md).

- **Aplicado 2026-05-10**: `SOURCE_DATE_EPOCH` desde commit timestamp, `tar --sort=name --owner=0 --group=0 --numeric-owner --mtime=@$SDE`, `gzip -n` (strips embedded mtime/filename).
- **Pendiente verificación bit-idéntica**: confirmar que dos runs back-to-back producen el mismo `sha256` (CI job a añadir).
- **Pendiente cross-environment**: rebuild desde otra distro / runner.
- **Verificación externa**: si lo intentas, abre un issue con el report de `diffoscope` — agradecemos cualquier verificación independiente.

## Verificar releases con Sigstore

Public key:    <https://firmar.ec/.well-known/cosign.pub>
Latest tag:    `v0.7.0-rc1`
Tag SHA:       `9380db41291f2beadf2f3304cecf1d322963679f`
Rekor tlog:    `1497932420` · integrated `2026-05-10T19:02:23 UTC`
Sig + bundle:  `_backups/F7-deploy-2026-05-10-rc1/v0.7.0-rc1.{sig,bundle}`

```bash
# 1. Fetch the public key
curl -sf https://firmar.ec/.well-known/cosign.pub -o cosign.pub

# 2. Pin the tag SHA you want to verify
TAG="v0.7.0-rc1"
TAG_SHA=$(git rev-parse "$TAG")
echo "$TAG_SHA"  # debería imprimir 9380db41291f2beadf2f3304cecf1d322963679f

# 3. Verify the signature against the tag SHA
cosign verify-blob \
  --key cosign.pub \
  --signature _backups/F7-deploy-2026-05-10-rc1/v0.7.0-rc1.sig \
  --bundle    _backups/F7-deploy-2026-05-10-rc1/v0.7.0-rc1.bundle \
  --rekor-url https://rekor.sigstore.dev \
  <(echo -n "$TAG_SHA")

# 4. Cross-check Rekor tlog entry
rekor-cli get --log-index 1497932420 --rekor_server https://rekor.sigstore.dev
```

Si cualquier paso falla, **no confíes en el binario** y abre un issue.

## Principios

Segura · Fácil de usar · Ligera · Compatible · Mobile-first · Fully responsive · Privacy by design · LOPDP-native · Open source · Auditable.

## Desarrollo local

```bash
git clone https://git.idkmanager.com/alfonso/firma-ec
cd firma-ec
pnpm install
pnpm -F @firma-ec/landing dev   # http://localhost:4321
pnpm -F @firma-ec/pwa dev       # http://localhost:5173
pnpm test                       # all packages
```

## Patrocinio

firmar.ec es y seguirá siendo gratis. El patrocinio no compra el servicio:
financia el desarrollo, las auditorías de seguridad y la infraestructura que
mantienen la herramienta viva y abierta.

| Tier | Mensual | Anual (10% desc.) | Target |
|------|---------|-------------------|--------|
| 🥉 Bronze   | $50    | $540    | Freelancers, devs, microempresas |
| 🥈 Silver   | $200   | $2 160  | Estudios contables, PYMEs, notarías |
| 🥇 Gold     | $500   | $5 400  | Empresas medianas, cooperativas, estudios jurídicos |
| 💎 Platinum | $1 500 | $16 200 | Corporativos, banca, aseguradoras |
| 🏛️ Founding | $5 000+ | Negociable | Instituciones, gobierno, GADs, universidades |

**Pago directo, sin intermediarios**: transferencia bancaria a IDK Manager
Cía. Ltda. con factura SRI. No usamos plataformas que retengan fondos ni
cobren comisión. Escríbenos a **sponsors@firmar.ec** o visita
[firmar.ec/patrocinar](https://firmar.ec/patrocinar).

- Beneficios por tier → [`docs/sponsorship/benefits.md`](docs/sponsorship/benefits.md)
- Gobernanza del programa → [`docs/sponsorship/governance.md`](docs/sponsorship/governance.md)
- Lista de patrocinadores → [`SPONSORS.md`](SPONSORS.md)

## Repos

- **Source**: [git.idkmanager.com/alfonso/firma-ec](https://git.idkmanager.com/alfonso/firma-ec)
- **Mirror**: [github.com/idkmanager/firma-ec](https://github.com/idkmanager/firma-ec)

## Licencia

Apache 2.0 — ver [`LICENSE`](LICENSE).

## Créditos

Desarrollado por [IDKmanager](https://idkmanager.com) (Ecuador).
