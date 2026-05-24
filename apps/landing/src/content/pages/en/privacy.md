---
title: "Privacy Notice"
description: "Personal data protection policy for firmar.ec in compliance with Ecuador's LOPDP (Ecuadorian Personal Data Protection Law). Version 1.0."
lang: en
datePublished: "2026-05-08"
h1: "Privacy Notice"
breadcrumbs:
  - { name: "Privacy Notice", url: "https://firmar.ec/en/privacy/" }
---

**Version 1.0** · Effective 2026-05-08

## Executive summary (the essentials in 30 seconds)

- **Zero server-side collection.** firmar.ec does not store your certificate, your password, your PDFs, or the signed output. Signing happens 100% in your browser.
- **No cookies, no analytics, no third parties.** No Google Analytics, no Meta Pixel, no tracking pixel, no external CDN that receives your files.
- **Minimal CDN logs**: Cloudflare processes TLS traffic and retains logs for up to 14 days with truncated IP. Those logs are managed by Cloudflare as a sub-processor.
- **Zero retention** on IDK Manager infrastructure (Ecuador origin, IDK Swarm).
- **Your ARCO+ rights** are exercised by contacting the data controller (IDK Manager) via the channels published at [idkmanager.com/contacto](https://idkmanager.com/contacto/). We respond within 15 business days.

## 1. Identity of the data controller

- **Controller**: IDK Manager (Quito, Ecuador). Operator of the firmar.ec service.
- **Data Protection Officer (DPO)**: the role is assumed by IDK Manager as the controller. Contact channels at [idkmanager.com/contacto](https://idkmanager.com/contacto/).
- **Address**: Quito, Pichincha, Ecuador.

## 2. Lawful bases (Art. 7 LOPDP — Ecuadorian Personal Data Protection Law)

Being a pure client-side tool, **we do not process personal data on our servers**. The only applicable lawful bases are:

| Processing | Lawful basis |
|---|---|
| CDN access logs (truncated IP, aggregated user-agent) | Legitimate interest (operational security) |
| GitHub issues and advisories you submit voluntarily | Sender's consent |

## 3. Categories of data we do NOT process

To avoid any doubt, firmar.ec explicitly declares it does **not collect, transmit, store or process**:

- The content of your PDFs before or after signing
- Your `.p12`, `.pfx` or any other private-key container file
- Your certificate password
- Your ID number, RUC, name, phone, or any other personal identity data
- Your location, device, or browser fingerprint
- Your application usage history

## 4. Data we DO process (and why)

- **Cloudflare CDN logs**: truncated IP (last octet removed), user-agent aggregated by category, HTTP response code, timestamp. Retention 14 days.
- **GitHub issues and advisories**: if you open a public issue or a private security advisory, GitHub stores that content under its own privacy policy. firmar.ec does not operate a mail server or mailbox of its own.

## 5. Sub-processors

| Sub-processor | Role | Data | Contractual location |
|---|---|---|---|
| Cloudflare | CDN + WAF + Tunnel | CDN logs ≤14 days | Global edge |
| Let's Encrypt | TLS certificate issuance | Public CSR (no personal data) | EU (ISRG) |
| GitHub | Public repositories | Code + commits | US |

Any unavoidable international transfer is covered under standard contractual clauses and Ecuadorian data protection legislation. There is no material international transfer of personal data because we do not collect personal data on the server.

## 6. Your ARCO+ rights (Art. 12 LOPDP)

You have the right of **A**ccess, **R**ectification, **C**ancellation, **O**bjection, **portability**, **erasure**, and to **object to automated decisions**. Since we do not store identifiable personal data, in practice only the following apply:

- Right to **access/erasure** of any issue or advisory you submitted: contact the controller (IDK Manager) via [idkmanager.com/contacto](https://idkmanager.com/contacto/) referencing the original thread; we handle it within 15 days.
- Right to **information** (this notice): always published at `/en/privacy` with version history in the public repository.

Response deadline: **15 business days** from receipt.

## 7. Breach notification

Should a personal data breach be detected, we will notify the **Superintendencia de Protección de Datos Personales (SPDP)** within 5 business days (Art. 46 LOPDP) and affected data subjects if there is significant risk. Given the pure client-side model, a personal data breach in our systems is practically impossible.

## 8. Auditability

The client source code is **entirely public** at [github.com/idkmanager/firma-ec](https://github.com/idkmanager/firma-ec) under the Apache 2.0 license. Any external auditor can verify:

- That there are no outbound requests carrying `.p12` or PDF data
- That the served bundle matches the published code (reproducible builds — roadmap, `diffoscope` verification not yet performed)
- That releases are signed with Sigstore Cosign + Rekor transparency log + SLSA L2 with L3 elements (see [`SECURITY.md`](https://github.com/idkmanager/firma-ec/blob/main/SECURITY.md))

## 9. Changes to this notice

We version this policy. The current version is always at `/en/privacy`. Previous versions are preserved in the repository git history. Any substantive change is announced 30 days in advance.

## 10. Contact

- **Personal data (LOPDP / DPO)**: contact the controller IDK Manager at [idkmanager.com/contacto](https://idkmanager.com/contacto/)
- **Support**: [GitHub Issues](https://github.com/idkmanager/firma-ec/issues)
- **Security reports**: [GitHub Security Advisories (private)](https://github.com/idkmanager/firma-ec/security/advisories/new) — RFC 9116 policy at [/.well-known/security.txt](/.well-known/security.txt)
