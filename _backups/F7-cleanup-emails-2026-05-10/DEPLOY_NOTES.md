# F7 cleanup — remove non-existent @firmar.ec emails — 2026-05-10

## Summary

User-visible cleanup. The 3 firmar.ec email addresses were never provisioned
(zone has null MX). Replaced everywhere user-visible with public, working
URL channels. LOPDP compliance preserved by routing data-subject contact
to IDK Manager (the parent organization that legally acts as data controller).

## Email -> replacement

| Old | New |
|---|---|
| `contacto@firmar.ec` | https://github.com/idkmanager/firma-ec/issues |
| `datos@firmar.ec` (DPO/ARCO+) | https://idkmanager.com/contacto/ (IDK Manager = controller) |
| `security@firmar.ec` | https://github.com/idkmanager/firma-ec/security/advisories/new |

## Image SHAs (registry 190.160.10.129:5000)

- `firma-ec-landing:v0.1.11` image sha256 `41c609875b9301886a643d80a3f852dce667b0f4fad5b63b89912d4028a4e090`

## Pre-deploy

```
firma-ec_landing 190.160.10.129:5000/firma-ec-landing:0.1.10  (2/2)
firma-ec_pwa     190.160.10.129:5000/firma-ec-pwa:0.6.0-rc8   (2/2)  -- NOT TOUCHED
```

## Post-deploy

```
firma-ec_landing 190.160.10.129:5000/firma-ec-landing:v0.1.11 (2/2 max 1 per node)  -- CONVERGED
firma-ec_pwa     190.160.10.129:5000/firma-ec-pwa:0.6.0-rc8   (2/2 max 1 per node)  -- unchanged
```

## Smoke (Cloudflare-fronted, cache-busted)

- `https://firmar.ec/.well-known/security.txt` → Contact lines now HTTPS URLs ✓
- `https://firmar.ec/.well-known/pgp-key.txt` → 404 ✓
- 9 user-visible pages (`/`, `/contacto`, `/privacidad`, `/seguridad`, `/acerca`, `/terminos`, `/faq`, `/en/contact`, `/en/privacy`) → 0 `@firmar.ec` matches in HTML ✓
- CSP `connect-src 'self'` retained on landing (FreeTSA scope is PWA only — unchanged) ✓

## Tag + cosign

- Tag: `v-landing-0.1.11` (annotated, sha `b2b71089c703dbeb250597a92124e3832f5f25bf`)
- Commit signed: `834ef47a9c3b1d81fbd814873296d9a6ae4809b4`
- Cosign: `MEUCIQC/dvQ27nFLoVjCQ7TIOhcpcJMAw7W/GIpGzW2sQ2ihYQIgEquefDp468V7u1WadAN9t471Y0K/FU+h8ovcVUpbWfA=`
- tlog index: 1497265355
- Pub key: vault `apps_firma_ec.cosign_pub` / public mirror at `https://firmar.ec/.well-known/cosign.pub`

## Push

- `origin` (Gitea): main 834ef47 + tag v-landing-0.1.11 → pushed.
- No GitHub mirror configured on this repo's remotes (firma-ec uses single Gitea remote — different from workspace claude-md repo which has multi-push).

## Out-of-scope / follow-ups

- DNS update (operator) — drop legacy `mailto:` from CAA `iodef` and DMARC `rua`.
  Currently still:
  - `CAA firmar.ec 0 iodef "mailto:security@firmar.ec"`
  - `TXT _dmarc.firmar.ec v=DMARC1; p=reject; rua=mailto:datos@firmar.ec`
  Non-blocking because zone has null MX (mail is impossible regardless). Documented
  in `docs/transparency-report.md` with annotations.
- inbox-backend env defaults referencing `@firmar.ec` left as-is (NOT user-visible;
  internal to the inbox service).
- PWA `app.firmar.ec` not touched — PWA had no `@firmar.ec` references.
