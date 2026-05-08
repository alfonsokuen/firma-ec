---
question: "Can I sign a very large PDF?"
lang: en
order: 6
tags: [limits, performance]
---

Yes, up to 50 MB on mobile and 200 MB on desktop per PDF. Signing runs in a dedicated Web Worker, so the UI remains responsive even if the PDF takes a few seconds to process. For larger PDFs the limiting factor is browser memory, not the app.
