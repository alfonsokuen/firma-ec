---
title: "Firmar documentos en línea gratis | firma electrónica Ecuador"
description: "Página web para firmar documentos en línea, gratis y sin instalar nada. Aprende cómo se firma electrónicamente un documento con tu certificado .p12 (BCE, Security Data y demás ECIs de ARCOTEL)."
lang: es
datePublished: "2026-06-14"
dateModified: "2026-08-23"
h1: "Firmar documentos en línea"
breadcrumbs:
  - { name: "Firmar documentos en línea", url: "https://firmar.ec/firmar-documentos-en-linea/" }
related:
  - { title: "Cómo firmar un PDF", href: "/como-firmar-pdf/" }
  - { title: "Firmar PDF online gratis sin instalar", href: "/firmar-pdf-online-gratis-sin-instalar-programas/" }
  - { title: "Firma electrónica en Ecuador", href: "/firma-electronica-ecuador/" }
  - { title: "Cómo obtener un certificado", href: "/como-obtener-certificado-firma-electronica/" }
  - { title: "Cómo verificar la firma de un PDF", href: "/verificar-firma-pdf/" }
  - { title: "Firmar un PDF desde el celular", href: "/firmar-pdf-desde-el-celular/" }
  - { title: "firmar.ec vs FirmaEC", href: "/comparativos/firmaec/" }
---

> **¿Cómo firmar un documento PDF con firma electrónica gratis y sin instalar programas?** Con firmar.ec: es gratis y funciona directo en tu navegador, sin instalar ningún programa ni driver de token. Subes tu PDF, cargas tu certificado `.p12` con su contraseña y descargas el documento firmado con una firma PAdES válida ante el SRI, la banca y las instituciones públicas — todo en menos de un minuto y sin registrarte. Ni el documento ni tu llave privada se envían a ningún servidor: la firma se calcula dentro de tu propio navegador.

**firmar.ec es una página web para firmar documentos en línea, gratis y sin instalar nada.** Subes tu PDF, cargas tu certificado electrónico `.p12` y descargas el documento firmado — todo dentro de tu navegador. Tu llave privada nunca se envía a ningún servidor.

A continuación te explicamos cómo se firma electrónicamente un documento en Ecuador, qué necesitas y por qué puedes hacerlo aquí sin pagar.

