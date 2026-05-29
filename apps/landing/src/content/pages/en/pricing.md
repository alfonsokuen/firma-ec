---
title: "Electronic Signature Pricing in Ecuador 2026 — ECI Comparison"
description: "Reference price table for electronic signatures in Ecuador, updated 2026, comparing every ARCOTEL-accredited ECI: BCE, ICERT-EC, Security Data, UANATACA, ANF AC, Eclipsoft, ArgosData, and more. How much an electronic signature costs for SRI, ECUAPASS, or personal use."
lang: en
datePublished: "2026-05-29"
dateModified: "2026-05-29"
h1: "How Much Does an Electronic Signature Cost in Ecuador? 2026 Pricing"
breadcrumbs:
  - { name: "Electronic signature pricing 2026", url: "https://firmar.ec/en/pricing/" }
related:
  - { title: "ECIs accredited by ARCOTEL", href: "/en/certificate-issuers-ecuador/" }
  - { title: "How to get an electronic certificate", href: "/en/how-to-get-an-electronic-certificate/" }
  - { title: "What is an electronic signature?", href: "/en/what-is-electronic-signature/" }
  - { title: "Electronic signature in Ecuador: legal framework", href: "/en/electronic-signature-ecuador/" }
---

> **Direct answer.** In Ecuador, a certified electronic signature costs between **USD 16 and USD 60** depending on the **ECI** (Certificate Information Entity accredited by ARCOTEL), **validity** (1 to 3 years), and **format** (`.p12` file, USB token, or cloud certificate). The cheapest option with **a publicly published rate** is **ICERT-EC** by the Judiciary Council (~USD 19.80 + VAT for 2 years). Certificates with **remote video identification** start at ~USD 16 + VAT. **firmar.ec does not charge to sign PDFs — the web tool is 100% free and open source.** What you pay is the certificate to the ECI.

## Price table per ECI (reference, 2026)

Public or reference prices for **natural person certificates** with standard validity. **Always verify with the ECI before paying** — rates change.

| ECI | Mode | Validity | Reference price (+ VAT) | Type |
|---|---|---|---|---|
| **ICERT-EC (Judiciary Council)** | `.p12` or token | 2 years | **USD 19.80** *(official rate)* | Public |
| **Banco Central del Ecuador (BCE)** | `.p12` or token | 2 years | **USD ~28** | Public |
| **Registro Civil ECI** | `.p12` or token | 2 years | **USD ~30** | Public |
| **ArgosData (Signare)** | `.p12` with video ID | 1-2 years | **USD ~16–40** | Private |
| **Eclipsoft** | `.p12` / token / mobile | 1-2 years | **USD ~18–40** | Private |
| **UANATACA Ecuador** | `.p12` / cloud / eIDAS | 1-3 years | **USD ~20–50** | Private |
| **ANF AC Ecuador** | `.p12` / cloud / eIDAS | 1-2 years | **USD ~20–45** | Private |
| **Security Data** | `.p12` / token / HSM | 1-3 years | **USD ~28–60** | Private |
| **Datil** | `.p12` with video ID | 1-2 years | Inquire | Private |
| **Other ARCOTEL ECIs** | varies | varies | Inquire | Private |

[See full comparison of 17+ accredited ECIs →](/en/certificate-issuers-ecuador/)

> **These prices are not firmar.ec quotes.** Each price is charged by the ECI directly. We don't (yet) resell their certificates.

## What price fits you? Quick guide

- **Cheapest for occasional use**: ICERT-EC (USD 19.80 + VAT, 2 years), in-person.
- **Need it today / this week**: ArgosData, UANATACA, Datil, or ANF AC — remote video ID, 24–72 hours.
- **Accountant / daily SRI invoices**: Security Data, UANATACA, Eclipsoft, or BCE.
- **Sign from mobile / web (PWA)**: any ECI issuing `.p12` (most of them).
- **Company with multiple signers in the cloud**: UANATACA, ANF AC, Lazzate.
- **Quipux / physical USB token**: public ECIs (BCE, ICERT-EC, Civil Registry).

