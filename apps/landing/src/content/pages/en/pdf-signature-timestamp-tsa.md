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

> **How do I add a timestamp (TSA) to the electronic signature of a PDF?** In firmar.ec: open **Settings**, enable the **timestamp**, and sign your PDF as usual at [app.firmar.ec](https://app.firmar.ec/#/firmar). The signature comes out in the **PAdES B-T** profile, with an RFC 3161 timestamp issued by a Time Stamping Authority (TSA). On app.firmar.ec the TSA in use is FreeTSA, a free public TSA, reached through a relay on the site itself. Only the document's **hash** travels to the time server — never the PDF.

[Sign with a timestamp →](https://app.firmar.ec/#/firmar)

## What a timestamp is and why it matters

A timestamp is proof, issued by a third party called a **TSA** (Time Stamping Authority), that the signature existed at a given moment. Technically it is an **RFC 3161** response: the TSA receives the hash of your signature, adds certified time, and returns it signed with its own certificate.

Why it matters:

- **The date comes from a third party**, not the signer: it is evidence the document was signed *no later than* that moment.
- **The signature outlives certificate expiry**: a verifier can confirm you signed while your certificate was still valid, even after it has expired.

## How to enable it in firmar.ec (step by step)

1. **Open [app.firmar.ec](https://app.firmar.ec/#/firmar)** in your browser.
2. **Go to Settings** and enable the **timestamp (TSA)**. It ships disabled by default, because it is one of the few options that uses the network while signing.
3. **The TSA in use is FreeTSA**, a free public TSA, reached through a relay on the site itself. The URL field accepts any other RFC 3161 TSA, but on app.firmar.ec the site's CSP only allows the default one: pointing elsewhere requires [self-hosting firmar.ec](https://github.com/idkmanager/firmar-ec) and adjusting the deployment's CSP — the app itself warns you when you type another URL.
4. **Sign your PDF as usual**: load the document, the `.p12` and the password. The resulting signature carries the seal and lands in the **PAdES B-T** profile (ETSI EN 319 142).

## B-B, B-T and what travels over the network

| Profile | What it adds | Network at signing time? |
|---|---|---|
| **PAdES B-B** (default) | The signature with your certificate | No |
| **PAdES B-T** (TSA enabled) | RFC 3161 timestamp | Yes: the **hash** is sent to the TSA |
| **PAdES B-LT / B-LTA** (LTV enabled) | Revocation info (OCSP/CRL) and archive timestamp | Yes: queries about the certificates |

RFC 3161 is designed so the TSA **never sees your document**: it receives only the hash (the cryptographic fingerprint). Your PDF still never leaves the browser, as everywhere in firmar.ec — details in [signing without uploading to a server](/en/sign-pdf-without-uploading-to-a-server/). With FreeTSA, the timestamp request goes through a firmar.ec relay, because FreeTSA does not accept direct browser requests (CORS); that relay only transports the RFC 3161 request — that is, the hash.

## Honest limits

- **Batch signing inherits this setting**: with the timestamp enabled, every document in a [batch](/en/sign-multiple-pdfs-at-once/) also comes out as B-T. There is no need to sign them one by one.
- **FreeTSA is a free public TSA**, not an Ecuadorian accredited one. For most uses any standard RFC 3161 TSA produces a verifiable seal. If your procedure demands a specific TSA, typing its URL into app.firmar.ec is not enough: the site's CSP blocks any destination other than the default, so you have to self-host the app and open that TSA in the deployment's CSP.
- A timestamp requires an **internet connection** at signing time (it is an exchange with the TSA). Without network, sign in B-B.

## Frequently asked questions

**Does the TSA see my document?** No. The RFC 3161 protocol sends the TSA only the hash — the cryptographic fingerprint of the signature. The PDF never leaves your browser.

**Is the timestamp enabled by default?** No, it ships disabled: it is one of the few options that uses the network while signing. Enable it in Settings and it stays on for subsequent signatures.

**Which TSA does firmar.ec use?** FreeTSA, a free public TSA, through a relay that only transports the RFC 3161 request. Pointing at another TSA is only possible by self-hosting firmar.ec, because the published site's CSP allows that destination only.

**Is a signature without a timestamp valid?** Yes. The B-B profile is a fully valid PAdES signature; the seal adds third-party proof of date and lets the signature be verified even after your certificate expires.

**Can I timestamp batch signatures?** Yes. The batch inherits the app settings: with the timestamp enabled in Settings, every document in the batch comes out in the B-T profile.
