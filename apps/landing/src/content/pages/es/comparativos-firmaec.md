---
title: "firmar.ec vs FirmaEC desktop: comparación honesta"
description: "Comparación objetiva entre firmar.ec y FirmaEC del MINTEL. Qué hace cada una mejor, cuándo usar cuál, y por qué son complementarias en lugar de competencia."
lang: es
datePublished: "2026-05-08"
h1: "firmar.ec vs FirmaEC desktop"
breadcrumbs:
  - { name: "Comparativos", url: "https://firmar.ec/comparativos/firmaec/" }
  - { name: "vs FirmaEC", url: "https://firmar.ec/comparativos/firmaec/" }
related:
  - { title: "Alternativa a FirmaEC", href: "/alternativa-firmaec/" }
  - { title: "Firma electrónica en Ecuador", href: "/firma-electronica-ecuador/" }
  - { title: "Cómo firmar con certificado BCE", href: "/como-firmar-con-certificado-bce/" }
---

**FirmaEC** es la app desktop oficial del MINTEL (Ministerio de Telecomunicaciones) para firmar documentos electrónicos en Ecuador. Es **excelente y de uso obligado en muchos casos**. firmar.ec **no es competencia**, es complemento. Esta comparación te ayuda a elegir la herramienta correcta según el caso de uso.

## Tabla de comparación

| Capacidad | firmar.ec | FirmaEC desktop |
|---|---|---|
| **Plataforma** | Web (cualquier navegador moderno) | Java desktop (Win/Mac/Linux) |
| **Instalación** | Cero | Requiere Java JRE 8+ + driver del token |
| **Móvil (iOS/Android)** | ✅ Sí, mobile-first PWA | ❌ No |
| **Formatos soportados** | PDF (PAdES B-B, B-T, B-LT, B-LTA) | PDF + XML (XAdES) + cualquier archivo (CAdES) |
| **Firma con `.p12`** | ✅ Sí | ✅ Sí |
| **Firma con token USB físico** | ❌ No (en evaluación WebUSB) | ✅ Sí |
| **Firma masiva (muchos PDFs)** | ⚠️ Manualmente uno por uno | ✅ Modo lote integrado |
| **Verificación de firmas** | ✅ Sí (offline + OCSP + CRL) | ✅ Sí |
| **TSA RFC 3161 (sello de tiempo)** | ✅ FreeTSA por defecto, configurable | Verificar con MINTEL |
| **PAdES B-LT / B-LTA (long-term validation)** | ✅ Sí | Verificar con MINTEL |
| **Costo** | Gratis | Gratis |
| **Open source** | ✅ Sí (AGPL-3.0) | ✅ Sí (publicada en [MINKA gob.ec](https://minka.gob.ec/mintel/ge/firmaec)) |
| **Llave privada al servidor** | ❌ Nunca | ❌ Nunca (es desktop) |
| **Funciona offline** | Verificación sí; firma recomendado online por TSA | ✅ Sí |
| **Audita el código tú mismo** | ✅ Sí (3 mirrors públicos) | ✅ Sí (vía portal MINKA) |
| **Sigstore Cosign + Rekor tlog en releases** | ✅ Sí | Verificar con MINTEL |
| **Reproducible builds** | ⏳ Roadmap | Verificar con MINTEL |
| **i18n (Inglés)** | ✅ Sí | ⚠️ Limitado |

## ¿Cuándo usar firmar.ec?

- Necesitas firmar **un PDF rápido** y no tienes Java instalado.
- Estás en una **máquina restringida** (corporativa, hotel, cibercafé) donde no puedes instalar software.
- Quieres firmar desde tu **celular o tablet**.
- Tu contraparte necesita **verificar** una firma sin instalar nada.
- Tu organización tiene políticas de **cumplimiento LOPDP estrictas** y quiere evidencia técnica de que la llave nunca sale del dispositivo.
- Eres dev/auditor y quieres **auditar el código** que procesa tu cert.

## ¿Cuándo usar FirmaEC desktop?

- Firmas **comprobantes electrónicos del SRI** (requieren XAdES; firmar.ec no lo soporta — está fuera de su scope hoy).
- Operas dentro de **Quipux** con flujos pre-definidos del Ministerio.
- Tienes un **token criptográfico USB** y necesitas firmar con él.
- Firmas **lotes de muchos PDFs** en una sesión.
- Trabajas **completamente offline** y necesitas firmar.
- Tu cert es del **BCE en token físico** y nunca lo exportaste a `.p12`.

## Compatibilidad cruzada

- Un PDF firmado en **firmar.ec** se valida correctamente en **FirmaEC**, en **Adobe Reader**, en **Foxit**, y en el validador del MINTEL Minka. Y viceversa.
- Ambos producen el mismo perfil técnico: **PAdES Baseline B-B** (ETSI EN 319 142).

## Filosofía

FirmaEC fue creada como **infraestructura pública** del Ecuador. firmar.ec se construye con la misma intención de **bien común**: open-source, sin fines de lucro, complementando lo que el sector público ya ofrece. La diferencia clave es la **plataforma** (web vs desktop) y el **modelo operativo** (mantenido por taller privado vs ministerio).

Ambos pueden coexistir, y de hecho **debería existir más de uno**. Una herramienta crítica de soberanía digital con un único proveedor (público o privado) es un riesgo sistémico.

## Recursos

- [FirmaEC oficial — minka.gob.ec](https://minka.gob.ec/mintel/ge/firmaec)
- [Validador Minka del MINTEL](https://minka.gob.ec)
