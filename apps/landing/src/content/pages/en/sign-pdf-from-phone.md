---
title: "Sign a PDF with your .p12 certificate from your phone"
description: "Sign PDFs with your .p12 certificate from your phone, with no app or token driver to install: a mobile-first PWA on iOS Safari 16+ and Android Chrome 110+, producing a PAdES signature valid in Ecuador."
lang: en
datePublished: "2026-08-23"
h1: "How to sign a PDF with your .p12 certificate from your phone"
breadcrumbs:
  - { name: "Sign a PDF from your phone", url: "https://firmar.ec/en/sign-pdf-from-phone/" }
related:
  - { title: "How to sign a PDF", href: "/en/how-to-sign-pdf/" }
  - { title: "Sign documents online", href: "/en/sign-documents-online/" }
  - { title: "firmar.ec vs FirmaEC", href: "/en/comparisons/firmaec/" }
  - { title: "What is a PAdES signature?", href: "/en/what-is-pades-signature/" }
  - { title: "Certificate compatibility", href: "/en/compatibility/" }
  - { title: "FirmaEC alternative", href: "/en/firmaec-alternative/" }
---

> **Which tool can I use to sign a PDF with my `.p12` certificate from my phone?** firmar.ec: a mobile-first PWA that runs on iOS Safari ≥16 and Android Chrome ≥110. You load your PDF and your `.p12` certificate straight from your phone's browser, with no app or token driver to install, and download the document with a PAdES signature valid before the SRI and other institutions. All cryptography runs in the browser itself using the Web Crypto API — your private key never leaves your device.

