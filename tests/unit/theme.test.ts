// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  THEME_PRESETS,
  THEME_IDS,
  getTheme,
  generateCSSVariables,
  applyTheme,
} from '../../src/core/theme/theme';

const REQUIRED_COLOR_KEYS = [
  'bg',
  'bgElevated',
  'bgHover',
  'bgActive',
  'fg',
  'fgMuted',
  'fgDisabled',
  'fgInverse',
  'accent',
  'accentHover',
  'accentActive',
  'accentMuted',
  'border',
  'borderLight',
  'borderFocus',
  'success',
  'warning',
  'danger',
  'info',
  'codeBg',
  'codeFg',
  'keyword',
  'string',
  'number',
  'comment',
  'function',
  'glow',
  'selection',
];

describe('theme presets', () => {
  it('ships the six originals plus the four cipher themes', () => {
    expect(THEME_IDS).toEqual([
      'medieval',
      'ditherboy',
      'terminal-green',
      'terminal-amber',
      'light',
      'high-contrast',
      'gothic',
      'cyber',
      'cafe',
      'zelda',
    ]);
  });

  it('every preset defines a complete palette, fonts and metrics', () => {
    for (const theme of THEME_PRESETS) {
      for (const key of REQUIRED_COLOR_KEYS) {
        expect(theme.colors[key as keyof typeof theme.colors], `${theme.id}.${key}`).toBeTruthy();
      }
      expect(theme.fonts.mono, theme.id).toBeTruthy();
      expect(theme.fonts.sans, theme.id).toBeTruthy();
      expect(theme.spacing.md, theme.id).toBeTruthy();
      expect(theme.borderRadius.md, theme.id).toBeTruthy();
      expect(theme.shadows.md, theme.id).toBeTruthy();
      expect(theme.description.length, theme.id).toBeGreaterThan(0);
      expect(typeof theme.isDark, theme.id).toBe('boolean');
    }
  });

  it('gives the four cipher themes their signature accents', () => {
    expect(getTheme('gothic')?.colors.accent).toBe('#d4af37');
    expect(getTheme('cyber')?.colors.accent).toBe('#00f0ff');
    expect(getTheme('cafe')?.colors.accent).toBe('#a9744f');
    expect(getTheme('cafe')?.isDark).toBe(false);
    expect(getTheme('zelda')?.colors.accent).toBe('#e6b74a');
    expect(getTheme('zelda')?.colors.info).toBe('#39d8ff');
  });

  it('publishes glow and selection as CSS custom properties', () => {
    const gothic = generateCSSVariables(getTheme('gothic')!);
    expect(gothic).toContain('--glow: rgba(212, 175, 55, 0.35)');
    expect(gothic).toContain('--selection: rgba(212, 175, 55, 0.22)');
    expect(gothic).toContain('--color-glow: rgba(212, 175, 55, 0.35)');

    for (const theme of THEME_PRESETS) {
      const css = generateCSSVariables(theme);
      expect(css, theme.id).toContain('--glow:');
      expect(css, theme.id).toContain('--selection:');
    }
  });
});

describe('applyTheme', () => {
  it('injects the stylesheet and tags the document', () => {
    const theme = getTheme('cyber')!;
    applyTheme(theme);

    expect(document.documentElement.getAttribute('data-theme')).toBe('cyber');
    expect(document.documentElement.getAttribute('data-theme-dark')).toBe('true');
    const style = document.getElementById('theme-variables');
    expect(style?.textContent).toContain('#00f0ff');
    expect(style?.textContent).toContain('--glow: rgba(0, 240, 255, 0.45)');
  });
});
