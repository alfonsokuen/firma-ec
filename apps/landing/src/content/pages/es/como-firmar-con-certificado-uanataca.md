---
title: "Cómo firmar un PDF con certificado UANATACA en Ecuador"
description: "Firma PDFs con tu certificado UANATACA (.p12) desde el navegador, gratis y sin instalar nada; completamos la cadena aunque venga solo con la hoja."
lang: es
datePublished: "2026-05-29"
h1: "Cómo firmar un PDF con tu certificado UANATACA"
breadcrumbs:
  - { name: "Cómo firmar con certificado UANATACA", url: "https://firmar.ec/como-firmar-con-certificado-uanataca/" }
related:
  - { title: "Cómo firmar un PDF", href: "/como-firmar-pdf/" }
  - { title: "Validar tu certificado .p12", href: "/validar-certificado/" }
  - { title: "Cómo verificar la firma de un PDF", href: "/verificar-firma-pdf/" }
---

**UANATACA** es una entidad de certificación acreditada por ARCOTEL para emitir certificados de firma electrónica en Ecuador (sus certificados suelen entregarse a través de revendedores como Signare/ArgosData). Esta guía muestra cómo firmar un PDF con tu certificado UANATACA `.p12` **gratis, en tu navegador y sin instalar nada** — también desde el celular.

> **Tiempo total:** 2-3 minutos por PDF.

## La particularidad de UANATACA: el `.p12` "solo con la hoja"

Los certificados de UANATACA suelen entregarse en un `.p12` que contiene **solo el certificado del titular** (la "hoja"), sin la CA intermedia (`UANATACA CA2 2016`). Muchos verificadores 100% en el navegador fallan con estos archivos porque no pueden armar la cadena `hoja → CA2 2016 → raíz`.

**firmar.ec lo resuelve automáticamente**: trae embebida la CA intermedia de UANATACA, así que completa la cadena y reconoce tu certificado sin que tengas que hacer nada. (Si quieres comprobarlo antes de firmar, usa [Validar certificado](/validar-certificado/).)

## Lo que necesitas

- Tu certificado UANATACA en formato **`.p12` / `.pfx`** y su **contraseña**.
- El PDF que quieras firmar.
- Un navegador moderno (Chrome, Firefox, Safari, Edge).

## Cómo firmar

El flujo es el mismo de [cómo firmar un PDF](/como-firmar-pdf/) en firmar.ec: cargas el PDF, colocas el cuadro de firma, subes tu `.p12` UANATACA, ingresas la contraseña y descargas el PDF firmado. Todo ocurre **en tu navegador** — tu llave privada nunca sale de tu dispositivo.

1. Abre **[app.firmar.ec/firmar](https://app.firmar.ec/firmar)**.
2. Carga el PDF y coloca el sello visible (incluye tu nombre, "UANATACA" como emisor y un QR de verificación).
3. Sube tu `.p12` de UANATACA e ingresa la contraseña.
4. Revisa el resumen y pulsa **Firmar PDF**.
5. Descarga el `<documento>-firmado.pdf` (o compártelo por WhatsApp/email).

## Después de firmar

Valida tu propia firma en [app.firmar.ec/verificar](https://app.firmar.ec/#/verificar): confirma integridad, que el certificado UANATACA encadena a su raíz acreditada por ARCOTEL y el estado de revocación. El PDF resultante es **PAdES Baseline B-B** (ETSI EN 319 142-1), válido en Adobe Reader, el validador del MINTEL y cualquier verificador PAdES estándar.

## Preguntas frecuentes

**Mi `.p12` UANATACA daba "emisor no reconocido" en otros sitios. ¿Por qué?** Porque venía solo con la hoja y esos verificadores no completaban la cadena. firmar.ec sí trae la intermedia de UANATACA embebida.

**¿Es gratis?** Sí. firmar.ec es gratis para uso personal y open source (AGPL-3.0).

**¿Funciona en el celular?** Sí, en cualquier navegador móvil moderno.
