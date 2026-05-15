<script lang="ts">
/**
 * IdkmanagerMark — institutional wordmark for "IDKMANAGER" (parent company).
 *
 * PWA twin of `apps/landing/src/components/IdkmanagerMark.astro` so footers +
 * about credits stay visually identical across the two apps. Inline SVG so it
 * inherits `currentColor` and ships zero extra bytes over the wire.
 *
 * Sizes match landing exactly:
 *   - sm:  ~88px wide (footer copyright line)
 *   - md:  ~128px wide (footer credit row)  ← default
 *   - lg:  ~160px wide (about page)
 */
interface Props {
  size?: 'sm' | 'md' | 'lg';
  class?: string;
}

let { size = 'md', class: className = '' }: Props = $props();

const widths = { sm: 88, md: 128, lg: 160 } as const;
const heights = { sm: 14, md: 20, lg: 26 } as const;
const fontSizes = { sm: 11, md: 16, lg: 20 } as const;

let w = $derived(widths[size]);
let h = $derived(heights[size]);
let fs = $derived(fontSizes[size]);
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 {w} {h}"
  width={w}
  height={h}
  role="img"
  aria-label="IDKMANAGER"
  class="idkmark inline-block align-middle {className}"
>
  <text
    x="0"
    y={h - Math.round(h * 0.22)}
    font-family='"Geist Display", system-ui, sans-serif'
    font-weight="700"
    font-size={fs}
    letter-spacing="0.04em"
    fill="currentColor"
  >IDKMANAGER</text>
</svg>
