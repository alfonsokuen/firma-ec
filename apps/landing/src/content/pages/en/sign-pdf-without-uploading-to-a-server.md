---
title: "Sign a PDF without uploading it to a server (local in-browser signing)"
description: "How to sign a PDF online without uploading the document to any server: firmar.ec computes the signature inside your browser with the Web Crypto API. Neither the PDF nor your .p12 key leaves the device — and you can verify it."
lang: en
datePublished: "2026-08-29"
h1: "How to sign a PDF without uploading it to a server"
breadcrumbs:
  - { name: "Sign PDF without uploading to a server", url: "https://firmar.ec/en/sign-pdf-without-uploading-to-a-server/" }
related:
  - { title: "Security at firmar.ec", href: "/en/security/" }
  - { title: "Sign a PDF from your phone", href: "/en/sign-pdf-from-phone/" }
  - { title: "Sign PDF online free without installing", href: "/en/sign-pdf-online-free-without-installing/" }
  - { title: "What is PAdES?", href: "/en/what-is-pades-signature/" }
  - { title: "Timestamp (TSA)", href: "/en/pdf-signature-timestamp-tsa/" }
---

> **How do I sign a PDF online without uploading the document to a server?** With firmar.ec the signature is computed **inside your browser**: the PDF and your `.p12` certificate are processed in a local Web Worker with the Web Crypto API and are **never sent to any server**. There is no "signing server" to upload to. With the default configuration you can load the page, disconnect from the internet and still sign — and since the code is open source (AGPL-3.0), you don't have to take our word for it: you can verify it.

[Sign a PDF locally →](https://app.firmar.ec/#/firmar)

## Why most "online" signers upload your document

Most online signing services work the same way: you upload the PDF to their servers, the server signs it (or stamps an image on it) and returns the result. That means your contract, medical record or confidential offer **traveled to and was processed on third-party infrastructure**, often abroad. firmar.ec inverts that architecture: the web page delivers the signing engine to you, and **the cryptography runs on your machine**. That is also why it complies with Ecuador's LOPDP by design — data that was never collected cannot leak.

## Where exactly the signing happens

- The PDF is read as bytes **in browser memory** and handed to a **dedicated Web Worker** — an isolated thread of the page itself.
- The `.p12` file and its password are processed in that same worker; the private key is imported through the native `Web Crypto API` as a `CryptoKey extractable:false`, and buffers are zeroed when done.
- The **PAdES** signature (ETSI EN 319 142) is assembled locally and the signed PDF is downloaded from your own memory, not from a server.

The full architecture is described in [security](/en/security/).

## Verify it yourself (3 ways)

1. **Airplane mode.** Open [app.firmar.ec](https://app.firmar.ec/#/firmar), let it load, disconnect from the internet and sign. With the default configuration the signature is computed without touching the network.
2. **The browser's Network tab.** Open developer tools (F12 → Network) and sign a document: no request carries your PDF or your `.p12`.
3. **The source code.** firmar.ec is open source under AGPL-3.0: the signing engine is published on [GitHub](https://github.com/idkmanager/firmar-ec) and anyone can audit what it does with your document. A closed signer can only ask for trust; an open one can prove it.

## What DOES use the network (and what travels)

Honesty requires the fine print. With the default configuration (**PAdES Baseline B-B** profile) signing does not use the network. Three optional cases do — and in none of them does your full document travel:

| Case | On by default? | What travels? |
|---|---|---|
| **Timestamp (TSA, RFC 3161)** | No — enabled in Settings | Only the document's **hash**, never the PDF. See [timestamp](/en/pdf-signature-timestamp-tsa/) |
| **Long-term validation (LTV: OCSP/CRL)** | No — enabled in Settings | Revocation queries about the **certificates**, not the document |
| **Intermediate certificate download (AIA)** | Automatic the first time you use a `.p12` missing its chain | Your ECI's public certificate is **downloaded**; nothing is uploaded |

The [public statistics counter](/en/statistics/) records aggregate usage volume — never your document, your certificate or personal data.

## Frequently asked questions

**Is my PDF uploaded to a server when I sign it?** No. The signature is computed inside your browser, in a local Web Worker with the Web Crypto API. There is no signing server: the PDF never leaves your device.

**What about my private key (.p12)?** It never leaves either. The file and password are processed on your machine only; the key is imported as a non-extractable CryptoKey and buffers are zeroed when done.

**Can I sign without an internet connection?** Yes, with the default configuration (PAdES B-B profile): once the page has loaded you can disconnect and sign. Only the optional timestamp (TSA) and long-term validation (LTV) features use the network — both off by default — plus the automatic intermediate-certificate download the first time you use a .p12 missing its chain.

**How do I verify this is true and not marketing?** Three ways: sign in airplane mode, watch the Network tab of your browser's developer tools while signing, or audit the source code — it is open source under AGPL-3.0.

**Is a locally computed signature as valid as a server-side one?** Yes. Validity comes from your certificate issued by an ARCOTEL-accredited ECI, not from where the signature is computed. The result is standard PAdES and validates in FirmaEC, Adobe Reader and the SRI validator.
