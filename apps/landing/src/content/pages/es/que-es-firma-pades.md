---
title: "¿Qué es PAdES? Firma electrónica en archivos PDF"
description: "PAdES (PDF Advanced Electronic Signatures) es el estándar ETSI EN 319 142 para firmar PDFs. Explicamos los perfiles B-B, B-T, B-LT, B-LTA y cómo se compara con XAdES y CAdES."
lang: es
datePublished: "2026-05-08"
h1: "¿Qué es PAdES? Firma electrónica en archivos PDF"
breadcrumbs:
  - { name: "¿Qué es PAdES?", url: "https://firmar.ec/que-es-firma-pades/" }
related:
  - { title: "Firma electrónica en Ecuador", href: "/firma-electronica-ecuador/" }
  - { title: "Cómo firmar con certificado BCE", href: "/como-firmar-con-certificado-bce/" }
  - { title: "Glosario técnico", href: "/glosario/" }
---

**PAdES** (acrónimo de *PDF Advanced Electronic Signatures*) es el conjunto de perfiles definidos en la norma **ETSI EN 319 142** para incrustar **firmas electrónicas avanzadas dentro de un archivo PDF**. Es el formato que producen FirmaEC desktop, Adobe Sign, DocuSign y firmar.ec.

## ¿Por qué PAdES y no otra cosa?

Históricamente, firmar un PDF "a mano" significaba imprimir, firmar con bolígrafo, escanear y pegar la imagen. Eso tiene **cero validez criptográfica**: la imagen del trazo no demuestra autoría ni integridad.

PAdES resuelve eso embebiendo en el PDF:

1. Una **firma criptográfica** (CMS / PKCS#7 SignedData) sobre todo el contenido del documento.
2. El **certificado del firmante** y la cadena hasta la AC raíz.
3. (Opcional) Un **timestamp de TSA** que prueba la fecha exacta de la firma.
4. (Opcional) Información de revocación (OCSP/CRL) embebida para validación a largo plazo.

Cualquier modificación posterior del PDF —cambiar una palabra, una cifra, un sello visual— **invalida la firma criptográfica** y los visualizadores lo muestran al lector con una advertencia roja.

## Los 4 perfiles PAdES

ETSI define cuatro perfiles "Baseline" en orden creciente de robustez:

| Perfil | Qué incluye | Cuándo usarlo |
|---|---|---|
| **B-B** (Basic) | Firma + cert + cadena | Casos de uso simples; valida mientras el cert esté vigente y la AC esté online. Es lo que produce firmar.ec v1. |
| **B-T** (Timestamp) | Lo anterior + timestamp TSA | Necesario cuando importa probar **cuándo** se firmó. firmar.ec v1.1 (roadmap). |
| **B-LT** (Long-Term) | Lo anterior + revocación embebida | Permite verificar la firma años después aunque la AC ya no exista o el cert haya caducado. firmar.ec v1.2 (roadmap). |
| **B-LTA** (Long-Term Archive) | Lo anterior + timestamps periódicos | Para archivos legales que deban conservarse décadas. |

Para la mayoría de casos cotidianos —contratos, facturas, cartas, declaraciones— **B-B es suficiente**. Se valida con cualquier visor PDF moderno (Adobe Reader, Foxit, FirmaEC, Minka, etc.) mientras tu cert esté vigente.

## ¿En qué se diferencia de XAdES y CAdES?

Ambos son hermanos de PAdES en la familia ETSI:

- **XAdES** (XML): firma directamente XML. Es el formato que el SRI exige para comprobantes electrónicos.
- **CAdES** (CMS detached): firma cualquier archivo dejando un `.p7s` separado.
- **PAdES** (PDF): firma embebida en el propio PDF.

¿Cuál usar?
- PDF → **PAdES**.
- XML del SRI → **XAdES**.
- Cualquier archivo arbitrario donde quieres mantener el original intacto → **CAdES**.

## ¿Cómo se ve una firma PAdES?

Hay dos componentes:

### Componente criptográfico (siempre invisible al humano)
Un diccionario `/Sig` dentro del PDF con campos `/Filter`, `/SubFilter`, `/Contents` (la firma CMS DER), `/ByteRange` (qué bytes cubre), `/Cert`, `/M` (signing time), opcional `/TS` (timestamp).

### Sello visible (opcional)
Una "estampilla" en una página específica que muestra al lector humano: nombre del firmante, cargo, fecha, razón ("Aprobado", "Revisado"), y opcionalmente un código QR que linkea a un verificador. firmar.ec genera el QR apuntando a `app.firmar.ec/verificar?h=<hash>`.

## Algoritmos: ¿qué cripto usa PAdES?

ETSI TS 119 312 mantiene la lista de algoritmos vigentes. Hoy se usan:

- **Hash**: SHA-256 (mínimo), SHA-384 o SHA-512.
- **Firma asimétrica**: RSA con clave ≥ 2048 bits, o ECDSA P-256/P-384.
- **Padding**: RSASSA-PKCS1-v1_5 (legacy interoperable) o RSA-PSS (moderno preferido).

firmar.ec rechaza explícitamente SHA-1, MD5 y RSA<2048: si tu certificado todavía usa eso, lo emitiste contra la política y tu ECI debería habértelo renovado.

## Estándares y referencias

- **ETSI EN 319 142-1** — PAdES Baseline ([texto](https://www.etsi.org/deliver/etsi_en/319100_319199/31914201/))
- **ETSI EN 319 102-1** — Procedimientos de validación AdES
- **ETSI TS 119 312** — Suites criptográficas vigentes
- **RFC 5652** — CMS Cryptographic Message Syntax
- **RFC 7292** — PKCS#12 Personal Information Exchange
- **ISO 32000-2** — PDF 2.0 (sección sobre firmas)

## Verificación: ¿cómo sé que un PDF firmado es válido?

Puedes:

1. Abrir el PDF en **Adobe Reader** o **Foxit Reader** — muestran panel de firmas con detalles del firmante.
2. Subirlo a **firmar.ec/verificar** (es lo que más recomendamos: gratis, en tu navegador, valida cadena hasta raíces ARCOTEL + OCSP).
3. Usar **Minka del MINTEL** ([validador oficial](https://minka.gob.ec)).
4. Validador del **SRI** para XAdES (no PAdES).

Todas estas herramientas dan el mismo resultado para una firma válida: producen el mismo árbol de checks porque siguen ETSI EN 319 102.
