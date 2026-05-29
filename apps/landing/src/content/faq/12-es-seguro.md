---
question: "¿Es seguro firmar mis PDFs en línea?"
lang: es
order: 12
tags: [seguridad, privacidad]
---

Sí, por diseño. Todo ocurre dentro de tu navegador: tu certificado `.p12` y tu llave privada nunca se suben a ningún servidor, porque no hay servidor de firma. El código es abierto (AGPL-3.0) y auditable, y el sitio obtiene **A+ en Mozilla Observatory y en SSL Labs**. Como nada sale de tu dispositivo, cumple la LOPDP por diseño. Puedes comprobarlo tú mismo: desconecta el internet después de que cargue la página y la firma seguirá funcionando.
