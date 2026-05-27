# Solicitudes formales de Root CA — ACEs ARCOTEL pendientes

> 2026-05-15 · firma.ec v0.7.5 · 5 ACEs SRI-aceptadas todavía con placeholder en `@firma-ec/tsl-ec`
> Cada email pide el certificado raíz autofirmado en formato PEM/DER para integración en la Trust Service List local de la PWA `firmar.ec`.

Contexto que reusan todos los emails:

- firma.ec es una PWA pública open-source operada por IDK Manager Cia. Ltda. (RUC `1791999023001`, Quito) para que cualquier ciudadano ecuatoriano firme y verifique PDFs PAdES con su certificado .p12, sin instalación y sin enviar el documento a un servidor.
- Repositorio: `https://github.com/idkmanager/firmar-ec` · Licencia AGPL-3.0.
- La PWA mantiene una Trust Service List (TSL) embebida con las 17 entidades de certificación acreditadas por ARCOTEL. Hoy 4/17 cargan la raíz real (Eclipsoft, UanaTaca, ArgosData, Datil); 5 entidades aceptadas por SRI en gob.ec siguen como placeholder por falta de un endpoint público bien conocido para la raíz.
- Se requiere el certificado de la **CA raíz autofirmada** (no la subordinada ni un end-entity), en `.pem`, `.cer` o `.crt`. Si publican el `.crt` en una URL fija nos sirve; si no, lo recibimos por correo.

Remitente sugerido: `gerencia@idkmanager.com` (Alfonso Kuen Arroyo, representante legal IDK Manager Cia. Ltda.). CC opcional `dpo@idkmanager.com` para trazabilidad LOPDP.

---

## 1) Banco Central del Ecuador — Entidad de Certificación de Información (ECI-BCE)

**Para:** `seguridad@bce.ec`
**CC:** `consultaseci@bce.fin.ec`
**Asunto:** Solicitud de certificado raíz de la ECI-BCE para integración en TSL local de firmar.ec (PWA pública open-source)

Estimados:

Soy Alfonso Kuen Arroyo (RUC 1791999023001 — IDK Manager Cia. Ltda.). Operamos `firmar.ec`, una PWA pública de código abierto que permite a cualquier ciudadano ecuatoriano firmar y verificar PDFs en formato PAdES sin instalar nada y sin enviar el documento a un servidor (todo el proceso ocurre en el navegador). El código está bajo AGPL-3.0 en `github.com/idkmanager/firmar-ec`.

La herramienta requiere una Trust Service List local con los certificados raíz de las 17 ACEs acreditadas por ARCOTEL. Hoy tenemos la raíz real de 4 entidades. La de la ECI-BCE no está disponible públicamente: el endpoint histórico `https://www.bce.fin.ec/aia/eciroot.crt` responde con la página de "Por políticas de seguridad del BCE el requerimiento de despliegue del URL fue rechazado".

Solicito formalmente:

1. El certificado de la CA raíz autofirmada de la ECI-BCE (`Subject == Issuer`), en formato PEM o DER.
2. La huella SHA-256 esperada para validación independiente.
3. Si está dentro de su política, autorización para servirlo desde una URL pública estable de bce.fin.ec (necesario para que la PWA pueda verificar la TSL contra el origen).

El uso es exclusivamente trust-anchor para validar firmas PAdES de ciudadanos que firman con su certificado .p12 ECI-BCE. No se almacena ni transmite ningún dato del firmante. La integración será visible en `https://app.firmar.ec` y reportada en el changelog público.

Estoy a la orden para cualquier coordinación adicional, contrato de uso, o requisitos formales del DPC del BCE.

Saludos cordiales,
Alfonso Kuen Arroyo
Representante Legal · IDK Manager Cia. Ltda.
+593 95 888 8193 · `gerencia@idkmanager.com`

---

## 2) Security Data Seguridad en Datos y Firma Digital S.A.