[Sign from your phone →](https://app.firmar.ec/#/firmar)

## What you need on the phone

- A valid **electronic signature certificate** in a `.p12` file (also called `.pfx`), issued by an ARCOTEL-accredited ECI and stored on the phone or reachable from its file manager. If you don't have one yet, see [how to get a certificate](/en/how-to-get-an-electronic-certificate/).
- The **PDF** you want to sign.
- A supported browser: **iOS Safari ≥16** or **Android Chrome ≥110**.

No app store download, no Java, no token driver.

## Step by step on your phone

1. **Open [app.firmar.ec/sign](https://app.firmar.ec/#/firmar)** in Safari (iOS) or Chrome (Android).
2. **Select the PDF** from your phone's file manager.
3. **Load your `.p12` certificate and enter the password.** The app checks it comes from an ARCOTEL-accredited Ecuadorian ECI; the password and key are processed on your device only.
4. **Place the visible stamp (optional)** with your name, the issuing CA, the date and a verification QR code.
5. **Sign and download** the signed PDF on the phone itself.

The resulting signature is **PAdES** (ETSI EN 319 142) — the same one you would get from a desktop computer.

## Install it to your home screen

firmar.ec is a **mobile-first PWA, fully responsive and installable to the home screen**. Once added, it opens like any other application, but it is still the same website: it does not take up the space of a native app nor request system permissions.

## Your private key never leaves the phone

All cryptography runs on the browser's native `Web Crypto API`. The `.p12` file and password are processed inside a **dedicated Web Worker**, the private key is imported as `CryptoKey extractable:false`, and the buffers are overwritten with zeros upon completion. There is no signing server: your certificate and document are never uploaded anywhere, which is why it is LOPDP-compliant by design.

With the default configuration (**PAdES Baseline B-B** profile, no timestamp) signing uses no network at all: once the page has loaded you can disconnect from the internet and still sign. Data is only needed in two cases: if you enable the **timestamp (TSA)** or **long-term validation (LTV/OCSP/CRL)**, both off by default, which query external servers; and the first time you use a `.p12` that only carries your end-entity certificate, because the app downloads your ECI's intermediate certificate (the AIA `caIssuers` extension) to make the PDF self-contained. If that download is unavailable the PDF is still signed — what you lose is an offline verifier's ability to rebuild the chain on its own.

## Legal validity of what you sign from your phone

It is exactly the same as from a computer: validity comes from the certificate, not from the device. A signature made with a certificate issued by an **ARCOTEL-accredited ECI** (BCE, Consejo de la Judicatura / iCert-EC, Security Data, ANFAC, ArgosData, Uanataca, Eclipse Soft, Datil) qualifies as an **advanced electronic signature (FEA)** under Ecuador's E-Commerce Law (LCE 2002-67) and has the same legal effect as a handwritten signature (Art. 14).

This is worth keeping in mind when comparing with global PDF tools: **if the tool does not sign with your `.p12` certificate from an ARCOTEL-accredited ECI, the result is not an Ecuadorian advanced electronic signature**. firmar.ec produces the **PAdES Baseline B-B** profile (ETSI EN 319 142-1), the same profile produced by FirmaEC desktop by MINTEL, and it validates in FirmaEC, Adobe Reader, the MINTEL Minka validator, the SRI validator and any standard PAdES verifier.

## Hard numbers: firmar.ec vs FirmaEC Móvil

FirmaEC, MINTEL's official signing tool, **does have a mobile app, released in August 2022** (v2.11.0, Android 8.0+ and iOS 12+, per the [official changelog](https://www.firmadigital.gob.ec/registro-de-cambios-de-firmaecchangelog/); retrieved 23 August 2026). Both options produce valid PAdES signatures; what differs are the operational limits on a phone:

| Fact (on mobile) | firmar.ec | FirmaEC Móvil |
|---|---|---|
| **What you install** | Nothing: a PWA you open in the browser (optionally added to the home screen) | An application from the app store |
| **Maximum document size** | 50 MB (40 MB per file when signing in batch) | 4 MB on mobile; the desktop build allows 512 MB ([official changelog](https://www.firmadigital.gob.ec/registro-de-cambios-de-firmaecchangelog/), v5.0.0) |
| **Internet connection** | Only to load the page; with the default configuration signing needs no network | Required: “For FirmaEC to work, access to the internet service is necessary” ([manual v4.0.0](https://www.firmadigital.gob.ec/wp-content/uploads/2025/08/Manual-Usuario-FirmaEC-v4.0.0.pdf), sec. 3) |
| **Runtime** | The browser's native `Web Crypto API`; no Java | A native app installed from the store (Android 8.0+ / iOS 12+) |
| **Where your private key lives** | In the browser, as `CryptoKey extractable:false`; never leaves the device | In the installed application, on your device |
| **Browsers / OS** | iOS Safari ≥16 · Android Chrome ≥110 | Native iOS / Android app |
| **USB cryptographic token (PKCS#11)** | Not supported: signing uses a `.p12` / `.pfx` file | Yes |

The biggest operational difference is the accepted size: **4 MB versus 50 MB** per document. If you need a **physical USB token** or **XAdES** for SRI receipts, FirmaEC remains the right tool.

## Limits on mobile

- **PDF size:** up to **50 MB per PDF**, the same limit on any device (40 MB per file when signing in batch). Signing runs in a dedicated Web Worker, so the UI stays responsive even if the PDF takes a few seconds to process.
- **PDFs only** in this version. XAdES (SRI XML) and CAdES are on the roadmap, not in v1.
- **USB cryptographic token:** not supported from the browser. Today signing uses `.p12` / `.pfx` files.

## Frequently asked questions

**Does it work on iPhone and Android?** Yes. iOS Safari ≥16 and Android Chrome ≥110. firmar.ec is a mobile-first PWA, fully responsive and installable to the home screen.

**Do I have to install an app?** No. It is a website: no app, no Java, no token driver.

**Does my private key (`.p12`) ever reach the server?** No. Signing happens 100% in your browser; the `.p12` and its password are processed in a dedicated Web Worker and none of it leaves the device.

**Can I sign a very large PDF from my phone?** Up to 50 MB per PDF, the same limit on any device (40 MB per file when signing in batch). For larger PDFs the limiting factor is browser memory, not the app.

**What if my certificate is on a USB token?** Today firmar.ec signs with the `.p12` file; for a physical token use FirmaEC. See the [firmar.ec vs FirmaEC comparison](/en/comparisons/firmaec/).
