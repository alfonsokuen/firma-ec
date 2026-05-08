---
term: "OCSP"
lang: en
acronym: "Online Certificate Status Protocol"
seeAlso: ["rfc-6960", "revocacion", "crl"]
---

Protocol (RFC 6960) that allows querying in real time whether an X.509 certificate is valid or has been revoked, without needing to download the full Certificate Revocation List (CRL). firmar.ec's verifier queries OCSP for every signature validated.
