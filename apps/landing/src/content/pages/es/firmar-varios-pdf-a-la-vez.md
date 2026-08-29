---
title: "Firmar varios PDF a la vez (por lotes) con tu certificado"
description: "Cómo firmar varios PDF a la vez con un certificado electrónico: la firma por lotes de firmar.ec procesa hasta 50 documentos con un solo .p12 y una sola contraseña, gratis y sin subirlos a ningún servidor."
lang: es
datePublished: "2026-08-29"
h1: "Cómo firmar varios PDF a la vez (por lotes) con tu certificado"
breadcrumbs:
  - { name: "Firmar varios PDF a la vez", url: "https://firmar.ec/firmar-varios-pdf-a-la-vez/" }
related:
  - { title: "Cómo firmar un PDF", href: "/como-firmar-pdf/" }
  - { title: "Firmar PDF online gratis sin instalar", href: "/firmar-pdf-online-gratis-sin-instalar-programas/" }
  - { title: "Firmar sin subir el documento a un servidor", href: "/firmar-pdf-sin-subirlo-al-servidor/" }
  - { title: "Sello de tiempo (TSA)", href: "/sello-de-tiempo-tsa-firma-pdf/" }
  - { title: "Compatibilidad de certificados", href: "/compatibilidad/" }
---

> **¿Cómo firmar varios PDF a la vez (por lotes) con un certificado?** Con la firma por lotes de firmar.ec: abres [app.firmar.ec/firmar-lote](https://app.firmar.ec/#/firmar-lote), seleccionas **hasta 50 PDFs**, cargas tu certificado `.p12` **una sola vez**, ingresas la contraseña una sola vez, y descargas todos los documentos firmados en un archivo ZIP. Es gratis, corre en tu navegador y los documentos no se suben a ningún servidor.

[Firmar por lotes →](https://app.firmar.ec/#/firmar-lote)

## Cuándo sirve la firma por lotes

Cuando lo que te frena no es firmar, sino repetir: actas de entrega de un mismo proyecto, contratos de un mismo lote de clientes, certificados de un curso, planillas mensuales. Firmarlos uno por uno significa cargar el certificado y teclear la contraseña una vez por documento; por lotes, el certificado se carga **una vez** y la cola firma los documentos en serie, mostrando el avance de cada uno.

## Paso a paso

1. **Abre [app.firmar.ec/firmar-lote](https://app.firmar.ec/#/firmar-lote)** en tu navegador.
2. **Arrastra o selecciona los PDFs** — hasta 50 por lote, de máximo 40 MB cada uno.
3. **Carga tu certificado `.p12` e ingresa la contraseña** (una sola vez para todo el lote). La app valida que sea de una ECI ecuatoriana acreditada por ARCOTEL.
4. **Coloca el sello visible**: la app lo posiciona automáticamente en cada documento y puedes ajustarlo manualmente donde un PDF lo necesite.
5. **Firma y descarga el ZIP** con todos los PDFs firmados.

Cada documento del lote recibe su propia firma **PAdES** (ETSI EN 319 142), idéntica en validez a la de la [firma individual](/como-firmar-pdf/).

## Los números exactos

| Dato | Valor |
|---|---|
| Documentos por lote | Hasta **50 PDFs** |
| Tamaño por archivo | Hasta **40 MB** (la firma individual admite 50 MB) |
| Certificado y contraseña | Se ingresan **una sola vez** por lote |
| Salida | Un **ZIP** con todos los PDFs firmados |
| Perfil de firma | **PAdES Baseline B-B** |
| Costo | **Gratis** — open source AGPL-3.0 |

## Límites honestos del lote

- **Sin sello de tiempo (TSA) en lotes:** la firma por lotes produce el perfil B-B. Si un documento necesita [sello de tiempo](/sello-de-tiempo-tsa-firma-pdf/), fírmalo individualmente con la opción activada.
- **40 MB por archivo** dentro del lote (frente a 50 MB en firma individual).
- **Todo ocurre en tu navegador**, también en lotes: los documentos no se suben a ningún servidor — el mismo diseño de la [firma sin subir el documento](/firmar-pdf-sin-subirlo-al-servidor/). El límite práctico en lotes muy pesados es la memoria de tu equipo, no un servidor.

## Preguntas frecuentes

**¿Cuántos PDF puedo firmar a la vez?** Hasta 50 por lote, de máximo 40 MB cada uno. Para más documentos, divide en varios lotes.

**¿Tengo que ingresar la contraseña del certificado por cada documento?** No. El certificado y la contraseña se ingresan una sola vez y valen para todo el lote.

**¿Las firmas del lote valen igual que las individuales?** Sí. Cada PDF recibe su propia firma PAdES con tu certificado; la validez legal es exactamente la misma que firmando uno por uno.

**¿Los documentos del lote se suben a algún servidor?** No. Igual que en la firma individual, todo el lote se procesa dentro de tu navegador y descargas el resultado como ZIP.

**¿Puedo poner el sello visible en cada documento del lote?** Sí. La app coloca el sello automáticamente en cada PDF y permite ajustar la posición manualmente en los documentos que lo necesiten.

**¿La firma por lotes lleva sello de tiempo?** No: el lote firma en perfil PAdES B-B, sin TSA. Si necesitas sello de tiempo en un documento, fírmalo individualmente con la opción de sello de tiempo activada en Configuración.
