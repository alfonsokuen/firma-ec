---
title: "Poner un sello de tiempo (TSA) a la firma electrónica de un PDF"
description: "Cómo poner un sello de tiempo TSA (RFC 3161) a la firma electrónica de un PDF: en firmar.ec lo activas en Configuración y la firma sale en perfil PAdES B-T. Solo viaja el hash del documento, nunca el PDF."
lang: es
datePublished: "2026-08-29"
h1: "Cómo poner un sello de tiempo (TSA) a la firma electrónica de un PDF"
breadcrumbs:
  - { name: "Sello de tiempo (TSA) en un PDF", url: "https://firmar.ec/sello-de-tiempo-tsa-firma-pdf/" }
related:
  - { title: "¿Qué es PAdES?", href: "/que-es-firma-pades/" }
  - { title: "Firmar sin subir el documento a un servidor", href: "/firmar-pdf-sin-subirlo-al-servidor/" }
  - { title: "Cómo firmar un PDF", href: "/como-firmar-pdf/" }
  - { title: "Verificar la firma de un PDF", href: "/verificar-firma-pdf/" }
  - { title: "Glosario (TSA, OCSP, CRL)", href: "/glosario/" }
---

> **¿Cómo poner un sello de tiempo (TSA) a la firma electrónica de un PDF?** En firmar.ec: abre **Configuración**, activa el **sello de tiempo**, y firma tu PDF como siempre en [app.firmar.ec](https://app.firmar.ec/#/firmar). La firma sale en perfil **PAdES B-T**, con un sello RFC 3161 emitido por una autoridad de sellado de tiempo (TSA). Por defecto se usa FreeTSA, una TSA pública gratuita, y puedes configurar la URL de cualquier otra TSA compatible con RFC 3161. Al servidor de tiempo solo viaja el **hash** del documento — nunca el PDF.

[Firmar con sello de tiempo →](https://app.firmar.ec/#/firmar)

## Qué es un sello de tiempo y para qué sirve

Un sello de tiempo (timestamp) es la constancia, emitida por un tercero llamado **TSA** (Time Stamping Authority), de que la firma existía en un momento determinado. Técnicamente es una respuesta **RFC 3161**: la TSA recibe el hash de tu firma, le añade la hora certificada y lo devuelve firmado con su propio certificado.

¿Por qué importa? Sin sello de tiempo, la fecha de una firma es la que declara el equipo del firmante — modificable. Con sello:

- **La fecha es de un tercero**, no del firmante: sirve como evidencia de que el documento estaba firmado *a más tardar* en ese momento.
- **La firma sobrevive a la expiración del certificado**: un verificador puede comprobar que firmaste cuando tu certificado aún estaba vigente, aunque hoy ya haya expirado.

## Cómo activarlo en firmar.ec (paso a paso)

1. **Abre [app.firmar.ec](https://app.firmar.ec/#/firmar)** en tu navegador.
2. **Entra a Configuración** y activa el **sello de tiempo (TSA)**. Viene desactivado por defecto, porque es de las pocas opciones que usa la red al firmar.
3. (Opcional) **Configura la URL de tu TSA.** Por defecto se usa FreeTSA, una TSA pública gratuita; si tu organización tiene una TSA propia o de pago, pega su URL RFC 3161.
4. **Firma tu PDF como siempre**: carga el documento, el `.p12` y la contraseña. La firma resultante lleva el sello y queda en perfil **PAdES B-T** (ETSI EN 319 142).

## B-B, B-T y qué viaja por la red

| Perfil | Qué añade | ¿Usa la red al firmar? |
|---|---|---|
| **PAdES B-B** (por defecto) | La firma con tu certificado | No |
| **PAdES B-T** (con TSA activada) | Sello de tiempo RFC 3161 | Sí: se envía el **hash** a la TSA |
| **PAdES B-LT / B-LTA** (con LTV activada) | Información de revocación (OCSP/CRL) y sello de archivo | Sí: consultas sobre los certificados |

El protocolo RFC 3161 está diseñado para que la TSA **nunca vea tu documento**: recibe únicamente el hash (la huella criptográfica). Tu PDF sigue sin salir del navegador, como en todo firmar.ec — el detalle está en [firmar sin subir el documento a un servidor](/firmar-pdf-sin-subirlo-al-servidor/). Con FreeTSA, la petición de sello pasa por un relay de firmar.ec, porque FreeTSA no acepta peticiones directas desde el navegador (CORS); ese relay solo transporta la petición RFC 3161, es decir, el hash.

## Límites honestos

- **La firma por lotes no aplica TSA**: los [lotes](/firmar-varios-pdf-a-la-vez/) firman en perfil B-B. Para sellar un documento, fírmalo individualmente con la opción activada.
- **FreeTSA es una TSA pública gratuita**, no una TSA ecuatoriana acreditada. Para la mayoría de usos, cualquier TSA RFC 3161 estándar produce un sello verificable; si tu trámite exige una TSA específica, configura su URL en la app.
- El sello de tiempo requiere **conexión a internet** en el momento de firmar (es el intercambio con la TSA). Sin red, firma en B-B.

## Preguntas frecuentes

**¿La TSA ve mi documento?** No. El protocolo RFC 3161 envía a la TSA solo el hash — la huella criptográfica de la firma. El PDF nunca sale de tu navegador.

**¿El sello de tiempo viene activado por defecto?** No, viene desactivado: es una de las pocas opciones que usa la red al firmar. Se activa en Configuración y queda guardado para las siguientes firmas.

**¿Qué TSA usa firmar.ec?** Por defecto FreeTSA, una TSA pública gratuita, a través de un relay que solo transporta la petición RFC 3161. Puedes configurar la URL de cualquier otra TSA compatible.

**¿Una firma sin sello de tiempo es válida?** Sí. El perfil B-B es una firma PAdES plenamente válida; el sello añade una prueba de fecha emitida por un tercero y permite verificar la firma incluso después de que expire tu certificado.

**¿Puedo poner sello de tiempo al firmar por lotes?** No en esta versión: el lote firma en perfil B-B. Firma individualmente los documentos que necesiten sello.
