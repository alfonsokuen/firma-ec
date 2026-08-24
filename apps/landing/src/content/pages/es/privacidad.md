---
title: "Aviso de Privacidad"
description: "Política de protección de datos personales de firmar.ec conforme a la LOPDP del Ecuador. Versión 1.1."
lang: es
datePublished: "2026-05-08"
dateModified: "2026-08-24"
h1: "Aviso de Privacidad"
breadcrumbs:
  - { name: "Aviso de Privacidad", url: "https://firmar.ec/privacidad/" }
---

**Versión 1.1** · Vigente desde 2026-05-08 · Última actualización 2026-08-24

## Resumen ejecutivo (lo importante en 30 segundos)

- **Nada tuyo llega a nuestros servidores.** firmar.ec no almacena tu certificado, tu contraseña, tus PDFs, ni los firmados. La firma sucede 100% en tu navegador.
- **No usamos cookies, ni analytics, ni terceros.** No hay Google Analytics, no hay Meta Pixel, no hay píxel de seguimiento, no hay CDN externo que reciba tus archivos.
- **Contamos operaciones, no personas.** Llevamos un contador global de cuántas firmas, verificaciones, validaciones e instalaciones ocurren en total. Sin identificador, sin cookie y sin nada del documento. Los totales son públicos en [/estadisticas/](/estadisticas/): ves exactamente el mismo número que nosotros. Detalle en la sección 4.
- **Logs CDN mínimos**: Cloudflare procesa tráfico TLS y guarda logs por hasta 14 días con IP truncada. Esos logs los maneja Cloudflare como subprocesador.
- **Retención cero** en infra IDK Manager (origen Ecuador, Swarm IDK).
- **Tus derechos ARCO+** se ejercen contactando al controlador de datos (IDK Manager) vía los canales publicados en [idkmanager.com/contacto](https://idkmanager.com/contacto/). Respondemos en máximo 15 días.

## 1. Identidad del responsable

- **Responsable**: IDK Manager (Quito, Ecuador). Operador del servicio firmar.ec.
- **Delegado de Protección de Datos (DPO)**: el rol es asumido por IDK Manager como controlador. Canales de contacto en [idkmanager.com/contacto](https://idkmanager.com/contacto/).
- **Domicilio**: Quito, Pichincha, Ecuador.

## 2. Bases de licitud (art. 7 LOPDP)

Al ser una herramienta cliente puro, **no procesamos datos personales en nuestros servidores**. Las únicas bases de licitud aplicables son:

| Tratamiento | Base de licitud |
|---|---|
| Logs de acceso CDN (IP truncada, user-agent agregado) | Interés legítimo (seguridad operacional) |
| Issues y advisories en GitHub que envíes voluntariamente | Consentimiento del remitente |

## 3. Categorías de datos que NO tratamos

Para evitar dudas, declaramos explícitamente que firmar.ec **no recolecta, transmite, almacena ni procesa**:

- El contenido de tus PDFs antes o después de firmar
- Tu archivo `.p12`, `.pfx` o cualquier otro contenedor de llave privada
- Tu contraseña del certificado
- Tu cédula, RUC, nombre, teléfono ni cualquier otro dato de identidad personal
- Tu ubicación, dispositivo, ni huella digital del navegador
- **Tu historial de uso individual**: no guardamos qué documentos firmaste, ni cuándo, ni con qué certificado, ni desde dónde. El contador global de la sección 4 es una suma sin identificadores: no permite reconstruir lo que hiciste tú, ni saber cuántas personas distintas hay detrás de la cifra.

## 4. Datos que SÍ tratamos (y por qué)

- **Logs CDN de Cloudflare**: IP truncada (último octeto eliminado), user-agent agregado por categoría, código HTTP de respuesta, timestamp. Retención 14 días.
- **Issues y advisories en GitHub**: si abres un issue público o un security advisory privado, GitHub almacena ese contenido bajo su propia política de privacidad. firmar.ec no opera servidor de correo ni buzón propio.
- **Contadores agregados de uso**: al completarse una firma, una verificación de firma, una validación de certificado o la instalación de la aplicación, el navegador envía un aviso que contiene **únicamente el tipo de operación** — literalmente una de estas cuatro palabras: `sign` (firma), `verify` (verificación de firma), `cert` (validación de certificado) o `install` (instalación de la app). Nada más: sin identificador, sin sesión, sin cookie, sin referente, sin user-agent y sin absolutamente nada del documento ni del certificado. Su único efecto es sumar 1 a un contador global. Los totales se publican en [/estadisticas/](/estadisticas/). Sirven para saber si el proyecto se usa y crece; no para saber quién lo usa, y no pueden decirlo.
- **Una IP transitoria para frenar el abuso de esos contadores**: para que nadie infle las cifras, el servidor guarda en memoria (Redis) una clave derivada de tu dirección IP, con un tope de 20 avisos por hora. Esa clave **se autodestruye a las 2 horas**, no se escribe en ninguna base de datos, no se registra en logs de aplicación y no se cruza con ningún otro dato. Es el único momento en que una IP completa toca nuestra infraestructura, y solo para contar peticiones.

## 5. Subprocesadores

| Subprocesador | Función | Datos | Ubicación contractual |
|---|---|---|---|
| Cloudflare | CDN + WAF + Tunnel | Logs CDN ≤14 días | Global edge |
| Let's Encrypt | Emisión certificado TLS | CSR público (sin datos personales) | EU (ISRG) |
| GitHub | Repositorios públicos | Código + commits | US |

Cualquier transferencia internacional inevitable se cubre bajo cláusulas contractuales modelo y la legislación ecuatoriana de protección de datos. No hay transferencia internacional de datos personales relevante porque no recolectamos datos personales en servidor.

## 6. Tus derechos ARCO+ (art. 12 LOPDP)

Tienes derecho a **A**cceso, **R**ectificación, **C**ancelación, **O**posición, **portabilidad**, **suprimir**, y **oponerte a decisiones automatizadas**. Como no almacenamos datos personales identificables, en la práctica solo aplican:

- Derecho a **acceso/cancelación** de los issues o advisories que hayas enviado: contacta al controlador (IDK Manager) vía [idkmanager.com/contacto](https://idkmanager.com/contacto/) con referencia al hilo original; lo gestionamos dentro de 15 días.
- Derecho a **información** (este aviso): siempre publicado en `/privacidad` con histórico de versiones en el repositorio público.

Plazo de respuesta: **15 días hábiles** desde la recepción.

## 7. Notificación de brechas

En caso de detectar una brecha de datos personales, notificaremos a la **Superintendencia de Protección de Datos Personales (SPDP)** en máximo 5 días hábiles (art. 46 LOPDP) y a los titulares afectados si hubiera riesgo significativo. Dado el modelo cliente puro, una brecha de datos personales en nuestros sistemas es prácticamente imposible.

## 8. Auditabilidad

El código fuente del cliente es **íntegramente público** en [github.com/idkmanager/firmar-ec](https://github.com/idkmanager/firmar-ec) bajo licencia AGPL-3.0. Cualquier auditor externo puede verificar:

- Que no hay requests salientes que lleven `.p12` o PDF
- Que el bundle servido coincide con el código publicado (reproducible builds — roadmap, verificación con `diffoscope` aún no realizada)
- Que las releases están firmadas con Sigstore Cosign + Rekor transparency log + SLSA L2 con elementos L3 (ver [`SECURITY.md`](https://github.com/idkmanager/firmar-ec/blob/main/SECURITY.md))

## 9. Cambios a este aviso

Versionamos esta política. La versión vigente está siempre en `/privacidad`. Versiones anteriores se conservan en el historial de git del repositorio. Cualquier cambio sustantivo se anuncia con 30 días de antelación.

**v1.1 (2026-08-24) — corrección de una omisión, no una ampliación del tratamiento.** Las versiones anteriores de este aviso no declaraban los contadores agregados de uso descritos en la sección 4, que ya venían funcionando. Esta versión los documenta y añade a esa misma familia el contador de instalaciones de la aplicación. No se anuncia con 30 días de antelación porque no amplía lo que se trata sobre ti: lo hace explícito. El código que emite estos avisos es público y auditable (sección 8).

## 10. Contacto

- **Datos personales (LOPDP / DPO)**: contacto al controlador IDK Manager en [idkmanager.com/contacto](https://idkmanager.com/contacto/)
- **Soporte**: [GitHub Issues](https://github.com/idkmanager/firmar-ec/issues)
- **Reportes de seguridad**: [GitHub Security Advisories (privado)](https://github.com/idkmanager/firmar-ec/security/advisories/new) — política RFC 9116 en [/.well-known/security.txt](/.well-known/security.txt)
