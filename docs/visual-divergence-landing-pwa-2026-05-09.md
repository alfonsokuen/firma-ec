# Visual divergence: firmar.ec (landing) ↔ app.firmar.ec (PWA)

**Date**: 2026-05-09
**Source of truth**: landing (Astro F1 v0.1.6, Tier A polish via UI Pro Max).
**Goal**: PWA v0.5.0 — visually one experience.

## Audit method

Playwright MCP, three viewports (390×844, 1280×800, 1920×1080), full-page screenshots.
Saved under `audits/v0.5.0/before/` and `audits/v0.5.0/after/`.

## Divergences identified (BEFORE)

### 1. Header — MINOR (acceptable, kept differentiated by intent)
| Item | Landing | PWA before | Action |
|---|---|---|---|
| Height | h-16 (64px) | h-14 (56px) | **Bump to h-16** |
| Lockup | `firmar.ec` | `firmar.ec` + `app` chip | Keep app chip (intentional differentiator) |
| Nav (desktop) | Firmar · Verificar · Seguridad · FAQ · Acerca | Inicio · Verificar · Firmar · Paranoia · Acerca | Keep PWA nav (different surface area) |
| Toggles | LangSwitch (Astro) + ThemeToggle | Globe icon + EN/ES + ThemeToggle | Match landing's separation pattern |
| Border | `border-transparent` (scroll-driven shadow) | `border-ink-200/50` always | **Match landing — scroll shadow pattern** |
| Container | `container` (max-w fluid via UnoCSS) | `container max-w-6xl mx-auto px-4` | **Use single shared container** |
| "Open app" CTA | Yes (top-right primary) | N/A (already in app) | Keep N/A |

### 2. Hero — MAJOR DIVERGENCE
| Item | Landing | PWA before | Action |
|---|---|---|---|
| Eyebrow | `text-sm font-mono text-brand-500 uppercase tracking-wider` "Firma electrónica · Ecuador" | None | **ADD** |
| H1 | `clamp(2rem,1.2rem+4vw,4rem) bold tracking-[-0.02em]` "Firma y verifica PDFs con tu certificado ecuatoriano." | `clamp(1.875rem,1.4rem+2.4vw,3rem) extrabold` "¿Qué quieres hacer?" | **Match landing typography exactly + replace copy** |
| Lead | "100% en tu navegador. Tu llave nunca sale…" lg/xl ink-600 max-w-2xl | mono "firmar.ec" only | **ADD lead paragraph** |
| Primary CTA | `px-7 py-4 rounded-lg bg-brand-500` shadow + ring + lift | None at top | **ADD: "Firmar PDF" → /firmar (or "Verificar PDF" → /verificar)** |
| Secondary CTA | `px-5 py-3 rounded-md border` | Two big cards only | **ADD outline button + ghost button** |
| Badges row | 6 trust badges (Apache, ETSI, ARCOTEL, Mozilla, SSL Labs, LOPDP) | None | **ADD** |
| Body cards | (separate ParaQuien etc.) | Two large action cards | **Keep PWA cards — useful for app surface; but RE-STYLE to match landing Card.astro patterns** |
| Section padding | `py-12 md:py-20` | `py-12 md:py-16` | **Match `py-12 md:py-20`** |
| Container width | `container` (UnoCSS preset) | `max-w-3xl` | **Widen to landing container** |

