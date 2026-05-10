# QA Audit — firma-ec ecosystem + idkmanager.com blog post
**Fecha:** 2026-05-10
**HEAD SHA (firma-ec):** `8dba0f7e6a73acbf491a1fb4ef4ded802f7c4d7b`
**Status:** DONE_WITH_CONCERNS

## Scope
- `https://firmar.ec` — landing (Astro v0.1.9)
- `https://app.firmar.ec` — PWA (v0.6.0-rc7, F6 LIVE)
- `https://idkmanager.com` — institutional Astro
- `https://idkmanager.com/blog/firmar-ec-firma-electronica-ecuador-launch/`

## Findings summary

| Severity | Count |
|----------|-------|
| P0       | 0     |
| P1       | 1     |
| P2       | 4     |
| P3       | 0     |

---

## P0 — Critical
*(none)*

## P1 — High

### P1-1 — `og:image` referenced by blog post returns 404
- **Affected:** `https://idkmanager.com/blog/firmar-ec-firma-electronica-ecuador-launch/` and likely all posts using site default
- **Repro:** `curl -sI https://idkmanager.com/og-default.jpg` → `HTTP/1.1 404 Not Found`
- **Impact:** Social previews on WhatsApp, Twitter/X, Facebook, LinkedIn, Slack, Telegram show no image card. The largest immediate channel for the launch announcement.
- **Fix proposal:** Either (a) generate `og-default.jpg` (1200×630) and deploy to `/public/og-default.jpg`, or (b) override per-post `og:image` for the firmar.ec launch post with a dedicated brand image.

## P2 — Medium

### P2-1 — Cloudflare Insights beacon blocked by CSP on `firmar.ec` and `app.firmar.ec`
- **Repro:** Console error on every page load:
  > Loading the script `https://static.cloudflareinsights.com/beacon.min.js/...` violates the following Content Security Policy directive: "script-src 'self' 'unsafe-inline'..."
- **Impact:** No web-analytics signal from these two hosts (CF Web Analytics dead). Functional impact = none. Data impact = ongoing blind spot.
- **Fix proposal:** Decision required — either (a) disable CF Web Analytics on the zone (clean up the noise, drop the beacon entirely — aligns with "sin tracking" promise on app.firmar.ec) or (b) add `https://static.cloudflareinsights.com` to `script-src`. **Recommendation: option (a)** to honor the privacy stance documented in the PWA footer and About page.

### P2-2 — Blog post `og:type` is `website` (should be `article`)
- **Affected:** `/blog/firmar-ec-firma-electronica-ecuador-launch/`
- **Impact:** Reduced richness of social previews; LinkedIn/Twitter heuristics weight `article` differently. Minor SEO surface.
- **Fix proposal:** Set `og:type=article` on blog post layout; add `article:published_time`, `article:author`.

### P2-3 — Blog post `article:published_time` missing
- **Affected:** Same as P2-2.
- **Impact:** Date crawling depends on visible-text heuristic; loses signal in news aggregators.
- **Fix proposal:** Emit `<meta property="article:published_time" content="2026-05-10T...">` from blog frontmatter.

### P2-4 — Hero hero copy contains both "electrónico .p12" (new) AND "ecuatoriano" (old phrasing) on `firmar.ec/`
- **H1:** `Firma y verifica PDFs con tu certificado electrónico .p12.` — **correct**.
- **Body:** also contains "ecuatoriano" elsewhere (subhero / value props), which is fine prose-wise but worth a copy review to ensure the refresh is consistent.
- **Impact:** None functional; pure editorial polish.

## P3 — Low
*(none)*

---

## Per-host headers summary

| Host                   | HSTS preload | CSP strict | X-Frame | COEP            | Trusted-Types | Notes |
|------------------------|--------------|------------|---------|-----------------|---------------|-------|
| firmar.ec              | ✓            | ✓ (`unsafe-inline`+`unsafe-hashes`) | DENY    | credentialless  | n/a           | clean |
| app.firmar.ec          | ✓            | ✓ + `connect-src https://freetsa.org` ✓, `wasm-unsafe-eval` ✓ | DENY    | credentialless  | ✓ `require-trusted-types-for 'script'` | TSA + WASM whitelisted |
| idkmanager.com         | ✓            | ✓ (incl. GTM/GA/CF Insights) | DENY    | (not set)       | n/a           | analytics whitelisted |
| blog post              | ✓            | same as host | DENY  | (not set)       | n/a           | clean |

**All four hosts:** `referrer-policy`, `x-content-type-options: nosniff`, `permissions-policy` set. HSTS includes `preload` everywhere.

Raw headers: `_backups/F6.7-qa-audit-2026-05-10/headers/{firmar.ec,app.firmar.ec,idkmanager.com,blog-post}.txt`.

---

## Per-route render summary

