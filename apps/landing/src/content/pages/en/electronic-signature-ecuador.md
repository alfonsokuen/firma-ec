---
title: "Electronic signatures in Ecuador: complete guide 2026"
description: "How electronic signatures work in Ecuador: LCE legal framework, ECIs accredited by ARCOTEL, validity with the SRI/bank/notary, and where to sign for free."
lang: en
datePublished: "2026-05-08"
dateModified: "2026-08-23"
h1: "Electronic signatures in Ecuador"
breadcrumbs:
  - { name: "Electronic signatures in Ecuador", url: "https://firmar.ec/en/electronic-signature-ecuador/" }
related:
  - { title: "Sign documents online", href: "/en/sign-documents-online/" }
  - { title: "How to sign a PDF", href: "/en/how-to-sign-pdf/" }
  - { title: "How to get a certificate", href: "/en/how-to-get-an-electronic-certificate/" }
  - { title: "How to verify a PDF signature", href: "/en/verify-pdf-signature/" }
  - { title: "What is PAdES?", href: "/en/what-is-pades-signature/" }
  - { title: "Glossary", href: "/en/glossary/" }
---

In Ecuador, **electronically signing a document carries the same legal validity as a handwritten signature**, provided it is done with a digital certificate issued by a **Certification Information Entity (ECI — Entidad de Certificación de Información) accredited by ARCOTEL** (Agencia de Regulación y Control de las Telecomunicaciones). This guide summarises the legal framework, authorised entities, valid formats, and where you can sign for free without installing Java.

## Legal framework: the LCE

The **Ecuadorian E-Commerce, Electronic Signatures and Data Messages Law (LCE 2002-67)** (published in Official Register No. 557, 17 April 2002) recognises that an electronically signed document has the same legal validity as a handwritten one (Art. 14), provided four conditions are met:

1. The signature is **linked exclusively to the signer**.
2. It **identifies** the signer.
3. It was created using **means under the signer's exclusive control**.
4. Any subsequent alteration of the document is **detectable**.

These four requirements define an **advanced electronic signature (FEA — firma electrónica avanzada)**. Signatures made with a certificate issued by an ARCOTEL-accredited Ecuadorian ECI are FEA by construction.

The LCE's implementing regulation is **Executive Decree 3496**, which details ECI operations and ARCOTEL oversight.

## Who can issue certificates? The accredited ECIs

As of 2026, ARCOTEL maintains accreditation for the following Certification Information Entities:

| ECI | Type | Notes |
|---|---|---|
| Banco Central del Ecuador (BCE) | Public | Certificates for natural and legal persons, including RUC holders. Optional hardware token. |
| Consejo de la Judicatura (iCert-EC) | Public | iCert-EC root; certificates for the justice sector. |
| Security Data Seguridad en Datos y Firma Digital S.A. | Private | One of the most widely used in SRI, banking, and the private sector. |
| ANFAC (ANF AC Ecuador) | Private | Ecuadorian subsidiary of ANF Autoridad de Certificación. |
| ArgosData | Private | Information certification and related services. |
| Uanataca Ecuador | Private | Regional operation with international backing. |
| Eclipse Soft (Soluciones Eclipse) | Private | Corporate focus. |
| Datil Media | Private | Known for integration with accounting systems and the SRI. |

Beyond the above, firmar.ec recognises the roots of other accredited ECIs that operate their own PKI — Lazzate, Alpha Technologies, AppFirmas, CorpNewBest, DarkCam, FirmaSegura, LetMi Ecuador and PrimeCoreLat — for a total of **16 of the 17 ECIs** accredited by ARCOTEL (the 17th, the Civil Registry, signs with BCE/Security Data certificates, already covered).

Before obtaining a certificate, verify that the ECI is **currently active** in the [ARCOTEL public registry](https://www.arcotel.gob.ec).

## What is an electronic signature used for?

- **SRI** (Servicio de Rentas Internas — Ecuadorian Tax Authority): tax filings, withholding certificates, electronic receipts (SRI invoicing XML files carry XAdES signatures).
- **Banking**: account opening, loan contracts, FATCA forms.
- **Public sector**: municipal, ministerial, INCOP (public procurement), and IESS (social security) procedures.
- **Business**: contracts, NDAs, labour addenda, minutes, audited financial statements.
- **Personal**: electronic notarial powers of attorney (in certain jurisdictions), sworn declarations, authorisations.

## Valid formats

An electronic signature is not a single format; it depends on the document type:

- **PAdES** (`.pdf`): the most common format for administrative documents, contracts, letters, PDF invoices. This is what firmar.ec produces.
- **XAdES** (`.xml`): mandatory for SRI electronic receipts (invoice, withholding certificate, credit note, settlement).
- **CAdES** (`.p7s` detached): a detached signature accompanying the original file; common for B2B integrations.

## Where can you sign for free?

- **firmar.ec** (this site) — web PWA, free, open-source, 100% in your browser. Perfect for PDFs (PAdES). No Java installation needed; works on mobile.
- **FirmaEC by MINTEL** — official desktop app, also free. Requires Java + token driver. Covers PAdES, XAdES and CAdES.

Any service that charges for signing a PDF is charging for **convenience**, not for legal validity: validity comes from your certificate, not from the software that uses it.

## Validity with the SRI

The SRI validates XML files signed with XAdES-BES according to its own policy. firmar.ec **does not produce XAdES** in v1 (only PAdES); for electronic invoicing, use your accounting system or FirmaEC. However, **administrative PDFs** (RUC certificates, declarations, authorisations that the SRI requires in PDF format) signed with firmar.ec are **fully valid**.

## Security recommendations

1. **Never share your `.p12` file.** It is the digital equivalent of your signature and national ID combined.
2. **Use a strong password** for your certificate (minimum 12 characters, mixing letters + numbers + symbols).
3. **Keep your certificate current.** ECIs notify before expiry, but renewal involves a fee.
4. **If you are going to sign with your certificate on a website, verify it is purely client-side** — the key should never leave your browser. firmar.ec is; many alternatives are not.

## Frequently asked questions

Quick summary (full version at [/en/faq](/en/faq)):

- **Does a firmar.ec signature have the same validity as FirmaEC desktop?** Yes. Both produce PAdES B-B with your certificate.
- **Does it work offline?** Yes, both for verification and for signing with the default configuration (PAdES B-B). The network is needed for timestamping (TSA) and long-term validation (LTV), both off by default, and for the first signature with a leaf-only `.p12`, when the CA's intermediate certificate is downloaded.
- **Can I lose my certificate?** If you lose the `.p12` file and the password, you must request a new one from your ECI; it is not recoverable.

## Official resources

- [ARCOTEL — Telecommunications and digital certification](https://www.arcotel.gob.ec)
- [LCE — Law 2002-67](https://www.derechoecuador.com/registro-oficial/2002/04/registro-oficial-no-557-mi%C3%A9rcoles-17-de-abril-de-2002)
- [SRI — Electronic receipts](https://www.sri.gob.ec)
