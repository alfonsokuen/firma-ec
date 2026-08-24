---
title: "Firma electrónica y facturación del SRI"
description: "El mismo certificado .p12 firma tus facturas del SRI (XAdES) y tus PDF (PAdES). Qué formato usa cada trámite y qué herramienta necesitas."
lang: es
datePublished: "2026-07-03"
dateModified: "2026-08-24"
h1: "Firma electrónica para facturación del SRI: qué certificado y qué formato necesitas"
breadcrumbs:
  - { name: "Firma electrónica y SRI", url: "https://firmar.ec/firma-electronica-facturacion-sri/" }
related:
  - { title: "Cómo obtener un certificado", href: "/como-obtener-certificado-firma-electronica/" }
  - { title: "Firma electrónica para empresas", href: "/firma-electronica-para-empresas/" }
  - { title: "¿Qué es PAdES?", href: "/que-es-firma-pades/" }
  - { title: "Firma electrónica en Ecuador", href: "/firma-electronica-ecuador/" }
---

> **¿Necesitas un certificado especial para facturar en el SRI?** No: el **mismo certificado `.p12`** emitido por una ECI acreditada por ARCOTEL sirve para la facturación electrónica y para firmar contratos o PDFs. Lo que cambia es el **formato de firma**: los comprobantes del SRI son XML firmados en **XAdES-BES** (lo hace tu sistema de facturación automáticamente), mientras que los documentos PDF se firman en **PAdES** — eso es lo que hace [firmar.ec](/como-firmar-pdf/), gratis.

## Un certificado, dos formatos de firma

| | Comprobantes SRI (factura, retención, NC/ND, guía) | Documentos PDF (contratos, oficios, anexos) |
|---|---|---|
| **Archivo** | XML | PDF |
| **Formato de firma** | XAdES-BES (política del SRI) | [PAdES](/que-es-firma-pades/) (ETSI EN 319 142) |
| **Quién firma** | Tu sistema de facturación (contable/ERP/facturador), de forma automática con tu `.p12` | Tú, con una herramienta como firmar.ec |
| **Certificado** | El mismo `.p12` de una ECI acreditada | El mismo `.p12` |

**firmar.ec no genera XAdES** (no firma XML de comprobantes): para eso está tu sistema de facturación autorizado. firmar.ec cubre todo lo demás — los PDF administrativos, contratos y anexos que el negocio firma a diario.

## Qué necesitas para facturar electrónicamente

1. **Certificado de firma electrónica vigente** de una ECI acreditada — de [persona natural](/como-obtener-certificado-firma-electronica/) si facturas con tu RUC personal, o de [representante legal / persona jurídica](/firma-electronica-para-empresas/) si factura una compañía.
2. **Un sistema de facturación**: el facturador gratuito del SRI o un sistema contable privado. Ahí cargas tu `.p12` una sola vez y el sistema firma cada comprobante.
3. **Ambiente habilitado en el SRI**: pruebas y luego producción, trámite que se hace en SRI en Línea.

## Errores comunes de firma en el SRI

- **"FIRMA INVÁLIDA" al enviar un comprobante**: casi siempre es certificado **vencido o revocado**. Revisa la fecha de expiración de tu `.p12` gratis en [validar-certificado](/validar-certificado/) y, si venció, [renuévalo](/renovar-certificado-firma-electronica/).
- **Contraseña incorrecta del `.p12`**: la contraseña la fijó la ECI o tú al descargarlo; si la perdiste, no es recuperable — toca emitir un certificado nuevo.
- **Certificado de una entidad no acreditada**: el SRI solo acepta firmas de ECIs vigentes ante ARCOTEL. Verifica el emisor en la [comparativa de ECIs](/comparativa-emisores-ecuador/).

## Preguntas frecuentes

**¿Puedo firmar una factura en PDF con firmar.ec y enviarla al SRI?** El comprobante fiscal es el **XML** firmado en XAdES; el PDF (RIDE) es solo la representación impresa y no requiere firma para el SRI. Puedes firmar el RIDE en PAdES si tu cliente lo pide, pero no reemplaza al XML.

**¿El certificado del BCE sirve para facturar?** Sí — cualquier ECI acreditada sirve. Mira la [guía del BCE](/como-firmar-con-certificado-bce/) para usarlo también con PDFs.

**¿Necesito un certificado por cada punto de emisión?** No. El certificado es del contribuyente (persona o empresa), no del punto de emisión: el mismo `.p12` firma los comprobantes de todos tus establecimientos.

**¿Dónde consigo el certificado si aún no lo tengo?** Cualquier ECI acreditada ([comparativa](/comparativa-emisores-ecuador/), [precios](/precios/)); emisión 100% en línea disponible en [tienda.firmar.ec](https://tienda.firmar.ec/facturacion-electronica?utm_source=landing&utm_medium=guia-sri).
