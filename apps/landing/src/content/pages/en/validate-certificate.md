---
title: "How to validate your .p12 electronic certificate in Ecuador (free)"
description: "Check the holder, validity dates and issuing authority (ACE) of your .p12/.pfx certificate for free, in your browser, without your private key ever leaving your device."
lang: en
datePublished: "2026-05-29"
h1: "How to validate your .p12 electronic certificate"
breadcrumbs:
  - { name: "Validate certificate", url: "https://firmar.ec/en/validate-certificate/" }
related:
  - { title: "How to verify a PDF signature", href: "/en/verify-pdf-signature/" }
  - { title: "How to sign a PDF", href: "/en/how-to-sign-pdf/" }
  - { title: "How to get an electronic certificate", href: "/en/how-to-get-an-electronic-certificate/" }
---

> **How do you know your `.p12` electronic certificate is valid?** Upload it to [app.firmar.ec/validate-certificate](https://app.firmar.ec/#/validar-certificado), enter its password, and in seconds you will see the **holder**, the **ID/RUC**, the **issuing authority (ACE)**, the **validity dates** and whether the chain **links to an ARCOTEL-accredited root**. It is free, it runs **in your browser**, and your private key is never uploaded to any server.

## What does validation check?

When you validate a `.p12` / `.pfx` certificate, firmar.ec shows you:

- **Holder** — name, ID or RUC of the certificate owner.
- **Issuing authority (ACE)** — which ARCOTEL-accredited certification authority issued it.
- **Validity** — *valid from / valid until* dates and whether it is currently valid, expired or not yet valid.
- **Trust chain** — whether the certificate links to an **ARCOTEL-accredited root** (the Trust Service List embedded in the app). It even recognises "leaf-only" certificates that ship without the intermediate CA, such as UANATACA's.
- **Revocation** — OCSP/CRL status when online.

## Validate step by step

1. Open [app.firmar.ec/validate-certificate](https://app.firmar.ec/#/validar-certificado).
2. Drag or select your **`.p12` / `.pfx`** file (the one you received from your ACE).
3. Type the certificate **password**.
4. Press **Validate certificate** and read the result: holder, issuer, validity and trust chain.

The whole process happens **inside your browser**: neither the file, nor the password, nor the private key leave your device.

## Compatible certification authorities (ACE)

firmar.ec recognises certificates issued by the ARCOTEL-accredited authorities: **Security Data**, **Banco Central del Ecuador (BCE)**, **UANATACA**, **ANF AC**, **Consejo de la Judicatura (iCert-EC)**, **ArgosData**, **Datil**, **Lazzate**, **Eclipsoft** and the rest. If your `.p12` was issued by any of them, it validates offline.

## Why validate before a filing?

Before signing a document for the SRI, ECUAPASS, a public agency or a contract, it is worth confirming your certificate is **valid** and **recognised**. Validating it prevents discovering — mid-filing — that it expired or that the system does not recognise your issuer.

## FAQ

**Is it safe to upload my `.p12` here?** Yes: it is not uploaded. Validation runs in your browser (client-side) and your private key never leaves your device. The code is open source (AGPL-3.0).

**Do I need to install anything?** No. It works in any modern browser, including on your phone.

**Can I sign with it afterwards?** The same `.p12` you validate here is the one you use to [sign a PDF](/en/how-to-sign-pdf/) on firmar.ec.
