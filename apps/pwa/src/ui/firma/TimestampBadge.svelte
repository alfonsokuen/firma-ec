<script lang="ts">
  /**
   * TimestampBadge.svelte — F6 §Task 17.
   *
   * Three-state badge mirroring the verifier's TimestampSummary contract:
   *   - gold   → fully verified RFC 3161 stamp (imprint + chain + signature OK)
   *   - silver → stamp present but at least one check failed; reason explains why
   *   - none   → no stamp embedded → render nothing (collapses cleanly)
   *
   * Rendered both in /verificar (after a B-T PDF is verified) and in /firmar
   * step 7 on success. Reduced-motion aware. Min touch target 44px not
   * applicable (it's a passive status, not interactive); a11y is role=status
   * + aria-live=polite so screen readers announce when it appears.
   */
  import { t, tp, getLang, type UIKey } from '../../lib/i18n.svelte.ts';

  interface Props {
    /** Three-state qualitative outcome — drives variant + visibility. */
    badge: 'gold' | 'silver' | 'none';
    /** TSTInfo.genTime — Date in /firmar (signer), ISO string in /verificar. */
    signingTime?: Date | string | undefined;
    /** Subject CN of the TSA signing cert. */
    tsaIssuer?: string | undefined;
    /** Failure reason (silver only). One of TimestampSummary.reason values. */
    reason?:
      | 'imprint_mismatch'
      | 'sig_invalid'
      | 'chain_invalid'
      | 'expired'
      | 'malformed'
      | 'no_tsa_cert'
      | undefined;
    /**
     * Context where the badge renders. Drives the title copy:
     *   'firmar'   → "Firma sellada"
     *   'verificar' → "Sellada por TSA"
     */
    context?: 'firmar' | 'verificar';
  }

  const {
    badge,
    signingTime,
    tsaIssuer,
    reason,
    context = 'verificar',
  }: Props = $props();

  // Format the signing time using the active app locale. Accepts either a Date
  // (signer-side) or an ISO string (verifier-side) for ergonomics across both
  // call sites — invalid inputs render as null and the line is suppressed.
  const formattedTime = $derived.by((): string | null => {
    if (signingTime === undefined) return null;
    const d = signingTime instanceof Date ? signingTime : new Date(signingTime);
    if (Number.isNaN(d.getTime())) return null;
    const lang = getLang();
    const locale = lang === 'es' ? 'es-EC' : 'en-US';
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  });

  // i18n key for the silver-state reason. Defensive against an unmapped reason
  // (future verifier reasons fall back to a generic 'malformed' copy).
  const reasonKey = $derived.by((): UIKey | null => {
    if (badge !== 'silver' || !reason) return null;
    const map: Record<NonNullable<Props['reason']>, UIKey> = {
      imprint_mismatch: 'verificar.tsa.silver_reason.imprint_mismatch',
      sig_invalid: 'verificar.tsa.silver_reason.sig_invalid',
      chain_invalid: 'verificar.tsa.silver_reason.chain_invalid',
      expired: 'verificar.tsa.silver_reason.expired',
      malformed: 'verificar.tsa.silver_reason.malformed',
      no_tsa_cert: 'verificar.tsa.silver_reason.no_tsa_cert',
    };
    return map[reason] ?? 'verificar.tsa.silver_reason.malformed';
  });

  const titleKey = $derived<UIKey>(
    badge === 'gold'
      ? context === 'firmar'
        ? 'firmar.tsa.gold'
        : 'verificar.tsa.gold'
      : 'verificar.tsa.silver',
  );

  const detailKey = $derived<UIKey>(
    context === 'firmar' ? 'firmar.tsa.gold_detail' : 'verificar.tsa.gold_detail',
  );
</script>

{#if badge === 'gold'}
  <div
    role="status"
    aria-live="polite"
    class="tsa-badge tsa-badge--gold rounded-2xl px-5 py-3 flex items-start gap-3 text-left"
  >
    <span
      class="i-lucide-shield-check text-2xl shrink-0 mt-0.5 tsa-badge__icon"
      aria-hidden="true"
    ></span>
    <div class="flex-1 min-w-0">
      <p class="font-display font-semibold text-sm leading-snug">{t(titleKey)}</p>
      {#if tsaIssuer || formattedTime}
        <p class="text-xs mt-0.5 tsa-badge__detail">
          {tp(detailKey, {
            tsa: tsaIssuer ?? '—',
            datetime: formattedTime ?? '',
          })}
        </p>
      {/if}
    </div>
  </div>
{:else if badge === 'silver'}
  <div
    role="status"
    aria-live="polite"
    class="rounded-2xl border border-ink-300 dark:border-ink-700 bg-ink-100/60 dark:bg-ink-800/40 px-5 py-3 flex items-start gap-3 text-left"
  >
    <span
      class="i-lucide-alert-triangle text-2xl text-ink-500 shrink-0 mt-0.5"
      aria-hidden="true"
    ></span>
    <div class="flex-1 min-w-0">
      <p class="font-display font-semibold text-sm leading-snug text-ink-700 dark:text-ink-200">
        {t(titleKey)}
      </p>
      {#if reasonKey}
        <p class="text-xs mt-0.5 text-ink-500 dark:text-ink-400">{t(reasonKey)}</p>
      {/if}
      {#if tsaIssuer || formattedTime}
        <p class="text-xs mt-0.5 text-ink-500 dark:text-ink-400 font-mono">
          {tsaIssuer ?? ''}{tsaIssuer && formattedTime ? ' · ' : ''}{formattedTime ?? ''}
        </p>
      {/if}
    </div>
  </div>
{/if}

<!-- badge==='none' renders nothing on purpose (collapses out of the layout). -->

<style>
  /*
   * Gold badge — F6.6 retuned to SUCCESS-GREEN (hue 145°, matching the
   * `ok` token family) so it reads as positive/verified rather than as
   * "another warning" when rendered immediately below the orange
   * "Firma válida con advertencias" panel (TSL placeholders generate
   * 18 advertencias on the outer cert chain). The previous honey-amber
   * (hue 85°) shared visual register with warn-tone surfaces.
   *
   * Triad (bg / border / fg) tuned for legibility in light + dark.
   * Reduced-motion: no transitions to honor.
   */
  .tsa-badge--gold {
    --tsa-gold: oklch(64% 0.16 145);
    --tsa-gold-fg: oklch(34% 0.10 145);
    --tsa-gold-bg: oklch(96% 0.04 145);
    --tsa-gold-border: oklch(64% 0.16 145 / 0.45);
    background-color: var(--tsa-gold-bg);
    border: 1px solid var(--tsa-gold-border);
    color: var(--tsa-gold-fg);
  }
  :global([data-theme='dark']) .tsa-badge--gold {
    --tsa-gold: oklch(72% 0.16 145);
    --tsa-gold-fg: oklch(86% 0.10 145);
    --tsa-gold-bg: oklch(26% 0.06 145 / 0.45);
    --tsa-gold-border: oklch(64% 0.16 145 / 0.45);
  }
  .tsa-badge--gold .tsa-badge__icon {
    color: var(--tsa-gold);
  }
  .tsa-badge--gold .tsa-badge__detail {
    color: var(--tsa-gold-fg);
    opacity: 0.88;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
</style>