## Does the price include VAT?

**No**, listed prices are **before VAT (15%)**. Total = `price + 15% VAT`. Example: ICERT-EC USD 19.80 + VAT = **USD 22.77 total**.

## Hidden costs?

- **Renewal:** when the cert expires (1-3 years), you pay again.
- **Physical token:** USB token costs separately (USD 25–60 per device).
- **Urgent revocation:** some ECIs charge admin fees (USD 5–15).
- **Re-issuance for data changes:** new full issuance.

## What's included?

- **Certificate issuance** (`.p12` file or provisioned token).
- **Identity validation** (in-person or remote video).
- **Certificate maintenance** in the ECI's trust chain (OCSP/CRL publication).
- **Basic support** during validity.

## What's NOT included?

- **The signing tool.** That's on you. Use [firmar.ec](https://app.firmar.ec) free (our preferred case, of course), FirmaEC by MINTEL free, Adobe Acrobat (paid), or anything else.
- **EU qualified eIDAS validity.** Requires a European provider with qualified eIDAS seal — significantly more expensive (USD 80–200+).
- **Unlimited timestamping (TSA).** Some signatures (PAdES B-T / B-LT / B-LTA) require an RFC 3161 TSA. [firmar.ec uses FreeTSA by default](https://freetsa.org/), free.

## Comparison with international alternatives (informational)

| Alternative | Typical price | Valid for SRI / Quipux? |
|---|---|---|
| **DocuSign** | USD ~10/mo/user | ❌ Does not equate to handwritten in Ecuador without ARCOTEL cert |
| **Adobe Sign** | USD ~15/mo/user | ❌ Same |
| **HelloSign / Dropbox Sign** | USD ~15/mo/user | ❌ Same |
| **EU Qualified eIDAS cert** | USD ~80–200/year | ⚠️ Technically yes, but recognition depends on treaty |
| **ARCOTEL ECI cert (Ecuador)** | USD 16–60 once per 1-3 years | ✅ Yes, full equivalence (Law 2002-67) |

> **Conclusion:** for signing in Ecuador with full legal validity, the **cheapest and correct** option is a certificate from an ARCOTEL-accredited ECI. DocuSign and similar work for private contracts that accept that mechanism, but **not for SRI, ECUAPASS, or Quipux**.

## Will firmar.ec sell certificates?

Yes, we are in the process of enabling **UANATACA Associate reseller** within firmar.ec, with plans from USD ~16/year + VAT with remote video identification. Completing integration. If you want to be notified when available, [contact us](/en/contact/).

Meanwhile, recommended flow:

1. **Pick your ECI** at [ARCOTEL ECIs comparison](/en/certificate-issuers-ecuador/).
2. **Apply directly on its official site**. You pay the ECI, not us.
3. **Once you have your `.p12`**, open [app.firmar.ec](https://app.firmar.ec) and sign. Free, no install, also from mobile.

## FAQ

**Why do prices vary so much?** Private ECIs compete on service (speed, support, cloud platform, video ID); public ECIs are cheaper but with more in-person flows.

**Does the signature expire and I lose what I signed?** No. The **certificate** expires, but **documents** you signed keep their validity if the signature was valid at signing time. PAdES B-LT / B-LTA embeds validity evidence.

**Can I deduct VAT?** Yes, if invoiced to your RUC, **VAT offsets** in your monthly return. Categorize as **professional / IT service**.

**Volume discounts?** Yes, all ECIs offer corporate plans with volume discounts (10+ users).

---

**Specific pricing question?** [Contact us](/en/contact/). We don't sell certificates yet but we'll guide you honestly, free. The signing tool is and always will be [free and open source](https://github.com/idkmanager/firmar-ec).
