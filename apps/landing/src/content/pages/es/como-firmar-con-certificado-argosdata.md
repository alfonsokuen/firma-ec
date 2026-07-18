---
title: "Cómo firmar un PDF con certificado ArgosData"
description: "Firma PDFs con tu certificado ArgosData (.p12) desde el navegador, gratis y sin instalar nada. Compatible con los certificados de persona natural de ArgosData."
lang: es
datePublished: "2026-05-29"
h1: "Cómo firmar un PDF con tu certificado ArgosData"
breadcrumbs:
  - { name: "Cómo firmar con certificado ArgosData", url: "https://firmar.ec/como-firmar-con-certificado-argosdata/" }
related:
  - { title: "Cómo firmar un PDF", href: "/como-firmar-pdf/" }
  - { title: "Validar tu certificado .p12", href: "/validar-certificado/" }
  - { title: "Cómo obtener un certificado", href: "/como-obtener-certificado-firma-electronica/" }
---

**ArgosData** es una entidad de certificación acreditada por ARCOTEL que emite certificados de firma electrónica en Ecuador, frecuentes en personas naturales. Si tienes tu certificado ArgosData en formato **`.p12`**, esta guía muestra cómo firmar tus PDFs **gratis, en tu navegador y sin instalar nada** — también desde el celular.

> **Tiempo total:** 2-3 minutos por PDF.

## Lo que necesitas

- Tu certificado ArgosData en formato **`.p12` / `.pfx`** y su **contraseña**.
- El PDF que quieras firmar.
- Un navegador moderno (Chrome, Firefox, Safari, Edge).

## Cómo firmar

El flujo es el de [cómo firmar un PDF](/como-firmar-pdf/) en firmar.ec, con tu `.p12` de ArgosData. Todo ocurre **en tu navegador** — tu llave privada nunca se sube a ningún servidor.

1. Abre **[app.firmar.ec/firmar](https://app.firmar.ec/firmar)**.
2. Carga el PDF y coloca el sello visible (con tu nombre, "ArgosData" como emisor y un QR de verificación).
3. Sube tu `.p12` de ArgosData e ingresa la contraseña.
4. Revisa el resumen y pulsa **Firmar PDF**.
5. Descarga el `<documento>-firmado.pdf` o compártelo.

¿Quieres comprobar tu certificado antes de un trámite? Usa [Validar certificado](/validar-certificado/): te muestra titular, cédula/RUC, vigencia y que la cadena de ArgosData encadena a su raíz acreditada por ARCOTEL.

## Después de firmar

Valida tu propia firma en [app.firmar.ec/verificar](https://app.firmar.ec/#/verificar): confirma integridad, emisor y revocación. El PDF resultante es **PAdES Baseline B-B** (ETSI EN 319 142-1), válido en Adobe Reader, el validador del MINTEL y cualquier verificador PAdES estándar.

## Preguntas frecuentes

**¿Es gratis?** Sí. firmar.ec es gratis para uso personal y open source (AGPL-3.0).

**¿Funciona en el celular?** Sí, en cualquier navegador móvil moderno, sin instalar apps.

**¿Y si mi `.p12` solo trae la hoja?** firmar.ec completa la cadena automáticamente con las CA intermedias embebidas.
