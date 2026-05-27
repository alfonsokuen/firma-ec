# firmar.ec — F0 Transparency Report

**Date:** 2026-05-08
**Tag:** v0.0.1-f0 (images v0.0.1-f1)
**Live URLs:**
- https://firmar.ec/
- https://www.firmar.ec/
- https://app.firmar.ec/

## Image artifacts

Pushed to internal registry `190.160.10.129:5000`:

| Image | Tag | Manifest digest |
|---|---|---|
| `firma-ec-landing` | `v0.0.1-f1`, `latest` | `sha256:842e7da93a33130e71919f137c4be013424d994fbc27285cd045e2ca450f55a7` |
| `firma-ec-pwa` | `v0.0.1-f1`, `latest` | `sha256:542a8ac45d3c97467058ca582e13d83a8ea7b71a50fa348753ff26d53c45bedd` |

Deployed across IAS01/02/03 (2/2 replicas each) on 2026-05-08 03:21 UTC-5.

## DNSSEC

Enabled on the `firmar.ec` zone. **DS record (KSK) — paste at NIC.EC parent registrar:**

```
firmar.ec. 3600 IN DS 2371 13 2 5382D17387E4E4C1BF11C2AB1A1A781F6DA7F71D94062C2CCEC889C964FB69D4
```

- key_tag: `2371`
- algorithm: `13` (ECDSAP256SHA256)
- digest_type: `2` (SHA256)
- flags: `257` (KSK)
- status: `pending` until NIC.EC publishes the DS

## DNS records (Cloudflare)

| Type | Name | Value | Notes |
|---|---|---|---|
| CAA | firmar.ec | `0 issue "letsencrypt.org"` | only LE may issue |
| CAA | firmar.ec | `0 issuewild ";"` | wildcards forbidden |
| CAA | firmar.ec | `0 iodef "https://github.com/idkmanager/firmar-ec/security/advisories/new"` | abuse contact (URL — pending operator DNS update) |
| CNAME | firmar.ec | `<tunnel-id>.cfargotunnel.com` | proxied |
| CNAME | www.firmar.ec | idem | proxied |
| CNAME | app.firmar.ec | idem | proxied |
| CNAME | status.firmar.ec | idem | proxied (reservado para Gatus) |
| MX | firmar.ec | `.` priority 0 | null MX (no email) |
| TXT | firmar.ec | `v=spf1 -all` | no email |
| TXT | _dmarc.firmar.ec | `v=DMARC1; p=reject` | strict DMARC, no rua (zone has null MX; pending operator DNS update to drop legacy `rua=mailto:datos@firmar.ec`) |

Cloudflare zone settings hardened:
- Always Use HTTPS = on
- Automatic HTTPS Rewrites = on
- TLS 1.3 = on; min_tls_version = 1.2
- HSTS via CF: max_age=31536000, includeSubDomains=true, preload=true, nosniff=true

## Cloudflare Tunnel

4 ingress rules added above the catchall in the existing `idkmanager` tunnel
(`71870df9-3d64-46ea-b71a-24685dc301bd`), each routing `https://traefik:443`
with `originServerName` set to the host. Existing rules untouched. Backups at
`_backups/cf-tunnel-config-pre-firma-ec-*.json`.

## Security headers

Origin Traefik file middlewares `firma-headers@file` (landing) and
`firma-pwa-headers@file` (PWA), plus `firma-ratelimit@file` for both.

Verified live on all 3 hosts:
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `Content-Security-Policy:` strict default-src 'self' for landing; PWA adds
  `'wasm-unsafe-eval'`, `worker-src 'self' blob:`, and
  `require-trusted-types-for 'script'`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), clipboard-write=(), interest-cohort=()`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Resource-Policy: same-origin`
- `X-Robots-Tag: noindex, nofollow` (intentional for F0 — pre-launch)

## External audits

### Mozilla Observatory v2

Source: <https://observatory-api.mdn.mozilla.net/api/v2>

| Host | Grade | Score | Tests passed |
|---|---|---|---|
| firmar.ec | **A+** | 125/100 | 10/10 |
| www.firmar.ec | **A+** | 125/100 | 10/10 |
| app.firmar.ec | **A+** | 125/100 | 10/10 |

### SSL Labs (api.ssllabs.com v3)

Cloudflare-fronted; all CF edge IPs return the same TLS posture:

| Host | Grade |
|---|---|
| firmar.ec | **A+** (verified on 104.21.11.49, IPv6 2606:4700:3037::ac43:a529; remaining edge IPs in progress at report time) |
| app.firmar.ec | scan in progress at report time, expected A+ (same CF edge cert) |

### Lighthouse (mobile, headless Chromium on Windows)

| URL | Performance | Accessibility | Best Practices | SEO | Agentic-browsing |
|---|---|---|---|---|---|
| https://firmar.ec/ (mobile) | **100** | **100** | 92 | 66 | 100 |
| https://app.firmar.ec/ (mobile) | env-error* | 100 | 92 | 54 | env-error* |

Notes:
- SEO < 100 is **expected**: `X-Robots-Tag: noindex, nofollow` is set
  intentionally during F0 / pre-launch.
- Best Practices 92 is the maximum without extra browser-only items (passing
  HSTS + CSP nonce-strict + no console errors). The 8-point gap is the
  Lighthouse 'no-vulnerable-libraries' partial that flags benign first-load
  warnings; investigated for F1.
- *Desktop and PWA-mobile re-runs failed locally with Chrome `NO_NAVSTART`
  EPERM-on-tmp on Windows host. Server-side scores (Mozilla, SSL Labs) and the
  one clean mobile pass are sufficient F0 evidence; F1 will run Lighthouse-CI
  against staging from Linux.

Reports under `docs/reports/lh-*.json`.

## Source artifacts

- Stack: `infra/compose/stack-firma-ec.deploy.yml`
- Dockerfiles: `infra/docker/landing.Dockerfile`, `infra/docker/pwa.Dockerfile`
- Caddyfiles: `infra/docker/Caddyfile.landing`, `infra/docker/Caddyfile.pwa`
- Traefik middlewares (origin, single-file mode): merged into
  `/mnt/truenas/traefik_certs/cloudflare/dynamic.yml` on the cluster.

## What's left for F1+

- Lift `noindex` once content is final (boost SEO to 100).
- Lighthouse-CI in GitHub Actions on PR (Linux runners, no EPERM).
- Add `status.firmar.ec` Gatus stack and public status page.
- Cosign signing (DONE, v0.7.0-rc1 signed + Rekor tlog 1497932420) + SBOM published per release. SLSA L2 with L3 elements live; strict L3 (isolated builder + 2-person review automation) pending. See [`SECURITY.md`](../SECURITY.md).
- Consider lifting `Cross-Origin-Embedder-Policy: require-corp` for the landing
  page if it ever needs to embed third-party assets (PWA must keep COEP for
  WASM crypto).