### 3. Footer — MAJOR DIVERGENCE
| Item | Landing | PWA before | Action |
|---|---|---|---|
| Layout | 4-col grid: lockup+desc+CTA / Legal / Repos + bottom strip | Single row: copyright/version/idkmark + privacy claim + 3 links | **Reimplement: 3-col grid with lockup + project nav + privacy claim** |
| Lockup | `firmar.ec` heading | None | **ADD** |
| IDKMANAGER mark | size="sm" with eyebrow "OPERADO POR" | size="sm" with "Operado por" eyebrow | Already aligned |
| Privacy claim | Not in landing (it's a PWA-specific claim) | Bold present | **Keep** — meaningful PWA differentiator (no servers) |
| Bottom strip | Border-t + container + © year + security.txt | None | **ADD with version + copyright** |
| Border treatment | `border-ink-200 dark:border-ink-800` (solid) | `/50` opacity | **Match solid borders** |

### 4. CTA Buttons — DIVERGENCE
| Variant | Landing pattern | Action |
|---|---|---|
| Primary | `inline-flex items-center gap-2 px-7 py-4 rounded-lg bg-brand-500 text-white font-semibold shadow-[0_8px_32px_-8px_color-mix(...)] ring-1 ring-brand-600/30 hover:shadow-... hover:-translate-y-0.5 transition` | **Extract → `Button.svelte` + apply across PWA** |
| Outline | `inline-flex items-center gap-2 px-5 py-3 rounded-md border border-ink-300 dark:border-ink-700 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors` | **Same** |
| Ghost | `text-sm font-medium text-brand-600 hover:bg-brand-500/5` | **Same** |
| Compact (header) | `h-10 px-3.5 rounded-md bg-brand-500 ring-1 shadow` | Variant `compact` |

### 5. Cards — DIVERGENCE (medium)
Landing Card.astro: `rounded-lg border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 p-6`.
PWA Home cards: `rounded-xl border ... p-6` with hover-color logic embedded.

**Action**: align to `rounded-lg` + `p-6` and standardize hover micro (lift + shadow already in PWA, just unify radius).

### 6. Iconography — ALIGNED
Both use `i-lucide-*` via UnoCSS preset-icons. No emoji in either. Good.

### 7. Motion — MOSTLY ALIGNED
Both use `cubic-bezier(0.32,0.72,0,1)` for premium curves. PWA Home cards already had hero-grade motion. Header lacked scroll-shadow.

### 8. Color application — ALIGNED
Both use brand-500 sparingly (lockup `.firmar`, accents, primary CTA bg). Both have dark mode via `data-theme="dark"`.

## Decisions taken for v0.5.0

1. **Reimplement PWA Header** to h-16, scroll-shadow, container parity, retain "app" chip badge as intentional differentiator.
2. **Reimplement PWA Hero** (`Home.svelte` top section) with: eyebrow + h1 (landing-style ladder) + lead + 3 CTAs (primary/outline/ghost) + badge row. Two action cards remain BELOW (now framed by hero).
3. **Reimplement PWA Footer** as 3-col grid: lockup+desc+IDK / nav links / privacy claim, plus bottom strip with version + license. Privacy claim keeps prominence.
4. **Create `Button.svelte`** shared component — variants `primary | outline | ghost | compact`, sizes `sm | md | lg`. Replace ad-hoc buttons.
5. **Tighten Card radius** in Home cards: `rounded-lg` to mirror landing.
6. **Microcopy**: PWA Home title rotates to **"Firma y verifica PDFs con tu certificado ecuatoriano."** (landing voice), PWA-specific CTAs underneath ("Verificar PDF", "Firmar PDF — F3"). Keep Spanish/English parity.

Result: navigating `firmar.ec` → `app.firmar.ec` should feel like the same product surface, with the only intentional differentiator being the `app` chip in the header lockup.

## Files touched

- `apps/pwa/src/ui/Button.svelte` — NEW
- `apps/pwa/src/ui/Header.svelte` — MODIFY (h-16, scroll shadow, border transparent until scroll)
- `apps/pwa/src/ui/Footer.svelte` — MODIFY (3-col grid + bottom strip)
- `apps/pwa/src/routes/Home.svelte` — MODIFY (reframe with hero + reuse Button)
- `apps/pwa/src/lib/i18n.svelte.ts` — MODIFY (new keys: hero.eyebrow, hero.title_landing, hero.lead, footer columns)
- `apps/pwa/src/lib/version.ts` — bump 0.4.9 → 0.5.0
- `apps/pwa/package.json` — bump version
