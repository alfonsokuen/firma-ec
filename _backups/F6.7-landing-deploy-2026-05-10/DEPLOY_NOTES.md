# F6.7 + landing 0.1.9 deploy — 2026-05-10

## Image SHAs (registry 190.160.10.129:5000)

- `firma-ec-pwa:0.6.0-rc7` digest `sha256:d71885e39a6a3a6856057c90d578af42f83ba1d454ab10d1c429971a3e915036` (image sha256:23795623ba00…)
- `firma-ec-landing:v0.1.9` digest `sha256:70d15a76020931a93a046879f2bd1baf05ebd0552b80a02c4ec1b448082fa4bb` (image sha256:a1f08743c5a7…)

## Pre-deploy (replaced)

```
firma-ec_landing 190.160.10.129:5000/firma-ec-landing:v0.1.8
firma-ec_pwa     190.160.10.129:5000/firma-ec-pwa:0.6.0-rc6
```

## Post-deploy

```
firma-ec_landing 190.160.10.129:5000/firma-ec-landing:v0.1.9 2/2 (max 1 per node)
firma-ec_pwa     190.160.10.129:5000/firma-ec-pwa:0.6.0-rc7  2/2 (max 1 per node)
```

## Live verification (Playwright)

- Landing ES h1: `Firma y verifica PDFs con tu certificado electrónico .p12.` ✔
- Landing EN h1: `Sign and verify PDFs with your .p12 electronic certificate.` ✔
- App `/configuracion` footer: `versión 0.6.0-rc7` ✔
- App `/verificar` con sample-b-t-freetsa.pdf:
  - Banner: `Verificación en modo demostración — v0.6.0-rc7 — 2 de 17 ACEs ARCOTEL tienen raíz real cargada (Eclipsoft, Uanataca); las 15 restantes siguen como placeholders…` ✔
  - TSA stamp visible: `Sellada por TSA · Emitido por www.freetsa.org` ✔
  - PADES: B-T ✔
  - Warnings: 16 (1 TRUST_PARTIAL + 15 tsl_warning placeholders) ✔
- CSP includes `https://freetsa.org` in connect-src ✔

## SW cache caveat

Existing PWA users on rc6 need to either accept the in-app update prompt
or hard-reload to pick up rc7 (precache hash changed). Verified by
unregistering SW + clearing caches in fresh Playwright profile and
reloading — footer flipped from rc6 → rc7.

## Pending: 15 ACEs still need real PEM fetch

Placeholders remaining: alpha-technologies, anfac, appfirmas, argosdata,
bce, judicatura, corpnewbest, datil, registro-civil, security-data, …
(see `packages/tsl-ec/src/data/aces-arcotel.json` notes field per entry).
