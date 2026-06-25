# Guardrails — marca y YMYL (lectura obligatoria antes de publicar)

firmar.ec es contenido **YMYL** (firma electrónica = legal/confianza). Un dato incorrecto
daña al usuario, la marca y crea riesgo jurídico. Estas reglas no son opcionales.

## Reglas always-on (el sistema se las autoaplica en TODA pieza)

1. **Desambiguar `firmar.ec ≠ FirmaEC`.** FirmaEC es la app del Estado; los LLMs y usuarios
   las confunden. Toda pieza debe dejar explícito que firmar.ec es una herramienta web
   independiente. Nunca usar el logo/marca de FirmaEC sugiriendo afiliación.
2. **No prometer lo que el producto no hace.** firmar.ec **firma y verifica** PDFs (PAdES) y
   **verifica vigencia** de un certificado. NO emite certificados, NO "arregla" un rechazo de
   SENAE, NO renueva la firma (eso lo hace la ECI emisora). El valor legal lo dan el
   **certificado acreditado + la ley**, no la herramienta.
3. **Ningún CTA pide datos.** Respetar "sin formularios, sin tracking, sin cuenta". El CTA
   estándar apunta a `firmar.ec` / `app.firmar.ec` (o a `tienda.firmar.ec` para `.p12`), nunca
   a un formulario de captura.
4. **Privacidad como hecho técnico, no dictamen legal.** "Procesamiento 100% local, tu `.p12`
   nunca sale de tu equipo, open source" → permitido (es verificable). "Cumple LOPDP" como
   **certificación legal** → NO; redactar como característica de diseño.
5. **Publicación solo por API oficial** de cada red. Nunca automatización de navegador para el
   feed de marca; los bots de Marketplace quedan aislados en su negocio (riesgo de baneo).
6. **Sistema visual de marca**: Azul Fe `#1E3A8A`, Sello Ámbar `#C9821E`, Tinta `#0F172A`,
   Papel `#F8FAFC`; Plus Jakarta Sans + Inter. La "f" caligráfica nunca sobre azul sólido.

## Gate fail-closed: revisión humana obligatoria

Antes de publicar, va a **aprobación humana** cualquier pieza que:

- Sea del **Pilar 4** (validez legal de la firma electrónica, LCE 2002-67).
- Afirme un **hecho legal**, un **plazo/efecto de SENAE/SRI/SERCOP**, o **cumplimiento LOPDP**.
- Cite una **norma** (verificar la cita y la vigencia con fuente).

Aprobador: gerencia para gasto/publicación; un **revisor con criterio legal designado** para
YMYL. Buffer de 48 h para el Pilar 4. Pilares 1, 2, 3, 5, 6 **sin** afirmaciones legales →
auto-aprobación ligera (el sistema publica solo).

## Claims: permitido vs prohibido

| Tema | ✅ Permitido | ❌ Prohibido |
|------|-------------|-------------|
| Validez legal | "La firma electrónica tiene validez legal en Ecuador (LCE 2002-67) **cuando usas un certificado acreditado**." | "firmar.ec **da** validez legal." |
| SENAE/Ecuapass | "**Verifica gratis** si tu firma sigue vigente antes de transmitir a SENAE." | "firmar.ec **desbloquea** tu Ecuapass / **arregla** el rechazo." |
| Renovación | "Tu firma vence cada 1-2 años — **verifica** la vigencia aquí; renuévala con tu ECI / en tienda.firmar.ec." | "firmar.ec **renueva** tu certificado." (salvo flujo de tienda activo) |
| Privacidad | "Tu `.p12` nunca sale de tu equipo (open source, verifícalo)." | "firmar.ec es **legalmente** LOPDP-certificado." |
| Comparativa | "Sin Java, sin instalar programas; 100% en el navegador." (factual) | Denigrar a FirmaEC o afirmar fallas sin evidencia. |

## Reglas de creativo

- Los **how-to/demos** se graban **reales** de `app.firmar.ec` (no IA): no engañar sobre el
  flujo. La IA (higgsfield) solo para b-roll, fondos, intro/outro y voz es-EC.
- Todo video pasa por `virality_predictor` antes de publicar; se descarta lo que no supere el
  umbral de hook/retención.
- `tienda.firmar.ec` (`.p12`): **no** nombrar al partner emisor ni precios mayoristas en
  público; el comparador se presenta como **neutral**.
