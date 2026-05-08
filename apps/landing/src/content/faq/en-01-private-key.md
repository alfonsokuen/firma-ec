---
question: "Does my private key (.p12) ever reach the server?"
lang: en
order: 1
tags: [security, privacy]
---

No. Signing happens 100% in your browser. The `.p12` file and password are processed inside a dedicated Web Worker, the private key is imported into the Web Crypto API as `CryptoKey extractable:false`, and the buffers are overwritten with zeros upon completion. You can verify this yourself by opening DevTools → Network during signing: there are no outbound requests carrying that data.
