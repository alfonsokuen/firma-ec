import {
  defineConfig,
  presetIcons,
  presetTypography,
  presetWind4,
  transformerDirectives,
  transformerVariantGroup,
} from 'unocss';

export default defineConfig({
  presets: [
    presetWind4({ preflight: false }),
    presetTypography(),
    presetIcons({
      scale: 1.2,
      cdn: undefined,
      collections: {
        lucide: () =>
          import('@iconify-json/lucide/icons.json').then((i) => i.default),
      },
    }),
  ],
  transformers: [transformerDirectives(), transformerVariantGroup()],
  theme: {
    colors: {
      ink: {
        50: 'oklch(98% 0.005 250)',
        100: 'oklch(96% 0.01 250)',
        200: 'oklch(91% 0.02 250)',
        300: 'oklch(82% 0.03 250)',
        400: 'oklch(68% 0.04 250)',
        500: 'oklch(54% 0.05 250)',
        600: 'oklch(42% 0.06 250)',
        700: 'oklch(32% 0.06 250)',
        800: 'oklch(22% 0.05 250)',
        900: 'oklch(14% 0.04 250)',
        950: 'oklch(8% 0.03 250)',
      },
      brand: {
        50: 'oklch(98% 0.025 245)',
        100: 'oklch(94% 0.06 245)',
        200: 'oklch(86% 0.12 245)',
        300: 'oklch(76% 0.16 245)',
        400: 'oklch(70% 0.19 245)',
        500: 'oklch(58% 0.21 245)',
        600: 'oklch(46% 0.20 245)',
        700: 'oklch(36% 0.16 245)',
        800: 'oklch(28% 0.13 245)',
        900: 'oklch(20% 0.10 245)',
      },
      ok: { 500: 'oklch(64% 0.16 145)' },
      warn: { 500: 'oklch(74% 0.17 80)' },
      err: { 500: 'oklch(58% 0.21 25)' },
    },
    fontFamily: {
      display: '"Geist Display", system-ui, sans-serif',
      sans: '"Geist Sans", "Inter", system-ui, sans-serif',
      mono: '"Geist Mono", "JetBrains Mono", ui-monospace, monospace',
    },
  },
  rules: [
    // Fluid type: text-fluid-{min}-{max} — sizes in px, output in rem + vw clamp
    [
      /^text-fluid-(\d+)-(\d+)$/,
      ([, min, max]) => ({
        'font-size': `clamp(${Number(min) / 16}rem, ${Number(min) / 100}rem + 2vw, ${Number(max) / 16}rem)`,
      }),
    ],
  ],
  safelist: [
    // Navigation / UI chrome
    'i-lucide-menu',
    'i-lucide-x',
    'i-lucide-moon',
    'i-lucide-sun',
    'i-lucide-arrow-right',
    'i-lucide-globe',
    'i-lucide-pen-tool',
    // PDF verification flow
    'i-lucide-upload',
    'i-lucide-file-check',
    'i-lucide-file-x',
    'i-lucide-file-text',
    'i-lucide-shield-check',
    'i-lucide-shield-x',
    'i-lucide-shield-alert',
    'i-lucide-lock',
    'i-lucide-lock-open',
    'i-lucide-eye',
    'i-lucide-chevron-down',
    'i-lucide-chevron-up',
    'i-lucide-rotate-ccw',
    'i-lucide-copy',
    'i-lucide-check',
    // Status / feedback
    'i-lucide-circle-check',
    'i-lucide-check-circle',
    'i-lucide-circle-x',
    'i-lucide-x-circle',
    'i-lucide-alert-triangle',
    'i-lucide-info',
    'i-lucide-loader-2',
    'i-lucide-loader',
    // F3 firma wizard
    'i-lucide-eye-off',
    'i-lucide-key-round',
    'i-lucide-shield',
    'i-lucide-arrow-left',
    'i-lucide-arrow-right',
    'i-lucide-download',
    'i-lucide-share-2',
    'i-lucide-rotate-cw',
    'i-lucide-circle-check-big',
    'i-lucide-chevron-right',
    'i-lucide-file-pen',
  ],
});
