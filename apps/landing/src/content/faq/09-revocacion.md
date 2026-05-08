---
question: "¿La verificación detecta certificados revocados?"
lang: es
order: 9
tags: [verificacion, ocsp]
---

Sí. El verificador consulta OCSP (RFC 6960) en vivo contra el responder de la AC emisora del certificado. Si la AC no expone OCSP o está temporalmente inaccesible, mostramos una advertencia clara en el reporte de verificación, distinguiendo entre "OCSP no disponible" y "certificado revocado".
