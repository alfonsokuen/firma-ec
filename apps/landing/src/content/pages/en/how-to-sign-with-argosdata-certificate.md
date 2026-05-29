---
title: "How to sign a PDF with an ArgosData certificate in Ecuador"
description: "Sign PDFs with your ArgosData (.p12) certificate from the browser, free and with nothing to install. Compatible with ArgosData natural-person certificates."
lang: en
datePublished: "2026-05-29"
h1: "How to sign a PDF with your ArgosData certificate"
breadcrumbs:
  - { name: "How to sign with an ArgosData certificate", url: "https://firmar.ec/en/how-to-sign-with-argosdata-certificate/" }
related:
  - { title: "How to sign a PDF", href: "/en/how-to-sign-pdf/" }
  - { title: "Validate your .p12 certificate", href: "/en/validate-certificate/" }
  - { title: "How to get an electronic certificate", href: "/en/how-to-get-an-electronic-certificate/" }
---

**ArgosData** is an ARCOTEL-accredited certification authority that issues electronic-signature certificates in Ecuador, common among natural persons. If you have your ArgosData certificate as a **`.p12`** file, this guide shows how to sign your PDFs **free, in your browser, with nothing to install** — including on your phone.

> **Total time:** 2-3 minutes per PDF.

## What you need

- Your ArgosData certificate as a **`.p12` / `.pfx`** file and its **password**.
- The PDF you want to sign.
- A modern browser (Chrome, Firefox, Safari, Edge).

## How to sign

The flow is the same as [how to sign a PDF](/en/how-to-sign-pdf/) on firmar.ec, using your ArgosData `.p12`. Everything happens **in your browser** — your private key is never uploaded to any server.

1. Open **[app.firmar.ec/firmar](https://app.firmar.ec/firmar)**.
2. Load the PDF and place the visible seal (with your name, "ArgosData" as issuer and a verification QR).
3. Upload your ArgosData `.p12` and enter the password.
4. Review the summary and press **Sign PDF**.
5. Download the `<document>-firmado.pdf` or share it.

Want to check your certificate before a filing? Use [Validate certificate](/en/validate-certificate/): it shows the holder, ID/RUC, validity and that the ArgosData chain links to its ARCOTEL-accredited root.

## After signing

Validate your own signature at [app.firmar.ec/verificar](https://app.firmar.ec/#/verificar): it confirms integrity, issuer and revocation. The result is **PAdES Baseline B-B** (ETSI EN 319 142-1), valid in Adobe Reader, the MINTEL validator and any standard PAdES verifier.

## FAQ

**Is it free?** Yes. firmar.ec is free for personal use and open source (AGPL-3.0).

**Does it work on mobile?** Yes, on any modern mobile browser, with no apps to install.

**What if my `.p12` ships leaf-only?** firmar.ec completes the chain automatically using its bundled intermediate CAs.
