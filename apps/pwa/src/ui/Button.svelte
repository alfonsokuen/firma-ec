<script lang="ts">
  /**
   * Button.svelte — shared CTA primitive for visual parity with the landing site.
   *
   * Mirrors the button patterns in `apps/landing/src/components/Hero.astro` and
   * `Header.astro`. Use this everywhere across the PWA so the "voice" matches
   * `firmar.ec` exactly (same shadows, lift on hover, ring, easing).
   *
   * Variants:
   *  - primary  — brand-500 fill + premium shadow + ring; for hero / decisive CTAs
   *  - outline  — neutral border, hover ink-100 bg; for secondary actions
   *  - ghost    — text-only, brand-tinted hover; for tertiary actions
   *  - compact  — header-grade primary (h-10, smaller px), reuses brand fill
   *
   * Sizes (only honored for primary/outline/ghost):
   *  - sm  — px-4 py-2 text-sm
   *  - md  — px-5 py-3 text-base   (default)
   *  - lg  — px-7 py-4 text-base   (hero primary)
   *
   * Accepts `href` (renders <a>) or onclick (renders <button>). Supports
   * `external` to open in a new tab with rel=noopener.
   */
  import type { Snippet } from 'svelte';

  type Variant = 'primary' | 'outline' | 'ghost' | 'compact';
  type Size = 'sm' | 'md' | 'lg';

  interface Props {
    href?: string;
    variant?: Variant;
    size?: Size;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    external?: boolean;
    ariaLabel?: string;
    class?: string;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
  }

  let {
    href,
    variant = 'primary',
    size = 'md',
    type = 'button',
    disabled = false,
    external = false,
    ariaLabel,
    class: className = '',
    onclick,
    children,
  }: Props = $props();

  const sizeMap: Record<Size, string> = {
    sm: 'px-4 py-2 text-sm min-h-11',
    md: 'px-5 py-3 text-base min-h-11',
    lg: 'px-7 py-4 text-base min-h-11',
  };

  const variantMap: Record<Variant, string> = {
    primary:
      'bg-brand-500 text-white font-semibold rounded-lg ' +
      'shadow-[0_8px_32px_-8px_color-mix(in_oklch,oklch(52%_0.18_240)_50%,transparent)] ' +
      'ring-1 ring-brand-600/30 ' +
      'hover:shadow-[0_16px_40px_-8px_color-mix(in_oklch,oklch(52%_0.18_240)_65%,transparent)] ' +
      'hover:-translate-y-0.5 ' +
      'transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ' +
      'focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950',
    outline:
      'rounded-md border border-ink-300 dark:border-ink-700 ' +
      'hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ' +
      'focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950',
    ghost:
      'rounded-md text-brand-600 dark:text-brand-400 font-medium ' +
      'hover:bg-brand-500/5 transition-colors ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ' +
      'focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950',
    compact:
      'h-10 px-3 sm:px-3.5 rounded-md bg-brand-500 text-white text-sm font-semibold ' +
      'shadow-[0_4px_16px_-4px_color-mix(in_oklch,oklch(52%_0.18_240)_50%,transparent)] ' +
      'ring-1 ring-brand-600/30 ' +
      'hover:shadow-[0_8px_24px_-4px_color-mix(in_oklch,oklch(52%_0.18_240)_60%,transparent)] ' +
      'hover:-translate-y-px ' +
      'transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ' +
      'focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950',
  };

  const sizeClass = $derived(variant === 'compact' ? '' : sizeMap[size]);
  const finalClass = $derived(
    `inline-flex items-center justify-center gap-2 ${variantMap[variant]} ${sizeClass} ${
      disabled ? 'opacity-50 pointer-events-none' : ''
    } ${className}`,
  );
</script>

{#if href}
  <a
    href={href}
    class={finalClass}
    aria-label={ariaLabel}
    target={external ? '_blank' : undefined}
    rel={external ? 'noopener noreferrer' : undefined}
    aria-disabled={disabled || undefined}
  >
    {@render children()}
  </a>
{:else}
  <button
    {type}
    class={finalClass}
    aria-label={ariaLabel}
    {disabled}
    {onclick}
  >
    {@render children()}
  </button>
{/if}
