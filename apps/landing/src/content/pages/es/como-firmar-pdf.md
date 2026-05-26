---
title: "Cómo firmar un PDF con firma electrónica"
description: "Firma cualquier PDF con tu certificado .p12 en el navegador: sin instalar nada, también desde el celular. Gratis y conforme a la ley ecuatoriana."
lang: es
datePublished: "2026-05-25"
h1: "Cómo firmar un PDF con firma electrónica"
breadcrumbs:
  - { name: "Cómo firmar un PDF", url: "https://firmar.ec/como-firmar-pdf/" }
related:
  - { title: "Cómo firmar con certificado del BCE", href: "/como-firmar-con-certificado-bce/" }
  - { title: "Cómo verificar la firma de un PDF", href: "/verificar-firma-pdf/" }
  - { title: "Firma electrónica en Ecuador", href: "/firma-electronica-ecuador/" }
---

> **¿Cómo firmas un PDF con firma electrónica en Ecuador?** Abre [app.firmar.ec/firmar](https://app.firmar.ec/#/firmar), carga tu PDF y tu certificado `.p12`, escribe su contraseña y firma. Todo ocurre **en tu navegador** —también en el celular— sin instalar nada; tu llave nunca se sube a ningún servidor. El PDF firmado tiene la misma validez legal que una firma manuscrita (Ley de Comercio Electrónico, LCE 2002-67), siempre que tu certificado sea de una Entidad de Certificación de Información (ECI) acreditada por ARCOTEL.

## Lo que necesitas

- Un **certificado de firma electrónica** vigente en archivo `.p12` (también llamado `.pfx`), emitido por una ECI acreditada por ARCOTEL. Si aún no lo tienes, mira [cómo obtener un certificado](/como-obtener-certificado-firma-electronica/).
- El **PDF** que quieres firmar.
- Un **navegador moderno** (Chrome, Edge, Firefox o Safari), en computador o teléfono.

No necesitas Java, ni instalar programas, ni una extensión.

## Paso a paso

1. **Abre la app.** Entra a [app.firmar.ec/firmar](https://app.firmar.ec/#/firmar).
2. **Carga el PDF.** Arrastra o selecciona el documento que quieres firmar.
3. **Carga tu certificado `.p12` e ingresa la contraseña.** La app verifica que provenga de una ECI ecuatoriana acreditada por ARCOTEL. La contraseña y la llave se procesan solo en tu dispositivo.
4. **Coloca el sello visible (opcional).** Puedes posicionar un sello con tu nombre, la AC emisora, la fecha y un código QR de verificación.
5. **Firma.** El cálculo criptográfico ocurre en un Web Worker dedicado dentro de tu navegador.
6. **Descarga el PDF firmado.** El resultado es una firma **PAdES** (estándar ETSI EN 319 142), plenamente válida y verificable.

## ¿Es legal y válido?

Sí. En Ecuador una firma electrónica realizada con un certificado de una ECI acreditada por ARCOTEL **tiene la misma validez jurídica que la firma manuscrita** (LCE 2002-67). El PDF firmado se puede [verificar](/verificar-firma-pdf/) por cualquiera para comprobar su integridad y la vigencia del certificado.

## Casos específicos

- **Tu certificado es del Banco Central (BCE):** sigue la [guía para firmar con certificado del BCE](/como-firmar-con-certificado-bce/).
- **Necesitas firmar comprobantes electrónicos del SRI (XAdES):** eso requiere el formato XAdES; usa FirmaEC. Mira la [comparación firmar.ec vs FirmaEC](/comparativos/firmaec/).
- **Tienes el certificado en un token USB físico (no en archivo `.p12`):** hoy firmar.ec firma con el archivo `.p12`; para token físico usa FirmaEC.

## Preguntas frecuentes

**¿Tengo que subir mi PDF o mi certificado a internet?** No. Todo el proceso es local en tu navegador; nada se envía a un servidor.

**¿Funciona en el celular?** Sí, firmar.ec es una PWA mobile-first; funciona en iOS y Android.

**¿Cuánto cuesta?** Firmar es gratis. firmar.ec es un proyecto open-source sin fines de lucro de IDK Manager.
