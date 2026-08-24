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
- **Contamos operaciones, no personas.** Llevamos un contador global de cuántas firmas, verificaciones, validaciones e instalaciones ocurren en total. Sin identificador, sin cookie y sin nada del documento. Los totales de firmas, verificaciones y validaciones son públicos en [/estadisticas/](/estadisticas/): ves exactamente el mismo número que nosotros. El de instalaciones aún no se publica ahí; existe en la serie histórica y se publicará cuando la página lo muestre. Detalle en la sección 4.
- **Logs CDN mínimos**: Cloudflare procesa tráfico TLS y guarda logs por hasta 14 días con IP truncada. Esos logs los maneja Cloudflare como subprocesador.
- **De ti no guardamos nada; de las operaciones, solo la cuenta.** En la infraestructura de IDK Manager (origen Ecuador, Swarm IDK) no se retiene ningún documento, certificado ni dato que te identifique. Sí se conserva, sin plazo de borrado y sin identificadores, la serie histórica de cuántas operaciones ocurrieron y cuándo (sección 4).
- **Tus derechos ARCO+** se ejercen contactando al controlador de datos (IDK Manager) vía los canales publicados en [idkmanager.com/contacto](https://idkmanager.com/contacto/). Respondemos en máximo 15 días hábiles.

## 1. Identidad del responsable

- **Responsable**: IDK Manager (Quito, Ecuador). Operador del servicio firmar.ec.
- **Delegado de Protección de Datos (DPO)**: el rol es asumido por IDK Manager como controlador. Canales de contacto en [idkmanager.com/contacto](https://idkmanager.com/contacto/).
- **Domicilio**: Quito, Pichincha, Ecuador.

## 2. Bases de licitud (art. 7 LOPDP)

Al ser una herramienta cliente puro, **no procesamos en nuestros servidores ningún dato que te identifique ni contenido tuyo**. Lo único que se trata del lado servidor son los contadores agregados y la IP transitoria del limitador descritos en la sección 4. Las bases de licitud aplicables son:

| Tratamiento | Base de licitud |
|---|---|
| Logs de acceso CDN (IP truncada, user-agent agregado) | Interés legítimo (seguridad operacional) |
| Issues y advisories en GitHub que envíes voluntariamente | Consentimiento del remitente |
| Contadores agregados de uso, sin identificadores (sección 4) | Interés legítimo (saber si el proyecto se usa y publicarlo) |
| IP transitoria para limitar el abuso de esos contadores (sección 4) | Interés legítimo (integridad de las cifras publicadas) |

## 3. Categorías de datos que NO tratamos

Para evitar dudas, declaramos explícitamente que firmar.ec **no recolecta, transmite, almacena ni procesa**:

- El contenido de tus PDFs antes o después de firmar
- Tu archivo `.p12`, `.pfx` o cualquier otro contenedor de llave privada
- Tu contraseña del certificado
- Tu cédula, RUC, nombre, teléfono ni cualquier otro dato de identidad personal
- Tu ubicación, dispositivo, ni huella digital del navegador
- **Tu historial de uso individual**: no guardamos qué documentos firmaste, ni con qué certificado, ni desde dónde, ni nada que permita atribuirte una operación. Sí queda registrado **que ocurrió una operación y a qué hora** (sección 4), pero desligado de quién la hizo: es una línea que dice "a las 14:32 alguien firmó", sin ese alguien. No permite reconstruir lo que hiciste tú, ni saber cuántas personas distintas hay detrás de la cifra.

## 4. Datos que SÍ tratamos (y por qué)

- **Logs CDN de Cloudflare**: IP truncada (último octeto eliminado), user-agent agregado por categoría, código HTTP de respuesta, timestamp. Retención 14 días.
- **Issues y advisories en GitHub**: si abres un issue público o un security advisory privado, GitHub almacena ese contenido bajo su propia política de privacidad. firmar.ec no opera servidor de correo ni buzón propio.
- **Contadores agregados de uso**: al completarse una firma, una verificación de firma, una validación de certificado o la instalación de la aplicación, el navegador envía un aviso que contiene **únicamente el tipo de operación** — literalmente una de estas cuatro palabras: `sign` (firma), `verify` (verificación de firma), `cert` (validación de certificado) o `install` (instalación de la app). Nada más: sin identificador, sin sesión, sin cookie, sin referente, sin user-agent, sin marca de tiempo puesta por tu navegador y sin absolutamente nada del documento ni del certificado. Su efecto es doble y lo decimos entero: suma 1 a un contador global **y escribe una fila con esa palabra y la fecha y hora del servidor**. De ahí sale la serie histórica que publicamos en [/estadisticas/](/estadisticas/), agregada por minuto, hora, día, semana, mes y año. Esa fila **no lleva nada que te señale**: ni IP, ni identificador, ni sesión. Se conserva **sin plazo de borrado**, porque es la memoria histórica pública del proyecto. Sirve para saber si se usa y crece; no para saber quién lo usa, y no puede decirlo.
- **Tu IP, de forma transitoria, para frenar el abuso de esos contadores**: para que nadie infle las cifras hay dos límites por dirección IP. Uno guarda en Redis una clave que contiene tu IP tal cual (no va cifrada ni resumida) con un tope de 20 avisos por hora; esa clave **expira 2 horas después del último aviso** — es un plazo que se renueva, no uno absoluto. El otro es un límite general de 100 peticiones por minuto que vive solo en la memoria del proceso y desaparece al reiniciarlo. Ninguno de los dos escribe tu IP en una base de datos permanente, **ninguno la deja en nuestros registros de aplicación** — la eliminamos explícitamente del log, y hay una prueba automatizada que falla si vuelve — y ninguno se cruza con los contadores. Cloudflare, por su parte, ve la IP truncada como se explica arriba.

## 5. Subprocesadores

| Subprocesador | Función | Datos | Ubicación contractual |
|---|---|---|---|
| Cloudflare | CDN + WAF + Tunnel | Logs CDN ≤14 días | Global edge |
| Let's Encrypt | Emisión certificado TLS | CSR público (sin datos personales) | EU (ISRG) |
| GitHub | Repositorios públicos | Código + commits | US |

A esta lista hay que añadir dos servicios que **solo intervienen si tú activas la opción correspondiente** (ambas vienen desactivadas de fábrica):

| Servicio | Cuándo | Qué recibe |
|---|---|---|
| Autoridad de sellado de tiempo (freetsa.org) | Solo si activas el sellado de tiempo | El **hash** de tu documento, nunca el documento |
| Respondedores de revocación de las entidades certificadoras acreditadas | Solo si activas la validación a largo plazo | El **número de serie** del certificado consultado |

En los dos casos la petición sale a través de un proxy nuestro que **borra el origen y el referente**, así que el tercero ve la IP de nuestro servidor, no la tuya.

Cualquier transferencia internacional inevitable se cubre bajo cláusulas contractuales modelo y la legislación ecuatoriana de protección de datos. No hay transferencia internacional de datos que te identifiquen: lo único que sale de nuestra infraestructura es lo descrito en esta tabla, y solo si tú lo activas.

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

**v1.1 (2026-08-24).** Esta versión hace dos cosas distintas y conviene no mezclarlas:

1. **Corrige una omisión.** Las versiones anteriores no declaraban los contadores agregados de uso de la sección 4, que ya venían funcionando. Aquí no cabe esperar 30 días: seguir tratando sin declarar sería peor que declararlo hoy.
2. **Añade un contador nuevo**, el de instalaciones de la aplicación, que empieza a funcionar con esta misma versión. Eso **sí es un tratamiento nuevo**, y lo decimos sin rodeos. Se activa sin el preaviso de 30 días porque es de la misma naturaleza que los otros tres — un entero global, sin identificador, sin dato tuyo — y porque su impacto sobre ti es nulo: no hay nada que consentir ni de lo que desvincularse. Si no compartes ese criterio, escríbenos por los canales de la sección 10.

El código que emite estos avisos es público y auditable (sección 8): los cuatro valores literales de la sección 4 se pueden buscar en el repositorio.

## 10. Contacto

- **Datos personales (LOPDP / DPO)**: contacto al controlador IDK Manager en [idkmanager.com/contacto](https://idkmanager.com/contacto/)
- **Soporte**: [GitHub Issues](https://github.com/idkmanager/firmar-ec/issues)
- **Reportes de seguridad**: [GitHub Security Advisories (privado)](https://github.com/idkmanager/firmar-ec/security/advisories/new) — política RFC 9116 en [/.well-known/security.txt](/.well-known/security.txt)
