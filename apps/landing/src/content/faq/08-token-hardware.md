---
question: "¿Soporta token criptográfico USB / hardware?"
lang: es
order: 8
tags: [hardware, token]
---

Hoy soporta archivos `.p12` / `.pfx`. Los tokens hardware (eToken, BCE token, etc.) requieren acceso PKCS#11 que el navegador no expone directamente; estamos evaluando integración vía WebUSB y WebHID para v2 pero implica trade-offs de seguridad y compatibilidad importantes que aún no resolvemos.
