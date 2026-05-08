---
question: "¿Puedo firmar un PDF muy grande?"
lang: es
order: 6
tags: [limites, performance]
---

Sí, hasta 50 MB en mobile y 200 MB en desktop por PDF. La firma corre en un Web Worker dedicado, así que la UI sigue respondiendo aunque el PDF tarde unos segundos en procesarse. Para PDFs más grandes el limitante es la memoria del navegador, no la app.
