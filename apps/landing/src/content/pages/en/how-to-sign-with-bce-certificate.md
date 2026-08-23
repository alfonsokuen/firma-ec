---
title: "How to sign a PDF with your BCE certificate"
description: "Step-by-step guide for signing a PDF with your digital certificate from the Banco Central del Ecuador from any browser, without Java, without installation. Works on mobile."
lang: en
datePublished: "2026-05-08"
dateModified: "2026-08-23"
h1: "How to sign a PDF with your BCE certificate"
breadcrumbs:
  - { name: "How to sign with a BCE certificate", url: "https://firmar.ec/en/how-to-sign-with-bce-certificate/" }
related:
  - { title: "Electronic signatures in Ecuador", href: "/en/electronic-signature-ecuador/" }
  - { title: "What is PAdES?", href: "/en/what-is-pades-signature/" }
  - { title: "FAQ", href: "/en/faq/" }
---

The **Banco Central del Ecuador (BCE) certificate** is one of the most widely used in the country by both individuals and legal entities. Traditionally it required **FirmaEC desktop** (with Java installed and token driver configured). This guide shows how to sign the same type of PDFs **without installing anything**, from your browser, using firmar.ec — even from a mobile phone.

> **Total time**: 2–3 minutes per PDF (first time may take 5 min while you get familiar).

## What you need

- Your BCE certificate file in **`.p12`** format (downloaded when obtaining the cert at eci.bce.fin.ec).
- The **certificate password**.
- A PDF you want to sign.
- A modern browser (Chrome, Firefox, Safari, Edge — last 2 versions).

If you only have the certificate on a **hardware token**, this guide does not apply directly; you will need to export the certificate to `.p12` using the token software or use FirmaEC desktop. We are evaluating WebUSB support on the roadmap.

## Open the app

Visit **[app.firmar.ec/firmar](https://app.firmar.ec/firmar)**. The first time, your browser downloads the app (~3–5 MB); on subsequent visits it loads instantly from the local cache. **Your file and your key never leave your device** — verifiable by opening DevTools → Network during the flow.

The process is **6 steps** inside the app:

## Step 1: Load the PDF

Drag the file to the indicated zone, or tap/click to open the file selector. Supports up to 50 MB per PDF on any device. Verify that the name and PDF preview are correct before continuing.

## Step 2: Place the signature box

firmar.ec adds a **visible stamp** with your name, the issuing CA, the date, and a **QR code** linking to `app.firmar.ec/verificar?h=<hash>` to validate the document. Over the preview you can:

- **Move** the box by dragging (desktop) or tapping (mobile).
- **Resize** it from the corners.
- Use **zoom** to position it precisely.

The box starts at a suggested position (lower-right corner of the last page); adjust it and continue.

## Step 3: Load your `.p12` certificate

Select your `.p12` file (drag-and-drop also works). The app validates that the certificate is from an **ARCOTEL-accredited Ecuadorian ECI** (BCE in this case) and that it is current. If your certificate is expired, the app warns you: you can continue, but the resulting signature will not have full legal validity.

## Step 4: Enter the password

Type your certificate's **password** and confirm with **Verify password**. The password is used only to import the key into your browser and is **erased immediately** afterward; it is never stored or sent to any server.

## Step 5: Review and sign

The app shows a summary — *"You are about to sign `document.pdf` with the certificate of Jane Doe (BCE)"* — alongside the stamp you placed. Confirm with the **Sign PDF** button.

Behind the scenes (all in a dedicated browser Web Worker):
1. Computes the SHA-256 hash of the prepared PDF.
2. Signs the hash with your private key (imported into Web Crypto as `CryptoKey extractable:false`).
3. Builds a CMS SignedData with cert + chain.
4. Inserts the signature into the PDF (PAdES).
5. The Worker terminates; your key buffers are overwritten with zeros.

Takes less than 2 seconds on typical mobile, ~500 ms on desktop.

## Step 6: Download the signed PDF

Large **Download signed PDF** button. The suggested filename is `<original>-signed.pdf`. On iOS/Android mobile, you can also use **Share** (Web Share API) to send it directly via WhatsApp, email, or another app.

## After signing: verify (optional)

Before submitting the PDF to the SRI, your bank, or a counterparty, you can **validate your own signature** at [app.firmar.ec/verificar](https://app.firmar.ec/verificar). This confirms:

- The signature is cryptographically valid.
- Your cert was current at the time of signing.
- The chain up to the root CA validates.
- BCE's OCSP confirms the cert is not revoked.

## Troubleshooting

### "Incorrect password"
Your password has a typo. Remember it is case-sensitive and special characters matter. If you forgot it, you must request a new certificate from BCE; it is not recoverable.

### "Certificate is not from an accredited Ecuadorian ECI"
Your `.p12` was issued by an entity outside Ecuador or by an ECI that lost its accreditation. firmar.ec only trusts the roots in the Ecuadorian TSL. Verify with your issuer.

### "Certificate expired"
Your cert has passed its expiry date. Renew with BCE before signing.

### "The PDF is protected"
Your PDF has an opening password. Remove it (in Adobe Reader, "Print → Microsoft Print to PDF" produces a copy without a password that can be signed).

### "The bundle is loading, please wait"
You are on a 3G connection and the app is downloading for the first time. Wait 30–60 s; on subsequent visits it loads instantly from cache.

### Behind a corporate firewall
Some firewalls block Service Workers or WebAssembly. If the app does not load, try on a different network or consult your IT team.

## What about FirmaEC desktop?

FirmaEC remains excellent, especially for:
- Batch signing of many PDFs.
- Signing with a physical USB token (not yet supported in the browser).
- SRI electronic receipts (XAdES, not PAdES).

firmar.ec **complements** FirmaEC; it does not replace it. Each has its best use case.

## Validity of the produced signature

The resulting signature is **PAdES Baseline B-B** (ETSI EN 319 142-1) with your BCE certificate. It is fully valid for:
- SRI (for administrative PDFs)
- Private banking
- Municipal and IESS procedures
- Notaries (check with your local notary first)
- Any counterparty that knows how to validate PAdES

## Next step

If your procedure requires XAdES (SRI XML), firmar.ec **does not cover that yet**; use your accounting system or FirmaEC desktop. For everything else, you are ready to go.
