---
term: "TSL"
lang: en
acronym: "Trust Service List"
seeAlso: ["eci", "raiz-de-confianza"]
---

A versioned list of trusted root certificates. firmar.ec embeds an Ecuadorian TSL (the roots of the 16 ECIs accredited by ARCOTEL that operate their own PKI) in `packages/tsl-ec/`, refreshed by a CI workflow every 30 days with AIA verification.