**Para:** `info@securitydata.net.ec`
**CC:** `soporte@securitydata.net.ec`
**Asunto:** Solicitud de certificado raíz Security Data para integración en TSL local de firmar.ec

Estimados:

Soy Alfonso Kuen Arroyo, representante legal de IDK Manager Cia. Ltda. (RUC 1791999023001). Operamos la PWA pública de código abierto `firmar.ec` — firma y verificación de PDFs en formato PAdES, todo en navegador, sin envío del documento a ningún servidor. AGPL-3.0 en `github.com/idkmanager/firmar-ec`.

Para validar firmas hechas con certificados emitidos por Security Data necesito incorporar su **CA raíz autofirmada** a la Trust Service List embebida en la PWA. Reviso el sitio `securitydata.net.ec` y no encuentro un repositorio público con el `.cer` de la raíz (existen los CPS pero no el cert).

Solicito por favor:

1. El `.cer`/`.pem` de la CA raíz autofirmada de Security Data.
2. Huella SHA-256 esperada.
3. URL estable donde la PWA pueda hacer fetch periódico si está dentro de su política.

El cert se va a publicar embebido en el código abierto bajo AGPL-3.0 (cualquier persona puede auditar el sha256 y compararlo con el que ustedes publiquen oficialmente). No procesamos ni almacenamos datos de firmantes — la verificación es 100% del lado del cliente.

Quedo atento a su confirmación o requisitos adicionales.

Saludos,
Alfonso Kuen Arroyo
IDK Manager Cia. Ltda.
+593 95 888 8193 · `gerencia@idkmanager.com`

---

## 3) Consejo de la Judicatura — ECI

**Para:** `transparencia@funcionjudicial.gob.ec`
**CC:** `firma.electronica@funcionjudicial.gob.ec`
**Asunto:** Solicitud de certificado raíz ECI Consejo de la Judicatura — integración firmar.ec

Estimados:

Soy Alfonso Kuen Arroyo, representante legal de IDK Manager Cia. Ltda. (RUC 1791999023001). Operamos `firmar.ec`, una PWA pública de código abierto (AGPL-3.0, `github.com/idkmanager/firmar-ec`) que permite a ciudadanos ecuatorianos firmar y verificar PDFs con su certificado .p12 sin instalación y sin envío del documento a ningún servidor.

La PWA mantiene una Trust Service List local con las 17 entidades de certificación acreditadas por ARCOTEL. Para validar firmas hechas con certificados emitidos por la ECI del Consejo de la Judicatura, necesito el certificado de su **CA raíz autofirmada** en formato PEM o DER.

No encuentro un repositorio público en `funcionjudicial.gob.ec` con el `.cer` de la raíz, ni un subdominio PKI (`firmadigital.funcionjudicial.gob.ec` y `eci.funcionjudicial.gob.ec` no resuelven en DNS público).

Solicito formalmente:

1. El certificado raíz de la ECI Consejo de la Judicatura (`.pem`/`.cer`/`.crt`).
2. Huella SHA-256 esperada.
3. Si es viable, publicación en URL fija oficial para fetch periódico desde la PWA.

Quedo a la orden para cualquier requisito formal del área de Tecnología o de Transparencia que necesiten.

Saludos cordiales,
Alfonso Kuen Arroyo
Representante Legal · IDK Manager Cia. Ltda.
+593 95 888 8193 · `gerencia@idkmanager.com`

---

## 4) ANFAC Autoridad de Certificación Ecuador C.A.

**Para:** `info@anfac.es` (no encuentro presencia web en .ec — la matriz española es la única vía pública)
**CC:** `arcotel@arcotel.gob.ec` (para verificación cruzada del estado operativo de ANFAC-EC)
**Asunto:** Solicitud de certificado raíz ANFAC AC Ecuador — integración TSL firmar.ec

Estimados:

