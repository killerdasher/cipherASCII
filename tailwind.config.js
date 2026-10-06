/**
 * Tailwind CSS v3 configuration for cipherASCII (ASCII Art Studio).
 *
 * The app owns its palettes in `src/core/theme/theme.ts` - ten presets
 * (Medieval, Dither Boy, Terminal Green, Terminal Amber, Light, High
 * Contrast, plus the four cipher themes: Gothic Medieval, Cyber Y2K,
 * Cozy Cafe French and Zelda / RPG). `generateCSSVariables()` publishes each
 * preset as CSS custom properties, so every utility below resolves through
 * `var(--...)` and recolours the instant the theme switches.
 *
 * Preflight is intentionally NOT imported (styles.css only pulls the
 * components and utilities layers) so the hand-written application CSS keeps
 * full authority over the existing look.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        elevated: 'var(--bg-elevated)',
        hover: 'var(--bg-hover)',
        active: 'var(--bg-active)',
        fg: 'var(--fg)',
        muted: 'var(--fg-muted)',
        disabled: 'var(--fg-disabled)',
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        'accent-active': 'var(--accent-active)',
        line: 'var(--border)',
        'line-light': 'var(--border-light)',
        'line-focus': 'var(--border-focus)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
        info: 'var(--info)',
        glow: 'var(--glow, transparent)',
        selection: 'var(--selection, transparent)',
      },
      fontFamily: {
        mono: ['var(--font-mono)'],
        sans: ['var(--font-sans)'],
        display: ['var(--font-display, serif)'],
      },
      spacing: {
        xs: 'var(--space-xs)',
        sm: 'var(--space-sm)',
        md: 'var(--space-md)',
        lg: 'var(--space-lg)',
        xl: 'var(--space-xl)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        glow: '0 0 16px var(--glow, transparent)',
        'glow-sm': '0 0 8px var(--glow, transparent)',
      },
    },
  },
  plugins: [],
};
