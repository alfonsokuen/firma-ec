---
title: "FirmaEC alternative: sign PDFs in your browser"
description: "Does FirmaEC need Java or won't open on your phone? firmar.ec signs PDFs with your .p12 certificate in the browser, with no install. Free and open source."
lang: en
datePublished: "2026-05-25"
h1: "A web alternative to FirmaEC for signing PDFs"
breadcrumbs:
  - { name: "FirmaEC alternative", url: "https://firmar.ec/en/firmaec-alternative/" }
related:
  - { title: "firmar.ec vs FirmaEC: full comparison", href: "/en/comparisons/firmaec/" }
  - { title: "How to sign with a BCE certificate", href: "/en/how-to-sign-with-bce-certificate/" }
  - { title: "Electronic signatures in Ecuador", href: "/en/electronic-signature-ecuador/" }
---

> **Looking for an alternative to FirmaEC?** **firmar.ec** signs PDFs with your `.p12` electronic certificate directly in the browser: **no Java to install, no downloads, and it works on your phone too**. It is free and open source. Signing happens 100% on your device and carries the same legal validity as FirmaEC, as long as your certificate is issued by an Information Certification Entity (ECI) accredited by ARCOTEL.

## firmar.ec is not FirmaEC

Worth clarifying, because the names look alike: **firmar.ec and FirmaEC are different tools**.

- **FirmaEC** is the official desktop app from MINTEL (Ministry of Telecommunications). You download it, install it, and run it with Java.
- **firmar.ec** is an independent, open-source, non-profit web app by IDK Manager. There is nothing to install: it opens in the browser.

It does not replace FirmaEC for everything —below you'll see when you do need FirmaEC— but for the most common case (signing a PDF quickly) it removes the friction of installing software.

## Why look for a FirmaEC alternative?

The most common reasons people look for another option:

- **It requires Java.** FirmaEC needs Java JRE 8+ installed; on many machines that's an obstacle (versions, permissions, antivirus).
- **It doesn't work on mobile.** FirmaEC is desktop-only (Windows/Mac/Linux). If you need to sign from a phone or tablet, it isn't an option.
- **You can't install software.** On a corporate, hotel, or internet-café machine you often lack install permissions.
- **You just need to sign one PDF fast** and don't want to install anything for a one-off.

## What firmar.ec solves

| | firmar.ec | FirmaEC desktop |
|---|---|---|
| Platform | Web (any browser) | Java desktop |
| Installation | None | Java JRE 8+ + token driver |
| Mobile (iOS/Android) | ✅ Yes (PWA) | ❌ No |
| Sign with `.p12` | ✅ Yes | ✅ Yes |
| Cost | Free | Free |
| Open source | ✅ Yes (AGPL-3.0) | ✅ Yes (MINKA gob.ec) |
| Private key to a server | ❌ Never | ❌ Never |

[See the full firmar.ec vs FirmaEC comparison →](/en/comparisons/firmaec/)

## When you do need FirmaEC (not firmar.ec)

Let's be honest: firmar.ec doesn't cover everything. **Use FirmaEC** (or the matching official flow) if you:

- Sign **SRI electronic tax documents**, which require the **XAdES** format — firmar.ec today only does PDF (PAdES).
- Have a **USB cryptographic token** and need to sign with it (firmar.ec uses the `.p12` file, not the physical token).
- Need **bulk/batch signing** of many documents in one session.
- Work **fully offline**.

For everything else —signing a PDF with your `.p12`, from any device, with no install— firmar.ec is the direct web alternative.

## Get started

Open [app.firmar.ec](https://app.firmar.ec/) or go to [firmar.ec sign](/en/sign), load your PDF and your `.p12` certificate, and sign. Nothing is uploaded to any server: your key never leaves the browser. If you received a signed PDF and want to confirm it's valid, use the [verifier](/en/verify).
