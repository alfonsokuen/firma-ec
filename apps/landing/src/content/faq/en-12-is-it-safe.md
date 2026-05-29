---
question: "Is it safe to sign my PDFs online?"
lang: en
order: 12
tags: [seguridad, privacidad]
---

Yes, by design. Everything happens inside your browser: your `.p12` certificate and private key are never uploaded to any server, because there is no signing server. The code is open source (AGPL-3.0) and auditable, and the site scores **A+ on Mozilla Observatory and SSL Labs**. Since nothing leaves your device, it is LOPDP-compliant by design. You can check for yourself: disconnect from the internet after the page loads and signing still works.
