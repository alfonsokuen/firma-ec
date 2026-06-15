---
title: "How to sign a PDF with an electronic signature"
description: "Sign any PDF with your .p12 certificate in the browser: no install, on mobile too. Step-by-step guide, free and compliant with Ecuadorian law."
lang: en
datePublished: "2026-05-25"
h1: "How to sign a PDF with an electronic signature"
breadcrumbs:
  - { name: "How to sign a PDF", url: "https://firmar.ec/en/how-to-sign-pdf/" }
related:
  - { title: "Sign documents online", href: "/en/sign-documents-online/" }
  - { title: "How to sign with a BCE certificate", href: "/en/how-to-sign-with-bce-certificate/" }
  - { title: "How to verify a PDF signature", href: "/en/verify-pdf-signature/" }
  - { title: "Electronic signatures in Ecuador", href: "/en/electronic-signature-ecuador/" }
---

> **How do you sign a PDF with an electronic signature in Ecuador?** Open [app.firmar.ec/sign](https://app.firmar.ec/#/firmar), load your PDF and your `.p12` certificate, type its password and sign. Everything happens **in your browser** —on mobile too— with no install; your key is never uploaded to any server. The signed PDF has the same legal validity as a handwritten signature (Law of Electronic Commerce, LCE 2002-67), as long as your certificate is from an Information Certification Entity (ECI) accredited by ARCOTEL.

## What you need

- A valid **electronic signature certificate** as a `.p12` file (also called `.pfx`), issued by an ECI accredited by ARCOTEL. If you don't have one yet, see [how to get a certificate](/en/how-to-get-an-electronic-certificate/).
- The **PDF** you want to sign.
- A **modern browser** (Chrome, Edge, Firefox or Safari), on desktop or phone.

You don't need Java, any installed program, or an extension.

## Step by step

1. **Open the app.** Go to [app.firmar.ec/sign](https://app.firmar.ec/#/firmar).
2. **Load the PDF.** Drag or select the document you want to sign.
3. **Load your `.p12` certificate and enter the password.** The app checks that it comes from an ARCOTEL-accredited Ecuadorian ECI. The password and key are processed only on your device.
4. **Place the visible stamp (optional).** You can position a stamp with your name, the issuing CA, the date and a verification QR code.
5. **Sign.** The cryptographic computation happens in a dedicated Web Worker inside your browser.
6. **Download the signed PDF.** The result is a **PAdES** signature (ETSI EN 319 142 standard), fully valid and verifiable.

## Is it legal and valid?

Yes. In Ecuador an electronic signature made with a certificate from an ARCOTEL-accredited ECI **has the same legal validity as a handwritten signature** (LCE 2002-67). Anyone can [verify](/en/verify-pdf-signature/) the signed PDF to confirm its integrity and the certificate's validity.

## Specific cases

- **Your certificate is from the Central Bank (BCE):** follow the [guide to sign with a BCE certificate](/en/how-to-sign-with-bce-certificate/).
- **You need to sign SRI electronic tax documents (XAdES):** that requires the XAdES format; use FirmaEC. See the [firmar.ec vs FirmaEC comparison](/en/comparisons/firmaec/).
- **Your certificate is on a physical USB token (not a `.p12` file):** today firmar.ec signs with the `.p12` file; for a physical token use FirmaEC.

## Frequently asked questions

**Do I have to upload my PDF or certificate to the internet?** No. The whole process is local in your browser; nothing is sent to a server.

**Does it work on mobile?** Yes, firmar.ec is a mobile-first PWA; it works on iOS and Android.

**How much does it cost?** Signing is free. firmar.ec is a non-profit open-source project by IDK Manager.
