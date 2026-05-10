# F6 QA Audit — 2026-05-10

Live Playwright + curl audit run against production right before the
F6.2 (`v0.6.0-rc2`) deploy. Reproduces what an end-user with a fresh
browser sees today.

## Scope
- Hosts: `https://firmar.ec` (Astro landing) + `https://app.firmar.ec` (PWA).
- Routes: 8 (1 landing home + 1 landing 404 + 6 PWA routes).
- Viewports: desktop 1440×900 + mobile 390×844 (iPhone 14 Pro).
- Captures: full-page screenshots, console errors (level=error), network
  requests, raw HTTP response headers via curl.

## Console errors (aggregated, all 14 page loads)

| URL | Level | Message |
|-----|-------|---------|
| `https://firmar.ec/` | error | CSP blocks `https://static.cloudflareinsights.com/beacon.min.js/...` (`script-src 'self' 'unsafe-inline' 'unsafe-hashes'`). |
| `https://firmar.ec/como-funciona-wa/` | error | 404 — page never deployed (F3.5 docs scope deferred per memoria). |
| `https://firmar.ec/favicon.ico` | error | 404 — Astro landing has no favicon at root. |
| All PWA routes | none | **clean — zero JS errors / network failures**. |

The CF Insights script is **expected** to be blocked: it's the Cloudflare
Web Analytics beacon, the strict CSP `script-src 'self'` is intentional,
and we don't depend on Insights for anything load-bearing. Optionally
remove the beacon `<script>` injection from the Cloudflare zone settings
(or relax the CSP, which we will not do).

## Network requests >=400

| Route | Status | URL |
|-------|--------|-----|
| `/como-funciona-wa/` | 404 | landing — page does not exist yet |
| `firmar.ec/favicon.ico` | 404 | landing — no `/favicon.ico` artifact |
| All other routes | 2xx only | — |

PWA had **zero** 4xx/5xx during the audit.

## Header audit

Both `firmar.ec` and `app.firmar.ec` ship the full hardening stack. Highlights:

| Header | firmar.ec | app.firmar.ec |
|--------|-----------|---------------|
| `strict-transport-security` | `max-age=31536000; includeSubDomains; preload` | same |
| `x-frame-options` | `DENY` | `DENY` |
| `x-content-type-options` | `nosniff` | `nosniff` |
| `referrer-policy` | `no-referrer` | `no-referrer` |
| `cross-origin-embedder-policy` | `credentialless` | `credentialless` |
| `cross-origin-opener-policy` | `same-origin` | `same-origin` |
| `permissions-policy` | strict (camera, mic, geo, payment etc all blocked) | strict + `web-share=(self)`, `clipboard-write=(self)` |
| `content-security-policy` | strict, no externals | strict + `connect-src 'self' https://ocsp.firmar.ec https://freetsa.org`, `worker-src 'self' blob:`, `require-trusted-types-for 'script'` |
| `x-robots-tag` | (none) | `noindex, nofollow` |

Critical for F6: `app.firmar.ec` CSP retains `https://freetsa.org` in
`connect-src` after the rc2 deploy — verified post-deploy.

Raw header dumps in `headers/landing.txt` + `headers/app.txt`.

## Layout / visual

Spot-checked the 14 screenshots. No obvious layout breakage on either
viewport. Landing hero, PWA Firmar wizard step 1, Verificar dropzone,
Configuración TSA panel, Paranoia card, About cards, Footer all render
correctly desktop + mobile.

## Service-worker cache caveat

PWA registers with `registerType: 'prompt'` (not `autoUpdate`) — users
who already loaded `0.6.0-rc1` will keep serving rc1 from their service
worker until they manually accept the update prompt OR clear the cache.
The new bundle hashes (`index-B5STMWNv.js`, sign-worker chunk renamed)
guarantee `0.6.0-rc2` arrives once they reload after accepting the
prompt — but until then they'll still see the silent-no-feedback bug
F6.2 was meant to fix.

## Action items

| Priority | Item | Owner |
|----------|------|-------|
| P3 | Add a tiny `/favicon.ico` to landing | infra |
| P3 | Decide: deploy `/como-funciona-wa/` (F3.5) OR remove the link from any landing nav that points to it | content |
| P4 | Optional: disable Cloudflare Web Analytics beacon injection on the `firmar.ec` zone to silence the CSP error in console | infra |

No P0/P1/P2 issues found. Deploy approved.
