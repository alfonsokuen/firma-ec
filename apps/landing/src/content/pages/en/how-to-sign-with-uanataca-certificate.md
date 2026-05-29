---
title: "How to sign a PDF with a UANATACA certificate in Ecuador"
description: "Sign PDFs with your UANATACA (.p12) certificate from the browser, free and with nothing to install. firmar.ec completes the chain even if your .p12 ships leaf-only."
lang: en
datePublished: "2026-05-29"
h1: "How to sign a PDF with your UANATACA certificate"
breadcrumbs:
  - { name: "How to sign with a UANATACA certificate", url: "https://firmar.ec/en/how-to-sign-with-uanataca-certificate/" }
related:
  - { title: "How to sign a PDF", href: "/en/how-to-sign-pdf/" }
  - { title: "Validate your .p12 certificate", href: "/en/validate-certificate/" }
  - { title: "How to verify a PDF signature", href: "/en/verify-pdf-signature/" }
---

**UANATACA** is an ARCOTEL-accredited certification authority that issues electronic-signature certificates in Ecuador (often delivered through resellers such as Signare/ArgosData). This guide shows how to sign a PDF with your UANATACA `.p12` certificate **free, in your browser, with nothing to install** — including from your phone.

> **Total time:** 2-3 minutes per PDF.

## The UANATACA quirk: the "leaf-only" `.p12`

UANATACA certificates are usually delivered in a `.p12` that contains **only the holder's certificate** (the "leaf"), without the intermediate CA (`UANATACA CA2 2016`). Many browser-only verifiers fail on these files because they cannot build the `leaf → CA2 2016 → root` chain.

**firmar.ec handles it automatically**: it bundles UANATACA's intermediate CA, so it completes the chain and recognises your certificate with no extra steps. (To check before signing, use [Validate certificate](/en/validate-certificate/).)

## What you need

- Your UANATACA certificate as a **`.p12` / `.pfx`** file and its **password**.
- The PDF you want to sign.
- A modern browser (Chrome, Firefox, Safari, Edge).

## How to sign

The flow is the same as [how to sign a PDF](/en/how-to-sign-pdf/) on firmar.ec: load the PDF, place the signature box, upload your UANATACA `.p12`, enter the password and download the signed PDF. Everything happens **in your browser** — your private key never leaves your device.

1. Open **[app.firmar.ec/firmar](https://app.firmar.ec/firmar)**.
2. Load the PDF and place the visible seal (includes your name, "UANATACA" as issuer and a verification QR).
3. Upload your UANATACA `.p12` and enter the password.
4. Review the summary and press **Sign PDF**.
5. Download the `<document>-firmado.pdf` (or share it via WhatsApp/email).

## After signing

Validate your own signature at [app.firmar.ec/verificar](https://app.firmar.ec/#/verificar): it confirms integrity, that the UANATACA certificate chains to its ARCOTEL-accredited root, and the revocation status. The result is **PAdES Baseline B-B** (ETSI EN 319 142-1), valid in Adobe Reader, the MINTEL validator and any standard PAdES verifier.

## FAQ

**My UANATACA `.p12` showed "issuer not recognised" elsewhere. Why?** Because it shipped leaf-only and those verifiers did not complete the chain. firmar.ec bundles UANATACA's intermediate.

**Is it free?** Yes. firmar.ec is free for personal use and open source (AGPL-3.0).

**Does it work on mobile?** Yes, on any modern mobile browser.
