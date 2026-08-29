---
title: "Firmar un PDF sin subirlo a un servidor (firma local en el navegador)"
description: "Cómo firmar un PDF en línea sin subir el documento a ningún servidor: firmar.ec calcula la firma dentro de tu navegador con Web Crypto API. Ni el PDF ni tu llave .p12 se envían a ningún servidor para firmar — y puedes comprobarlo."
lang: es
datePublished: "2026-08-29"
h1: "Cómo firmar un PDF sin subirlo a un servidor"
breadcrumbs:
  - { name: "Firmar PDF sin subirlo al servidor", url: "https://firmar.ec/firmar-pdf-sin-subirlo-al-servidor/" }
related:
  - { title: "Seguridad de firmar.ec", href: "/seguridad/" }
  - { title: "Firmar un PDF desde el celular", href: "/firmar-pdf-desde-el-celular/" }
  - { title: "Firmar PDF online gratis sin instalar", href: "/firmar-pdf-online-gratis-sin-instalar-programas/" }
  - { title: "¿Qué es PAdES?", href: "/que-es-firma-pades/" }
  - { title: "Sello de tiempo (TSA)", href: "/sello-de-tiempo-tsa-firma-pdf/" }
  - { title: "Verificar la firma de un PDF", href: "/verificar-firma-pdf/" }
---

> **¿Cómo firmar un PDF en línea sin subir el documento a un servidor?** Con firmar.ec la firma se calcula **dentro de tu navegador**: el PDF y tu certificado `.p12` se procesan en un Web Worker local con Web Crypto API y **no se envían a ningún servidor**. No existe un "servidor de firma" al que subir el documento. Con la configuración por defecto puedes cargar la página, desconectar el internet y firmar igual — y como el código es open source (AGPL-3.0), no tienes que creer: puedes comprobarlo.

[Firmar un PDF localmente →](https://app.firmar.ec/#/firmar)

## Por qué casi todos los firmadores "online" suben tu documento

La mayoría de servicios de firma en línea funcionan igual: subes el PDF a sus servidores, el servidor lo firma (o le estampa una imagen) y te devuelve el resultado. Eso significa que tu contrato, tu historia clínica o tu oferta confidencial **viajó y quedó procesada en infraestructura de un tercero**, muchas veces fuera del país. firmar.ec invierte esa arquitectura: la web te entrega el motor de firma y **la criptografía corre en tu equipo**. Es la misma razón por la que cumple la LOPDP por diseño — no se puede filtrar lo que nunca se recolectó.

## Dónde ocurre la firma, exactamente

- El PDF se lee como bytes **en memoria del navegador** y se pasa a un **Web Worker dedicado** — un hilo aislado de la propia página.
- El archivo `.p12` y su contraseña se procesan en ese mismo worker; la llave privada se importa con el `Web Crypto API` nativo como `CryptoKey extractable:false`, y los buffers se sobrescriben con ceros al terminar.
- La firma **PAdES** (ETSI EN 319 142) se ensambla localmente y el PDF firmado se descarga desde tu propia memoria, no desde un servidor.

El detalle completo de la arquitectura está en [seguridad](/seguridad/).

## Compruébalo tú mismo (3 formas)

1. **Modo avión.** Abre [app.firmar.ec](https://app.firmar.ec/#/firmar), espera a que cargue, desconecta el internet (o activa modo avión) y firma. Con la configuración por defecto la firma se calcula sin usar la red.
2. **La pestaña Red del navegador.** Abre las herramientas de desarrollador (F12 → Red) y firma un documento: verás que ninguna petición lleva tu PDF ni tu `.p12`.
3. **El código fuente.** firmar.ec es open source bajo AGPL-3.0: el motor de firma está publicado en [GitHub](https://github.com/idkmanager/firmar-ec) y cualquiera puede auditar qué hace con tu documento. Un firmador cerrado solo puede pedirte confianza; uno abierto puede demostrarla.

## Qué SÍ usa la red (y qué viaja en cada caso)

Ser honestos exige el detalle fino. Con la configuración por defecto (perfil **PAdES Baseline B-B**) la firma no usa la red. Hay tres casos opcionales que sí la usan — y en ninguno viaja tu documento completo:

| Caso | ¿Activado por defecto? | ¿Qué viaja? |
|---|---|---|
| **Sello de tiempo (TSA, RFC 3161)** | No — se activa en Configuración | Solo el **hash** del documento, nunca el PDF. Ver [sello de tiempo](/sello-de-tiempo-tsa-firma-pdf/) |
| **Validación a largo plazo (LTV: OCSP/CRL)** | No — se activa en Configuración | Consultas de revocación sobre los **certificados**, no sobre el documento |
| **Descarga del certificado intermedio (AIA)** | Automático la primera vez que usas un `.p12` que no trae su cadena completa | Se **descarga** el certificado público de tu ECI; no se sube nada |

El [contador público de estadísticas](/estadisticas/) registra volumen agregado de uso — nunca tu documento, tu certificado ni datos personales.

## Preguntas frecuentes

**¿Mi PDF se sube a un servidor al firmarlo?** No. La firma se calcula dentro de tu navegador, en un Web Worker local con Web Crypto API. No existe un servidor de firma al que subir el documento: el PDF no se envía a ninguna parte para firmarlo. La única forma de que salga de tu equipo es que tú lo descargues, o que hayas entrado desde una integración que pida devolver el firmado a su propia aplicación (modo enlace, desactivado salvo que se pida expresamente).

**¿Y mi llave privada (.p12)?** Tampoco. El archivo y la contraseña se procesan solo en tu equipo; la llave se importa como CryptoKey no extraíble y los buffers se sobrescriben con ceros al terminar.

**¿Puedo firmar sin conexión a internet?** Sí, con la configuración por defecto (perfil PAdES B-B): una vez cargada la página puedes desconectar el internet y firmar. Solo usan la red las opciones de sello de tiempo (TSA) y validación a largo plazo (LTV) — desactivadas por defecto — y la descarga automática del certificado intermedio la primera vez que usas un .p12 que no trae su cadena completa.

**¿Cómo verifico que esto es cierto y no marketing?** Tres vías: firma en modo avión, mira la pestaña Red de las herramientas de desarrollador mientras firmas, o audita el código fuente — es open source bajo AGPL-3.0.

**¿La firma local vale igual que una hecha "en servidor"?** Sí. La validez la da tu certificado de una ECI acreditada por ARCOTEL, no dónde se calcule la firma. El resultado es PAdES estándar y se valida en FirmaEC, Adobe Reader y el validador del SRI.
