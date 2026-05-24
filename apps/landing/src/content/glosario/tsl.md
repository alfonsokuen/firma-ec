---
term: "TSL"
lang: es
acronym: "Trust Service List"
seeAlso: ["eci", "raiz-de-confianza"]
---

Lista versionada de certificados raíz de confianza. firmar.ec embebe una TSL ecuatoriana (las raíces de las 16 ECIs acreditadas por ARCOTEL que operan su propia PKI) en `packages/tsl-ec/`, refrescada por workflow CI cada 30 días con verificación AIA.
