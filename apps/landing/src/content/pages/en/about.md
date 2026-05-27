---
title: "About firmar.ec"
description: "Why firmar.ec exists, who is behind it, and why it is free and open-source. A project by IDK Manager."
lang: en
datePublished: "2026-05-08"
h1: "About firmar.ec"
breadcrumbs:
  - { name: "About", url: "https://firmar.ec/en/about/" }
---

## Why firmar.ec exists

In Ecuador, **electronically signing a PDF** is still harder than it should be:

- **FirmaEC by MINTEL** (Ecuador's Ministry of Telecommunications) is an excellent desktop app, but it requires Java to be installed, token driver configuration, and does not work on mobile or on restricted machines.
- **Commercial SaaS services** (Adobe Sign, DocuSign, etc.) ask you to upload your certificate to their servers, which is uncomfortable for anyone who takes **LOPDP** (Ecuadorian Personal Data Protection Law) compliance seriously.
- **Open-source Ecuadorian web alternatives** simply **did not exist** before this project.

firmar.ec solves this with **a public, free, registration-free, tracking-free PWA where your private key never leaves the browser**.

## Who is behind it

firmar.ec is a **non-profit open-source project** by **[IDK Manager](https://idkmanager.com)**, a software and technical services workshop in Quito, Ecuador. We build and operate this tool as a contribution to Ecuador's digital ecosystem.

We charge nothing for the service. There is no premium plan. No subscription. No advertising. No telemetry.

The cost of maintenance (domain, hosting, certificates, code upkeep) is borne by IDK Manager. The guiding philosophy: **a critical digital sovereignty tool should not be profit-driven**.

## Why open-source?

A tool that asks for your private key **must be auditable**. AGPL-3.0 + 3 public mirrors + releases signed with Sigstore Cosign + public Rekor transparency log entry + SLSA L2 with L3 elements exist so that any person, team, or public entity can **verify for themselves** that firmar.ec behaves as we say. Reproducible builds: on roadmap.

If you are going to trust your electronic signature to a web service, don't accept "trust us." Verify.

## How does it stay sustainable?

- **Simple, maintainable code** (Astro 5 + Svelte 5 + audited crypto libs) — minimises accumulated technical debt.
- **Zero application server** — the app is static; hosting costs are negligible.
- **Community** — we accept issues, PRs, and translations. If your organisation wants to contribute or collaborate, get in touch.
- **Plan B** — if IDK Manager were to stop operating the service, the code remains available on GitHub under AGPL-3.0; anyone can continue operations under a new domain.

## Public roadmap

- **v1 (current)**: sign + verify PAdES B-B PDFs with certificates from the 16 accredited Ecuadorian ECIs that operate their own root.
- **v1.1**: timestamped signing (PAdES B-T) once we identify an accredited TSA in Ecuador.
- **v1.2**: long-term validation (PAdES B-LT) — chain + revocation data embedded.
- **v1.x**: Kichwa language support, bulk signing, WebAuthn 2FA integration, photo seal.
- **Aspiration**: if the community requests it, support for XAdES (XML, SRI) and CAdES (detached signature).

Every roadmap decision is discussed in GitHub Issues. Your input matters.

## Contact

- General / support: [GitHub Issues](https://github.com/idkmanager/firmar-ec/issues)
- Personal data (LOPDP): contact the controller IDK Manager at [idkmanager.com/contacto](https://idkmanager.com/contacto/)
- Security (private advisory): [GitHub Security Advisories](https://github.com/idkmanager/firmar-ec/security/advisories/new)
- GitHub: [github.com/idkmanager/firmar-ec](https://github.com/idkmanager/firmar-ec)