Soy Alfonso Kuen Arroyo, representante legal de IDK Manager Cia. Ltda. (RUC 1791999023001 — Ecuador). Operamos la PWA pública de código abierto `firmar.ec` (AGPL-3.0, `github.com/idkmanager/firmar-ec`) para firma y verificación de PDFs PAdES por parte de cualquier ciudadano ecuatoriano.

ANFAC Autoridad de Certificación Ecuador C.A. figura entre las 17 ACEs acreditadas por ARCOTEL en Ecuador y está en el subset aceptado por el SRI para los trámites en gob.ec. Sin embargo no encuentro presencia web operativa de la entidad en Ecuador (los dominios `anfac.ec`, `anfac.com.ec` no resuelven en DNS). Por eso escribo a la matriz española.

¿Pueden orientarme sobre:

1. ¿ANFAC AC Ecuador C.A. mantiene operación activa? ¿La raíz utilizada para certificados emitidos en Ecuador es la misma que la raíz ANF española o es una raíz local distinta?
2. URL pública o copia del certificado raíz autofirmado utilizado para certificados ANFAC EC.
3. Huella SHA-256 esperada.

Si la entidad ya no opera en Ecuador, agradecería confirmación formal para retirarla del scope activo de la TSL (la dejaremos listada por ARCOTEL pero marcada como inactiva).

Saludos cordiales,
Alfonso Kuen Arroyo
IDK Manager Cia. Ltda.
+593 95 888 8193 · `gerencia@idkmanager.com`

---

## 5) Dirección General de Registro Civil — ECI

**Para:** `comunicacion@registrocivil.gob.ec`
**CC:** `arcotel@arcotel.gob.ec`
**Asunto:** Solicitud de certificado raíz ECI Registro Civil — integración firmar.ec

Estimados:

Soy Alfonso Kuen Arroyo, representante legal de IDK Manager Cia. Ltda. (RUC 1791999023001). Operamos la PWA pública de código abierto `firmar.ec` (AGPL-3.0, `github.com/idkmanager/firmar-ec`).

Mantenemos una Trust Service List local con las 17 ACEs acreditadas por ARCOTEL. Para validar firmas emitidas con certificados ECI Registro Civil necesito el certificado de su **CA raíz autofirmada** en formato PEM o DER.

No encuentro un repositorio público en `registrocivil.gob.ec` con el `.cer` de la raíz.

Solicito:

1. El certificado raíz de la ECI Registro Civil (`.pem`/`.cer`/`.crt`).
2. Huella SHA-256 esperada.
3. URL fija oficial donde podamos hacer fetch periódico desde la PWA si está dentro de su política.

Aunque su ECI no figura en el subset de gob.ec del SRI, sí está acreditada por ARCOTEL y debe poder verificarse contra una raíz real cuando un ciudadano firme con un cert emitido por ustedes.

Saludos cordiales,
Alfonso Kuen Arroyo
Representante Legal · IDK Manager Cia. Ltda.
+593 95 888 8193 · `gerencia@idkmanager.com`

---

## Seguimiento

| ACE | Email | Estado | Próxima acción |
|---|---|---|---|
| BCE | `seguridad@bce.ec` | redactado | enviar 2026-05-15 |
| Security Data | `info@securitydata.net.ec` | redactado | enviar 2026-05-15 |
| Judicatura | `transparencia@funcionjudicial.gob.ec` | redactado | enviar 2026-05-15 |
| ANFAC | `info@anfac.es` + ARCOTEL CC | redactado | enviar 2026-05-15 |
| Registro Civil | `comunicacion@registrocivil.gob.ec` | redactado | enviar 2026-05-15 |

Cuando lleguen respuestas → guardar PEM en `packages/tsl-ec/src/roots/<slug>-2024.pem`, flip `isPlaceholder:false`, actualizar `fingerprintSha256`/`validFrom`/`validUntil`/`notes` en `roots.ts` + `build-json.ts`, bumpear TSL_SEQUENCE, rebuild PWA, commit + tag patch (p.ej. `v0.7.6` por cada raíz que entre).
