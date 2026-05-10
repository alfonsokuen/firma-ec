# firmar.ec

> Firma y verifica PDFs ecuatorianos en tu navegador. 100% open source, 100% del lado del cliente. Sin servidores que vean tus documentos.

[![App](https://img.shields.io/badge/app-firmar.ec-0F172A?style=flat-square)](https://app.firmar.ec)
[![Mozilla Observatory](https://img.shields.io/badge/Mozilla_Observatory-A%2B-success?style=flat-square)](https://observatory.mozilla.org/analyze/firmar.ec)
[![SSL Labs](https://img.shields.io/badge/SSL_Labs-A%2B-success?style=flat-square)](https://www.ssllabs.com/ssltest/analyze.html?d=firmar.ec)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square)](LICENSE)

## ¿Qué es?

Una PWA que permite a cualquier persona en Ecuador **firmar y verificar PDFs** con su certificado digital `.p12` emitido por las ACEs autorizadas por **ARCOTEL**. Toda la criptografía ocurre en tu navegador — el archivo nunca sale de tu dispositivo.

- **App**: <https://app.firmar.ec>
- **Sitio institucional**: <https://firmar.ec>

![PWA home](docs/screenshots/pwa-home.png)

## Estado del proyecto

| Fase  | Descripción                                              | Estado                              |
| ----- | -------------------------------------------------------- | ----------------------------------- |
| F1    | Landing pública (firmar.ec)                              | ✅ LIVE — v0.1.9                    |
| F2    | Verificación PDF (PAdES B-B)                             | ✅ LIVE                             |
| F3    | Firma con `.p12` (PAdES B-B + cuadro QR estilo FirmaEC)  | ✅ LIVE — v0.5.1                    |
| F4    | Hardening (Mozilla A+, SSL Labs A+, CSP estricta)        | ✅ LIVE                             |
| F3.5  | WhatsApp inbox/outbox bidireccional                      | 🟡 Código completo, deploy pendiente |
| F6    | Sello de tiempo (RFC 3161, FreeTSA) → PAdES B-T          | ✅ LIVE — v0.6.0-rc7 (TSL parcial)  |
| F7    | LTV (DSS + OCSP + document timestamp) → PAdES B-LT/B-LTA | ⏳ Planificado                      |

## Características LIVE

- **Firma local** — tu `.p12` no sale del navegador. Web Crypto + node-forge para `.p12` legacy 3DES.
- **Verificación offline** — TSL local con **17 ACEs autorizadas por ARCOTEL**.
- **Compatible** — firmas PAdES B-B verificables por Adobe Reader, FirmaEC y SRI.
- **PWA instalable** — funciona offline. Share Target API: recibe PDFs desde WhatsApp/Gmail/etc.
- **Cuadro de firma con QR** — estilo FirmaEC, 240×72pt con URL `firmar.ec/#/verificar?h=<hash>`.
- **3 modos**: Firmar, Verificar, Paranoia (verificación estricta sin red).

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
- Reportes de seguridad: [GitHub Security Advisories (privado)](https://github.com/idkmanager/firma-ec/security/advisories/new).

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

## Repos

- **Source**: [git.idkmanager.com/alfonso/firma-ec](https://git.idkmanager.com/alfonso/firma-ec)
- **Mirror**: [github.com/idkmanager/firma-ec](https://github.com/idkmanager/firma-ec)

## Licencia

Apache 2.0 — ver [`LICENSE`](LICENSE).

## Créditos

Desarrollado por [IDKmanager](https://idkmanager.com) (Ecuador).
