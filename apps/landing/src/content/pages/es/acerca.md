---
title: "Acerca de firmar.ec"
description: "Por qué existe firmar.ec, quién está detrás, y por qué es gratis y open-source. Un proyecto de IDK Manager."
lang: es
datePublished: "2026-05-08"
h1: "Acerca de firmar.ec"
breadcrumbs:
  - { name: "Acerca", url: "https://firmar.ec/acerca/" }
---

## Por qué existe firmar.ec

En Ecuador, **firmar electrónicamente un PDF** sigue siendo más complicado de lo que debería:

- **FirmaEC del MINTEL** es una excelente app desktop, pero requiere Java instalado, configuración del driver del token, y no funciona en móvil ni en máquinas restringidas.
- **Servicios SaaS comerciales** (Adobe Sign, DocuSign, etc.) piden subir tu certificado a sus servidores, lo cual incomoda a quien tomó en serio el cumplimiento de la **LOPDP**.
- **Alternativas web open-source ecuatorianas** simplemente **no existían** hasta este proyecto.

firmar.ec resuelve eso con **una PWA pública, gratuita, sin registro, sin tracking, donde tu llave privada nunca sale del navegador**.

## Quién está detrás

firmar.ec es un proyecto **open-source sin fines de lucro** de **[IDK Manager](https://idkmanager.com)**, un taller de software y servicios técnicos en Quito, Ecuador. Construimos y operamos esta herramienta como contribución al ecosistema digital ecuatoriano.

No cobramos por el servicio. No hay plan premium. No hay suscripción. No hay publicidad. No hay telemetría.

El costo de mantenimiento (dominio, hosting, certificados, mantenimiento del código) lo asume IDK Manager. La filosofía que guía el proyecto: **una herramienta crítica de soberanía digital no debería tener fines de lucro**.

## ¿Por qué open-source?

Una herramienta que pide tu llave privada **debe ser auditable**. AGPL-3.0 + 3 mirrors públicos + releases firmadas con Sigstore Cosign + entrada pública en Rekor transparency log + SLSA L2 con elementos L3 existen para que cualquier persona, equipo o entidad pública pueda **verificar por sí misma** que firmar.ec se comporta como decimos. Reproducible builds: en roadmap.

Si vas a confiar tu firma electrónica a un servicio web, no aceptes "confía en nosotros". Verifica.

## ¿Cómo se sostiene en el tiempo?

- **Código simple y mantenible** (Astro 5 + Svelte 5 + libs cripto auditadas) — minimiza la deuda técnica acumulada.
- **La app es estática** — se sirve como archivos, sin servidor que la renderice; los costos de hosting son insignificantes. El único backend propio es el de los contadores agregados de uso (ver el aviso de privacidad).
- **Comunidad** — aceptamos issues, PRs, traducciones. Si tu organización quiere contribuir o colaborar, escríbenos.
- **Plan B** — si IDK Manager dejara de operar el servicio, el código sigue disponible en GitHub bajo AGPL-3.0; cualquiera puede continuar la operación con un nuevo dominio.

## Roadmap visible

- **v1 (actual)**: firma + verificación de PDFs PAdES B-B con certificados de las 16 ECIs ecuatorianas acreditadas que operan raíz propia.
- **v1.1**: firma con timestamp (PAdES B-T) cuando identifiquemos una TSA acreditada en EC.
- **v1.2**: validación a largo plazo (PAdES B-LT) — cadena + revocación embebidas.
- **v1.x**: Kichwa, firma masiva, integración WebAuthn 2FA, sello con foto.
- **Aspiración**: si la comunidad lo pide, soporte de XAdES (XML, SRI) y CAdES (firma detached).

Cada decisión de roadmap se discute en GitHub Issues. Tu opinión cuenta.

## Contacto

- General / soporte: [GitHub Issues](https://github.com/idkmanager/firmar-ec/issues)
- Datos personales (LOPDP): contacto al controlador IDK Manager en [idkmanager.com/contacto](https://idkmanager.com/contacto/)
- Seguridad (advisory privado): [GitHub Security Advisories](https://github.com/idkmanager/firmar-ec/security/advisories/new)
- GitHub: [github.com/idkmanager/firmar-ec](https://github.com/idkmanager/firmar-ec)
