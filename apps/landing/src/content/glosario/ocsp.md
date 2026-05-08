---
term: "OCSP"
lang: es
acronym: "Online Certificate Status Protocol"
seeAlso: ["rfc-6960", "revocacion", "crl"]
---

Protocolo (RFC 6960) que permite consultar en tiempo real si un certificado X.509 está vigente o ha sido revocado, sin necesidad de descargar la lista completa de revocación (CRL). El verificador de firmar.ec consulta OCSP por cada firma validada.
