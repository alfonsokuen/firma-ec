# Pilares de contenido, hooks y plantillas de copy

6 pilares. Cada pieza declara su pilar (define el gate y el `utm_campaign`). Leer
`guardrails.md` antes de producir. Gancho = primeros 3 s en pantalla; sin gancho fuerte no se
publica (lo descarta `virality_predictor`).

Plantilla de caption (todas las redes):
`[HOOK] + [1-2 líneas de valor + desambiguación firmar.ec≠FirmaEC] + [CTA a firmar.ec, sin pedir datos] + [hashtags es-EC]`

Hashtags base es-EC: `#Ecuador #FirmaElectrónica #Ecuapass #SENAE #SRI #Aduana #FirmaDigital #FirmarPDF`

---

## P1 — Firma vencida = Ecuapass/SENAE bloqueado  ·  `p1_ecuapass`

- **Audiencia:** B (importadores, exportadores, agentes de aduana). El de mayor LTV.
- **YMYL:** medio — verifica vigencia, NO "arregla" SENAE (guardrail #2).
- **Formato:** Reel/TikTok 9:16 problema→solución 15-25s + carrusel "5 señales de que tu firma
  está por vencer" + post LinkedIn B2B.
- **Hooks:**
  - "Si Ecuapass te rechaza el documento, **no es el sistema** — es tu firma."
  - "Tu firma venció y por eso SENAE no te deja transmitir. Verifícalo en 10 segundos."
- **CTA:** "Verifica gratis si tu firma sigue vigente en firmar.ec — sin instalar nada."

## P2 — Firma PDF gratis sin Java (alternativa honesta a FirmaEC)  ·  `p2_sin_java`

- **Audiencia:** A (general / firmantes de PDF). Volumen.
- **YMYL:** bajo. **Desambiguación obligatoria** en todo frame.
- **Formato:** Reel demo de pantalla (grabación real de `app.firmar.ec`) + carrusel comparativo
  factual "FirmaEC vs firmar.ec" (Java sí/no, dónde queda tu llave).
- **Hooks:**
  - "¿Cansado del Java de FirmaEC que nunca abre? Mira esto."
  - "Firma tu PDF sin descargar Java ni instalar nada."
- **CTA:** "Ábrelo en el navegador: firmar.ec. (No es el FirmaEC del gobierno — es una
  herramienta web independiente.)"

## P3 — Privacidad / la llave nunca sale de tu equipo  ·  `p3_privacidad`

- **Audiencia:** A + C (abogados/contadores). Diferenciador defendible.
- **YMYL:** bajo (privacidad como hecho técnico, no dictamen legal — guardrail #4).
- **Formato:** carrusel "qué pasa con tu certificado cuando firmas" (diagrama navegador-vs-nube)
  + Reel con voz es-EC.
- **Hooks:**
  - "Antes de subir tu firma a CUALQUIER web, mira dónde queda tu llave."
  - "Tu `.p12` nunca debería viajar por internet. Te muestro por qué."
- **CTA:** "Pruébalo tú mismo, es open source: firmar.ec."

## P4 — Validez legal de la firma electrónica (LCE 2002-67)  ·  `p4_validez`

- **Audiencia:** C profesional (contadores, abogados, empresas).
- **YMYL:** ALTO → **revisión humana/legal obligatoria, buffer 48 h** (gate fail-closed).
- **Formato:** post LinkedIn B2B + carrusel educativo + hilo X citando la norma.
- **Hooks:**
  - "¿Una firma electrónica vale como una de puño y letra? En Ecuador, sí — con una condición."
- **CTA:** "Aprende cómo firmar con validez en firmar.ec."
- **Guardrail duro:** NUNCA "firmar.ec da validez legal" (la dan el certificado acreditado + la
  ley). Citar siempre LCE 2002-67 con fuente. Todo copy pasa por el revisor legal.

## P5 — Renovación / vencimiento + comparador de emisores  ·  `p5_renovacion`

- **Audiencia:** C (renovación anual) + B. Capta intención de compra del `.p12`.
- **YMYL:** medio.
- **Formato:** carrusel "emisores/ECIs de Ecuador comparados (somos neutrales)" + Reel checklist
  de renovación + story con encuesta "¿sabes cuándo vence tu firma?".
- **Hooks:**
  - "Tu firma electrónica vence cada 1-2 años. ¿Sabes cuándo vence la tuya?"
- **CTA:** "Verifica la vigencia gratis en firmar.ec." (Tienda `.p12` cuando el flujo esté vivo.)
- **Guardrail:** comparador **neutral**; no nombrar al partner ni precios mayoristas (guardrail
  de creativo).

## P6 — Cómo firmar / tutoriales how-to  ·  `p6_howto`

- **Audiencia:** A (intención de búsqueda directa). Demo de producto, bajo riesgo.
- **YMYL:** bajo.
- **Formato:** Reel/Short **screen-recording real** de `app.firmar.ec` (no IA) + carrusel
  paso-a-paso; reusar el mismo guion en TikTok/Shorts.
- **Hooks:**
  - "Firma un PDF en 30 segundos, sin instalar nada. Listo, cronómetro."
  - "Cómo verificar si un PDF firmado es auténtico."
- **CTA:** "Hazlo tú ahora en firmar.ec."
