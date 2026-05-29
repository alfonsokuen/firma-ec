---
title: "How to sign a PDF with a Security Data certificate in Ecuador"
description: "Sign PDFs with your Security Data (.p12) certificate from the browser, free and with nothing to install. Compatible with Ecuador's most-used ACE. Works on mobile."
lang: en
datePublished: "2026-05-29"
h1: "How to sign a PDF with your Security Data certificate"
breadcrumbs:
  - { name: "How to sign with a Security Data certificate", url: "https://firmar.ec/en/how-to-sign-with-security-data-certificate/" }
related:
  - { title: "How to sign a PDF", href: "/en/how-to-sign-pdf/" }
  - { title: "Validate your .p12 certificate", href: "/en/validate-certificate/" }
  - { title: "How to verify a PDF signature", href: "/en/verify-pdf-signature/" }
---

**Security Data** is one of Ecuador's most-used certification authorities (ACE), accredited by ARCOTEL. If you have your certificate as a **`.p12`** file, this guide shows how to sign your PDFs **free, in your browser, with nothing to install** — including on your phone, with no Java or FirmaEC desktop.

> **Total time:** 2-3 minutes per PDF.

## What you need

- Your Security Data certificate as a **`.p12` / `.pfx`** file and its **password**.
- The PDF you want to sign.
- A modern browser (Chrome, Firefox, Safari, Edge).

If your Security Data certificate lives on a **physical USB token** rather than as a `.p12` file, this guide does not apply directly: you would need to export it to `.p12` from the token software, or use FirmaEC desktop. Token signing via WebUSB is on the roadmap.

## How to sign

The flow is the same as [how to sign a PDF](/en/how-to-sign-pdf/) on firmar.ec, using your Security Data `.p12`. Everything happens **in your browser** — your private key is never uploaded to any server.

1. Open **[app.firmar.ec/firmar](https://app.firmar.ec/firmar)**.
2. Load the PDF and place the visible seal (with your name, "Security Data" as issuer and a verification QR).
3. Upload your Security Data `.p12` and enter the password.
4. Review the summary and press **Sign PDF**.
5. Download the `<document>-firmado.pdf` or share it via WhatsApp/email.

Want to check your certificate first? Use [Validate certificate](/en/validate-certificate/): it shows the holder, validity and that the Security Data chain links to its ARCOTEL-accredited root.

## After signing

Validate your own signature at [app.firmar.ec/verificar](https://app.firmar.ec/#/verificar): it confirms integrity, issuer and revocation. The result is **PAdES Baseline B-B** (ETSI EN 319 142-1), valid in Adobe Reader, the MINTEL validator, the SRI (administrative PDFs) and any standard PAdES verifier.

## FAQ

**Is it compatible with FirmaEC?** Yes. The PAdES B-B profile is the same one FirmaEC desktop produces; PDFs validate both ways.

**Is it free?** Yes. firmar.ec is free for personal use and open source (AGPL-3.0).

**My Security Data `.p12` ships leaf-only — does it work?** Yes: firmar.ec bundles Security Data's intermediate CA and completes the chain automatically.
