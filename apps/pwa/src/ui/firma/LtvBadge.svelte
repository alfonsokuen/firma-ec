<script lang="ts">
  /**
   * LtvBadge.svelte — F7 §T29.
   *
   * Separate tier from TimestampBadge:
   *   - 'B-LTA' → emerald-success "Archivo a largo plazo · embebido N OCSP / M CRL"
   *               + lucide-archive-restore icon.
   *   - 'B-LT'  → emerald-success (slightly muted) "Validez a largo plazo · N OCSP / M CRL"
   *               + lucide-shield-check icon.
   *   - 'B-T' / 'B-B' → render nothing (TimestampBadge handles B-T; B-B has no badge).
   *
   * Reduced-motion aware. role=status / aria-live=polite so screen readers
   * announce when it appears. Tooltip surfaces retrospective validity copy.
   *
   * **Critical**: LTV badges NEVER block / contradict an outer-signature
   * judgment (spec §6.4 — LT-as-warning). Even if `retrospectiveValid` is
   * false, the outer signature can still be valid; this badge only colors
   * the LTV layer.
   */
  import { t, tp, getLang } from '../../lib/i18n.svelte.ts';

  /** Shape mirrors VerificationResult.signature.ltv from @firma-ec/verifier. */
  export interface LtvBadgeData {
    profile: 'B-B' | 'B-T' | 'B-LT' | 'B-LTA';
    dssPresent: boolean;
    embeddedOcspCount: number;
    embeddedCrlCount: number;
    retrospectiveValid: boolean;
    documentTimestamp?: {
      present: boolean;
      valid: boolean;
      badge: 'gold' | 'silver' | 'none';
      signingTime?: string | undefined;
      tsaIssuer?: string | undefined;
      reason?: string | undefined;
    } | undefined;
  }

  interface Props {
    ltv: LtvBadgeData | null | undefined;
  }
  const { ltv }: Props = $props();

  // Only render for B-LT and B-LTA. B-T / B-B / nullish → hidden.
  const visible = $derived.by(
    () => ltv !== null && ltv !== undefined && (ltv.profile === 'B-LT' || ltv.profile === 'B-LTA'),
  );

  const formattedArchive = $derived.by((): string => {
    if (!ltv?.documentTimestamp?.signingTime) return '—';
    const d = new Date(ltv.documentTimestamp.signingTime);
    if (Number.isNaN(d.getTime())) return '—';
    const lang = getLang();
    const locale = lang === 'es' ? 'es-EC' : 'en-US';
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  });

  const retrospectiveTooltip = $derived.by((): string => {
    if (!ltv) return '';
    return ltv.retrospectiveValid
      ? t('ltv.badge.tooltip_retrospective_ok')
      : t('ltv.badge.tooltip_retrospective_unverified');
  });
</script>

{#if visible && ltv}
  {#if ltv.profile === 'B-LTA'}
    <div
      role="status"
      aria-live="polite"
      title={retrospectiveTooltip}
      class="ltv-badge ltv-badge--lta rounded-2xl px-5 py-3 flex items-start gap-3 text-left"
    >
      <span
        class="i-lucide-archive-restore text-2xl shrink-0 mt-0.5 ltv-badge__icon"
        aria-hidden="true"
      ></span>
      <div class="flex-1 min-w-0">
        <p class="font-display font-semibold text-sm leading-snug">
          {t('ltv.badge.lta_title')}
        </p>
        <p class="text-xs mt-0.5 ltv-badge__detail">
          {tp('ltv.badge.lta_detail', {
            ocsps: ltv.embeddedOcspCount,
            crls: ltv.embeddedCrlCount,
            datetime: formattedArchive,
          })}
        </p>
      </div>
    </div>
  {:else if ltv.profile === 'B-LT'}
    <div
      role="status"
      aria-live="polite"
      title={retrospectiveTooltip}
      class="ltv-badge ltv-badge--lt rounded-2xl px-5 py-3 flex items-start gap-3 text-left"
    >
      <span
        class="i-lucide-shield-check text-2xl shrink-0 mt-0.5 ltv-badge__icon"
        aria-hidden="true"
      ></span>
      <div class="flex-1 min-w-0">
        <p class="font-display font-semibold text-sm leading-snug">
          {t('ltv.badge.lt_title')}
        </p>
        <p class="text-xs mt-0.5 ltv-badge__detail">
          {tp('ltv.badge.lt_detail', {
            ocsps: ltv.embeddedOcspCount,
            crls: ltv.embeddedCrlCount,
          })}
        </p>
      </div>
    </div>
  {/if}
{/if}

<style>
  /*
   * Two tiers, both on the same emerald-success hue (145°) used by the F6
   * gold TimestampBadge so the visual signal "trust earned" reads
   * consistently across the timestamp / LTV / archive ladder. LTA is the
   * brighter / saturated variant ("highest tier achieved"); LT is the
   * muted variant ("LT but no archive").
   *
   * Reduced-motion: no transitions to honor.
   */
  .ltv-badge--lta {
    --ltv-fg: oklch(34% 0.10 145);
    --ltv-bg: oklch(96% 0.04 145);
    --ltv-border: oklch(64% 0.16 145 / 0.55);
    --ltv-icon: oklch(58% 0.18 145);
    background-color: var(--ltv-bg);
    border: 1px solid var(--ltv-border);
    color: var(--ltv-fg);
  }
  :global([data-theme='dark']) .ltv-badge--lta {
    --ltv-fg: oklch(86% 0.10 145);
    --ltv-bg: oklch(26% 0.06 145 / 0.45);
    --ltv-border: oklch(64% 0.16 145 / 0.45);
    --ltv-icon: oklch(72% 0.16 145);
  }
  .ltv-badge--lt {
    --ltv-fg: oklch(38% 0.06 145);
    --ltv-bg: oklch(97% 0.025 145);
    --ltv-border: oklch(70% 0.10 145 / 0.40);
    --ltv-icon: oklch(60% 0.10 145);
    background-color: var(--ltv-bg);
    border: 1px solid var(--ltv-border);
    color: var(--ltv-fg);
  }
  :global([data-theme='dark']) .ltv-badge--lt {
    --ltv-fg: oklch(82% 0.06 145);
    --ltv-bg: oklch(24% 0.04 145 / 0.35);
    --ltv-border: oklch(60% 0.10 145 / 0.30);
    --ltv-icon: oklch(70% 0.10 145);
  }
  .ltv-badge__icon {
    color: var(--ltv-icon);
  }
  .ltv-badge__detail {
    color: var(--ltv-fg);
    opacity: 0.88;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
</style>
