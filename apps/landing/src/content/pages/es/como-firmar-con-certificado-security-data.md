---
title: "Cómo firmar un PDF con certificado Security Data en Ecuador"
description: "Firma PDFs con tu certificado Security Data (.p12) desde el navegador, gratis y sin instalar nada. Compatible con la ECI más usada de Ecuador. Funciona en móvil."
lang: es
datePublished: "2026-05-29"
h1: "Cómo firmar un PDF con tu certificado Security Data"
breadcrumbs:
  - { name: "Cómo firmar con certificado Security Data", url: "https://firmar.ec/como-firmar-con-certificado-security-data/" }
related:
  - { title: "Cómo firmar un PDF", href: "/como-firmar-pdf/" }
  - { title: "Validar tu certificado .p12", href: "/validar-certificado/" }
  - { title: "Cómo verificar la firma de un PDF", href: "/verificar-firma-pdf/" }
---

**Security Data** es una de las entidades de certificación (ECI) más usadas de Ecuador, acreditada por ARCOTEL. Si tienes tu certificado en formato **`.p12`**, esta guía muestra cómo firmar tus PDFs **gratis, en tu navegador y sin instalar nada** — también desde el celular, sin Java ni FirmaEC desktop.

> **Tiempo total:** 2-3 minutos por PDF.

## Lo que necesitas

- Tu certificado Security Data en formato **`.p12` / `.pfx`** y su **contraseña**.
- El PDF que quieras firmar.
- Un navegador moderno (Chrome, Firefox, Safari, Edge).

Si tu certificado de Security Data está en un **token físico USB** y no como archivo `.p12`, esta guía no aplica directamente: necesitarías exportarlo a `.p12` desde el software del token, o usar FirmaEC desktop. La firma con token por WebUSB está en el roadmap.

## Cómo firmar

El flujo es el de [cómo firmar un PDF](/como-firmar-pdf/) en firmar.ec, con tu `.p12` de Security Data. Todo ocurre **en tu navegador** — tu llave privada nunca se sube a ningún servidor.

1. Abre **[app.firmar.ec/firmar](https://app.firmar.ec/firmar)**.
2. Carga el PDF y coloca el sello visible (con tu nombre, "Security Data" como emisor y un QR de verificación).
3. Sube tu `.p12` de Security Data e ingresa la contraseña.
4. Revisa el resumen y pulsa **Firmar PDF**.
5. Descarga el `<documento>-firmado.pdf` o compártelo por WhatsApp/email.

¿Quieres comprobar tu certificado antes? Usa [Validar certificado](/validar-certificado/): te muestra titular, vigencia y que la cadena de Security Data encadena a su raíz acreditada por ARCOTEL.

## Después de firmar

Valida tu propia firma en [app.firmar.ec/verificar](https://app.firmar.ec/#/verificar): confirma integridad, emisor y revocación. El PDF resultante es **PAdES Baseline B-B** (ETSI EN 319 142-1), válido en Adobe Reader, el validador del MINTEL, el SRI (PDFs administrativos) y cualquier verificador PAdES estándar.

## Preguntas frecuentes

**¿Es compatible con FirmaEC?** Sí. El perfil PAdES B-B es el mismo que produce FirmaEC desktop; los PDFs se validan en ambos sentidos.

**¿Es gratis?** Sí. firmar.ec es gratis para uso personal y open source (AGPL-3.0).

**Mi `.p12` de Security Data trae solo la hoja, ¿funciona?** Sí: firmar.ec trae embebida la CA intermedia de Security Data y completa la cadena automáticamente.
