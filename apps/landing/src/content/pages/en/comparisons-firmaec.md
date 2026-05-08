---
title: "firmar.ec vs FirmaEC desktop: an honest comparison"
description: "Objective comparison between firmar.ec and FirmaEC by MINTEL. What each does better, when to use which, and why they are complementary rather than competing."
lang: en
datePublished: "2026-05-08"
h1: "firmar.ec vs FirmaEC desktop"
breadcrumbs:
  - { name: "Comparisons", url: "https://firmar.ec/en/comparisons/firmaec" }
  - { name: "vs FirmaEC", url: "https://firmar.ec/en/comparisons/firmaec" }
related:
  - { title: "Electronic signatures in Ecuador", href: "/en/electronic-signature-ecuador" }
  - { title: "How to sign with a BCE certificate", href: "/en/how-to-sign-with-bce-certificate" }
---

**FirmaEC** is the official desktop app by MINTEL (Ecuador's Ministry of Telecommunications) for signing electronic documents in Ecuador. It is **excellent and mandatory in many situations**. firmar.ec **is not a competitor — it is a complement**. This comparison helps you choose the right tool for your use case.

## Comparison table

| Capability | firmar.ec | FirmaEC desktop |
|---|---|---|
| **Platform** | Web (any modern browser) | Java desktop (Win/Mac/Linux) |
| **Installation** | None | Requires Java JRE 8+ + token driver |
| **Mobile (iOS/Android)** | ✅ Yes, mobile-first PWA | ❌ No |
| **Supported formats** | PDF (PAdES B-B) | PDF + XML (XAdES) + any file (CAdES) |
| **Sign with `.p12`** | ✅ Yes | ✅ Yes |
| **Sign with physical USB token** | ❌ No (WebUSB under evaluation) | ✅ Yes |
| **Batch signing (many PDFs)** | ⚠️ Manually one by one | ✅ Integrated batch mode |
| **Signature verification** | ✅ Yes (offline + OCSP) | ✅ Yes |
| **Cost** | Free | Free |
| **Open source** | ✅ Yes (Apache 2.0) | ❌ No |
| **Private key to server** | ❌ Never | ❌ Never (it's desktop) |
| **Works offline** | Verification yes; signing recommended online | ✅ Yes |
| **Audit the code yourself** | ✅ Yes | ❌ No, it is opaque |
| **Reproducible builds + Sigstore** | ✅ Yes | ❌ No |
| **i18n (English)** | ✅ Yes | ⚠️ Limited |

## When to use firmar.ec?

- You need to sign **a PDF quickly** and do not have Java installed.
- You are on a **restricted machine** (corporate, hotel, cyber café) where you cannot install software.
- You want to sign from your **mobile or tablet**.
- Your counterparty needs to **verify** a signature without installing anything.
- Your organisation has strict **LOPDP compliance policies** and wants technical evidence that the key never leaves the device.
- You are a developer or auditor who wants to **audit the code** that processes your certificate.

## When to use FirmaEC desktop?

- You sign **SRI electronic receipts** (they require XAdES; firmar.ec does not support this yet).
- You have a **physical USB cryptographic token** and need to sign with it.
- You sign **batches of many PDFs** in a single session.
- You work **completely offline** and need to sign.
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
