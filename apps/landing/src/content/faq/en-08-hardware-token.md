---
question: "Does it support USB / hardware cryptographic tokens?"
lang: en
order: 8
tags: [hardware, token]
---

Today it supports `.p12` / `.pfx` files. Hardware tokens (eToken, BCE token, etc.) require PKCS#11 access that browsers do not expose directly; we are evaluating integration via WebUSB and WebHID for v2, but this involves important security and compatibility trade-offs we have not yet resolved.
