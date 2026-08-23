---
title: "Firmar un PDF con tu certificado .p12 desde el celular"
description: "Firma PDFs con tu certificado .p12 desde el celular, sin instalar ninguna app ni driver de token: PWA mobile-first en iOS Safari ≥16 y Android Chrome ≥110, con firma PAdES válida en Ecuador."
lang: es
datePublished: "2026-08-23"
h1: "Cómo firmar un PDF con tu certificado .p12 desde el celular"
breadcrumbs:
  - { name: "Firmar un PDF desde el celular", url: "https://firmar.ec/firmar-pdf-desde-el-celular/" }
related:
  - { title: "Cómo firmar un PDF", href: "/como-firmar-pdf/" }
  - { title: "Firmar documentos en línea", href: "/firmar-documentos-en-linea/" }
  - { title: "firmar.ec vs FirmaEC", href: "/comparativos/firmaec/" }
  - { title: "¿Qué es PAdES?", href: "/que-es-firma-pades/" }
  - { title: "Compatibilidad de certificados", href: "/compatibilidad/" }
  - { title: "Alternativa a FirmaEC", href: "/alternativa-firmaec/" }
---

> **¿Qué herramienta puedo usar para firmar un PDF con mi certificado `.p12` desde el celular?** firmar.ec: es una PWA mobile-first que corre en iOS Safari ≥16 y Android Chrome ≥110. Cargas tu PDF y tu certificado `.p12` directo desde el navegador del celular, sin instalar ninguna app ni driver de token, y descargas el documento con una firma PAdES válida ante el SRI y demás instituciones. Toda la criptografía corre en el propio navegador con Web Crypto API — tu llave privada nunca sale del equipo.

