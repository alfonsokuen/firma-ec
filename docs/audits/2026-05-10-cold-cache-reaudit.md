# Cold-cache re-audit — firmar.ec / app.firmar.ec

**Date:** 2026-05-10
**Method:** Playwright Chromium, cleared cache, cache-busted URL (`?cb=cold1`), Performance Observer LCP, viewport 1280×800.
**Network:** broadband, no throttling (default Chromium).
**Origin:** desde la PC de desarrollo en Ecuador (regional CF edge GUA/UIO).

## Resultados

### Landing — `https://firmar.ec/?cb=cold1`

| Métrica | Valor |
|---|---|
| TTFB | **179 ms** |
| FCP | **300 ms** |
| LCP | **334 ms** |
| DOMContentLoaded | 243 ms |
| loadEvent | 250 ms |
| Transfer (HTML, comprimido) | 23 KB |

Headers relevantes:
```
HTTP/2 200
cache-control: public, max-age=300, must-revalidate
cf-cache-status: DYNAMIC
strict-transport-security: max-age=31536000; includeSubDomains; preload
```

### PWA — `https://app.firmar.ec/?cb=cold1`

| Métrica | Valor |
|---|---|
| TTFB | **319 ms** |
| FCP | **549 ms** |
| LCP | **549 ms** |
| DOMContentLoaded | 480 ms |
| Transfer (shell HTML) | 4 KB |

LCP coincide con FCP porque el shell de la PWA es minimal — los chunks Svelte cargan post-FCP pero no son LCP candidates.

## Comparación contra concern previo

El audit registrado a inicios de la sesión hablaba de **~7.7s cold cache** en firmar.ec/. La medición de hoy (mismo método, distintos cache-busters, regional CF edge) muestra **334 ms LCP — 23× más rápido** que el número original.

**Hipótesis de la divergencia (no reproducida):**
1. **Spike CF edge miss** durante un deploy reciente: las medidas anteriores cayeron justo en el ciclo de invalidación de cache CF cuando se desplegaron v0.5.0 → v0.6.x → v0.7.0 LTV en cadena.
2. **Bundle reduction**: landing pasó de 0.1.4 → 0.1.12 con SVG inlines reemplazando assets externos.
3. **Bot traffic**: ChatGPT-User/Perplexity bots desbloqueados 2026-05-10 podrían haber competido por CF origin durante una ventana, pero ya están allowlisted vía WAF.

## Decisión

Cold-cache no es un blocker actual. Métricas actuales pasan Core Web Vitals "Good" tier (LCP <2.5s) por amplísimo margen. **Tarea cerrada** — re-auditar solo si reaparece síntoma.

## Follow-up

- Considerar pasar `cache-control` de `must-revalidate` a `s-maxage=300, stale-while-revalidate=86400` para que CF sirva stale durante revalidación origen y mejore p99 cold globalmente.
- Repetir audit desde Lighthouse-CI cron (cosido a CI release.yml) para detectar regresiones automáticamente — abre una entrada de roadmap.
