---
question: "¿Con qué entidades de certificación (ACE) es compatible?"
lang: es
order: 11
tags: [compatibilidad, certificado]
---

Con las entidades acreditadas por ARCOTEL cuya raíz de confianza viene embebida en la app: **Security Data**, **Banco Central del Ecuador (BCE)**, **UANATACA**, **ANF AC**, **Consejo de la Judicatura (iCert-EC)**, **ArgosData**, **Datil**, **Lazzate**, **Eclipsoft** y el resto de emisores acreditados. Incluso reconoce los `.p12` que vienen "solo con la hoja" (sin la CA intermedia), como los de UANATACA: firmar.ec completa la cadena automáticamente. Si tu certificado fue emitido por cualquiera de ellas, lo reconoce y valida sin conexión.
