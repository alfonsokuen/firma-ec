---
question: "¿Con qué entidades de certificación (ACE) es compatible?"
lang: es
order: 11
tags: [compatibilidad, certificado]
---

Con las entidades acreditadas por ARCOTEL cuya raíz de confianza viene embebida en la app: **Security Data**, **Banco Central del Ecuador (BCE)**, **UANATACA**, **ANF AC**, **Consejo de la Judicatura (iCert-EC)**, **ArgosData**, **Datil**, **Lazzate**, **Eclipsoft** y el resto de emisores acreditados. Incluso reconoce los `.p12` que vienen "solo con la hoja" (sin la CA intermedia), como los de UANATACA: firmar.ec completa la cadena automáticamente, con los intermedios que ya trae y, si le falta alguno, descargándolo del propio certificado (extensión AIA `caIssuers`) — para eso hace falta conexión. En todos los demás casos el reconocimiento y la validación de la cadena ocurren sin conexión.
