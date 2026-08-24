---
title: "Privacy Notice"
description: "Personal data protection policy for firmar.ec in compliance with Ecuador's LOPDP (Ecuadorian Personal Data Protection Law). Version 1.1."
lang: en
datePublished: "2026-05-08"
dateModified: "2026-08-24"
h1: "Privacy Notice"
breadcrumbs:
  - { name: "Privacy Notice", url: "https://firmar.ec/en/privacy/" }
---

**Version 1.1** · Effective 2026-05-08 · Last updated 2026-08-24

## Executive summary (the essentials in 30 seconds)

- **Nothing of yours reaches our servers.** firmar.ec does not store your certificate, your password, your PDFs, or the signed output. Signing happens 100% in your browser.
- **No cookies, no analytics, no third parties.** No Google Analytics, no Meta Pixel, no tracking pixel, no external CDN that receives your files.
- **We count operations, not people.** We keep a global tally of how many signatures, verifications, certificate validations and app installs happen in total. No identifier, no cookie, nothing from your document. The totals for signatures, verifications and validations are public at [/estadisticas/](/estadisticas/): you see the exact same number we do. The install count is not published there yet; it exists in the historical series and will be published once the page shows it. Details in section 4.
- **Minimal CDN logs**: Cloudflare processes TLS traffic and retains logs for up to 14 days with truncated IP. Those logs are managed by Cloudflare as a sub-processor.
- **Nothing of yours is kept; of the operations, only the tally.** On IDK Manager infrastructure (Ecuador origin, IDK Swarm) no document, certificate or identifying data is retained. What is kept, with no deletion deadline and no identifiers, is the historical series of how many operations happened and when (section 4).
- **Your ARCO+ rights** are exercised by contacting the data controller (IDK Manager) via the channels published at [idkmanager.com/contacto](https://idkmanager.com/contacto/). We respond within 15 business days.

## 1. Identity of the data controller

- **Controller**: IDK Manager (Quito, Ecuador). Operator of the firmar.ec service.
- **Data Protection Officer (DPO)**: the role is assumed by IDK Manager as the controller. Contact channels at [idkmanager.com/contacto](https://idkmanager.com/contacto/).
- **Address**: Quito, Pichincha, Ecuador.

## 2. Lawful bases (Art. 7 LOPDP — Ecuadorian Personal Data Protection Law)

Being a pure client-side tool, **we process no identifying data of yours and no content of yours on our servers**. The only server-side processing is the aggregate counters described in section 4; the anti-abuse caps operate on an internal address of our network, not on yours. The applicable lawful bases are:

| Processing | Lawful basis |
|---|---|
| CDN access logs (truncated IP, aggregated user-agent) | Legitimate interest (operational security) |
| GitHub issues and advisories you submit voluntarily | Sender's consent |
| Aggregate usage counters, without identifiers (section 4) | Legitimate interest (knowing whether the project is used, and publishing it) |
| Technical caps against abuse of those counters, computed **without your IP** (section 4) | Legitimate interest (integrity of the published figures) |

## 3. Categories of data we do NOT process

To avoid any doubt, firmar.ec explicitly declares it does **not collect, transmit, store or process**:

- The content of your PDFs before or after signing
- Your `.p12`, `.pfx` or any other private-key container file
- Your certificate password
- Your ID number, RUC, name, phone, or any other personal identity data
- Your location, device, or browser fingerprint
- **Your individual usage history**: we do not keep which documents you signed, with which certificate, from where, or anything that could attribute an operation to you. What is recorded is **that an operation happened and at what time** (section 4), detached from who performed it: a line saying "at 14:32 someone signed", without the someone. It cannot reconstruct what you did, nor tell how many distinct people are behind the figure.

## 4. Data we DO process (and why)

- **Cloudflare CDN logs**: truncated IP (last octet removed), user-agent aggregated by category, HTTP response code, timestamp. Retention 14 days.
- **GitHub issues and advisories**: if you open a public issue or a private security advisory, GitHub stores that content under its own privacy policy. firmar.ec does not operate a mail server or mailbox of its own.
- **Aggregate usage counters**: when a signature, a signature verification, a certificate validation or an app install completes, the browser sends a ping containing **only the operation type** — literally one of these four words: `sign`, `verify` (signature verification), `cert` (certificate validation) or `install`. Nothing else: no identifier, no session, no cookie, no referrer, no user-agent, no timestamp set by your browser, and absolutely nothing from the document or the certificate. Its effect is twofold and we state it in full: it adds 1 to a global counter **and writes one row holding that word plus the server's date and time**. That is where the historical series we publish at [/estadisticas/](/estadisticas/) comes from, aggregated by minute, hour, day, week, month and year. That row **carries nothing pointing at you**: no IP, no identifier, no session. It is kept **with no deletion deadline**, because it is the project's public historical record. It tells us whether the project is used and growing; it cannot tell us who uses it.
- **The anti-abuse caps, and why they do not carry your IP**: so nobody can inflate the figures there are two limits, one of 20 pings per hour and one of 100 requests per minute. Both are computed on the network address our server sees — and that address **is not yours**. All traffic arrives through the Cloudflare tunnel, so what reaches our infrastructure is always an **internal address of our own network**. This is not an assumption: we measured it on 2026-08-24 against the production service and of 1,498 logged requests **none** carried a public address. Nor is there any code reading the headers your IP would travel in.

  The consequence, stated in full: **both caps are global, not per person**. They cannot tell users apart because they have nothing to tell them apart by. The hourly cap's key lives in Redis until 2 hours after the last ping and the other only in process memory; neither is joined with the counters. And there is a side effect we would rather declare: if more than 20 pings happen within the same hour in total, the surplus is **discarded** and the published figure falls short. It never over-counts. Your IP is seen by Cloudflare, handled as described above.

## 5. Sub-processors

| Sub-processor | Role | Data | Contractual location |
|---|---|---|---|
| Cloudflare | CDN + WAF + Tunnel | CDN logs ≤14 days | Global edge |
| Let's Encrypt | TLS certificate issuance | Public CSR (no personal data) | EU (ISRG) |
| GitHub | Public repositories | Code + commits | US |

Two further services **only come into play if you turn on the matching option** (both ship disabled):

| Service | When | What it receives |
|---|---|---|
| Time-stamping authority (freetsa.org) | Only if you enable time-stamping | The **hash** of your document, never the document |
| Revocation responders of the accredited certification authorities | Only if you enable long-term validation | The **serial number** of the certificate being checked |

In both cases the request goes out through a proxy of ours that **strips origin and referrer**, so the third party sees our server's IP, not yours.

Any unavoidable international transfer is covered under standard contractual clauses and Ecuadorian data protection legislation. There is no international transfer of data identifying you: the only thing leaving our infrastructure is what this table describes, and only if you enable it.

## 6. Your ARCO+ rights (Art. 12 LOPDP)

You have the right of **A**ccess, **R**ectification, **C**ancellation, **O**bjection, **portability**, **erasure**, and to **object to automated decisions**. Since we do not store identifiable personal data, in practice only the following apply:

- Right to **access/erasure** of any issue or advisory you submitted: contact the controller (IDK Manager) via [idkmanager.com/contacto](https://idkmanager.com/contacto/) referencing the original thread; we handle it within 15 days.
- Right to **information** (this notice): always published at `/en/privacy` with version history in the public repository.

Response deadline: **15 business days** from receipt.

## 7. Breach notification

Should a personal data breach be detected, we will notify the **Superintendencia de Protección de Datos Personales (SPDP)** within 5 business days (Art. 46 LOPDP) and affected data subjects if there is significant risk. Given the pure client-side model, a personal data breach in our systems is practically impossible.

## 8. Auditability

The client source code is **entirely public** at [github.com/idkmanager/firmar-ec](https://github.com/idkmanager/firmar-ec) under the AGPL-3.0 license. Any external auditor can verify:

- That there are no outbound requests carrying `.p12` or PDF data
- That the served bundle matches the published code (reproducible builds — roadmap, `diffoscope` verification not yet performed)
- That releases are signed with Sigstore Cosign + Rekor transparency log + SLSA L2 with L3 elements (see [`SECURITY.md`](https://github.com/idkmanager/firmar-ec/blob/main/SECURITY.md))

## 9. Changes to this notice

We version this policy. The current version is always at `/en/privacy`. Previous versions are preserved in the repository git history. Any substantive change is announced 30 days in advance.

**v1.1 (2026-08-24).** This version does two distinct things, and they should not be conflated:

1. **It corrects an omission.** Earlier versions did not declare the aggregate usage counters in section 4, which were already running. Waiting 30 days is not an option here: continuing to process without declaring would be worse than declaring today.
2. **It adds a new counter**, for app installs, which starts running with this same version. That **is** new processing, and we say so plainly. It goes live without the 30-day notice because it is of the same nature as the other three — a global integer, no identifier, nothing of yours — and because its impact on you is nil: there is nothing to consent to and nothing to opt out of. If you disagree with that judgement, write to us through the channels in section 10.

The code that emits these pings is public and auditable (section 8): the four literal values in section 4 can be searched for in the repository.

## 10. Contact

- **Personal data (LOPDP / DPO)**: contact the controller IDK Manager at [idkmanager.com/contacto](https://idkmanager.com/contacto/)
- **Support**: [GitHub Issues](https://github.com/idkmanager/firmar-ec/issues)
- **Security reports**: [GitHub Security Advisories (private)](https://github.com/idkmanager/firmar-ec/security/advisories/new) — RFC 9116 policy at [/.well-known/security.txt](/.well-known/security.txt)
