/**
 * Theme System - Medieval/themeable UI like Script Slayer / Dither Boy.
 *
 * Supports: multiple themes, CSS variable injection, theme switching,
 * custom theme creation, theme persistence.
 */

export interface ThemeColors {
  // Base
  bg: string;
  bgElevated: string;
  bgHover: string;
  bgActive: string;

  // Text
  fg: string;
  fgMuted: string;
  fgDisabled: string;
  fgInverse: string;

  // Accent
  accent: string;
  accentHover: string;
  accentActive: string;
  accentMuted: string;

  // Borders
  border: string;
  borderLight: string;
  borderFocus: string;

  // Status
  success: string;
  warning: string;
  danger: string;
  info: string;

  // Syntax/Code
  codeBg: string;
  codeFg: string;
  keyword: string;
  string: string;
  number: string;
  comment: string;
  function: string;

  // Effects - glow halo + selection wash (used by the cipher themes and by
  // any component opting into var(--glow) / var(--selection)).
  glow: string;
  selection: string;
}

export interface Theme {
  id: string;
  name: string;
  description: string;
  colors: ThemeColors;
  fonts: {
    mono: string;
    sans: string;
    display?: string;
  };
  spacing: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
  borderRadius: {
    sm: string;
    md: string;
    lg: string;
    full: string;
  };
  shadows: {
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
  transitions: {
    fast: string;
    normal: string;
    slow: string;
  };
  isDark: boolean;
}

export const THEME_PRESETS: Theme[] = [
  // Medieval / Script Slayer inspired
  {
    id: 'medieval',
    name: 'Medieval',
    description: 'Script Slayer inspired dark theme with parchment tones',
    isDark: true,
    colors: {
      bg: '#1a1612',
      bgElevated: '#241e18',
      bgHover: '#2d241c',
      bgActive: '#3a2e22',

      fg: '#f5f0e8',
      fgMuted: '#a89b8a',
      fgDisabled: '#6b5d4d',
      fgInverse: '#1a1612',

      accent: '#d4a53c',
      accentHover: '#e8c05c',
      accentActive: '#c4942c',
      accentMuted: '#d4a53c40',

      border: '#3a2e22',
      borderLight: '#4a3e2e',
      borderFocus: '#d4a53c',

      success: '#4ade80',
      warning: '#fbbf24',
      danger: '#f87171',
      info: '#60a5fa',

      codeBg: '#15120f',
      codeFg: '#e8dcc8',
      keyword: '#d4a53c',
      string: '#86efac',
      number: '#fca5a5',
      comment: '#6b5d4d',
      function: '#fde047',
      glow: 'rgba(212, 165, 60, 0.35)',
      selection: 'rgba(212, 165, 60, 0.22)',
    },
    fonts: {
      mono: '"Cascadia Mono", "Fira Code", "JetBrains Mono", monospace',
      sans: '"Cinzel", "IM Fell English", Georgia, serif',
      display: '"Cinzel Decorative", "IM Fell English SC", serif',
    },
    spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px' },
    borderRadius: { sm: '2px', md: '4px', lg: '8px', full: '9999px' },
    shadows: {
      sm: '0 1px 2px rgba(0,0,0,0.3)',
      md: '0 4px 6px rgba(0,0,0,0.4)',
      lg: '0 10px 15px rgba(0,0,0,0.5)',
      xl: '0 20px 25px rgba(0,0,0,0.6)',
    },
    transitions: { fast: '100ms ease', normal: '200ms ease', slow: '300ms ease' },
  },

  // Dither Boy inspired
  {
    id: 'ditherboy',
    name: 'Dither Boy',
    description: 'Dither Boy inspired retro terminal aesthetic',
    isDark: true,
    colors: {
      bg: '#0c0c10',
      bgElevated: '#16161d',
      bgHover: '#1e1e2a',
      bgActive: '#2a2a3a',

      fg: '#d4d4d8',
      fgMuted: '#71717a',
      fgDisabled: '#3f3f46',
      fgInverse: '#0c0c10',

      accent: '#3b82f6',
      accentHover: '#60a5fa',
      accentActive: '#2563eb',
      accentMuted: '#3b82f640',

      border: '#27272a',
      borderLight: '#3f3f46',
      borderFocus: '#3b82f6',

      success: '#22c55e',
      warning: '#fbbf24',
      danger: '#ef4444',
      info: '#06b6d4',

      codeBg: '#08080b',
      codeFg: '#e4e4e7',
      keyword: '#3b82f6',
      string: '#4ade80',
      number: '#fca5a5',
      comment: '#52525b',
      function: '#fde047',
      glow: 'rgba(59, 130, 246, 0.35)',
      selection: 'rgba(59, 130, 246, 0.22)',
    },
    fonts: {
      mono: '"Cascadia Mono", "Consolas", "DejaVu Sans Mono", monospace',
      sans: '"IBM Plex Sans", "Inter", system-ui, sans-serif',
      display: '"IBM Plex Mono", "Space Mono", monospace',
    },
    spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px' },
    borderRadius: { sm: '0', md: '0', lg: '0', full: '0' },
    shadows: {
      sm: '0 0 0 1px rgba(59,130,246,0.2)',
      md: '0 0 0 2px rgba(59,130,246,0.3)',
      lg: '0 0 0 4px rgba(59,130,246,0.4)',
      xl: '0 0 0 8px rgba(59,130,246,0.5)',
    },
    transitions: { fast: '50ms linear', normal: '100ms linear', slow: '150ms linear' },
  },

  // Classic Terminal Green
  {
    id: 'terminal-green',
    name: 'Terminal Green',
    description: 'Classic amber/green monochrome monitor',
    isDark: true,
    colors: {
      bg: '#001100',
      bgElevated: '#001a00',
      bgHover: '#002200',
      bgActive: '#003300',

      fg: '#00ff00',
      fgMuted: '#00aa00',
      fgDisabled: '#005500',
      fgInverse: '#001100',

      accent: '#00ff00',
      accentHover: '#44ff44',
      accentActive: '#00cc00',
      accentMuted: '#00ff0040',

      border: '#004400',
      borderLight: '#006600',
      borderFocus: '#00ff00',

      success: '#00ff00',
      warning: '#ffff00',
      danger: '#ff0000',
      info: '#00ffff',

      codeBg: '#000800',
      codeFg: '#00ff00',
      keyword: '#00ff00',
      string: '#88ff88',
      number: '#ff8888',
      comment: '#006600',
      function: '#ffff00',
      glow: 'rgba(0, 255, 0, 0.35)',
      selection: 'rgba(0, 255, 0, 0.20)',
    },
    fonts: {
      mono: '"VT323", "Courier New", monospace',
      sans: '"VT323", "Courier New", monospace',
      display: '"VT323", "Courier New", monospace',
    },
    spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px' },
    borderRadius: { sm: '0', md: '0', lg: '0', full: '0' },
    shadows: {
      sm: '0 0 4px #00ff00',
      md: '0 0 8px #00ff00',
      lg: '0 0 16px #00ff00',
      xl: '0 0 32px #00ff00',
    },
    transitions: { fast: '0ms', normal: '0ms', slow: '0ms' },
  },

  // Classic Terminal Amber
  {
    id: 'terminal-amber',
    name: 'Terminal Amber',
    description: 'Classic amber monochrome monitor',
    isDark: true,
    colors: {
      bg: '#1a0d00',
      bgElevated: '#261400',
      bgHover: '#331e00',
      bgActive: '#402800',

      fg: '#ffbf00',
      fgMuted: '#cc9900',
      fgDisabled: '#664400',
      fgInverse: '#1a0d00',

      accent: '#ffbf00',
      accentHover: '#ffcc44',
      accentActive: '#e6aa00',
      accentMuted: '#ffbf0040',

      border: '#442200',
      borderLight: '#663300',
      borderFocus: '#ffbf00',

      success: '#ffbf00',
      warning: '#ffff00',
      danger: '#ff4400',
      info: '#ffcc00',

      codeBg: '#0d0600',
      codeFg: '#ffbf00',
      keyword: '#ffbf00',
      string: '#ffcc88',
      number: '#ff8844',
      comment: '#886600',
      function: '#ffff00',
      glow: 'rgba(255, 191, 0, 0.35)',
      selection: 'rgba(255, 191, 0, 0.20)',
    },
    fonts: {
      mono: '"VT323", "Courier New", monospace',
      sans: '"VT323", "Courier New", monospace',
      display: '"VT323", "Courier New", monospace',
    },
    spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px' },
    borderRadius: { sm: '0', md: '0', lg: '0', full: '0' },
    shadows: {
      sm: '0 0 4px #ffbf00',
      md: '0 0 8px #ffbf00',
      lg: '0 0 16px #ffbf00',
      xl: '0 0 32px #ffbf00',
    },
    transitions: { fast: '0ms', normal: '0ms', slow: '0ms' },
  },

  // Light theme
  {
    id: 'light',
    name: 'Light',
    description: 'Clean light theme for daylight work',
    isDark: false,
    colors: {
      bg: '#fafafa',
      bgElevated: '#ffffff',
      bgHover: '#f5f5f5',
      bgActive: '#e8e8e8',

      fg: '#18181b',
      fgMuted: '#71717a',
      fgDisabled: '#d4d4d8',
      fgInverse: '#ffffff',

      accent: '#3b82f6',
      accentHover: '#2563eb',
      accentActive: '#1d4ed8',
      accentMuted: '#3b82f620',

      border: '#e4e4e7',
      borderLight: '#f4f4f5',
      borderFocus: '#3b82f6',

      success: '#16a34a',
      warning: '#ca8a04',
      danger: '#dc2626',
      info: '#0891b2',

      codeBg: '#fafafa',
      codeFg: '#18181b',
      keyword: '#3b82f6',
      string: '#16a34a',
      number: '#dc2626',
      comment: '#a1a1aa',
      function: '#ca8a04',
      glow: 'rgba(59, 130, 246, 0.30)',
      selection: 'rgba(59, 130, 246, 0.18)',
    },
    fonts: {
      mono: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
      sans: '"Inter", system-ui, sans-serif',
      display: '"Space Grotesk", "Inter", sans-serif',
    },
    spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px' },
    borderRadius: { sm: '4px', md: '8px', lg: '12px', full: '9999px' },
    shadows: {
      sm: '0 1px 2px rgba(0,0,0,0.05)',
      md: '0 4px 6px rgba(0,0,0,0.07)',
      lg: '0 10px 15px rgba(0,0,0,0.1)',
      xl: '0 20px 25px rgba(0,0,0,0.15)',
    },
    transitions: { fast: '100ms ease', normal: '200ms ease', slow: '300ms ease' },
  },

  // High Contrast
  {
    id: 'high-contrast',
    name: 'High Contrast',
    description: 'Maximum contrast for accessibility',
    isDark: true,
    colors: {
      bg: '#000000',
      bgElevated: '#111111',
      bgHover: '#222222',
      bgActive: '#333333',

      fg: '#ffffff',
      fgMuted: '#cccccc',
      fgDisabled: '#666666',
      fgInverse: '#000000',

      accent: '#ffff00',
      accentHover: '#ffff33',
      accentActive: '#cccc00',
      accentMuted: '#ffff0040',

      border: '#ffffff',
      borderLight: '#cccccc',
      borderFocus: '#ffff00',

      success: '#00ff00',
      warning: '#ffff00',
      danger: '#ff0000',
      info: '#00ffff',

      codeBg: '#000000',
      codeFg: '#ffffff',
      keyword: '#ffff00',
      string: '#00ff00',
      number: '#ff00ff',
      comment: '#888888',
      function: '#00ffff',
      glow: 'rgba(255, 255, 0, 0.35)',
      selection: 'rgba(255, 255, 0, 0.22)',
    },
    fonts: {
      mono: '"Cascadia Mono", "Consolas", monospace',
      sans: 'system-ui, sans-serif',
      display: '"Cascadia Mono", monospace',
    },
    spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px' },
    borderRadius: { sm: '0', md: '0', lg: '0', full: '0' },
    shadows: { sm: 'none', md: 'none', lg: 'none', xl: 'none' },
    transitions: { fast: '0ms', normal: '0ms', slow: '0ms' },
  },

  // ---------------------------------------------------------------- cipherASCII
  // Gothic Medieval - obsidian, forged iron, parchment, aged gold (#D4AF37)
  {
    id: 'gothic',
    name: 'Gothic Medieval',
    description: 'Obsidian surfaces, forged iron borders, parchment text, aged gold',
    isDark: true,
    colors: {
      bg: '#0a0a0e',
      bgElevated: '#131319',
      bgHover: '#1b1b24',
      bgActive: '#22222d',

      fg: '#e6ddc7',
      fgMuted: '#93897a',
      fgDisabled: '#5c574d',
      fgInverse: '#0a0a0e',

      accent: '#d4af37',
      accentHover: '#e8c65c',
      accentActive: '#b8952c',
      accentMuted: '#d4af3740',

      border: '#2a2a36',
      borderLight: '#4d4a55',
      borderFocus: '#d4af37',

      success: '#7bc47f',
      warning: '#e0b44c',
      danger: '#c94f4f',
      info: '#7fa9d1',

      codeBg: '#08080c',
      codeFg: '#e6ddc7',
      keyword: '#d4af37',
      string: '#a8c98f',
      number: '#e0a0a0',
      comment: '#6f695c',
      function: '#f0d98a',
      glow: 'rgba(212, 175, 55, 0.35)',
      selection: 'rgba(212, 175, 55, 0.22)',
    },
    fonts: {
      mono: '"Cascadia Mono", "Fira Code", "JetBrains Mono", monospace',
      sans: '"Palatino Linotype", Palatino, Georgia, serif',
      display: '"Cinzel", "Palatino Linotype", Georgia, serif',
    },
    spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px' },
    borderRadius: { sm: '2px', md: '4px', lg: '8px', full: '9999px' },
    shadows: {
      sm: '0 1px 2px rgba(0,0,0,0.5)',
      md: '0 4px 6px rgba(0,0,0,0.55)',
      lg: '0 10px 15px rgba(0,0,0,0.6)',
      xl: '0 20px 25px rgba(0,0,0,0.65)',
    },
    transitions: { fast: '100ms ease', normal: '200ms ease', slow: '300ms ease' },
  },

  // Cyber Y2K - chrome on black, neon cyan/magenta, wireframe edges, CRT glow
  {
    id: 'cyber',
    name: 'Cyber Y2K',
    description: 'Chrome on black, neon cyan and magenta, wireframe edges, CRT glow',
    isDark: true,
    colors: {
      bg: '#05070d',
      bgElevated: '#0a0e18',
      bgHover: '#101827',
      bgActive: '#16223a',

      fg: '#d9fbff',
      fgMuted: '#6d8ba6',
      fgDisabled: '#3d5062',
      fgInverse: '#04121a',

      accent: '#00f0ff',
      accentHover: '#6df7ff',
      accentActive: '#00c2d1',
      accentMuted: '#00f0ff40',

      border: '#1e2a40',
      borderLight: '#38507a',
      borderFocus: '#00f0ff',

      success: '#39ff9a',
      warning: '#ffe14d',
      danger: '#ff35d3',
      info: '#7a5cff',

      codeBg: '#04060c',
      codeFg: '#d9fbff',
      keyword: '#00f0ff',
      string: '#ff35d3',
      number: '#ffe14d',
      comment: '#4f6a80',
      function: '#7a5cff',
      glow: 'rgba(0, 240, 255, 0.45)',
      selection: 'rgba(255, 53, 211, 0.28)',
    },
    fonts: {
      mono: '"Cascadia Mono", "Fira Code", "JetBrains Mono", monospace',
      sans: '"Segoe UI", system-ui, -apple-system, sans-serif',
      display: '"Eurostile", "Bank Gothic", "Segoe UI", system-ui, sans-serif',
    },
    spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px' },
    borderRadius: { sm: '0', md: '2px', lg: '4px', full: '9999px' },
    shadows: {
      sm: '0 1px 2px rgba(0,240,255,0.25)',
      md: '0 4px 10px rgba(0,240,255,0.25)',
      lg: '0 10px 20px rgba(255,53,211,0.25)',
      xl: '0 20px 40px rgba(0,240,255,0.3)',
    },
    transitions: { fast: '90ms linear', normal: '180ms linear', slow: '280ms linear' },
  },

  // Cozy Cafe French - cream, sepia shadows, serif headers, espresso controls
  {
    id: 'cafe',
    name: 'Cozy Cafe French',
    description: 'Cream and beige, sepia shadows, elegant serif headers, espresso UI',
    isDark: false,
    colors: {
      bg: '#f2e8d5',
      bgElevated: '#fbf5e9',
      bgHover: '#ece0c9',
      bgActive: '#e3d4b8',

      fg: '#3a2c21',
      fgMuted: '#8a755c',
      fgDisabled: '#b6a68f',
      fgInverse: '#fff8ec',

      accent: '#a9744f',
      accentHover: '#bd8660',
      accentActive: '#945f3d',
      accentMuted: '#a9744f40',

      border: '#d3c0a2',
      borderLight: '#e2d3ba',
      borderFocus: '#a9744f',

      success: '#6d8a63',
      warning: '#c98a3c',
      danger: '#b4523f',
      info: '#5c7f9e',

      codeBg: '#efe4d0',
      codeFg: '#3a2c21',
      keyword: '#a9744f',
      string: '#6d8a63',
      number: '#b4523f',
      comment: '#a08d74',
      function: '#5c7f9e',
      glow: 'rgba(169, 116, 79, 0.30)',
      selection: 'rgba(169, 116, 79, 0.18)',
    },
    fonts: {
      mono: '"Cascadia Mono", "Fira Code", "JetBrains Mono", monospace',
      sans: 'Georgia, "Times New Roman", serif',
      display: '"Playfair Display", Georgia, "Times New Roman", serif',
    },
    spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px' },
    borderRadius: { sm: '4px', md: '8px', lg: '14px', full: '9999px' },
    shadows: {
      sm: '0 1px 2px rgba(120, 96, 64, 0.25)',
      md: '0 4px 8px rgba(120, 96, 64, 0.25)',
      lg: '0 10px 18px rgba(120, 96, 64, 0.28)',
      xl: '0 20px 30px rgba(120, 96, 64, 0.3)',
    },
    transitions: { fast: '140ms ease', normal: '240ms ease', slow: '360ms ease' },
  },

  // Zelda / RPG - ancient stone, Sheikah blue, Triforce gold, carved borders
  {
    id: 'zelda',
    name: 'Zelda / RPG',
    description: 'Ancient stone, Sheikah-blue glow, Triforce gold, fantasy borders',
    isDark: true,
    colors: {
      bg: '#0c1014',
      bgElevated: '#16202a',
      bgHover: '#1c2a37',
      bgActive: '#243444',

      fg: '#e2ecf2',
      fgMuted: '#8695a3',
      fgDisabled: '#4d5a66',
      fgInverse: '#0c1014',

      accent: '#e6b74a',
      accentHover: '#f2cb6c',
      accentActive: '#cfa238',
      accentMuted: '#e6b74a40',

      border: '#26333f',
      borderLight: '#45566a',
      borderFocus: '#39d8ff',

      success: '#7fd08a',
      warning: '#e6b74a',
      danger: '#e06a4e',
      info: '#39d8ff',

      codeBg: '#0a0e12',
      codeFg: '#e2ecf2',
      keyword: '#39d8ff',
      string: '#9fe08a',
      number: '#e6b74a',
      comment: '#5c6b78',
      function: '#f2cb6c',
      glow: 'rgba(57, 216, 255, 0.42)',
      selection: 'rgba(230, 183, 74, 0.24)',
    },
    fonts: {
      mono: '"Cascadia Mono", "Fira Code", "JetBrains Mono", monospace',
      sans: '"Segoe UI", system-ui, -apple-system, sans-serif',
      display: '"Cinzel", "Trajan Pro", "Times New Roman", Georgia, serif',
    },
    spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px' },
    borderRadius: { sm: '2px', md: '4px', lg: '10px', full: '9999px' },
    shadows: {
      sm: '0 1px 2px rgba(0,0,0,0.45)',
      md: '0 4px 8px rgba(0,0,0,0.5)',
      lg: '0 10px 18px rgba(57, 216, 255, 0.2)',
      xl: '0 20px 34px rgba(0,0,0,0.6)',
    },
    transitions: { fast: '120ms ease', normal: '220ms ease', slow: '340ms ease' },
  },
];

export const THEME_IDS = THEME_PRESETS.map((t) => t.id);

export function getTheme(id: string): Theme | undefined {
  return THEME_PRESETS.find((t) => t.id === id);
}

export function createCustomTheme(base: Theme, overrides: Partial<Theme>): Theme {
  return {
    ...base,
    ...overrides,
    id: `custom_${Date.now()}`,
    colors: { ...base.colors, ...overrides.colors },
    fonts: { ...base.fonts, ...overrides.fonts },
    spacing: { ...base.spacing, ...overrides.spacing },
    borderRadius: { ...base.borderRadius, ...overrides.borderRadius },
    shadows: { ...base.shadows, ...overrides.shadows },
    transitions: { ...base.transitions, ...overrides.transitions },
  };
}

export function generateCSSVariables(theme: Theme): string {
  const { colors, fonts, spacing, borderRadius, shadows, transitions } = theme;
  const lines: string[] = [':root {'];

  // Colors
  for (const [key, value] of Object.entries(colors)) {
    lines.push(`  --color-${kebabCase(key)}: ${value};`);
  }

  // Legacy aliases used directly by styles.css (kept in sync so themes
  // actually restyle the app rather than only exposing --color-* names).
  const aliases: Array<[keyof ThemeColors, string]> = [
    ['bg', '--bg'],
    ['bgElevated', '--bg-elevated'],
    ['bgHover', '--bg-hover'],
    ['bgActive', '--bg-active'],
    ['fg', '--fg'],
    ['fgMuted', '--fg-muted'],
    ['fgDisabled', '--fg-disabled'],
    ['accent', '--accent'],
    ['accentHover', '--accent-hover'],
    ['accentActive', '--accent-active'],
    ['border', '--border'],
    ['borderFocus', '--border-focus'],
    ['success', '--success'],
    ['warning', '--warning'],
    ['danger', '--danger'],
    ['info', '--info'],
    ['codeBg', '--code-bg'],
    ['codeFg', '--code-fg'],
    ['glow', '--glow'],
    ['selection', '--selection'],
  ];
  for (const [key, cssVar] of aliases) {
    const value = colors[key];
    if (value) lines.push(`  ${cssVar}: ${value};`);
  }

  // Fonts
  lines.push(`  --font-mono: ${fonts.mono};`);
  lines.push(`  --font-sans: ${fonts.sans};`);
  if (fonts.display) lines.push(`  --font-display: ${fonts.display};`);

  // Spacing
  for (const [key, value] of Object.entries(spacing)) {
    lines.push(`  --space-${key}: ${value};`);
  }

  // Border radius
  for (const [key, value] of Object.entries(borderRadius)) {
    lines.push(`  --radius-${key}: ${value};`);
  }

  // Shadows
  for (const [key, value] of Object.entries(shadows)) {
    lines.push(`  --shadow-${key}: ${value};`);
  }

  // Transitions
  for (const [key, value] of Object.entries(transitions)) {
    lines.push(`  --transition-${key}: ${value};`);
  }

  lines.push('}');
  return lines.join('\n');
}

function kebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

export function applyTheme(theme: Theme): void {
  const css = generateCSSVariables(theme);
  let style = document.getElementById('theme-variables');
  if (!style) {
    style = document.createElement('style');
    style.id = 'theme-variables';
    document.head.appendChild(style);
  }
  style.textContent = css;
  document.documentElement.setAttribute('data-theme', theme.id);
  document.documentElement.setAttribute('data-theme-dark', theme.isDark.toString());
}

export function getDefaultTheme(): Theme {
  return THEME_PRESETS[0]; // Medieval as default (Script Slayer inspired)
}