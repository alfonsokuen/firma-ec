# Lighthouse-fallback audit — firmar.ec / app.firmar.ec

**Fecha**: 2026-05-10
**Tool**: Playwright + CDP (`scripts/lh-fallback-2026-05-10.mjs`) — lighthouse CLI no instalado en el sandbox; las metricas son aproximaciones equivalentes (Web Vitals via `performance.getEntriesByType`).
**Viewport**: 1280×800 (desktop). Mobile NO corrido (sin lighthouse CLI no hay ajuste de CPU/network throttling; un emulado a esta resolucion no aportaria datos confiables).

---

## Performance proxies (ms, transferencia, requests)

| URL | TTFB | FCP | reqs | bytes | failed | console errs |
|---|---:|---:|---:|---:|---:|---:|
| https://firmar.ec/ | 7696* | 7783* | 9 | 103 KB | 1 | 1 |
| https://firmar.ec/contacto | 356 | 442 | 9 | 102 KB | 1 | 1 |
| https://firmar.ec/acerca | 337 | 429 | 9 | 102 KB | 1 | 1 |
| https://firmar.ec/privacidad | 338 | 418 | 9 | 102 KB | 1 | 1 |
| https://app.firmar.ec/ | 384 | 961 | 8 | 375 KB | 1 | 1 |
| https://app.firmar.ec/#/firmar | 205 | 489 | 8 | 375 KB | 1 | 1 |
| https://app.firmar.ec/#/verificar | 178 | 417 | 10 | 383 KB | 1 | 1 |
| https://app.firmar.ec/#/configuracion | 225 | 452 | 9 | 379 KB | 1 | 1 |

*Cold-cache outlier en `firmar.ec/`: 7.7s en primer hit. Subsiguientes < 500ms. Probable Cloudflare cold cache + Astro SSG cache miss del worker edge. No bloqueante; monitorear si se repite.

LCP no capturado (no se disparo en `networkidle`; SPA routing emite LCP solo en first paint del shell, ya cubierto por FCP).

## SEO / meta

| URL | title | desc | og:image | canonical | lang |
|---|---|---|---|---|---|
| Landing (4 rutas) | OK | OK | OK | OK | `es-EC` |
| PWA (4 rutas) | OK | OK | OK | **MISSING** | `es` |

**PWA canonical missing**: esperado para SPA con hash-router (no se puede emitir canonical estatico distinto por ruta). Documentado, no accionable sin SSR.

## A11y proxies

- Landing: 100% de `<button>` (1/1) y `<a>` (28–39 segun ruta) con accessible name. Sin `<img>` (icon-set vibre OK).
- PWA: idem. 3–9 botones segun ruta, todos nombrados.
- `<html lang>` presente en todas las rutas.

## Hallazgos consistentes

### 1. CSP bloquea Cloudflare Web Analytics beacon (8/8 rutas)

```
Refused to load script 'https://static.cloudflareinsights.com/beacon.min.js/...'
violates CSP directive script-src 'self' 'unsafe-inline'.
```

**Estado**: comportamiento esperado del hardening F0/F1. CF agrega el beacon automaticamente en zone con Web Analytics ON. Para aceptarlo habria que whitelist `*.cloudflareinsights.com` en `script-src` + `connect-src`. Decision actual: **dejar bloqueado**, no necesitamos analytics third-party. Documentar para futuras auditorias.

### 2. PWA payload 3.6× la landing

PWA ~375 KB total transferido (8–10 requests) vs landing ~102 KB. Razonable: PWA incluye SW + Svelte runtime + pdf-lib + asn1js stubs. Dentro de presupuesto F3 (≤200 KB gzip per chunk OK).

## Followups sugeridos (no este sweep)

- Instalar `lighthouse` CLI en proximo sweep y correr modo mobile con throttling Slow 4G para cifras categoricas (P/A/BP/SEO scores 0–100).
- Inyectar `axe-core` via `@axe-core/playwright` para reporte WCAG real (no solo proxies).
- Investigar cold-cache 7.7s en `firmar.ec/` — repetir audit en 24h, si se repite ajustar cache headers Caddy.

## Artifacts

- `_backups/F7-followup-2026-05-10/lighthouse-results.json` — raw JSON (8 rutas, perf+meta+network+console).
- `scripts/lh-fallback-2026-05-10.mjs` — script reproducible.
