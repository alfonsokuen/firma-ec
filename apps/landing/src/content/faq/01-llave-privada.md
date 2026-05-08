---
question: "¿Mi llave privada (.p12) llega al servidor?"
lang: es
order: 1
tags: [seguridad, privacidad]
---

No. La firma sucede 100% en tu navegador. El archivo `.p12` y la contraseña se procesan dentro de un Web Worker dedicado, la llave privada se importa al Web Crypto API como `CryptoKey extractable:false`, y los buffers se sobrescriben con ceros al terminar. Puedes verificarlo tú mismo abriendo DevTools → Network durante la firma: no hay ningún request saliente que lleve esos datos.
