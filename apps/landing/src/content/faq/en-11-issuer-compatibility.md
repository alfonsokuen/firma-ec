---
question: "Which certificate authorities (ACE) is it compatible with?"
lang: en
order: 11
tags: [compatibilidad, certificado]
---

With the ARCOTEL-accredited authorities whose trust root is embedded in the app: **Security Data**, **Banco Central del Ecuador (BCE)**, **UANATACA**, **ANF AC**, **Consejo de la Judicatura (iCert-EC)**, **ArgosData**, **Datil**, **Lazzate**, **Eclipsoft** and the rest of the accredited issuers. It even handles `.p12` files that ship "leaf only" (without the intermediate CA), such as UANATACA's: firmar.ec completes the chain automatically, using the intermediates it already bundles and, if one is missing, downloading it from the certificate itself (the AIA `caIssuers` extension) — that step does need a connection. In every other case recognition and chain validation happen offline.
