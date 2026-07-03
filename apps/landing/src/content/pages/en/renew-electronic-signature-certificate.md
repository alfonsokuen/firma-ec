---
title: "Renewing your electronic signature certificate"
description: "When and how to renew your .p12 certificate in Ecuador, what happens to already-signed documents and how to check the expiry date."
lang: en
datePublished: "2026-07-03"
h1: "How to renew your electronic signature certificate in Ecuador"
breadcrumbs:
  - { name: "Renew certificate", url: "https://firmar.ec/en/renew-electronic-signature-certificate/" }
related:
  - { title: "Validate a .p12 certificate", href: "/en/validate-certificate/" }
  - { title: "How to get a certificate", href: "/en/how-to-get-an-electronic-certificate/" }
  - { title: "Pricing by ECI", href: "/en/pricing/" }
  - { title: "How to sign a PDF", href: "/en/how-to-sign-pdf/" }
---

> **How is an electronic signature renewed?** Technically it is not "extended": the ECI issues a **new certificate** with new keys and a new validity period. The process is shorter than the first issuance (your identity is usually already validated) and it pays to do it **before** expiry. You can check your `.p12` expiry date for free at [validate-certificate](/en/validate-certificate/).

## When to renew

Ecuadorian certificates are issued for **1 to 5 years** depending on the ECI and plan. Renew:

- **Before expiry** (ideally 2–4 weeks ahead): some issuers only offer the simplified online renewal while the certificate is still valid.
- **Immediately if it expired**: you cannot sign anything new with an expired certificate; the process becomes a regular issuance.
- **Right away if your situation changed**: change of legal representative, lost `.p12`, forgotten password or suspected compromise (in the last two cases, **revoke** the certificate with your ECI first).

## How to check the expiry date

Upload your `.p12` to the free [validate certificate](/en/validate-certificate/) tool: you will see the issuer, the trust-chain status and the **exact expiry date**. Everything happens in your browser; the file is never uploaded to a server.

## The process, step by step

1. **Contact your ECI** (or any other accredited one — you are not tied to the original issuer; [compare prices](/en/pricing/)).
2. **Present the requirements**: for a natural person the ID is usually enough; for [companies](/en/electronic-signature-for-companies/), the RUC and a current appointment.
3. **Pay the renewal**: the cost is similar to a new issuance; it varies by ECI and validity period.
4. **Download the new `.p12`** and store it with a strong password. Stop using the old one for signing.

At [tienda.firmar.ec](https://tienda.firmar.ec/?utm_source=landing&utm_medium=guia-renovar-en) renewal is done **online in minutes**, no in-person appointment.

## What about documents you already signed?

**They remain valid.** A signature's validity is assessed as of the moment of signing, not the present. This is where the signature profile matters:

- If the PDF was signed with a **timestamp** (PAdES B-T or higher, which firmar.ec applies when the TSA is available), anyone can prove *when* it was signed, even years after your certificate expires.
- A basic (B-B) signature without a timestamp is still valid, but proving the date depends on external context.

That is why firmar.ec produces [PAdES](/en/what-is-pades-signature/) B-T/B-LT/B-LTA profiles with embedded revocation data: your documents outlive the certificate.

## FAQ

**Can I renew with a different ECI?** Yes. The new certificate is independent; pick whichever issuer suits you in the [comparison](/en/certificate-issuers-ecuador/).

**Does renewing change my `.p12` file?** Yes: you receive a new file with new keys. Delete old copies from shared devices to avoid confusion.

**Do signatures made with the expired certificate become invalid?** No. Whatever you signed while the certificate was valid keeps its validity; you only lose the ability to sign *new* documents.

**Is there automatic renewal?** Not in the Ecuadorian ecosystem today: there is always a procedure (even a fully online one) because the ECI must re-validate your identity or representation.
