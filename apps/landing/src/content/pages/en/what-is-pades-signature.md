---
title: "What is PAdES? Electronic signatures in PDF files"
description: "PAdES is the ETSI EN 319 142 standard for signing PDFs. We explain the B-B, B-T, B-LT and B-LTA profiles and how it compares with XAdES and CAdES."
lang: en
datePublished: "2026-05-08"
h1: "What is PAdES? Electronic signatures in PDF files"
breadcrumbs:
  - { name: "What is PAdES?", url: "https://firmar.ec/en/what-is-pades-signature/" }
related:
  - { title: "How to verify a PDF signature", href: "/en/verify-pdf-signature/" }
  - { title: "Electronic signatures in Ecuador", href: "/en/electronic-signature-ecuador/" }
  - { title: "How to sign with a BCE certificate", href: "/en/how-to-sign-with-bce-certificate/" }
  - { title: "Technical glossary", href: "/en/glossary/" }
---

**PAdES** (acronym for *PDF Advanced Electronic Signatures*) is the set of profiles defined in the **ETSI EN 319 142** standard for embedding **advanced electronic signatures inside a PDF file**. It is the format produced by FirmaEC desktop, Adobe Sign, DocuSign and firmar.ec.

## Why PAdES and not something else?

Historically, signing a PDF "by hand" meant printing it, signing with a pen, scanning, and pasting an image. That approach has **zero cryptographic validity**: the image of a handwritten stroke proves neither authorship nor integrity.

PAdES solves this by embedding inside the PDF:

1. A **cryptographic signature** (CMS / PKCS#7 SignedData) over the entire document content.
2. The **signer's certificate** and the chain up to the root CA.
3. (Optional) A **TSA timestamp** proving the exact date of signing.
4. (Optional) Revocation information (OCSP/CRL) embedded for long-term validation.

Any subsequent modification of the PDF — changing a word, a figure, a visual stamp — **invalidates the cryptographic signature**, and PDF viewers display a red warning to the reader.

## The 4 PAdES profiles

ETSI defines four "Baseline" profiles in ascending order of robustness:

| Profile | What it includes | When to use it |
|---|---|---|
| **B-B** (Basic) | Signature + cert + chain | Simple use cases; validates while the cert is valid and the CA is online. This is what firmar.ec v1 produces. |
| **B-T** (Timestamp) | Above + TSA timestamp | Needed when it matters to prove **when** signing occurred. firmar.ec v1.1 (roadmap). |
| **B-LT** (Long-Term) | Above + embedded revocation | Allows verifying the signature years later even if the CA no longer exists or the cert has expired. firmar.ec v1.2 (roadmap). |
| **B-LTA** (Long-Term Archive) | Above + periodic timestamps | For legal archives that must be kept for decades. |

For most everyday use cases — contracts, invoices, letters, declarations — **B-B is sufficient**. It validates with any modern PDF viewer (Adobe Reader, Foxit, FirmaEC, Minka, etc.) while your certificate is valid.

## How does PAdES differ from XAdES and CAdES?

Both are siblings of PAdES within the ETSI family:

- **XAdES** (XML): signs XML directly. This is the format required by the SRI for electronic receipts.
- **CAdES** (CMS detached): signs any file and leaves a separate `.p7s` file.
- **PAdES** (PDF): signature embedded within the PDF itself.

Which one to use?
- PDF → **PAdES**.
- SRI XML → **XAdES**.
- Any arbitrary file where you want to keep the original intact → **CAdES**.

## What does a PAdES signature look like?

There are two components:

### Cryptographic component (always invisible to humans)
A `/Sig` dictionary inside the PDF with fields `/Filter`, `/SubFilter`, `/Contents` (the CMS DER signature), `/ByteRange` (which bytes are covered), `/Cert`, `/M` (signing time), optional `/TS` (timestamp).

### Visible stamp (optional)
A "stamp" on a specific page that shows the human reader: signer's name, role, date, reason ("Approved", "Reviewed"), and optionally a QR code linking to a verifier. firmar.ec generates the QR pointing to `app.firmar.ec/verificar?h=<hash>`.

## Algorithms: what crypto does PAdES use?

ETSI TS 119 312 maintains the list of current algorithms. Today the following are used:

- **Hash**: SHA-256 (minimum), SHA-384 or SHA-512.
- **Asymmetric signature**: RSA with key ≥ 2048 bits, or ECDSA P-256/P-384.
- **Padding**: RSASSA-PKCS1-v1_5 (legacy interoperable) or RSA-PSS (modern preferred).

firmar.ec explicitly rejects SHA-1, MD5, and RSA<2048: if your certificate still uses those, it was issued against policy and your ECI should have renewed it.

## Standards and references

- **ETSI EN 319 142-1** — PAdES Baseline ([text](https://www.etsi.org/deliver/etsi_en/319100_319199/31914201/))
- **ETSI EN 319 102-1** — AdES validation procedures
- **ETSI TS 119 312** — Current cryptographic suites
- **RFC 5652** — CMS Cryptographic Message Syntax
- **RFC 7292** — PKCS#12 Personal Information Exchange
- **ISO 32000-2** — PDF 2.0 (signatures section)

## Verification: how do I know a signed PDF is valid?

You can:

1. Open the PDF in **Adobe Reader** or **Foxit Reader** — they show a signature panel with signer details.
2. Upload it to **firmar.ec/verificar** (our top recommendation: free, in your browser, validates the chain up to ARCOTEL roots + OCSP).
3. Use **Minka by MINTEL** ([official validator](https://minka.gob.ec)).
4. The **SRI validator** for XAdES (not PAdES).

All these tools produce the same result for a valid signature: they run the same set of checks because they all follow ETSI EN 319 102.
