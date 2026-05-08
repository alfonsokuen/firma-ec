---
title: "Aviso de Privacidad"
description: "Política de protección de datos personales de firmar.ec conforme a la LOPDP del Ecuador. Versión 1.0."
lang: es
datePublished: "2026-05-08"
h1: "Aviso de Privacidad"
breadcrumbs:
  - { name: "Aviso de Privacidad", url: "https://firmar.ec/privacidad" }
---

**Versión 1.0** · Vigente desde 2026-05-08

## Resumen ejecutivo (lo importante en 30 segundos)

- **Cero recolección en servidor.** firmar.ec no almacena tu certificado, tu contraseña, tus PDFs, ni los firmados. La firma sucede 100% en tu navegador.
- **No usamos cookies, ni analytics, ni terceros.** No hay Google Analytics, no hay Meta Pixel, no hay píxel de seguimiento, no hay CDN externo que reciba tus archivos.
- **Logs CDN mínimos**: Cloudflare procesa tráfico TLS y guarda logs por hasta 14 días con IP truncada. Esos logs los maneja Cloudflare como subprocesador.
- **Retención cero** en infra IDK Manager (origen Ecuador, Swarm IDK).
- **Tus derechos ARCO+** se ejercen escribiendo a [datos@firmar.ec](mailto:datos@firmar.ec). Respondemos en máximo 15 días.

## 1. Identidad del responsable

- **Responsable**: IDK Manager (Quito, Ecuador). Operador del servicio firmar.ec.
- **Delegado de Protección de Datos (DPO)**: contacto vía [datos@firmar.ec](mailto:datos@firmar.ec).
- **Domicilio**: Quito, Pichincha, Ecuador.

## 2. Bases de licitud (art. 7 LOPDP)

Al ser una herramienta cliente puro, **no procesamos datos personales en nuestros servidores**. Las únicas bases de licitud aplicables son:

| Tratamiento | Base de licitud |
|---|---|
| Logs de acceso CDN (IP truncada, user-agent agregado) | Interés legítimo (seguridad operacional) |
| Email entrante a `contacto@`, `datos@`, `security@` | Consentimiento del remitente |

## 3. Categorías de datos que NO tratamos

Para evitar dudas, declaramos explícitamente que firmar.ec **no recolecta, transmite, almacena ni procesa**:

- El contenido de tus PDFs antes o después de firmar
- Tu archivo `.p12`, `.pfx` o cualquier otro contenedor de llave privada
- Tu contraseña del certificado
- Tu cédula, RUC, nombre, teléfono ni cualquier otro dato de identidad personal
- Tu ubicación, dispositivo, ni huella digital del navegador
- Tu historial de uso de la aplicación

## 4. Datos que SÍ tratamos (y por qué)

- **Logs CDN de Cloudflare**: IP truncada (último octeto eliminado), user-agent agregado por categoría, código HTTP de respuesta, timestamp. Retención 14 días.
- **Email entrante**: si nos escribes, tu dirección de correo y el contenido de tu mensaje quedan en el buzón hasta que tú o nosotros lo borremos.

## 5. Subprocesadores

| Subprocesador | Función | Datos | Ubicación contractual |
|---|---|---|---|
| Cloudflare | CDN + WAF + Tunnel | Logs CDN ≤14 días | Global edge |
| Let's Encrypt | Emisión certificado TLS | CSR público (sin datos personales) | EU (ISRG) |
| GitHub | Repositorios públicos | Código + commits | US |

Cualquier transferencia internacional inevitable se cubre bajo cláusulas contractuales modelo y la legislación ecuatoriana de protección de datos. No hay transferencia internacional de datos personales relevante porque no recolectamos datos personales en servidor.

## 6. Tus derechos ARCO+ (art. 12 LOPDP)

Tienes derecho a **A**cceso, **R**ectificación, **C**ancelación, **O**posición, **portabilidad**, **suprimir**, y **oponerte a decisiones automatizadas**. Como no almacenamos datos personales identificables, en la práctica solo aplican:

- Derecho a **acceso/cancelación** del email que nos hayas enviado: escribe a `datos@firmar.ec` con copia de tu correo original; lo eliminamos dentro de 15 días.
- Derecho a **información** (este aviso): siempre publicado en `/privacidad` con histórico de versiones en el repositorio público.

Plazo de respuesta: **15 días hábiles** desde la recepción.

## 7. Notificación de brechas

En caso de detectar una brecha de datos personales, notificaremos a la **Superintendencia de Protección de Datos Personales (SPDP)** en máximo 5 días hábiles (art. 46 LOPDP) y a los titulares afectados si hubiera riesgo significativo. Dado el modelo cliente puro, una brecha de datos personales en nuestros sistemas es prácticamente imposible.

## 8. Auditabilidad

El código fuente del cliente es **íntegramente público** en [github.com/idkmanager/firma-ec](https://github.com/idkmanager/firma-ec) bajo licencia Apache 2.0. Cualquier auditor externo puede verificar:

- Que no hay requests salientes que lleven `.p12` o PDF
- Que el bundle servido coincide con el código publicado (reproducible builds)
- Que las releases están firmadas con Sigstore Cosign + SLSA L3 provenance

## 9. Cambios a este aviso

Versionamos esta política. La versión vigente está siempre en `/privacidad`. Versiones anteriores se conservan en el historial de git del repositorio. Cualquier cambio sustantivo se anuncia con 30 días de antelación.

## 10. Contacto

- **Datos / DPO**: [datos@firmar.ec](mailto:datos@firmar.ec)
- **Soporte**: [contacto@firmar.ec](mailto:contacto@firmar.ec)
- **Reportes de seguridad**: [security@firmar.ec](mailto:security@firmar.ec) — política RFC 9116 en [/.well-known/security.txt](/.well-known/security.txt)
