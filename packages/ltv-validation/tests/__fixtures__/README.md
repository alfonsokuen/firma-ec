# Test fixtures

## OCSP KAT (Known-Answer Test)

A frozen Let's Encrypt OCSP `good` response is expected at:

- `le-ocsp-good-2026-05-10.der`

When this file is missing, the KAT test is **skipped** with an explicit reason
(see `ocsp-kat.test.ts`). The file MUST be captured manually because the
sandboxed CI cannot reach external networks.

### Capture script

Run `pnpm --filter @firma-ec/ltv-validation capture-le-ocsp` (see
`scripts/capture-le-ocsp.mjs`). Requires Node 20+, OpenSSL CLI ≥3, and
network access to:

- `https://example-le-site.tld:443` (any LE-issued site you trust)
- `http://r3.o.lencr.org/` (LE OCSP responder)

Document the resulting fixture's SHA-256 here when committed:

```
SHA-256(le-ocsp-good-2026-05-10.der) = <hex>
```

### CRL KAT (optional)

`eci-crl-2026-05-10.der` — best-effort capture from
`http://crl.eci.bce.ec/crl/AC-BCE.crl`. If the responder is down at capture
time, mark `KAT_HAVE_CRL=0` and tests skip gracefully.
