---
title: "firmar.ec vs FirmaEC desktop: an honest comparison"
description: "Objective comparison between firmar.ec and FirmaEC by MINTEL. What each does better, when to use which, and why they are complementary rather than competing."
lang: en
datePublished: "2026-05-08"
dateModified: "2026-08-23"
h1: "firmar.ec vs FirmaEC desktop"
breadcrumbs:
  - { name: "Comparisons", url: "https://firmar.ec/en/comparisons/firmaec/" }
  - { name: "vs FirmaEC", url: "https://firmar.ec/en/comparisons/firmaec/" }
related:
  - { title: "FirmaEC alternative", href: "/en/firmaec-alternative/" }
  - { title: "Electronic signatures in Ecuador", href: "/en/electronic-signature-ecuador/" }
  - { title: "How to sign with a BCE certificate", href: "/en/how-to-sign-with-bce-certificate/" }
---

**FirmaEC** is MINTEL's official signing tool (Ecuador's Ministry of Telecommunications) for signing electronic documents in Ecuador, with a desktop build and **also a mobile app released in August 2022** (v2.11.0, Android 8.0+ and iOS 12+, per the [official changelog](https://www.firmadigital.gob.ec/registro-de-cambios-de-firmaecchangelog/); retrieved 23 August 2026). It is **excellent and mandatory in many situations**. firmar.ec **is not a competitor — it is a complement**. This comparison helps you choose the right tool for your use case.

## Comparison table

| Capability | firmar.ec | FirmaEC desktop |
|---|---|---|
| **Platform** | Web (any modern browser) | Java desktop (Win/Mac/Linux) + native Android / iOS app |
| **Installation** | None | Desktop: Java JRE 8+ + token driver. Mobile: app from the store |
| **Mobile (iOS/Android)** | ✅ Yes, mobile-first PWA; nothing to install | ✅ Yes, native app from the store |
| **Supported formats** | PDF (PAdES B-B, B-T, B-LT, B-LTA) | PDF + XML (XAdES) + any file (CAdES) |
| **Maximum document size** | 50 MB on any device (40 MB per file when signing in batch) | 4 MB on mobile · 512 MB on desktop ([official changelog](https://www.firmadigital.gob.ec/registro-de-cambios-de-firmaecchangelog/), v5.0.0) |
| **Sign with `.p12`** | ✅ Yes | ✅ Yes |
| **Sign with physical USB token** | ❌ No (WebUSB under evaluation) | ✅ Yes |
| **Batch signing (many PDFs)** | ✅ Integrated batch mode (`/firmar-lote`), up to 40 MB per file | ✅ Integrated batch mode |
| **Signature verification** | ✅ Yes (offline + OCSP + CRL) | ✅ Yes |
| **TSA RFC 3161 (timestamp)** | ✅ Supported, off by default (FreeTSA endpoint, configurable) | ✅ Yes, since v5.0.0 (11 April 2026): “Incorporación del sellado de tiempo (TSA) en los documentos firmados electrónicamente” ([official changelog](https://www.firmadigital.gob.ec/registro-de-cambios-de-firmaecchangelog/); retrieved 23 August 2026) |
| **PAdES B-LT / B-LTA (long-term validation)** | ✅ Yes | Check with MINTEL |
| **Cost** | Free | Free |
| **Open source** | ✅ Yes (AGPL-3.0) | ✅ Yes (published on [MINKA gob.ec](https://minka.gob.ec/mintel/ge/firmaec)) |
| **Private key to server** | ❌ Never | ❌ Never (it runs locally) |
| **Works offline** | ✅ Yes for verification, and for signing too with the default configuration (PAdES B-B). Timestamping (TSA) and LTV, both off by default, do need the network | ❌ No: “For FirmaEC to work, access to the internet service is necessary” ([manual v4.0.0](https://www.firmadigital.gob.ec/wp-content/uploads/2025/08/Manual-Usuario-FirmaEC-v4.0.0.pdf), sec. 3) |
| **Audit the code yourself** | ✅ Yes (3 public mirrors) | ✅ Yes (via MINKA portal) |
| **Sigstore Cosign + Rekor tlog on releases** | ✅ Yes | Check with MINTEL |
| **Reproducible builds** | ⏳ Roadmap | Check with MINTEL |
| **i18n (English)** | ✅ Yes | ⚠️ Limited |

## When to use firmar.ec?

- You need to sign **a PDF quickly** and do not have Java installed.
- You are on a **restricted machine** (corporate, hotel, cyber café) where you cannot install software.
- You want to sign from your **mobile or tablet** without installing an app, or the document is larger than the 4 MB FirmaEC Móvil accepts.
- Your counterparty needs to **verify** a signature without installing anything.
- Your organisation has strict **LOPDP compliance policies** and wants technical evidence that the key never leaves the device.
- You are a developer or auditor who wants to **audit the code** that processes your certificate.

## When to use FirmaEC desktop?

- You sign **SRI electronic receipts** (they require XAdES; firmar.ec does not support this yet).
- You have a **physical USB cryptographic token** and need to sign with it.
- Your BCE certificate is on a **physical token** and you never exported it to `.p12`.

## Cross-compatibility

- A PDF signed in **firmar.ec** validates correctly in **FirmaEC**, in **Adobe Reader**, in **Foxit**, and in the MINTEL Minka validator. And vice versa.
- Both produce the same technical profile: **PAdES Baseline B-B** (ETSI EN 319 142).

## Philosophy

FirmaEC was created as **public infrastructure** for Ecuador. firmar.ec is built with the same intention of **public good**: open-source, non-profit, complementing what the public sector already provides. The key difference is the **platform** (web vs desktop) and the **operational model** (maintained by a private workshop vs a ministry).

Both can coexist, and in fact **more than one should exist**. A critical digital sovereignty tool with a single provider (public or private) is a systemic risk.

## Resources

- [FirmaEC official — minka.gob.ec](https://minka.gob.ec/mintel/ge/firmaec)
- [MINTEL Minka validator](https://minka.gob.ec)