[Firmar un documento ahora →](https://app.firmar.ec/)

## ¿Cómo se firma electrónicamente un documento?

Firmar documentos con firma electrónica toma tres pasos y menos de un minuto:

1. **Sube el documento.** Abre la app y arrastra el PDF que quieres firmar.
2. **Carga tu certificado.** Selecciona tu archivo `.p12` (también llamado `.pfx`) e introduce su contraseña. El certificado se procesa en la memoria de tu navegador; no sale de tu equipo.
3. **Firma y descarga.** firmar.ec genera una firma PAdES válida y te devuelve el documento firmado, listo para el SRI, Quipux, SERCOP, un banco o cualquier institución que lo exija.

Eso es todo. No hay registro, no hay límite de firmas y no se instala Java ni ningún driver.

## Una página web para firmar documentos, sin instalar nada

La mayoría de las herramientas para firmar documentos electrónicos en Ecuador son aplicaciones de escritorio que exigen Java y la configuración del token. firmar.ec es distinto: es una **página web para firmar documentos** que funciona en cualquier navegador moderno, también en celular. No descargas programas, no actualizas runtimes y no dependes del sistema operativo.

Como la firma ocurre del lado del cliente (con WebCrypto y `pkijs`), el documento y la clave privada **nunca viajan por la red**. Es la misma garantía de privacidad de una app instalada, pero sin instalar nada.

## Datos duros: firmar.ec frente a FirmaEC

FirmaEC es el firmador oficial del MINTEL y tiene versión de escritorio y **también app móvil desde agosto de 2022** (v2.11.0, Android 8.0+ e iOS 12+, según el [registro de cambios oficial](https://www.firmadigital.gob.ec/registro-de-cambios-de-firmaecchangelog/); consultado el 23 de agosto de 2026). Ambas herramientas producen firmas PAdES válidas; la diferencia está en los límites operativos:

| Dato | firmar.ec | FirmaEC |
|---|---|---|
| **Cómo se usa** | Página web / PWA en el navegador; nada que instalar | Aplicación instalable (escritorio y móvil) |
| **Java** | No requiere Java ni runtimes | Aplicación Java con JRE embebido: su [manual v4.0.0](https://www.firmadigital.gob.ec/wp-content/uploads/2025/08/Manual-Usuario-FirmaEC-v4.0.0.pdf) documenta invocar el firmador a través del `jre` que trae la propia instalación |
| **Tamaño máximo por PDF** | 50 MB en cualquier dispositivo (40 MB por archivo en firma por lotes) | 4 MB en móvil · 512 MB en escritorio ([registro de cambios oficial](https://www.firmadigital.gob.ec/registro-de-cambios-de-firmaecchangelog/), v5.0.0) |
| **Conexión a internet** | Solo para cargar la página: con la configuración por defecto la firma se calcula sin red (ver «Firmar sin conexión» más abajo) | Requerida: «Para el funcionamiento de FirmaEC es necesario tener acceso al servicio de internet» ([manual v4.0.0](https://www.firmadigital.gob.ec/wp-content/uploads/2025/08/Manual-Usuario-FirmaEC-v4.0.0.pdf), sec. 3) |
| **Dónde se procesa tu llave privada** | En tu navegador (Web Crypto API, `CryptoKey extractable:false`); nunca sale del equipo | En la aplicación instalada, en tu equipo |
| **Formato de firma** | PDF con PAdES Baseline B-B (ETSI EN 319 142-1) | PAdES para PDF y XAdES para comprobantes XML del SRI |
| **Token criptográfico USB (PKCS#11)** | No soportado: se firma con archivo `.p12` / `.pfx` | Sí |

En resumen: si tu certificado está en un archivo `.p12` y quieres firmar un PDF sin instalar nada —sobre todo desde el celular, donde FirmaEC topa en 4 MB—, firmar.ec te resuelve el caso. Si necesitas firmar con **token USB físico** o generar **XAdES** para el SRI, FirmaEC sigue siendo la herramienta.

## Firmar sin conexión: qué necesita red y qué no

La firma criptográfica se calcula **íntegramente en tu navegador**: no hay servidor de firma, y ni el PDF ni tu llave privada viajan por la red. Con la configuración por defecto —perfil **PAdES Baseline B-B**, sin sello de tiempo— puedes firmar sin conexión una vez cargada la página.

Hay dos casos en los que sí hace falta internet:

- **Sello de tiempo (TSA) y validación a largo plazo (LTV/OCSP/CRL).** Vienen **desactivados por defecto**; si los activas, la app consulta servidores externos y sin red no puede completarlos.
- **La primera firma con un `.p12` que solo contiene tu certificado final.** Varias ECIs entregan el archivo sin el certificado intermedio de su CA subordinada. En ese caso la app intenta descargarlo del propio certificado (extensión AIA `caIssuers`, RFC 5280) para dejar el PDF autocontenido y que valide también en Adobe. Si esa descarga no está disponible, **el PDF se firma igual**: lo que se pierde es que un verificador offline pueda reconstruir la cadena por sí solo.

## Firmar documentos gratis: qué pagas y qué no

firmar.ec es **gratis** para uso personal de todos los ecuatorianos. No hay límite de documentos. Cualquier servicio que cobre por firmar un PDF cobra por la **conveniencia**, no por la validez: la validez legal la otorga tu certificado emitido por una ECI acreditada, no el software que lo usa.

Lo único que necesitas es un certificado de firma electrónica vigente. Si todavía no tienes uno, lee [cómo obtener un certificado de firma electrónica](/como-obtener-certificado-firma-electronica/) o compara precios y emisores en la [comparativa de ECIs de Ecuador](/comparativa-emisores-ecuador/).

## Firmar documentos con firma electrónica reconocida en Ecuador

Para que la firma tenga la misma validez legal que tu firma manuscrita (Ley de Comercio Electrónico, Ley 2002-67), el certificado debe provenir de una **Entidad de Certificación de Información (ECI) acreditada por ARCOTEL**. firmar.ec reconoce las raíces de las ECIs acreditadas, entre ellas:

- **Banco Central del Ecuador (BCE)** — el certificado más usado por personas naturales y jurídicas. Guía: [firmar con certificado del BCE](/como-firmar-con-certificado-bce/).
- **Security Data** — una de las ECIs más usadas en el SRI y la banca. Guía: [firmar documentos con un certificado de Security Data](/como-firmar-con-certificado-security-data/).
- **Uanataca, ArgosData, Consejo de la Judicatura, ANFAC, Eclipsoft, Datil** y demás ECIs acreditadas.

Si tu certificado fue emitido por cualquiera de ellas, firmar.ec lo reconoce automáticamente contra la lista de raíces que trae la propia app, sin subir nada a ningún servidor.

## ¿Qué documentos puedes firmar?

firmar.ec firma **documentos PDF** con el estándar **PAdES** (la firma queda embebida dentro del propio PDF). Sirve para la gran mayoría de trámites administrativos:

- Contratos, adendas, NDAs y actas.
- Autorizaciones, declaraciones juradas y poderes en PDF.
- Formularios y oficios para el sector público (municipios, ministerios, IESS).
- Documentos que un banco o el SRI te pidan firmar en PDF.

Para comprobantes electrónicos del SRI en XML (factura, retención) se usa el formato XAdES, que normalmente genera tu sistema contable o FirmaEC del MINTEL.

## Validez legal de los documentos firmados

Un documento firmado con firmar.ec produce una firma **PAdES** equivalente a la de FirmaEC, el firmador oficial del MINTEL. Ante el SRI, la banca y las instituciones públicas, **un PDF firmado con tu certificado tiene plena validez** — lo que importa es el certificado, no la herramienta. Puedes comprobar cualquier firma en [verificar la firma de un PDF](/verificar-firma-pdf/).

## Preguntas frecuentes

**¿Cuánto cuesta?** Cero. firmar.ec es un proyecto open-source sin fines de lucro de IDK Manager. No hay plan premium, no hay suscripción, no hay límite de firmas. Tampoco hay publicidad ni telemetría: el costo de mantenimiento lo asume IDK Manager como contribución al ecosistema digital ecuatoriano.

**¿Mi llave privada (`.p12`) llega al servidor?** No. La firma sucede 100% en tu navegador. El archivo `.p12` y la contraseña se procesan dentro de un Web Worker dedicado, la llave privada se importa al Web Crypto API como `CryptoKey extractable:false`, y los buffers se sobrescriben con ceros al terminar. Puedes verificarlo tú mismo abriendo DevTools → Network durante la firma: no hay ningún request saliente que lleve esos datos.

**¿Qué tipos de archivo puedo firmar?** En esta versión, solo PDFs. Soporte de XAdES (XML para SRI) y CAdES (firma detached para cualquier archivo) está en el roadmap pero no en v1. Si necesitas firmar comprobantes electrónicos del SRI hoy, tu mejor opción sigue siendo el flujo nativo en tu sistema contable.

**¿La firma tiene validez legal en Ecuador?** Sí, siempre que tu certificado haya sido emitido por una **Entidad de Certificación de Información (ECI) acreditada por ARCOTEL**: BCE, Consejo de la Judicatura (iCert-EC), Security Data, ANFAC, ArgosData, Uanataca, Eclipse Soft, Datil. Estas firmas son **firma electrónica avanzada** (FEA) según la Ley de Comercio Electrónico, Firmas Electrónicas y Mensajes de Datos (Ley 2002-67) y tienen los mismos efectos jurídicos que una firma manuscrita (art. 14).

**¿Es compatible con FirmaEC del MINTEL?** Sí. Los PDFs firmados por firmar.ec usan el perfil **PAdES Baseline B-B** (ETSI EN 319 142-1), el mismo que produce FirmaEC desktop. Pueden validarse en FirmaEC, Adobe Reader, validador del MINTEL Minka, validador del SRI y cualquier otro verificador PAdES estándar.

## Empieza a firmar documentos en línea

No necesitas crear una cuenta. Abre la app, sube tu documento y firma.

[Abrir firmar.ec y firmar un documento →](https://app.firmar.ec/)
