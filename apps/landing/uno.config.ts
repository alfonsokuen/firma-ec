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
    presetWind4({
      preflight: false,
      dark: { dark: '[data-theme="dark"]', light: '[data-theme="light"]' },
    }),
    presetTypography(),
    presetIcons({
      scale: 1.2,
      cdn: undefined,
      collections: {
        lucide: () => import('@iconify-json/lucide/icons.json').then((i) => i.default),
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
        50: 'oklch(98% 0.02 245)',
        100: 'oklch(94% 0.05 245)',
        200: 'oklch(86% 0.10 245)',
        300: 'oklch(76% 0.15 245)',
        400: 'oklch(70% 0.19 245)',
        500: '#0062c4',
        600: 'oklch(46% 0.20 245)',
        700: 'oklch(36% 0.16 245)',
        800: 'oklch(26% 0.11 245)',
        900: 'oklch(18% 0.07 245)',
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
    [
      /^text-fluid-(\d+)-(\d+)$/,
      ([, min, max]) => ({
        'font-size': `clamp(${Number(min) / 16}rem, ${Number(min) / 100}rem + 2vw, ${Number(max) / 16}rem)`,
      }),
    ],
  ],
  safelist: [
    'i-lucide-arrow-right',
    'i-lucide-shield-check',
    'i-lucide-lock',
    'i-lucide-globe',
    'i-lucide-code',
    'i-lucide-eye',
    'i-lucide-moon',
    'i-lucide-sun',
    'i-lucide-menu',
    'i-lucide-x',
  ],
});
