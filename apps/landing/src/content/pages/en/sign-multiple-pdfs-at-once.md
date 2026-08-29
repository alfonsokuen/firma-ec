---
title: "Sign multiple PDFs at once (batch signing) with your certificate"
description: "How to sign several PDFs at once with an electronic certificate: firmar.ec's batch signing processes up to 50 documents with a single .p12 and one password, free and without uploading them to any server."
lang: en
datePublished: "2026-08-29"
h1: "How to sign multiple PDFs at once (batch signing) with your certificate"
breadcrumbs:
  - { name: "Sign multiple PDFs at once", url: "https://firmar.ec/en/sign-multiple-pdfs-at-once/" }
related:
  - { title: "How to sign a PDF", href: "/en/how-to-sign-pdf/" }
  - { title: "Sign PDF online free without installing", href: "/en/sign-pdf-online-free-without-installing/" }
  - { title: "Sign without uploading to a server", href: "/en/sign-pdf-without-uploading-to-a-server/" }
  - { title: "Timestamp (TSA)", href: "/en/pdf-signature-timestamp-tsa/" }
  - { title: "Certificate compatibility", href: "/en/compatibility/" }
---

> **How do I sign several PDFs at once (in batch) with a certificate?** With firmar.ec's batch signing: open [app.firmar.ec/firmar-lote](https://app.firmar.ec/#/firmar-lote), select **up to 50 PDFs**, load your `.p12` certificate **once**, enter the password once, and download all signed documents in a ZIP file. It is free, runs in your browser, and the documents are never uploaded to a server.

[Batch-sign PDFs →](https://app.firmar.ec/#/firmar-lote)

## When batch signing helps

When what slows you down is not signing but repeating it: delivery certificates for one project, contracts for a batch of clients, course certificates, monthly payroll sheets. One by one, you load the certificate and type the password once per document; in batch, the certificate loads **once** and the queue signs the documents in series, showing per-document progress.

## Step by step

1. **Open [app.firmar.ec/firmar-lote](https://app.firmar.ec/#/firmar-lote)** in your browser.
2. **Drag in or select the PDFs** — up to 50 per batch, max 40 MB each.
3. **Load your `.p12` certificate and enter the password** (once for the whole batch). The app checks it comes from an ARCOTEL-accredited Ecuadorian ECI.
4. **Place the visible stamp**: the app positions it automatically on each document and you can adjust it manually where needed.
5. **Sign and download the ZIP** with all signed PDFs.

Each document in the batch gets its own **PAdES** signature (ETSI EN 319 142), identical in validity to [individual signing](/en/how-to-sign-pdf/).

## The exact numbers

| Fact | Value |
|---|---|
| Documents per batch | Up to **50 PDFs** |
| Size per file | Up to **40 MB** (individual signing allows 50 MB) |
| Certificate and password | Entered **once** per batch |
| Output | One **ZIP** with all signed PDFs |
| Output ZIP size | Up to **1 GB** (built entirely in memory; at 40 MB per file that is ~25 documents) |
| Signature profile | Whatever you have configured: **PAdES Baseline B-B** by default, or **B-T / B-LT / B-LTA** if you enable the timestamp and LTV |
| Cost | **Free** — open source AGPL-3.0 |

## Honest limits of batch mode

- **The batch inherits your signing settings:** if the [timestamp (TSA)](/en/pdf-signature-timestamp-tsa/) or long-term validation (LTV) are enabled in Settings, every document in the batch gets them (B-T, B-LT or B-LTA profile). With the default configuration the batch signs in B-B, exactly like individual signing.
- **40 MB per file** inside a batch (vs 50 MB for individual signing).
- **The output ZIP is capped at 1 GB**, because it is built whole in browser memory before being downloaded. The app adds up the batch size *before* signing and rejects it with a clear message if it would not fit: at 40 MB per file the real batch is about **25 documents**, not 50. The 50-file and 40 MB-per-file caps are each true, but they do not combine.
- **Everything runs in your browser**, in batch mode too: documents are not sent to any server to be signed — the same design as [signing without uploading](/en/sign-pdf-without-uploading-to-a-server/).

## Frequently asked questions

**How many PDFs can I sign at once?** Up to 50 per batch, max 40 MB each, as long as the output ZIP stays under 1 GB — with large files that is the binding cap (about 25 documents at 40 MB each). The app checks it before signing and tells you if the batch has to be split.

**Do I have to enter the certificate password for every document?** No. The certificate and password are entered once and apply to the whole batch.

**Are batch signatures as valid as individual ones?** Yes. Each PDF gets its own PAdES signature with your certificate; legal validity is exactly the same as signing one by one.

**Are batch documents uploaded to any server?** No. Just like individual signing, the whole batch is processed inside your browser and you download the result as a ZIP.

**Does batch signing include a timestamp?** It carries whatever you have configured: the batch inherits the app's timestamp (TSA) and LTV settings. With the defaults they are off and the batch comes out as PAdES B-B; enable them in Settings and every document in the batch comes out as B-T (or B-LT / B-LTA with LTV).
