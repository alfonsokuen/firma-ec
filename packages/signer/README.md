# @firma-ec/signer

PAdES-B-B PDF signing for browser PWAs. Pure WebCrypto + `@signpdf` 4 + `pkijs`.

> **Status:** F3 scaffolding (Tasks 1-3). Implementation in progress.

## Scope

- Parse `.p12` / `.pfx` (PKCS#12) with PIN.
- Build CMS SignedData (CAdES detached) via `pkijs`.
- Wire `@signpdf` 4 + `pdf-lib` for PAdES-B-B.
- Visible signature box: CN-only stamp.
- Incremental update when the PDF already has signatures (re-uses `@firma-ec/verifier`).

## Non-goals (F3)

- LTV / DSS / VRI (planned F4).
- Multiple visible-sig templates (CN-only en F3).
- Server-side signing.

## API (preview)

```ts
import { signPdf } from '@firma-ec/signer';

const result = await signPdf({
  pdf: pdfBytes,
  pfx: p12Bytes,
  pin: '••••',
  visibleSig: { pageIndex: 0, x: 50, y: 50, w: 200, h: 60, size: 'standard' },
  reason: 'Aprobado',
  location: 'Quito, EC',
});
// → { bytes, signerCN, sigAlg, signingTime }
```

See `docs/superpowers/specs/2026-05-09-firma-ec-F3-firma-MVP-design.md`.

## License

Apache-2.0
