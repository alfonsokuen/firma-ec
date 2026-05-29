---
title: "How to sign a PDF with a Consejo de la Judicatura (iCert-EC) certificate"
description: "Sign PDFs with your Consejo de la Judicatura (iCert-EC, .p12) certificate from the browser, free and with nothing to install. For judicial officials and filings."
lang: en
datePublished: "2026-05-29"
h1: "How to sign a PDF with your Consejo de la Judicatura certificate"
breadcrumbs:
  - { name: "How to sign with an iCert-EC certificate", url: "https://firmar.ec/en/how-to-sign-with-consejo-judicatura-certificate/" }
related:
  - { title: "How to sign a PDF", href: "/en/how-to-sign-pdf/" }
  - { title: "Validate your .p12 certificate", href: "/en/validate-certificate/" }
  - { title: "How to verify a PDF signature", href: "/en/verify-pdf-signature/" }
---

The **Consejo de la Judicatura** (Ecuador's Judiciary Council) runs its own certification authority, **iCert-EC**, accredited by ARCOTEL, which issues electronic-signature certificates used by judicial officials and in Judiciary filings. If you have your iCert-EC certificate as a **`.p12`** file, this guide shows how to sign PDFs **free, in your browser, with nothing to install**.

> **Total time:** 2-3 minutes per PDF.

## What you need

- Your Consejo de la Judicatura (iCert-EC) certificate as a **`.p12` / `.pfx`** file and its **password**.
- The PDF you want to sign.
- A modern browser (Chrome, Firefox, Safari, Edge).

## How to sign

The flow is the same as [how to sign a PDF](/en/how-to-sign-pdf/) on firmar.ec, using your iCert-EC `.p12`. Everything happens **in your browser** — your private key is never uploaded to any server.

1. Open **[app.firmar.ec/firmar](https://app.firmar.ec/firmar)**.
2. Load the PDF and place the visible seal (with your name, the iCert-EC issuer and a verification QR).
3. Upload your Consejo de la Judicatura `.p12` and enter the password.
4. Review the summary and press **Sign PDF**.
5. Download the `<document>-firmado.pdf` or share it.

Want to check your certificate first? Use [Validate certificate](/en/validate-certificate/): it shows the holder, validity and that the iCert-EC chain links to the ARCOTEL-accredited Consejo de la Judicatura root.

## After signing

Validate your own signature at [app.firmar.ec/verificar](https://app.firmar.ec/#/verificar): it confirms integrity, issuer and revocation. The result is **PAdES Baseline B-B** (ETSI EN 319 142-1), valid in Adobe Reader, the MINTEL validator and any standard PAdES verifier.

## FAQ

**Is it valid for judicial documents?** firmar.ec produces a standard, fully valid PAdES signature. For the Judiciary's internal workflow and systems, follow your institution's rules; this tool covers the technical PDF signature.

**Is it free?** Yes. firmar.ec is free for personal use and open source (AGPL-3.0).

**Multi-signature documents (several signers).** firmar.ec supports multiple signatures on the same PDF and verifies them all — common in judicial files with more than one official.
