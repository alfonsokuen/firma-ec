---
title: "Electronic Signature vs Digital Signature: Is It the Same? (Ecuador, 2026)"
description: "Clearing up the confusion between electronic signature and digital signature with clear legal and technical definitions. What Ecuador's Law 2002-67 says, what ARCOTEL recognizes, and which term is correct in context. With examples."
lang: en
datePublished: "2026-05-29"
dateModified: "2026-08-24"
h1: "Electronic signature vs digital signature: are they the same?"
breadcrumbs:
  - { name: "Electronic vs digital signature", url: "https://firmar.ec/en/electronic-signature-vs-digital-signature/" }
related:
  - { title: "What is an electronic signature?", href: "/en/what-is-electronic-signature/" }
  - { title: "Electronic signature in Ecuador", href: "/en/electronic-signature-ecuador/" }
  - { title: "ECIs accredited by ARCOTEL", href: "/en/certificate-issuers-ecuador/" }
  - { title: "What is PAdES?", href: "/en/what-is-pades-signature/" }
---

> **Short answer:** in **Ecuadorian practice** and in **Law 2002-67 on Electronic Commerce**, "electronic signature" and "digital signature" are used as synonyms. Technically they differ: **digital signature** is the cryptographic mechanism (RSA/ECDSA + hash); **electronic signature** is the legal concept supporting the signer. Every certified electronic signature in Ecuador **is** a digital signature underneath, but not every digital signature has the legal status of a certified electronic signature. If your question is **"what do I need to sign invoices for the SRI or contracts in Ecuador?"**, the answer is: a **certified electronic signature** issued by an **ECI accredited by ARCOTEL**.

## Technical vs legal distinction

### Digital signature (technical concept)

The **cryptographic operation itself**: SHA-256 hash of the document, encrypted with a private key (RSA or ECDSA), producing bytes verifiable with the corresponding public key. **Pure math.**

When an engineer says "digital signature", they're talking about **PKCS#7 / CMS** (RFC 5652), RSA with PKCS#1 v1.5 or PSS padding, elliptic curves, X.509 certificates. Digital signature exists in every country — universal technical abstraction.

### Electronic signature (legal concept)

The **legal value** a jurisdiction grants to using cryptography to bind a person to a document. Law 2002-67 (Art. 13) defines it as:

> "**Electronic signature** is data in electronic form, attached to or logically associated with a data message, that can be used to identify the holder of the signature in relation to the data message, and to indicate that the holder approves and acknowledges the information contained in the data message."

Art. 14 grants it **the same value as a handwritten signature** when Art. 15 conditions are met: unique, controlled by the signer, bound to the document (any alteration invalidates it), and issued with backing from an **ARCOTEL-accredited ECI**.

> **Ecuador (Law 2002-67) uses the term "electronic signature"**, not "digital signature". The word "digital" does not appear in the law.

## Equivalence table

| Concept | "Digital signature" (technical) | "Electronic signature" (legal Ecuador) |
|---|---|---|
| **Nature** | Cryptographic algorithm | Legal category |
| **Defined in** | RFC 5652, ETSI EN 319 142, FIPS 186 | Law 2002-67 (Ecuador), eIDAS (EU), ESIGN Act (US) |
| **Applies to** | Any data type (PDF, XML, email, code) | Documents with legal effect in Ecuador |
| **Needs accredited ECI?** | No (technically can sign with self-issued cert) | Yes, for handwritten equivalence |
| **Example use** | Signing GitHub releases with Sigstore | Signing an SRI electronic invoice |

## Why used as synonyms?

Because in daily life, **a certified electronic signature in Ecuador is always a digital signature implemented with a certificate from an ARCOTEL-accredited ECI**. The two concepts overlap 100% from the end-user perspective.

When someone says "you need a digital signature for the SRI", **they mean a certified electronic signature** — the technical term has been popularized. When an ECI sells "digital signature certificate", they sell the same thing.

Only in academic, regulatory, or technical audit contexts is precise distinction useful.

## Which term is "correct" in Ecuador?

**The legally correct term in Ecuador is "electronic signature"** because that's how Law 2002-67 names it. **ARCOTEL** accredits "Certificate Information Entities" to issue "electronic signature" certificates. The SRI uses "electronic signature" in its dispositions.

"Digital signature" is widely used, valid in informal conversation and marketing, but **does not appear in Ecuadorian law**. For contracts, security policies, or legal documents, prefer **"electronic signature"** or **"certified electronic signature"**.

## Which one do I need for my case?

See [what is an electronic signature](/en/what-is-electronic-signature/). In short:

- **SRI, ECUAPASS, Quipux, court evidence, formal contracts** → certified electronic signature (= digital signature with ECI ARCOTEL cert).
- **Private agreements between parties accepting another method by contract** → simple electronic signature.
- **Software releases, source code, distribution packages** → cryptographic digital signature without specific legal value (Sigstore, cosign, GPG).

## Related terms commonly confused

- **Scanned handwritten signature.** An **image** of your handwritten signature. **Not an electronic signature** — an embedded image.
- **Biometric signature.** Captures biometric data (pressure, speed) while signing on a tablet. May be part of a certified electronic signature if integrated with an ECI cert, but alone does not equate to handwritten signature in Ecuador.
- **Advanced electronic signature (EU).** eIDAS term, conceptual equivalent to Ecuador's certified electronic signature. PAdES signatures from ARCOTEL certs **are technically advanced** under eIDAS but **not automatically "qualified"** in the EU — that requires a Trust Service Provider listed in the EUTL.
- **Electronic seal.** A signature for legal persons (organizations), not natural persons. Exists in eIDAS; in Ecuador the practical equivalent is an electronic signature certificate issued to the company.

## How to sign (regardless of the term)

Once you have your `.p12` certificate from an **ARCOTEL-accredited ECI** ([full list](/en/certificate-issuers-ecuador/)), you can sign a PDF at:

- **[firmar.ec](https://app.firmar.ec)** — free, open source, no install, also from mobile. Your private key never leaves the browser.
- **FirmaEC by MINTEL** — official desktop, requires Java. Useful for SRI XAdES or physical USB tokens.
- **Adobe Acrobat Reader** — if licensed and you prefer that flow.

The result, regardless of tool, is **the same signed PDF** under the PAdES standard (ETSI EN 319 142). Verifiable in all three and in the [MINTEL Minka validator](https://minka.gob.ec).

---

**Question about your specific case?** [Contact us](/en/contact/). We are the signing tool, and we also sell certificates from one ECI ([tienda.firmar.ec](https://tienda.firmar.ec/precios?utm_source=landing&utm_medium=vs-digital-en)); the guidance is honest either way. Honest answers come faster.