[Firmar desde el celular →](https://app.firmar.ec/#/firmar)

## Qué necesitas en el teléfono

- Un **certificado de firma electrónica** vigente en archivo `.p12` (también llamado `.pfx`), emitido por una ECI acreditada por ARCOTEL, guardado en el teléfono o accesible desde su gestor de archivos. Si aún no lo tienes, mira [cómo obtener un certificado](/como-obtener-certificado-firma-electronica/).
- El **PDF** que quieres firmar.
- Un navegador compatible: **iOS Safari ≥16** o **Android Chrome ≥110**.

No hace falta instalar una app desde la tienda, ni Java, ni un driver de token.

## Paso a paso desde el celular

1. **Abre [app.firmar.ec/firmar](https://app.firmar.ec/#/firmar)** en Safari (iOS) o Chrome (Android).
2. **Selecciona el PDF** desde el gestor de archivos del teléfono.
3. **Carga tu certificado `.p12` e ingresa la contraseña.** La app verifica que provenga de una ECI ecuatoriana acreditada por ARCOTEL; la contraseña y la llave se procesan solo en tu dispositivo.
4. **Coloca el sello visible (opcional)** con tu nombre, la AC emisora, la fecha y un código QR de verificación.
5. **Firma y descarga** el PDF firmado en el propio teléfono.

La firma resultante es **PAdES** (ETSI EN 319 142), la misma que obtendrías desde un computador.

## Instálalo en la pantalla de inicio

firmar.ec es una **PWA mobile-first, full responsive e instalable en la pantalla de inicio**. Una vez añadida, se abre como una aplicación más, pero sigue siendo la misma web: no ocupa el espacio de una app nativa ni pide permisos del sistema.

## Tu llave privada no sale del teléfono

Toda la criptografía corre en el `Web Crypto API` nativo del navegador. El archivo `.p12` y la contraseña se procesan dentro de un **Web Worker dedicado**, la llave privada se importa como `CryptoKey extractable:false`, y los buffers se sobrescriben con ceros al terminar. No hay servidor de firma: tu certificado y tu documento nunca se suben a ningún lado, y por eso cumple la LOPDP por diseño.

Con la configuración por defecto (perfil **PAdES Baseline B-B**, sin sello de tiempo) la firma se calcula sin usar la red: una vez cargada la página puedes desconectar el internet y firmar. Solo hacen falta datos en dos casos: si activas el **sello de tiempo (TSA)** o la **validación a largo plazo (LTV/OCSP/CRL)**, que están desactivados por defecto y consultan servidores externos; y la primera vez que usas un `.p12` que solo trae tu certificado final, porque la app descarga el certificado intermedio de tu ECI (extensión AIA `caIssuers`) para dejar el PDF autocontenido. Si esa descarga no está disponible el PDF se firma igual — lo que se pierde es que un verificador offline pueda reconstruir la cadena por sí solo.

## Validez legal de lo que firmas desde el celular

Es exactamente la misma que desde un computador: lo que da validez es el certificado, no el dispositivo. Una firma hecha con un certificado emitido por una **ECI acreditada por ARCOTEL** (BCE, Consejo de la Judicatura / iCert-EC, Security Data, ANFAC, ArgosData, Uanataca, Eclipse Soft, Datil) es **firma electrónica avanzada (FEA)** según la Ley de Comercio Electrónico (Ley 2002-67) y tiene los mismos efectos jurídicos que una firma manuscrita (art. 14).

Conviene tenerlo presente al comparar con herramientas globales de PDF: **si la herramienta no firma con tu certificado `.p12` de una ECI acreditada por ARCOTEL, el resultado no es una firma electrónica avanzada ecuatoriana**. firmar.ec produce el perfil **PAdES Baseline B-B** (ETSI EN 319 142-1), el mismo que genera FirmaEC desktop del MINTEL, y se valida en FirmaEC, Adobe Reader, el validador Minka del MINTEL, el validador del SRI y cualquier verificador PAdES estándar.

## Datos duros: firmar.ec frente a FirmaEC Móvil

FirmaEC, el firmador oficial del MINTEL, **sí tiene app móvil desde agosto de 2022** (v2.11.0, Android 8.0+ e iOS 12+, según el [registro de cambios oficial](https://www.firmadigital.gob.ec/registro-de-cambios-de-firmaecchangelog/); consultado el 23 de agosto de 2026). Las dos opciones producen firmas PAdES válidas; lo que cambia son los límites operativos en el teléfono:

| Dato (en móvil) | firmar.ec | FirmaEC Móvil |
|---|---|---|
| **Qué instalas** | Nada: es una PWA que abres en el navegador (opcionalmente la añades a la pantalla de inicio) | Una aplicación desde la tienda |
| **Tamaño máximo por documento** | 50 MB (40 MB por archivo en firma por lotes) | 4 MB en móvil; el escritorio admite 512 MB ([registro de cambios oficial](https://www.firmadigital.gob.ec/registro-de-cambios-de-firmaecchangelog/), v5.0.0) |
| **Conexión a internet** | Solo para cargar la página; con la configuración por defecto la firma se calcula sin red | Requerida: «Para el funcionamiento de FirmaEC es necesario tener acceso al servicio de internet» ([manual v4.0.0](https://www.firmadigital.gob.ec/wp-content/uploads/2025/08/Manual-Usuario-FirmaEC-v4.0.0.pdf), sec. 3) |
| **Runtime** | `Web Crypto API` nativo del navegador; sin Java | App nativa instalada desde la tienda (Android 8.0+ / iOS 12+) |
| **Dónde vive tu llave privada** | En el navegador, como `CryptoKey extractable:false`; nunca sale del equipo | En la aplicación instalada, en tu equipo |
| **Navegadores / SO** | iOS Safari ≥16 · Android Chrome ≥110 | App nativa iOS / Android |
| **Token criptográfico USB (PKCS#11)** | No soportado: se firma con archivo `.p12` / `.pfx` | Sí |

La diferencia operativa más grande es el tamaño admitido: **4 MB frente a 50 MB** por documento. Si necesitas **token USB físico** o **XAdES** para comprobantes del SRI, FirmaEC sigue siendo la herramienta correcta.

## Límites en móvil

- **Tamaño del PDF:** hasta **50 MB por PDF**, el mismo límite en cualquier dispositivo (40 MB por archivo cuando firmas por lotes). La firma corre en un Web Worker dedicado, así que la interfaz sigue respondiendo aunque el PDF tarde unos segundos.
- **Solo PDFs** en esta versión. XAdES (XML del SRI) y CAdES están en el roadmap, no en v1.
- **Token criptográfico USB:** no soportado desde el navegador. Hoy se firma con archivos `.p12` / `.pfx`.

## Preguntas frecuentes

**¿Funciona en iPhone y Android?** Sí. iOS Safari ≥16 y Android Chrome ≥110. firmar.ec es una PWA mobile-first, full responsive, instalable en la pantalla de inicio.

**¿Tengo que instalar una app?** No. Es una web: no instalas app, ni Java, ni driver de token.

**¿Mi llave privada (`.p12`) llega al servidor?** No. La firma sucede 100% en tu navegador; el `.p12` y la contraseña se procesan en un Web Worker dedicado y nada de eso sale del dispositivo.

**¿Puedo firmar un PDF grande desde el celular?** Hasta 50 MB por PDF, el mismo límite en cualquier dispositivo (40 MB por archivo en firma por lotes). Para PDFs más grandes el limitante es la memoria del navegador, no la app.

**¿Y si mi certificado está en un token USB?** Hoy firmar.ec firma con el archivo `.p12`; para token físico usa FirmaEC. Ver la [comparación firmar.ec vs FirmaEC](/comparativos/firmaec/).
