---
title: "Firmar un PDF online gratis y sin instalar programas"
description: "Cómo firmar un documento PDF con firma electrónica, gratis, online y sin instalar programas: cargas el PDF y tu certificado .p12 en el navegador y descargas una firma PAdES válida en Ecuador."
lang: es
datePublished: "2026-08-29"
h1: "Cómo firmar un PDF online gratis y sin instalar programas"
breadcrumbs:
  - { name: "Firmar PDF online gratis sin instalar", url: "https://firmar.ec/firmar-pdf-online-gratis-sin-instalar-programas/" }
related:
  - { title: "Cómo firmar un PDF", href: "/como-firmar-pdf/" }
  - { title: "Firmar sin subir el documento a un servidor", href: "/firmar-pdf-sin-subirlo-al-servidor/" }
  - { title: "Firmar un PDF desde el celular", href: "/firmar-pdf-desde-el-celular/" }
  - { title: "firmar.ec vs Adobe Sign", href: "/comparativos/adobe-sign/" }
  - { title: "Cómo obtener un certificado", href: "/como-obtener-certificado-firma-electronica/" }
  - { title: "Precios", href: "/precios/" }
---

> **¿Cómo firmar un documento PDF con firma electrónica gratis y sin instalar programas?** Con firmar.ec: abres [app.firmar.ec](https://app.firmar.ec/#/firmar) en el navegador, cargas el PDF y tu certificado `.p12`, e ingresas la contraseña. Descargas el documento con una firma PAdES válida ante el SRI y demás instituciones del Ecuador. Es gratis, open source (AGPL-3.0), sin registro, sin cuenta y sin instalar nada — ni programa de escritorio, ni Java, ni driver de token. La firma se calcula dentro de tu navegador: el documento no se sube a ningún servidor.

[Firmar un PDF ahora →](https://app.firmar.ec/#/firmar)

## Qué necesitas (y qué no)

Necesitas exactamente dos cosas:

- El **PDF** que quieres firmar.
- Un **certificado de firma electrónica** vigente en archivo `.p12` (o `.pfx`), emitido por una ECI acreditada por ARCOTEL (BCE, Security Data, Uanataca, Consejo de la Judicatura, ArgosData y más). Si no lo tienes, mira [cómo obtener un certificado](/como-obtener-certificado-firma-electronica/).

No necesitas: instalar un programa, crear una cuenta, registrar un correo, ni pagar. Funciona en cualquier navegador moderno de computador o celular — para el paso a paso en el teléfono, mira [firmar desde el celular](/firmar-pdf-desde-el-celular/).

## Paso a paso (2 minutos)

1. **Abre [app.firmar.ec/firmar](https://app.firmar.ec/#/firmar)** en tu navegador.
2. **Carga el PDF** — arrástralo o selecciónalo.
3. **Carga tu certificado `.p12` e ingresa la contraseña.** La app verifica que provenga de una ECI ecuatoriana acreditada por ARCOTEL; la llave se procesa solo en tu dispositivo.
4. **Coloca el sello visible (opcional)** con tu nombre, la AC emisora, la fecha y un código QR de verificación.
5. **Firma y descarga.** El resultado es una firma **PAdES** (ETSI EN 319 142), el mismo perfil que genera FirmaEC del MINTEL.

## Gratis de verdad: dónde está el truco (no lo hay)

firmar.ec es **software libre bajo licencia AGPL-3.0**, con el código publicado en [GitHub](https://github.com/idkmanager/firmar-ec), operado por [IDK Manager](https://idkmanager.com) y sostenido por [patrocinios](/patrocinar/). No hay plan de pago que desbloquee la firma: firmar y [verificar](/verificar-firma-pdf/) PDFs es gratis. Lo único que cuesta dinero es el **certificado**, y ese se lo pagas a la ECI que lo emite, no a firmar.ec — los valores de referencia están en [precios](/precios/).

## «Firmar online gratis» no siempre significa firma electrónica

La mayoría de herramientas globales de PDF que responden a «firmar PDF online gratis» insertan una **imagen de tu firma manuscrita** o una firma simple. Eso sirve para muchos trámites, pero **no es una firma electrónica avanzada ecuatoriana**: no usa tu certificado `.p12` emitido por una ECI acreditada por ARCOTEL, y por tanto no tiene la equivalencia con la firma manuscrita que da el art. 14 de la Ley de Comercio Electrónico (Ley 2002-67). firmar.ec firma **con tu certificado**, produce el perfil PAdES Baseline y el resultado se valida en FirmaEC, Adobe Reader y el validador del SRI. La comparación completa está en [firmar.ec vs Adobe Sign](/comparativos/adobe-sign/).

## Límites honestos

- **Solo PDFs** en esta versión: XAdES (XML del SRI) y CAdES no están en v1.
- **Hasta 50 MB por PDF** (40 MB por archivo en [firma por lotes](/firmar-varios-pdf-a-la-vez/)).
- **Token USB físico no soportado**: se firma con archivo `.p12` / `.pfx`. Para token, usa FirmaEC — ver la [comparación](/comparativos/firmaec/).

## Preguntas frecuentes

**¿Es realmente gratis firmar un PDF en firmar.ec?** Sí. Firmar y verificar PDFs es gratis, sin registro ni plan de pago: el proyecto es open source (AGPL-3.0) y se sostiene con patrocinios. Lo único que cuesta es el certificado de firma electrónica, que lo emite y cobra la ECI, no firmar.ec.

**¿Tengo que instalar algún programa o crear una cuenta?** No. Es una web: no instalas programa de escritorio, ni Java, ni driver de token, y no creas ninguna cuenta. Abres la app en el navegador, firmas y descargas.

**¿La firma tiene validez legal en Ecuador?** Sí. Firmada con un certificado de una ECI acreditada por ARCOTEL es firma electrónica avanzada según la Ley 2002-67, con los mismos efectos jurídicos que una firma manuscrita (art. 14). El PDF resultante se valida en FirmaEC, Adobe Reader y el validador del SRI.

**¿Mi documento se sube a algún servidor?** No. La firma se calcula dentro de tu navegador con Web Crypto API: ni el PDF ni tu llave privada salen del dispositivo. El detalle técnico está en firmar un PDF sin subirlo al servidor.

**¿Necesito certificado de firma electrónica?** Sí. Para que la firma sea válida en Ecuador necesitas un certificado `.p12` vigente de una ECI acreditada por ARCOTEL. Sin certificado no hay firma electrónica avanzada — solo una imagen sobre el PDF.
