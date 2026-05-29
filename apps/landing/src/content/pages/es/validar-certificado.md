---
title: "Cómo validar tu certificado electrónico .p12 en Ecuador (gratis)"
description: "Comprueba el titular, la vigencia y la entidad emisora (ACE) de tu certificado .p12/.pfx gratis, en tu navegador y sin que tu llave privada salga de tu dispositivo."
lang: es
datePublished: "2026-05-29"
h1: "Cómo validar tu certificado electrónico .p12"
breadcrumbs:
  - { name: "Validar certificado", url: "https://firmar.ec/validar-certificado/" }
related:
  - { title: "Cómo verificar la firma de un PDF", href: "/verificar-firma-pdf/" }
  - { title: "Cómo firmar un PDF", href: "/como-firmar-pdf/" }
  - { title: "Cómo obtener un certificado", href: "/como-obtener-certificado-firma-electronica/" }
---

> **¿Cómo sabes si tu certificado electrónico `.p12` es válido?** Súbelo a [app.firmar.ec/validar-certificado](https://app.firmar.ec/#/validar-certificado), ingresa su contraseña y verás en segundos el **titular**, la **cédula/RUC**, la **entidad emisora (ACE)**, las **fechas de vigencia** y si la cadena **encadena a una raíz acreditada por ARCOTEL**. Es gratis, ocurre **en tu navegador** y tu llave privada nunca se sube a ningún servidor.

## ¿Qué comprueba la validación?

Al validar un certificado `.p12` / `.pfx`, firmar.ec te muestra:

- **Titular** — nombre, cédula o RUC del propietario del certificado.
- **Entidad emisora (ACE)** — qué entidad de certificación acreditada por ARCOTEL lo emitió.
- **Vigencia** — fechas *válido desde / válido hasta* y si hoy está vigente, expirado o aún no vigente.
- **Cadena de confianza** — si el certificado encadena a una **raíz acreditada por ARCOTEL** (lista de confianza TSL embebida en la app). Reconoce incluso los certificados que vienen "solo con la hoja" (sin la CA intermedia), como los de UANATACA.
- **Revocación** — estado OCSP/CRL cuando hay conexión.

## Validar paso a paso

1. Abre [app.firmar.ec/validar-certificado](https://app.firmar.ec/#/validar-certificado).
2. Arrastra o selecciona tu archivo **`.p12` / `.pfx`** (el que recibiste de tu ACE).
3. Escribe la **contraseña** del certificado.
4. Pulsa **Validar certificado** y lee el resultado: titular, emisor, vigencia y cadena de confianza.

Todo el proceso ocurre **dentro de tu navegador**: ni el archivo ni la contraseña ni la llave privada salen de tu dispositivo.

## Entidades de certificación (ACE) compatibles

firmar.ec reconoce los certificados emitidos por las entidades acreditadas por ARCOTEL: **Security Data**, **Banco Central del Ecuador (BCE)**, **UANATACA**, **ANF AC**, **Consejo de la Judicatura (iCert-EC)**, **ArgosData**, **Datil**, **Lazzate**, **Eclipsoft** y el resto. Si tu `.p12` fue emitido por cualquiera de ellas, lo valida sin conexión.

## ¿Por qué validar antes de un trámite?

Antes de firmar un documento para el SRI, el ECUAPASS, una entidad pública o un contrato, conviene confirmar que tu certificado está **vigente** y es **reconocido**. Validarlo evita que descubras —a mitad de un trámite— que caducó o que el sistema no reconoce a tu emisor.

## Preguntas frecuentes

**¿Es seguro subir mi `.p12` aquí?** Sí: no se sube. La validación corre en tu navegador (cliente) y tu llave privada nunca sale de tu equipo. El código es abierto (AGPL-3.0).

**¿Necesito instalar algo?** No. Funciona en cualquier navegador moderno, también en el celular.

**¿Vale para firmar después?** El mismo `.p12` que validas aquí es el que usas para [firmar un PDF](/como-firmar-pdf/) en firmar.ec.
