---
title: "Add a timestamp (TSA) to a PDF's electronic signature"
description: "How to add a TSA timestamp (RFC 3161) to a PDF electronic signature: enable it in firmar.ec's Settings and the signature comes out as PAdES B-T. Only the document's hash travels — never the PDF."
lang: en
datePublished: "2026-08-29"
h1: "How to add a timestamp (TSA) to a PDF's electronic signature"
breadcrumbs:
  - { name: "Timestamp (TSA) on a PDF", url: "https://firmar.ec/en/pdf-signature-timestamp-tsa/" }
related:
  - { title: "What is PAdES?", href: "/en/what-is-pades-signature/" }
  - { title: "Sign without uploading to a server", href: "/en/sign-pdf-without-uploading-to-a-server/" }
  - { title: "How to sign a PDF", href: "/en/how-to-sign-pdf/" }
  - { title: "Verify a PDF signature", href: "/en/verify-pdf-signature/" }
  - { title: "Glossary (TSA, OCSP, CRL)", href: "/en/glossary/" }
---

> **How do I add a timestamp (TSA) to the electronic signature of a PDF?** In firmar.ec: open **Settings**, enable the **timestamp**, and sign your PDF as usual at [app.firmar.ec](https://app.firmar.ec/#/firmar). The signature comes out in the **PAdES B-T** profile, with an RFC 3161 timestamp issued by a Time Stamping Authority (TSA). By default it uses FreeTSA, a free public TSA, and you can configure the URL of any other RFC 3161-compatible TSA. Only the document's **hash** travels to the time server — never the PDF.

[Sign with a timestamp →](https://app.firmar.ec/#/firmar)

## What a timestamp is and why it matters

A timestamp is proof, issued by a third party called a **TSA** (Time Stamping Authority), that the signature existed at a given moment. Technically it is an **RFC 3161** response: the TSA receives the hash of your signature, adds certified time, and returns it signed with its own certificate.

Why it matters:

- **The date comes from a third party**, not the signer: it is evidence the document was signed *no later than* that moment.
- **The signature outlives certificate expiry**: a verifier can confirm you signed while your certificate was still valid, even after it has expired.

## How to enable it in firmar.ec (step by step)

1. **Open [app.firmar.ec](https://app.firmar.ec/#/firmar)** in your browser.
2. **Go to Settings** and enable the **timestamp (TSA)**. It ships disabled by default, because it is one of the few options that uses the network while signing.
3. (Optional) **Configure your TSA's URL.** FreeTSA, a free public TSA, is the default; if your organization has its own or a paid TSA, paste its RFC 3161 URL.
4. **Sign your PDF as usual**: load the document, the `.p12` and the password. The resulting signature carries the seal and lands in the **PAdES B-T** profile (ETSI EN 319 142).

## B-B, B-T and what travels over the network

| Profile | What it adds | Network at signing time? |
|---|---|---|
| **PAdES B-B** (default) | The signature with your certificate | No |
| **PAdES B-T** (TSA enabled) | RFC 3161 timestamp | Yes: the **hash** is sent to the TSA |
| **PAdES B-LT / B-LTA** (LTV enabled) | Revocation info (OCSP/CRL) and archive timestamp | Yes: queries about the certificates |

RFC 3161 is designed so the TSA **never sees your document**: it receives only the hash (the cryptographic fingerprint). Your PDF still never leaves the browser, as everywhere in firmar.ec — details in [signing without uploading to a server](/en/sign-pdf-without-uploading-to-a-server/). With FreeTSA, the timestamp request goes through a firmar.ec relay, because FreeTSA does not accept direct browser requests (CORS); that relay only transports the RFC 3161 request — that is, the hash.

## Honest limits

- **Batch signing does not apply TSA**: [batches](/en/sign-multiple-pdfs-at-once/) sign with the B-B profile. To seal a document, sign it individually with the option enabled.
- **FreeTSA is a free public TSA**, not an Ecuadorian accredited one. For most uses any standard RFC 3161 TSA produces a verifiable seal; if your procedure demands a specific TSA, configure its URL in the app.
- A timestamp requires an **internet connection** at signing time (it is an exchange with the TSA). Without network, sign in B-B.

## Frequently asked questions

**Does the TSA see my document?** No. The RFC 3161 protocol sends the TSA only the hash — the cryptographic fingerprint of the signature. The PDF never leaves your browser.

**Is the timestamp enabled by default?** No, it ships disabled: it is one of the few options that uses the network while signing. Enable it in Settings and it stays on for subsequent signatures.

**Which TSA does firmar.ec use?** FreeTSA by default, a free public TSA, through a relay that only transports the RFC 3161 request. You can configure the URL of any other compatible TSA.

**Is a signature without a timestamp valid?** Yes. The B-B profile is a fully valid PAdES signature; the seal adds third-party proof of date and lets the signature be verified even after your certificate expires.

**Can I timestamp batch signatures?** Not in this version: batches sign with the B-B profile. Sign documents that need a seal individually.
