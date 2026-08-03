# Medición — cómo funciona y cómo se activa

La capa de medición vive en la landing (`apps/landing/src/components/Analytics.astro`,
inyectada por `BaseHead.astro`). Es **cookieless** y **inerte por defecto**: sin variables de
entorno el build emite HTML sin ningún script de analítica, y la promesa "sin tracking · LOPDP
por diseño" se mantiene. La verificación del build lo confirma (grep de `cloudflareinsights` /
`fecTrack` en `dist/` = vacío cuando no hay env).

## Qué mide

- **Tráfico y fuente** (orgánico): de qué canal/campaña llega la gente → Cloudflare Web
  Analytics + UTM en los enlaces de bio/posts.
- **Conversión** (intención): clics en los CTAs declarados con `data-cta` en la landing —
  `firmar`, `verificar`, `abrir_app`, `instalar_app`, `obtener_certificado`.
- **Atribución de campaña**: los parámetros UTM se guardan por sesión en `sessionStorage`
  (sin cookies, sin PII) y se adjuntan a cada evento.

## Activación

Todo es opt-in por variable de entorno (`PUBLIC_*`, inlinadas en el build estático). Ver
`apps/landing/.env.example`.

### 1) Cloudflare Web Analytics (orgánico — recomendado, cero fricción)

Cookieless, sin PII, **ya permitido por el CSP** (`Caddyfile.landing` →
`static.cloudflareinsights.com`). Dos formas:

- **Dashboard (sin deploy):** Cloudflare → Web Analytics → firmar.ec → activar inyección
  automática en el edge. No requiere tocar código ni reconstruir.
- **Repo-controlado:** poner el token en `PUBLIC_CF_BEACON_TOKEN` al construir; `Analytics.astro`
  inyecta el beacon. Usar **una** de las dos vías, no ambas (evita doble conteo).

### 2) Eventos de conversión first-party (opcional)

`PUBLIC_EVENTS_ENDPOINT` debe ser **same-origin** (CSP `connect-src 'self'`), p.ej.
`/api/stats/event`. El tracker hace `navigator.sendBeacon` con el evento + UTM (agregado, sin
PII). Pendiente: cablear ese endpoint en `stats-backend` para persistir los eventos de
marketing (hoy el endpoint sirve los contadores de firma). Sin endpoint, los eventos siguen
disponibles en `window.dataLayer` para un tag manager / CF Zaraz.

### 3) Meta Pixel — SOLO fase de pauta (NO activo)

Deliberadamente **fuera** de la capa actual. Activarlo requiere, en orden:

1. Página FB ✅ creada; faltan IG Business + Ad Account + emitir el Pixel — estado y procedimiento en `cuentas.md`.
2. **Cambiar el CSP** (`Caddyfile.landing`): añadir `https://connect.facebook.net` a
   `script-src` y `https://www.facebook.com` a `connect-src`/`img-src`.
3. Implementar un **banner de consentimiento LOPDP**: el Pixel solo inicializa tras opt-in
   explícito (usa cookies = tracking, incompatible con el default "sin tracking").
4. Recién entonces inyectar el Pixel (env `PUBLIC_META_PIXEL_ID`) gated por consentimiento.

Mientras no se haga esto, el Pixel **no** existe en el sitio y la marca no se contradice.

## Esquema de UTM (consistencia obligatoria)

Todo enlace saliente de redes a `firmar.ec` lleva UTM. Plantilla:

```
https://firmar.ec/?utm_source=<red>&utm_medium=<organico|paid>&utm_campaign=<pilar>&utm_content=<pieza>
```

- `utm_source`: `tiktok | instagram | facebook | linkedin | youtube | x | whatsapp`
- `utm_medium`: `organico` (o `paid` en la fase de pauta)
- `utm_campaign`: id del pilar (`p1_ecuapass`, `p2_sin_java`, `p3_privacidad`, `p4_validez`,
  `p5_renovacion`, `p6_howto`)
- `utm_content`: identificador corto de la pieza/variante (para A/B)

## KPIs (baseline del día 1)

- **Orgánico**: visitas por canal/UTM, CTR de bio, alcance/engagement por pieza/pilar.
- **Conversión**: clics `data-cta` (uso de herramienta) y clics a `tienda.firmar.ec`.
- **Producto** (métrica norte): serie de firmas/verificaciones de `/api/stats` (ya existe).
- **GEO**: citación de la marca en IA (re-medir vs baseline 0/4 del 2026-05-25).
