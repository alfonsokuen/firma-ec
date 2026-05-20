---
term: "TSL"
lang: en
acronym: "Trust Service List"
seeAlso: ["eci", "raiz-de-confianza"]
---

A versioned list of trusted root certificates. firmar.ec embeds an Ecuadorian TSL (the 8 root certificates of the ECIs accredited by ARCOTEL) in `packages/tsl-ec/`, refreshed by a CI workflow every 30 days with AIA verification.
