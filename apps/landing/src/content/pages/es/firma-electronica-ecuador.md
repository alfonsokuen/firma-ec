---
title: "Firma electrónica en Ecuador: guía completa 2026"
description: "Cómo funciona la firma electrónica en Ecuador, marco legal LCE, las 7 ECIs acreditadas por ARCOTEL, validez ante SRI/banco/notario, casos de uso y dónde firmar gratis."
lang: es
datePublished: "2026-05-08"
h1: "Firma electrónica en Ecuador"
breadcrumbs:
  - { name: "Firma electrónica en Ecuador", url: "https://firmar.ec/firma-electronica-ecuador" }
related:
  - { title: "¿Qué es PAdES?", href: "/que-es-firma-pades" }
  - { title: "Cómo firmar con certificado BCE", href: "/como-firmar-con-certificado-bce" }
  - { title: "Glosario", href: "/glosario" }
---

En Ecuador, **firmar electrónicamente un documento tiene la misma validez legal que firmarlo a mano**, siempre que se haga con un certificado digital emitido por una **Entidad de Certificación de Información (ECI) acreditada por ARCOTEL**. Esta guía resume el marco legal, los actores autorizados, los formatos válidos y dónde puedes firmar gratis sin instalar Java.

## Marco legal: la LCE

La **Ley de Comercio Electrónico, Firmas Electrónicas y Mensajes de Datos** (Ley 2002-67, RO 557 del 17-abr-2002) reconoce que un documento firmado electrónicamente tiene la misma validez que uno con firma manuscrita (art. 14), siempre que cumpla cuatro requisitos:

1. La firma esté **vinculada únicamente al firmante**.
2. Permita **identificarlo**.
3. Haya sido creada con **medios bajo su control exclusivo**.
4. Cualquier alteración posterior del documento sea **detectable**.

Estos cuatro requisitos definen la **firma electrónica avanzada (FEA)**. Las firmas con certificado emitido por una ECI ecuatoriana acreditada son FEA por construcción.

El reglamento de la LCE es el **Decreto Ejecutivo 3496**, que detalla la operación de las ECIs y la supervisión por parte de ARCOTEL.

## ¿Quién puede emitir certificados? Las 7 ECIs acreditadas

En 2026, ARCOTEL mantiene acreditadas las siguientes Entidades de Certificación de Información:

| ECI | Tipo | Notas |
|---|---|---|
| Banco Central del Ecuador (BCE) | Pública | Certificados para personas naturales y jurídicas, incluido en RUC. Token físico opcional. |
| Security Data Seguridad en Datos y Firma Digital S.A. | Privada | Una de las más usadas en SRI, banca, sector privado. |
| ANFAC (ANF AC Ecuador) | Privada | Filial ecuatoriana de ANF Autoridad de Certificación. |
| Uanataca Ecuador | Privada | Operación regional con respaldo internacional. |
| Lazzate | Privada | Acreditada relativamente reciente. |
| Eclipse Soft (Soluciones Eclipse) | Privada | Enfoque corporativo. |
| Datil Media | Privada | Conocida por integración con sistemas contables y SRI. |

Antes de obtener un certificado, verifica que la ECI esté **vigente** en el [registro público de ARCOTEL](https://www.arcotel.gob.ec).

## ¿Para qué sirve una firma electrónica?

- **SRI**: declaración de impuestos, retenciones, comprobantes electrónicos (los XML de facturación llevan firma XAdES).
- **Banca**: apertura de cuentas, contratos de crédito, formularios FATCA.
- **Sector público**: trámites en municipios, ministerios, INCOP, IESS.
- **Empresarial**: contratos, NDAs, addendums laborales, actas, balances auditados.
- **Personal**: poderes notariales electrónicos (en ciertas jurisdicciones), declaraciones juradas, autorizaciones.

## Formatos válidos

Una firma electrónica no es un solo formato; depende del documento:

- **PAdES** (`.pdf`): el más común para documentos administrativos, contratos, cartas, facturas en PDF. Es lo que firma firmar.ec.
- **XAdES** (`.xml`): obligatorio para comprobantes electrónicos del SRI (factura, retención, nota de crédito, liquidación).
- **CAdES** (`.p7s` adjunto): firma detached que acompaña al archivo original; común para integraciones B2B.

## ¿Dónde puedes firmar gratis?

- **firmar.ec** (este sitio) — PWA web, gratis, open-source, 100% en tu navegador. Perfecta para PDFs (PAdES). Sin instalar Java, funciona en móvil.
- **FirmaEC del MINTEL** — app desktop oficial, también gratis. Requiere Java + driver del token. Cubre PAdES, XAdES y CAdES.

Cualquier servicio que cobre por firmar un PDF está cobrando por la **conveniencia**, no por la validez legal: la validez la otorga tu certificado, no el software que lo usa.

## Validez ante el SRI

El SRI valida XML firmados con XAdES-BES siguiendo su propia política. firmar.ec **no produce XAdES** en v1 (solo PAdES); para facturación electrónica usa tu sistema contable o FirmaEC. Sin embargo, **PDFs administrativos** (RUC, declaraciones, autorizaciones que el SRI requiere en formato PDF) firmados con firmar.ec son **plenamente válidos**.

## Recomendaciones de seguridad

1. **Nunca compartas tu archivo `.p12`**. Es el equivalente digital de tu firma + cédula juntos.
2. **Usa una contraseña fuerte** en tu certificado (mínimo 12 caracteres, mezcla letras+números+símbolos).
3. **Mantén tu certificado vigente**. Las ECIs avisan antes del vencimiento, pero hay un costo asociado a la renovación.
4. **Si vas a firmar con tu certificado en una web, verifica que sea cliente puro** (la llave nunca debe salir de tu navegador). firmar.ec lo es; muchas alternativas no.

## Preguntas frecuentes

Resumen rápido (versión completa en [/faq](/faq)):

- **¿La firma de firmar.ec tiene la misma validez que FirmaEC desktop?** Sí. Ambas producen PAdES B-B con tu certificado.
- **¿Funciona sin internet?** Para verificar, sí (offline). Para firmar, recomendable estar online para validar la cadena de la AC.
- **¿Puedo perder mi certificado?** Si pierdes el `.p12` y la contraseña, debes solicitar uno nuevo a tu ECI; no es recuperable.

## Recursos oficiales

- [ARCOTEL — Telecomunicaciones y certificación digital](https://www.arcotel.gob.ec)
- [LCE — Ley 2002-67](https://www.derechoecuador.com/registro-oficial/2002/04/registro-oficial-no-557-mi%C3%A9rcoles-17-de-abril-de-2002)
- [SRI — Comprobantes electrónicos](https://www.sri.gob.ec)
