---
title: "What is an Electronic Signature? Definition, Legal Validity in Ecuador and How It Works"
description: "Electronic signature explained in clear terms: what it is, its legal validity in Ecuador, how it differs from a scanned image of your signature, how it's created with a .p12 certificate, and when you need a certified electronic signature under Law 2002-67."
lang: en
datePublished: "2026-05-29"
dateModified: "2026-05-29"
h1: "What is an electronic signature"
breadcrumbs:
  - { name: "What is an electronic signature", url: "https://firmar.ec/en/what-is-electronic-signature/" }
related:
  - { title: "Electronic signature vs digital signature", href: "/en/electronic-signature-vs-digital-signature/" }
  - { title: "Electronic signature in Ecuador: legal framework", href: "/en/electronic-signature-ecuador/" }
  - { title: "ECIs accredited by ARCOTEL", href: "/en/certificate-issuers-ecuador/" }
  - { title: "How to sign a PDF", href: "/en/how-to-sign-pdf/" }
---

> **An electronic signature is a set of electronic data attached to a digital document that identifies the signer and uniquely binds them to the signed content.** In Ecuador, when generated with a digital certificate issued by an **ECI accredited by ARCOTEL**, it has the **same legal validity as a handwritten signature** (Law 2002-67, Art. 14). It is not a scanned image of your signature, nor a finger drawing, nor a photo: it is verifiable cryptography.

## Technical definition

An electronic signature results from applying a **cryptographic algorithm** (typically RSA or ECDSA with SHA-256) over a document's contents, using a **private key** that only the signer holds. The result is a block of bytes embedded in the document — for PDFs, inside the file itself following the **PAdES (PDF Advanced Electronic Signature)** standard.

Three essential technical properties:

1. **Integrity.** If the document is modified after signing — even a single character — the signature is automatically invalidated upon verification.
2. **Authenticity.** The signature is tied to the signer's **digital certificate** (an X.509 file issued by a certification authority). The receiver can verify who signed.
3. **Non-repudiation.** The signer cannot deny signing, because only they hold the private key that produced the signature.

## What is NOT a legal electronic signature

- A **scanned image of your handwritten signature** pasted into a PDF — just an image, no proof of authorship or integrity.
- A **finger or mouse drawing** in a PDF — same problem: no cryptography.
- **Typing your name at the end of an email** — expression of will, but not certified electronic signature.
- A **password, PIN, or SMS code** — authentication mechanisms, not document signatures.
- **DocuSign, Adobe Sign, HelloSign** used without an ARCOTEL certificate — valid between parties that agree contractually, but **does not equate to a handwritten signature** before Ecuadorian authorities.

For an electronic signature to **legally equate to a handwritten signature in Ecuador**, it must be a **certified electronic signature**: it must use a digital certificate from a **Certificate Information Entity (ECI) accredited by ARCOTEL**. Full list at [ECIs accredited by ARCOTEL](/en/certificate-issuers-ecuador/).

## How it works, step by step

When you sign a PDF with your `.p12` certificate:

1. **The software computes a SHA-256 hash** of the PDF contents (a unique "fingerprint").
2. **Your private key encrypts that hash.** Only your key produces the correct result.
3. **The encrypted result + your public certificate are embedded** in the PDF (`/ByteRange` + `/Contents`).
4. **The verifier**, upon receiving the PDF, recomputes the hash and decrypts the signature using the public key in your certificate. If they match → signature valid + document intact.
5. **The verifier validates the certificate chain** up to a trust root (ARCOTEL TSL), checks revocation (OCSP/CRL), and if the signature includes a timestamp (TSA RFC 3161), confirms when it was signed.

All this happens **on your own device** when you use a tool like [firmar.ec](/en/) — your private key never leaves the browser.

## Types of electronic signature recognized in Ecuador

Law 2002-67 recognizes two categories:

- **Simple electronic signature.** Any electronic mechanism identifying the signer. Limited validity — depends on agreement between parties.
- **Certified electronic signature.** Uses a certificate from an ARCOTEL-accredited ECI. **Legally equates to a handwritten signature.** This is what you need for SRI, ECUAPASS, Quipux, formal contracts, and court evidence.

When someone says "electronic signature" in formal Ecuadorian context, they almost always mean the **certified** one.

## When you need a certified electronic signature

- Signing **SRI electronic documents** (e-invoices, withholdings, forms 103/104/107/101).
- Signing **customs declarations** in ECUAPASS / SENAE.
- Signing official documents in **Quipux** (public sector).
- Signing **contracts** that need the evidentiary force of a handwritten signature.
- Submitting documents as **evidence in court**.

## Cost and how to obtain it

A certified electronic signature in Ecuador costs between **USD 16 and USD 60** depending on the ECI, validity (1 to 3 years), and format (`.p12` file or physical token). Typical issuance: **24–72 business hours** after identity verification. Details per provider at [ECIs ARCOTEL comparison](/en/certificate-issuers-ecuador/) and step-by-step at [how to get a certificate](/en/how-to-get-an-electronic-certificate/).

## How do I sign after getting my certificate?

Once you have your `.p12` file with its password, you can sign PDFs at **[firmar.ec](https://app.firmar.ec)** — no Java install, no software download, also from mobile. Free and open source (AGPL-3.0). For cases needing **FirmaEC by MINTEL** (SRI XAdES, physical USB token), see [firmar.ec vs FirmaEC](/en/comparisons/firmaec/).

## International validity

Certified electronic signatures issued in Ecuador are **internationally valid** in jurisdictions recognizing the PAdES standard (ETSI EN 319 142), including the EU under eIDAS. Probative value in each country depends on **mutual recognition treaties** — an Ecuadorian ECI certificate may not be automatically equivalent to a qualified eIDAS certificate in the EU.

## FAQ

**Are "electronic signature" and "digital signature" the same?** Not exactly. See [electronic vs digital signature](/en/electronic-signature-vs-digital-signature/).

**Does an electronic signature expire?** The certificate expires (1-3 years), but a signed document remains valid as long as the signature was valid at signing time. **PAdES B-LT / B-LTA** signatures embed validity evidence, keeping them verifiable indefinitely.

**Can I sign from mobile?** Yes, if your certificate is a `.p12` file. Open [app.firmar.ec](https://app.firmar.ec) on your phone browser. No install.

**What if I lose my `.p12`?** No recovery possible — the ECI does not store your private key (correctly). Request **revocation** and issue a new one.

**What if it's stolen?** Request **immediate revocation** from your ECI. Online checks (OCSP/CRL) will detect the theft and mark subsequent signatures as invalid.

## Verifying a signature you received

To verify a signed PDF:

- Use **[firmar.ec/verify](https://app.firmar.ec/#/verificar)** — offline + OCSP + CRL verification, free.
- Or Adobe Reader (Signature panel).
- Or the **MINTEL Minka validator** ([minka.gob.ec](https://minka.gob.ec)).

All three detect: document tampering after signing, certificate revocation status, and timestamp validity.

---

**Ready to sign?** Open [app.firmar.ec](https://app.firmar.ec), load your PDF and `.p12`, sign in under a minute. Cryptography happens 100% on your device. Free and open source.
