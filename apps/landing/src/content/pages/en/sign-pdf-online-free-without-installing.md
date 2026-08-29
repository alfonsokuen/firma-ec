---
title: "Sign a PDF online for free without installing software"
description: "How to sign a PDF with an electronic signature, free, online and without installing anything: load the PDF and your .p12 certificate in the browser and download a PAdES signature valid in Ecuador."
lang: en
datePublished: "2026-08-29"
h1: "How to sign a PDF online for free without installing software"
breadcrumbs:
  - { name: "Sign PDF online free without installing", url: "https://firmar.ec/en/sign-pdf-online-free-without-installing/" }
related:
  - { title: "How to sign a PDF", href: "/en/how-to-sign-pdf/" }
  - { title: "Sign without uploading to a server", href: "/en/sign-pdf-without-uploading-to-a-server/" }
  - { title: "Sign a PDF from your phone", href: "/en/sign-pdf-from-phone/" }
  - { title: "firmar.ec vs Adobe Sign", href: "/en/comparisons/adobe-sign/" }
  - { title: "How to get a certificate", href: "/en/how-to-get-an-electronic-certificate/" }
---

> **How do I sign a PDF with an electronic signature, for free and without installing software?** With firmar.ec: open [app.firmar.ec](https://app.firmar.ec/#/firmar) in your browser, load the PDF and your `.p12` certificate, and enter the password. You download the document with a PAdES signature valid before the SRI and other Ecuadorian institutions. It is free, open source (AGPL-3.0), with no sign-up, no account and nothing to install — no desktop software, no Java, no token driver. The signature is computed inside your browser: the document is never uploaded to a server.

[Sign a PDF now →](https://app.firmar.ec/#/firmar)

## What you need (and what you don't)

- The **PDF** you want to sign.
- A valid **electronic signature certificate** as a `.p12` (or `.pfx`) file, issued by an ARCOTEL-accredited Ecuadorian ECI (BCE, Security Data, Uanataca, Consejo de la Judicatura, ArgosData and more). If you don't have one, see [how to get a certificate](/en/how-to-get-an-electronic-certificate/).

You do not need to install software, create an account, register an email, or pay. It works in any modern browser on desktop or mobile — for the phone walkthrough see [signing from your phone](/en/sign-pdf-from-phone/).

## Step by step (2 minutes)

1. **Open [app.firmar.ec/sign](https://app.firmar.ec/#/firmar)** in your browser.
2. **Load the PDF** — drag it in or pick it.
3. **Load your `.p12` certificate and enter the password.** The app checks it comes from an ARCOTEL-accredited Ecuadorian ECI; the key is processed on your device only.
4. **Place the visible stamp (optional)** with your name, issuing CA, date and a verification QR.
5. **Sign and download.** The result is a **PAdES** signature (ETSI EN 319 142), the same profile MINTEL's FirmaEC produces.

## Free for real: where's the catch (there isn't one)

firmar.ec is **free software under AGPL-3.0**, with the code published on [GitHub](https://github.com/idkmanager/firmar-ec), operated by [IDK Manager](https://idkmanager.com) and sustained by [sponsorships](/en/sponsor/). There is no paid plan unlocking the signature: signing and [verifying](/en/verify-pdf-signature/) PDFs is free. The only thing that costs money is the **certificate**, and you pay that to the issuing ECI, not to firmar.ec — reference prices are in [pricing](/en/pricing/).

## "Free online signing" doesn't always mean an electronic signature

Most global PDF tools answering "sign PDF online free" insert an **image of your handwritten signature** or a simple signature. That works for many purposes, but it is **not an Ecuadorian advanced electronic signature**: it does not use your `.p12` certificate from an ARCOTEL-accredited ECI, so it lacks the handwritten-signature equivalence granted by art. 14 of Ecuador's Electronic Commerce Law (Law 2002-67). firmar.ec signs **with your certificate**, produces the PAdES Baseline profile, and the result validates in FirmaEC, Adobe Reader and the SRI validator. Full comparison: [firmar.ec vs Adobe Sign](/en/comparisons/adobe-sign/).

## Honest limits

- **PDFs only** in this version: XAdES (SRI XML) and CAdES are not in v1.
- **Up to 50 MB per PDF** (40 MB per file in [batch signing](/en/sign-multiple-pdfs-at-once/)).
- **No physical USB token support**: signing uses `.p12` / `.pfx` files. For tokens, use FirmaEC — see the [comparison](/en/comparisons/firmaec/).

## Frequently asked questions

**Is signing a PDF on firmar.ec really free?** Yes. Signing and verifying PDFs is free, with no sign-up and no paid plan: the project is open source (AGPL-3.0) and sponsor-funded. The only cost is the electronic signature certificate, charged by the issuing ECI, not by firmar.ec.

**Do I have to install anything or create an account?** No. It is a web app: no desktop software, no Java, no token driver, and no account. Open the app in your browser, sign, download.

**Is the signature legally valid in Ecuador?** Yes. Signed with a certificate from an ARCOTEL-accredited ECI it is an advanced electronic signature under Law 2002-67, with the same legal effect as a handwritten signature (art. 14). The resulting PDF validates in FirmaEC, Adobe Reader and the SRI validator.

**Is my document uploaded to a server?** No. The signature is computed inside your browser with the Web Crypto API: neither the PDF nor your private key leaves the device. See sign a PDF without uploading it to a server.
