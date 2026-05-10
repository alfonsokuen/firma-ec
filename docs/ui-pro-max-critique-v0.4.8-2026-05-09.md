# UI Pro Max Critique — firmar.ec v0.4.8

**Date**: 2026-05-09
**Scope**: PWA (`app.firmar.ec`) + Landing↔App linkage
**Prior**: v0.4.7 (LIVE production-ready, F3 firma + F4 share-target)
**Stack applied**: ui-ux-pro-max + emil-design-eng + design-taste-frontend + high-end-visual-design + impeccable + polish + critique + audit

---

## Executive summary

v0.4.7 PWA is functional and visually correct, but lacks the *premium* signal layer:
- **Detached from the institutional landing** — users who land on `firmar.ec` (high-trust marketing) are 301-redirected into the PWA on `/firmar`, but there is no UI affordance to *return* to the institutional site, and conversely the landing has no prominent "Open the app" CTA. This breaks the trust handoff and brand cohesion.
- **Hero cards** (Home) are competent but pedestrian — uniform borders, identical hover states, no dimensional storytelling, no animation entry, no copy ladder.
- **Drop zone** (Verificar/Firmar) collapses idle/hover/dragging into one visual register; no premium state choreography.
- **Typography ladder** is flat — h1/body share too similar a contrast in weight/size on mobile.
- **Motion vocabulary** is inconsistent — some hovers translate-y, others only color; no shared curve.
- **Footer** lacks brand handoff back to `firmar.ec` institutional site.

---

## Findings (P0 / P1 / P2)

### P0 — must ship in v0.4.8

| # | Area | Finding | Action |
|---|------|---------|--------|
| P0-1 | Linkage | Landing has no UI link "Open the app" beyond hidden 301 redirects | Add prominent **"Abrir app" / "Open app"** CTA in landing header (mobile + desktop) → `https://app.firmar.ec/` |
| P0-2 | Linkage | Landing Hero CTAs hit `/firmar` `/verificar` (301 → app) but copy doesn't telegraph "leaving institutional, entering tool" | Add `target=_blank` is wrong (PWA is the destination experience). Keep direct link but visually mark as "app launch" with arrow-up-right icon for clarity |
| P0-3 | Linkage | PWA footer has no link back to institutional `firmar.ec` site | Add **"Sitio institucional / Institutional site"** link in PWA Footer → `https://firmar.ec/` (target=_blank rel=noopener) |
| P0-4 | Linkage | PWA About route has no CTA back to landing for full docs | Add CTA card "Más información en firmar.ec" linking to `https://firmar.ec/acerca` |
| P0-5 | Hero (PWA Home) | h1 weight/size doesn't carry premium ladder | h1 → `font-weight: 800` + `tracking-tight` + `text-balance`; bump scale on `md:` |
| P0-6 | Hero cards | Identical card affordances; hover states monotonic | Differentiated hover lift (translate-y-0.5 + shadow tier) on Verificar (brand) vs Firmar (warn) — semantic color stays |
| P0-7 | Footer (PWA) | Lacks institutional site link & visual hierarchy | Three-column layout md+: brand+privacy / institutional links / source links |

### P1 — ship in v0.4.8 if budget, else v0.4.9

| # | Area | Finding | Action |
|---|------|---------|--------|
| P1-1 | Drop zone | Idle/hover/dragging share visual register | Add four discrete states (idle / hover / dragging / processing) with elevation + border tint via dataset attribute |
| P1-2 | Motion vocab | Curve `cubic-bezier(0.32, 0.72, 0, 1)` not consistently applied | Audit all `transition-*` to use shared `--ease-emil` token |
| P1-3 | Wizard transitions | Step changes are instant (no slide) | Add 250ms slide-x with `--ease-emil` via Svelte transition |
| P1-4 | Iconography | Some icons differ in size class within same context | Normalize to 16/20/24 by container |
| P1-5 | Empty states | About/share-anchor cards are text-only | Light iconography mark + breath |

### P2 — backlog v0.4.9+

- Loading spinner premium (replace generic Lucide loader with branded SVG)
- Install prompt visual polish (rounded-2xl + brand accent)
- Detail panel collapsible animation (height auto)
- Result verdict color tokens: subtle gradient ring (oklch) instead of flat
- Wizard progress: numeric progress + label semantic emphasis
- Microcopy pass with `clarify` skill
- Audit pass with `audit` skill (axe-core)

---

## Implementation plan v0.4.8

**Landing changes** (bump `0.1.0` → `0.1.5`):
1. `Header.astro` — add "Abrir app / Open app" CTA button (visible mobile too, between nav and toggles).
2. `Hero.astro` — add `i-lucide-arrow-up-right` decorator on primary CTAs (signal "leaving to app").
3. `Footer.astro` — add column "App" with link → `https://app.firmar.ec/`.
4. `i18n/ui.ts` — add `cta.abrir_app` / `nav.abrir_app` keys.

**PWA changes** (bump `0.4.7` → `0.4.8`):
1. `Footer.svelte` — add **"Sitio institucional"** link → `https://firmar.ec/` (external).
2. `routes/About.svelte` — add CTA card to `https://firmar.ec/acerca`.
3. `routes/Home.svelte` — h1 ladder (font-display, weight 800, tracking-tight, text-balance) + differentiated card hover.
4. `lib/i18n.svelte.ts` — add `footer.institutional`, `about.full_docs_cta`.
5. `styles/tokens.css` — formalize `--ease-emil: cubic-bezier(0.32, 0.72, 0, 1)`.
6. `ui/Drop.svelte` — discrete states via `data-state` attribute (P1-1).
7. `ui/Header.svelte` — already has wordmark linking to `/`; verify external "site" button if budget.

**Audit caveat**: Live Playwright before/after audit was deferred in this iteration due to MCP availability constraints in this autonomous run. Manual smoke-test post-deploy + browser DevTools sanity check substituted; full visual regression suite slated for v0.4.9.

---

## Acceptance criteria

- [ ] Landing → App: "Abrir app" CTA visible on `firmar.ec` mobile + desktop.
- [ ] App → Landing: "Sitio institucional" link visible on `app.firmar.ec` footer.
- [ ] About route has CTA to `firmar.ec/acerca`.
- [ ] PWA Home h1 ladder visibly heavier; cards have differentiated hover.
- [ ] Drop zone has 4 discrete visual states.
- [ ] Bundle size ≤ 200KB gzip (no degradation vs v0.4.7 baseline ~50KB).
- [ ] Tests cumulative passing.
- [ ] Privacy claim INTACT.
