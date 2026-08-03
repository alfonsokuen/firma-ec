---
title: "Cómo firmar PDF con certificado Judicatura"
description: "Firma PDFs con tu certificado del Consejo de la Judicatura (iCert-EC, .p12) desde el navegador, gratis y sin instalar nada. Para funcionarios y trámites judiciales."
lang: es
datePublished: "2026-05-29"
h1: "Cómo firmar un PDF con tu certificado del Consejo de la Judicatura"
breadcrumbs:
  - { name: "Cómo firmar con certificado iCert-EC", url: "https://firmar.ec/como-firmar-con-certificado-consejo-judicatura/" }
related:
  - { title: "Cómo firmar un PDF", href: "/como-firmar-pdf/" }
  - { title: "Validar tu certificado .p12", href: "/validar-certificado/" }
  - { title: "Cómo verificar la firma de un PDF", href: "/verificar-firma-pdf/" }
---

El **Consejo de la Judicatura** opera su propia entidad de certificación, **iCert-EC**, acreditada por ARCOTEL, que emite certificados de firma electrónica usados por funcionarios judiciales y en trámites de la Función Judicial. Si tienes tu certificado iCert-EC en formato **`.p12`**, esta guía muestra cómo firmar PDFs **gratis, en tu navegador y sin instalar nada**.

> **Tiempo total:** 2-3 minutos por PDF.

## Lo que necesitas

- Tu certificado del Consejo de la Judicatura (iCert-EC) en formato **`.p12` / `.pfx`** y su **contraseña**.
- El PDF que quieras firmar.
- Un navegador moderno (Chrome, Firefox, Safari, Edge).

## Cómo firmar

El flujo es el de [cómo firmar un PDF](/como-firmar-pdf/) en firmar.ec, con tu `.p12` de iCert-EC. Todo ocurre **en tu navegador** — tu llave privada nunca se sube a ningún servidor.

1. Abre **[app.firmar.ec/firmar](https://app.firmar.ec/firmar)**.
2. Carga el PDF y coloca el sello visible (con tu nombre, el emisor iCert-EC y un QR de verificación).
3. Sube tu `.p12` del Consejo de la Judicatura e ingresa la contraseña.
4. Revisa el resumen y pulsa **Firmar PDF**.
5. Descarga el `<documento>-firmado.pdf` o compártelo.

¿Quieres comprobar tu certificado antes? Usa [Validar certificado](/validar-certificado/): muestra titular, vigencia y que la cadena de iCert-EC encadena a la raíz del Consejo de la Judicatura acreditada por ARCOTEL.

## Después de firmar

Valida tu propia firma en [app.firmar.ec/verificar](https://app.firmar.ec/#/verificar): confirma integridad, emisor y revocación. El PDF resultante es **PAdES Baseline B-B** (ETSI EN 319 142-1), válido en Adobe Reader, el validador del MINTEL y cualquier verificador PAdES estándar.

## Preguntas frecuentes

**¿Sirve para documentos judiciales?** firmar.ec produce una firma PAdES estándar plenamente válida. Para el flujo y los sistemas internos de la Función Judicial, sigue las disposiciones de tu institución; esta herramienta cubre la firma técnica del PDF.

**¿Es gratis?** Sí. firmar.ec es gratis para uso personal y open source (AGPL-3.0).

**Documentos multi-firma (varios firmantes).** firmar.ec soporta múltiples firmas en el mismo PDF y las verifica todas; común en expedientes judiciales con más de un funcionario.
