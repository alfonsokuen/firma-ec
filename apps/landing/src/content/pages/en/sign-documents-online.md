---
title: "Sign documents online free | electronic signature Ecuador"
description: "A free website to sign documents online with no installs. Learn how to electronically sign a document with your .p12 certificate (BCE, Security Data and other ARCOTEL ECIs)."
lang: en
datePublished: "2026-06-14"
h1: "Sign documents online"
breadcrumbs:
  - { name: "Sign documents online", url: "https://firmar.ec/en/sign-documents-online/" }
related:
  - { title: "How to sign a PDF", href: "/en/how-to-sign-pdf/" }
  - { title: "Electronic signatures in Ecuador", href: "/en/electronic-signature-ecuador/" }
  - { title: "How to get a certificate", href: "/en/how-to-get-an-electronic-certificate/" }
  - { title: "Verify a PDF signature", href: "/en/verify-pdf-signature/" }
  - { title: "firmar.ec vs FirmaEC", href: "/en/comparisons/firmaec/" }
---

**firmar.ec is a website to sign documents online, free and with nothing to install.** You upload your PDF, load your `.p12` electronic certificate and download the signed document — all inside your browser. Your private key is never sent to any server. Below we explain how to electronically sign a document in Ecuador, what you need and why you can do it here for free.

[Sign a document now →](https://app.firmar.ec/)

## How do you electronically sign a document?

Signing documents with an electronic signature takes three steps and under a minute:

1. **Upload the document.** Open the app and drop in the PDF you want to sign.
2. **Load your certificate.** Select your `.p12` file (also called `.pfx`) and enter its password. The certificate is processed in your browser's memory; it never leaves your device.
3. **Sign and download.** firmar.ec generates a valid PAdES signature and returns the signed document, ready for SRI, Quipux, SERCOP, a bank or any institution that requires it.

That's it. No sign-up, no signature limit, and no Java or drivers to install.

## A website to sign documents, with nothing to install

Most tools to sign electronic documents in Ecuador are desktop apps that require Java and token setup. firmar.ec is different: it's a **website to sign documents** that runs in any modern browser, including on mobile. No downloads, no runtimes to update and no dependency on your operating system.

Because signing happens client-side (using WebCrypto and `pkijs`), the document and the private key **never travel over the network**. It's the same privacy guarantee as an installed app, but with nothing to install.

## Sign documents for free: what you pay and what you don't

firmar.ec is **free** for personal use, for everyone in Ecuador. There is no document limit. Any service that charges to sign a PDF is charging for **convenience**, not validity: legal validity comes from your certificate issued by an accredited ECI, not from the software that uses it.

All you need is a valid electronic signature certificate. If you don't have one yet, read [how to get an electronic certificate](/en/how-to-get-an-electronic-certificate/) or compare issuers and prices in the [Ecuador certificate issuers comparison](/en/certificate-issuers-ecuador/).

## Sign documents with a signature recognised in Ecuador

For the signature to carry the same legal validity as your handwritten one (Electronic Commerce Act, Law 2002-67), the certificate must come from an **Information Certification Entity (ECI) accredited by ARCOTEL**. firmar.ec recognises the roots of the accredited ECIs, including:

- **Banco Central del Ecuador (BCE)** — the most widely used certificate for individuals and companies. Guide: [sign with a BCE certificate](/en/how-to-sign-with-bce-certificate/).
- **Security Data** — one of the most used ECIs at the SRI and in banking. Guide: [sign documents with a Security Data certificate](/en/how-to-sign-with-security-data-certificate/).
- **Uanataca, ArgosData, Consejo de la Judicatura, ANFAC, Eclipsoft, Datil** and other accredited ECIs.

If your certificate was issued by any of them, firmar.ec recognises it automatically and validates its trust chain offline.

## Which documents can you sign?

firmar.ec signs **PDF documents** using the **PAdES** standard (the signature is embedded inside the PDF itself). It covers the vast majority of administrative paperwork:

- Contracts, addenda, NDAs and minutes.
- Authorisations, sworn statements and powers of attorney in PDF.
- Forms and letters for the public sector (municipalities, ministries, IESS).
- Documents a bank or the SRI asks you to sign in PDF.

For SRI electronic vouchers in XML (invoices, withholdings) the XAdES format is used, normally produced by your accounting system or by MINTEL's FirmaEC.

## Legal validity of signed documents

A document signed with firmar.ec produces a **PAdES** signature equivalent to FirmaEC, MINTEL's official signer. Before the SRI, banks and public institutions, **a PDF signed with your certificate is fully valid** — what matters is the certificate, not the tool. You can check any signature at [verify a PDF signature](/en/verify-pdf-signature/).

## Start signing documents online

You don't need an account. Open the app, upload your document and sign.

[Open firmar.ec and sign a document →](https://app.firmar.ec/)