| Route                                          | Desktop | Mobile | Console errors                       |
|------------------------------------------------|---------|--------|--------------------------------------|
| firmar.ec/                                     | ✓       | ✓      | 1 (CF Insights — see P2-1)           |
| app.firmar.ec/                                 | ✓       | —      | 1 (CF Insights — see P2-1)           |
| app.firmar.ec/#/verificar                      | ✓       | ✓      | 0                                    |
| app.firmar.ec/#/firmar                         | ✓       | ✓      | 0                                    |
| app.firmar.ec/#/configuracion                  | ✓       | ✓      | 0                                    |
| app.firmar.ec/#/about                          | ✓       | —      | 0                                    |
| app.firmar.ec/#/paranoia                       | ✓       | —      | 0                                    |
| firmar.ec/#/verificar?h=...  → app redirect    | ✓       | —      | 0 (banner "Verificando firma desde QR" present) |
| firmar.ec/firmar (301)                         | ✓       | —      | n/a (server redirect to app.firmar.ec/#/firmar) |
| idkmanager.com/                                | ✓       | ✓      | 0                                    |
| idkmanager.com/blog/                           | ✓       | —      | 0                                    |
| /blog/firmar-ec-firma-electronica-ecuador-launch/ | ✓     | ✓      | 0                                    |

**Mobile horizontal scroll:** none detected on tested routes (iPhone 14 Pro 390×844, viewport reports `scrollWidth==clientWidth==375`).

Screenshots: `_backups/F6.7-qa-audit-2026-05-10/screenshots/` (15 files).

---

## Real flow verifications

| Flow                                                                           | Result |
|--------------------------------------------------------------------------------|--------|
| Verify B-T sample → gold badge "Sellada por TSA · www.freetsa.org" visible     | ✓      |
| Verify panel shows PERFIL PADES = `B-T`                                        | ✓      |
| Verify panel shows engine = `0.5.0-rc4`                                        | ✓      |
| TRUST_PARTIAL banner "2 de 17 ACEs ARCOTEL tienen raíz real cargada"           | ✓      |
| QR deep-link `firmar.ec/#/verificar?h=abcdef0123` → `app.firmar.ec/#/verificar?h=abcdef0123` | ✓      |
| QR deep-link banner "Verificando firma desde QR · Documento del QR: abcdef0123" | ✓     |
| Configuración shows footer `versión 0.6.0-rc7`                                 | ✓      |
| Configuración: TSA toggle, URL `/api/tsa`, timeout 8000ms, "Probar TSA" button | ✓      |
| Wizard `/#/firmar` step 1 renders without error                                | ✓      |
| /firmar 301 redirect → app.firmar.ec/#/firmar                                  | ✓      |
| Blog post H1 contains "firmar.ec" + "Firma Electrónica Ecuatoriana"            | ✓      |
| Blog post outbound links (firmar.ec, app.firmar.ec, github.com/idkmanager) all 200 | ✓  |

---

## Bundle integrity (deployed app.firmar.ec)

- **Service Worker:** active, scriptURL `https://app.firmar.ec/sw.js`, count 1
- **Cache:** `workbox-precache-v2-https://app.firmar.ec/`
- **Verify worker (`verify.worker-DREEhgJX.js`, 429.8KB):** `TRUST_PARTIAL` ✓, `freetsa` ✓, `'B-T'` ✓, engine `0.5.0-rc4` ✓
- **Verificar route bundle (`Verificar-aA1jvbnV.js`, 26.6KB):** `TRUST_PARTIAL` ✓
- **Index (`index-D5_K4AKq.js`, 203.5KB):** `0.6.0-rc7` ✓, `/api/tsa` ✓, `multifirma_path` ✓
- **Sign worker (`sign.worker-BYTzylSo.js`, 1.19MB):** `freetsa` ✓ (TSA call site)
- **Largest single asset:** `sign.worker-BYTzylSo.js` 1.19MB (raw — gz expected ~350KB). Acceptable for off-main-thread sign worker.

All F6 fixes confirmed deployed.

---

## Blog post

- **URL:** `https://idkmanager.com/blog/firmar-ec-firma-electronica-ecuador-launch/`
- **Title:** "firmar.ec — firma electrónica ecuatoriana 100% en tu navegador | IDK MANAGER"
- **H1:** matches title.
- **Description (meta + og:description):** "Lanzamos firmar.ec: PWA gratuita y open source para firmar y verificar PDFs con tu certificado .p12 ecuatoriano. Sin servidores, sin telemetría, cumple LOPDP." — accurate, well-targeted.
- **Canonical:** ✓ self-referencing.
- **OG image:** ✗ **404** (P1-1).
- **og:type:** `website` (P2-2).
- **article:published_time:** missing (P2-3).
- **twitter:card:** `summary_large_image` ✓.
- **Outbound links:** firmar.ec ✓ 200, app.firmar.ec ✓ 200, github.com/idkmanager/firma-ec ✓ 200.
- **Indexed in /blog/ list:** ✓.
- **Mobile:** no horizontal scroll, fonts legible.

---

## Recommended actions (priority order)

1. **P1-1** — Ship `og-default.jpg` (1200×630) **today** to `idkmanager.com` to fix social preview for the launch post. Shareability is the launch's force multiplier and currently broken.
2. **P2-1** — Decide CF Insights stance for firmar.ec / app.firmar.ec. Recommendation: drop the beacon to honor "sin telemetría" claim. One-click in CF dashboard.
3. **P2-2 + P2-3** — Update blog Astro layout: `og:type=article` for posts, emit `article:published_time` from frontmatter. Single PR.
4. **P2-4** — Editorial pass on `firmar.ec` to harmonize the "electrónico .p12" / "ecuatoriano" mix. Cosmetic.

---

## Verification gates

- [x] All hosts headers dumped (4 files)
- [x] All target routes captured (12 routes, 15 screenshots desktop+selected mobile)
- [x] Real B-T verify completed (TRUST_PARTIAL, B-T, 0.5.0-rc4, freetsa.org all ✓)
- [x] QR redirect verified
- [x] Bundle integrity check completed (rc7, /api/tsa, multifirma_path, TRUST_PARTIAL all present)
- [x] Blog post deep-check completed
- [x] AUDIT-REPORT.md written

**Status: DONE_WITH_CONCERNS** — No P0/P1 blockers in firma-ec proper. P1-1 (`og-default.jpg` 404) is in idkmanager.com, blocks social-preview success of the launch post.
