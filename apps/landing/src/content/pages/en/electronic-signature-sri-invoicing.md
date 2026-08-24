---
title: "Electronic signature and SRI e-invoicing"
description: "The same .p12 certificate signs your SRI invoices (XAdES) and your PDFs (PAdES). Which format each procedure uses and the tool you need."
lang: en
datePublished: "2026-07-03"
dateModified: "2026-08-24"
h1: "Electronic signature for SRI e-invoicing: which certificate and format you need"
breadcrumbs:
  - { name: "Electronic signature and SRI", url: "https://firmar.ec/en/electronic-signature-sri-invoicing/" }
related:
  - { title: "How to get a certificate", href: "/en/how-to-get-an-electronic-certificate/" }
  - { title: "Electronic signature for companies", href: "/en/electronic-signature-for-companies/" }
  - { title: "What is PAdES?", href: "/en/what-is-pades-signature/" }
  - { title: "Electronic signature in Ecuador", href: "/en/electronic-signature-ecuador/" }
---

> **Do you need a special certificate to issue e-invoices with Ecuador's SRI?** No: the **same `.p12` certificate** issued by an ARCOTEL-accredited ECI works for e-invoicing and for signing contracts or PDFs. What changes is the **signature format**: SRI receipts are XML files signed with **XAdES-BES** (your invoicing system does it automatically), while PDF documents are signed with **PAdES** — which is what [firmar.ec](/en/how-to-sign-pdf/) does, for free.

## One certificate, two signature formats

| | SRI receipts (invoice, withholding, credit note) | PDF documents (contracts, letters, annexes) |
|---|---|---|
| **File** | XML | PDF |
| **Signature format** | XAdES-BES (SRI policy) | [PAdES](/en/what-is-pades-signature/) (ETSI EN 319 142) |
| **Who signs** | Your invoicing/accounting system, automatically, with your `.p12` | You, with a tool like firmar.ec |
| **Certificate** | The same `.p12` from an accredited ECI | The same `.p12` |

**firmar.ec does not produce XAdES** (it does not sign receipt XMLs): that is your authorised invoicing system's job. firmar.ec covers everything else — the administrative PDFs, contracts and annexes a business signs every day.

## What you need to e-invoice

1. **A valid electronic signature certificate** from an accredited ECI — [natural person](/en/how-to-get-an-electronic-certificate/) if you invoice with a personal RUC, or [legal representative / legal entity](/en/electronic-signature-for-companies/) if a company invoices.
2. **An invoicing system**: SRI's free invoicing tool or a private accounting system. You load your `.p12` once and it signs every receipt.
3. **SRI environment enabled**: testing, then production, requested through SRI en Línea.

## Common SRI signature errors

- **"FIRMA INVÁLIDA" when submitting a receipt**: almost always an **expired or revoked** certificate. Check your `.p12` expiry for free at [validate-certificate](/en/validate-certificate/) and [renew it](/en/renew-electronic-signature-certificate/) if needed.
- **Wrong `.p12` password**: it is not recoverable — a lost password means issuing a new certificate.
- **Certificate from a non-accredited entity**: the SRI only accepts signatures from ECIs currently accredited by ARCOTEL. Check the issuer in the [ECI comparison](/en/certificate-issuers-ecuador/).

## FAQ

**Can I sign a PDF invoice with firmar.ec and send it to the SRI?** The fiscal receipt is the **XML** signed with XAdES; the PDF (RIDE) is just its printable representation and needs no signature for the SRI. You may sign the RIDE with PAdES if your client asks, but it does not replace the XML.

**Does a BCE certificate work for invoicing?** Yes — any accredited ECI works. See the [BCE guide](/en/how-to-sign-with-bce-certificate/) to also use it with PDFs.

**Do I need one certificate per point of sale?** No. The certificate belongs to the taxpayer (person or company), not the point of sale: the same `.p12` signs receipts for all your establishments.

**Where do I get a certificate if I don't have one yet?** Any accredited ECI ([comparison](/en/certificate-issuers-ecuador/), [pricing](/en/pricing/)); fully online issuance is available at [tienda.firmar.ec](https://tienda.firmar.ec/facturacion-electronica?utm_source=landing&utm_medium=guia-sri-en).
