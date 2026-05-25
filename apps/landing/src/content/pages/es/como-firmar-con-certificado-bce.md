---
title: "Cómo firmar un PDF con certificado del BCE"
description: "Guía paso a paso para firmar un PDF con tu certificado digital del Banco Central del Ecuador desde cualquier navegador, sin Java, sin instalación. Funciona en móvil."
lang: es
datePublished: "2026-05-08"
h1: "Cómo firmar un PDF con tu certificado del BCE"
breadcrumbs:
  - { name: "Cómo firmar con certificado BCE", url: "https://firmar.ec/como-firmar-con-certificado-bce/" }
related:
  - { title: "Firma electrónica en Ecuador", href: "/firma-electronica-ecuador/" }
  - { title: "¿Qué es PAdES?", href: "/que-es-firma-pades/" }
  - { title: "FAQ", href: "/faq/" }
---

El **certificado del Banco Central del Ecuador (BCE)** es uno de los más usados en el país por personas naturales y jurídicas. Tradicionalmente requería **FirmaEC desktop** (con Java instalado y driver del token configurado). Esta guía muestra cómo firmar el mismo tipo de PDFs **sin instalar nada**, desde tu navegador, usando firmar.ec — incluso desde un celular.

> **Tiempo total**: 2-3 minutos por PDF (la primera vez puede tomar 5 min mientras te familiarizas).

## Lo que necesitas

- Tu archivo de certificado del BCE en formato **`.p12`** (descargado al obtener el cert en eci.bce.fin.ec).
- La **contraseña** del certificado.
- Un PDF que quieras firmar.
- Un navegador moderno (Chrome, Firefox, Safari, Edge — últimas 2 versiones).

Si solo tienes el certificado en un **token físico**, esta guía no aplica directamente; necesitarás exportar el certificado a `.p12` desde el software del token o usar FirmaEC desktop. Estamos evaluando soporte de WebUSB en el roadmap.

## Paso 1: Abre la app de firma

Visita **[app.firmar.ec/firmar](https://app.firmar.ec/firmar)**.

La primera vez tu navegador descarga la app (~3-5 MB). En visitas posteriores carga instantánea desde el cache local. **Tu archivo y tu llave nunca salen de tu dispositivo** — verificable abriendo DevTools → Network durante el flujo.

## Paso 2: Carga el PDF

Arrastra el archivo a la zona indicada, o toca/haz clic para abrir el selector. Soporta hasta 50 MB en móvil, 200 MB en desktop.

Verifica que el nombre y el preview del PDF sean los correctos antes de continuar.

## Paso 3: Carga tu certificado `.p12`

En la siguiente pantalla:

1. Selecciona tu archivo `.p12` (también funciona drag-and-drop).
2. Ingresa la contraseña del certificado en el campo correspondiente.
3. La app valida que el certificado sea de una ECI ecuatoriana acreditada (BCE en este caso) y que esté vigente.

Si tu cert está vencido, la app te advierte. Puedes seguir, pero la firma resultante no tendrá validez plena.

## Paso 4: Coloca el sello visible (opcional)

Por defecto, firmar.ec añade un **sello visible** en la última página con tu nombre, AC emisora, fecha y un QR que linkea a `app.firmar.ec/verificar?h=<hash>`. Puedes:

- **Aceptar el sello sugerido** (esquina inferior derecha de la última página).
- **Reposicionarlo** arrastrando (en desktop) o tocando (en móvil) sobre el preview.
- **Cambiar la razón** del sello: "Aprobado", "Revisado", "Visto bueno", o personalizado.
- **Desactivar el sello** si solo quieres una firma criptográfica invisible.

## Paso 5: Firma

La app muestra un resumen: "Vas a firmar `documento.pdf` con el certificado de Juan Pérez (BCE)". Confirma con el botón **Firmar**.

Detrás de escena (todo en un Web Worker dedicado del navegador):
1. Calcula el hash SHA-256 del PDF preparado.
2. Firma el hash con tu llave privada (importada al Web Crypto como `CryptoKey extractable:false`).
3. Construye un CMS SignedData con cert + cadena.
4. Inserta la firma en el PDF (PAdES B-B).
5. El Worker se termina; los buffers de tu llave se sobrescriben con ceros.

Tarda menos de 2 segundos en mobile típico, ~500 ms en desktop.

## Paso 6: Descarga el PDF firmado

Botón grande **Descargar PDF firmado**. El nombre sugerido es `<original>-firmado.pdf`.

En móviles iOS/Android, también puedes usar **Compartir** (Web Share API) para enviarlo directo por WhatsApp, email u otra app.

## Paso 7 (opcional): Verifica antes de enviar

Antes de mandar el PDF al SRI, banco o contraparte, **valida tu propia firma** en [app.firmar.ec/verificar](https://app.firmar.ec/verificar). Esto te confirma que:

- La firma es criptográficamente válida.
- Tu cert estaba vigente al firmar.
- La cadena hasta la AC raíz se valida.
- El OCSP del BCE confirma que el cert no está revocado.

## Solución de problemas

### "Contraseña incorrecta"
Tu contraseña tiene un typo. Recuerda que distingue mayúsculas/minúsculas y caracteres especiales. Si la olvidaste, debes pedir un cert nuevo al BCE; no es recuperable.

### "Certificado no es de una ECI ecuatoriana acreditada"
Tu `.p12` fue emitido por una entidad fuera de Ecuador o por una ECI que perdió la acreditación. firmar.ec solo confía en las raíces de la TSL ecuatoriana. Verifica con tu emisor.

### "Certificado vencido"
Tu cert pasó su fecha de expiración. Renueva con el BCE antes de firmar.

### "El PDF está protegido"
Tu PDF tiene contraseña de apertura. Quítala (en Adobe Reader, "Imprimir → Microsoft Print to PDF" produce una copia sin contraseña que sí se puede firmar).

### "El bundle pesa, espera unos segundos"
Estás en una conexión 3G y la app está descargándose por primera vez. Espera 30-60 s; en visitas siguientes carga instantánea desde el cache.

### Detrás de un firewall corporativo
Algunos firewalls bloquean Service Workers o WebAssembly. Si la app no carga, prueba en una red distinta o consulta con tu IT.

## ¿Y FirmaEC desktop?

FirmaEC sigue siendo excelente, especialmente para:
- Firmas en lote de muchos PDFs.
- Firmas con token físico USB (no soportadas todavía en navegador).
- Comprobantes electrónicos del SRI (XAdES, no PAdES).

firmar.ec **complementa** FirmaEC; no lo reemplaza. Cada uno tiene su mejor caso de uso.

## Validez de la firma producida

La firma resultante es **PAdES Baseline B-B** (ETSI EN 319 142-1) con tu cert del BCE. Es plenamente válida ante:
- SRI (para PDFs administrativos)
- Banca privada
- Trámites municipales y de IESS
- Notarios (consulta primero el de tu cantón)
- Cualquier contraparte que sepa validar PAdES

## Siguiente paso

Si tu trámite requiere XAdES (XML del SRI), firmar.ec **no lo cubre todavía**; usa tu sistema contable o FirmaEC desktop. Para todo lo demás, ya estás listo.
