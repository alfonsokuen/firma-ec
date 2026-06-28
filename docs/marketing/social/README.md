# Motor de contenido social — firmar.ec

Sistema operativo para producir y publicar contenido orgánico en redes sociales de
forma recurrente, con guardrails de marca y YMYL. Es la fuente de verdad que consumirá
el orquestador (servicio en Swarm IAS, fase posterior); por ahora opera como guía +
configuración versionada.

> Contexto estratégico completo y números de mercado en la memoria del proyecto
> `_memory/project_firmarec_social_ads_system_2026-06-24.md`.

## La cuña (por qué ganamos)

Tres carriles competitivos **vacíos** que ningún rival ocupa — se gana voz por
**posicionamiento, no por presupuesto**:

1. **Firma vencida = SENAE/Ecuapass bloqueado** — el dolor de mayor LTV (importadores,
   exportadores, agentes de aduana parados). Nadie lo pauta. Monetiza vía la venta de
   `.p12` en `tienda.firmar.ec`.
2. **Privacidad verificable / cero-custodia** — "tu `.p12` nunca sale de tu equipo, open
   source, verifícalo". Los rivales suben la firma a su nube o exigen instalar; no pueden
   responder sin contradecirse.
3. **Árbitro neutral** — no vendemos un emisor: comparamos sin sesgo.

La competencia pelea por **precio y velocidad de emisión** (un eje donde firmar.ec no
compite porque no emite). Casi nadie pauta → CPMs baratos cuando se active la fase de pago.

## Canales (mercado EC, DataReportal Digital 2026)

| Rol | Canal | Audiencia | Cadencia orgánica |
|-----|-------|-----------|-------------------|
| Primario | **TikTok** | General / firmantes de PDF | 3-4/sem |
| Primario | **Facebook** (Página + grupos comex) | General 25-44 + aduana | 2-3/sem |
| Secundario (costo-cero) | **Instagram / Reels** | Joven freelance/emprendedor | 2-3/sem (espejo de TikTok) |
| Secundario (B2B) | **LinkedIn** | Aduana/comex + contadores | 1-2/sem |
| Conversión/soporte | **WhatsApp Business** | Transversal → venta `.p12` | reactivo |
| Diferido | **YouTube** | Intención tutorial + SEO | 1/mes evergreen |
| Defensivo | **X** | — | solo reservar handle |

Una sola **fábrica de creativos** (un screen-recording vertical reciclado TikTok→IG→FB).

## Cómo opera (ciclo por pieza)

1. **Generar** — guion de un pilar → creativo (screen-recording real + higgsfield IA solo
   para hook/intro) → pre-filtrar con `virality_predictor`.
2. **Gate** — ver `guardrails.md`. Pilar 4 (legal/YMYL) y todo claim legal → revisión humana.
3. **Publicar** — solo por **API oficial** de cada red (nunca automatización de navegador;
   los bots de Marketplace quedan aislados en su negocio).
4. **Medir** — UTM por canal (ver `medicion.md`) + Cloudflare Web Analytics + eventos
   `data-cta` de la landing.

## Autonomía (máxima dentro de límites duros)

El sistema corre **solo** en todo lo reversible y en publicar contenido de patrón validado.
Solo dos frenos **fail-closed** (crean pasivo real):

- **Afirmaciones legales (YMYL)** — validez LCE 2002-67, plazos SENAE, cumplimiento LOPDP
  → aprobación humana antes de publicar.
- **Gasto de dinero** — la pauta corre dentro de un tope mensual fijado por gerencia; subir
  el tope o abrir un canal pago nuevo → confirmación.

Guardrails always-on (no gates, reglas que el sistema se autoaplica): desambiguar
`firmar.ec ≠ FirmaEC`, nunca "arregla SENAE" ni "emite certificados", ningún CTA que pida
datos/registro, publicación solo por API oficial.

## Archivos

- `guardrails.md` — reglas de marca y YMYL (de lectura obligatoria antes de publicar).
- `pilares-y-hooks.md` — los 6 pilares, ganchos de 3s y plantillas de copy + CTA.
- `calendario.md` — cadencia por red, semana tipo y esquema de UTM.
- `medicion.md` — cómo medir y cómo activar cada sumidero (incl. la fase de pauta/Pixel).
- `cuentas.md` — runbook de cuentas y activos reales (BM, Página, IG, Ad Account, Pixel) + estado y gotchas.
- `content-config.json` — la misma información, legible por máquina (para el orquestador).
