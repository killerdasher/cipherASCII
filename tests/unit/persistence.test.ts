import { describe, expect, it } from 'vitest';
import { createDocument } from '../../src/core/project/schema';
import { deserializeProject, serializeProject } from '../../src/core/project/serialize';
import { PRESET_PALETTES } from '../../src/core/palette/palette';
import { THEME_PRESETS } from '../../src/core/theme/theme';
import {
  CURRENT_SCHEMA_VERSION,
  type Document,
  type Palette,
  type RenderPreset,
  type Theme,
} from '../../src/core/types';

function roundTrip(doc: Document): Document {
  const result = deserializeProject(serializeProject(doc));
  if (!result.ok) throw new Error(`round-trip failed: ${result.error.message}`);
  return result.value;
}

const samplePalette: Palette = {
  id: 'mine',
  name: 'Mine',
  colors: [
    { rgb: 0x123456, name: 'Teal', locked: true },
    { rgb: 0x000000 },
  ],
  description: 'user palette',
  source: 'manual',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

function samplePreset(doc: Document): RenderPreset {
  return {
    id: 'preset_sample',
    name: 'Sample preset',
    description: '',
    imageSettings: doc.imageSettings,
    textSettings: doc.textSettings,
    exportSettings: doc.exportSettings,
    effectsPipeline: doc.effectsPipeline,
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function sampleCustomTheme(): Theme {
  return {
    ...THEME_PRESETS[0],
    id: 'custom_sample',
    name: 'Sample Custom',
    description: 'user theme',
    colors: { ...THEME_PRESETS[0].colors, bg: '#101010' },
  };
}

describe('schema 4: palettes and themes persist', () => {
  it('round-trips palettes, paletteId, render presets, themeId and custom themes', () => {
    const doc = createDocument();
    const authored: Document = {
      ...doc,
      paletteId: samplePalette.id,
      palettes: [samplePalette, ...doc.palettes],
      renderPresets: [samplePreset(doc)],
      themeId: 'custom_sample',
      customThemes: [sampleCustomTheme()],
    };
    const back = roundTrip(authored);
    expect(back.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(back.palettes).toEqual(authored.palettes);
    expect(back.paletteId).toBe('mine');
    expect(back.renderPresets).toEqual(authored.renderPresets);
    expect(back.themeId).toBe('custom_sample');
    expect(back.customThemes).toEqual(authored.customThemes);
  });

  it('migrates pre-4 documents to preset palettes and no custom themes', () => {
    const legacy = createDocument() as Document & Record<string, unknown>;
    const stripped: Record<string, unknown> = { ...legacy, schemaVersion: 3 };
    delete stripped.palettes;
    delete stripped.customThemes;
    const result = deserializeProject(JSON.stringify(stripped, null, 2));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.value.palettes).toEqual(PRESET_PALETTES);
    expect(result.value.customThemes).toEqual([]);
  });

  it('drops malformed palette entries but keeps the valid ones', () => {
    const doc = createDocument();
    const dirty = {
      ...doc,
      palettes: [
        'not-a-palette',
        { id: '', name: 'no id', colors: [] },
        {
          id: 'ok',
          name: 'Good',
          colors: [{ rgb: 'NaN' }, { rgb: 7.7, name: 'seven' }],
          createdAt: 't0',
        },
      ],
    } as unknown as Document;
    const back = roundTrip(dirty);
    expect(back.palettes).toHaveLength(1);
    expect(back.palettes[0].id).toBe('ok');
    expect(back.palettes[0].colors).toEqual([{ rgb: 7, name: 'seven' }]);
    expect(back.palettes[0].updatedAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('falls back to the presets when every palette entry is malformed', () => {
    const doc = createDocument();
    const dirty = { ...doc, palettes: [{ nope: true }] } as unknown as Document;
    expect(roundTrip(dirty).palettes).toEqual(PRESET_PALETTES);
  });

  it('repairs truncated custom themes onto the default preset and drops duplicates', () => {
    const doc = createDocument();
    const dirty = {
      ...doc,
      customThemes: [
        { id: 'custom_a', name: 'A', colors: { bg: '#101010', fg: 123 } },
        { id: 'custom_a', name: 'Duplicate' },
        { id: 'custom_b' },
      ],
    } as unknown as Document;
    const back = roundTrip(dirty);
    expect(back.customThemes).toHaveLength(1);
    const theme = back.customThemes[0];
    expect(theme.id).toBe('custom_a');
    expect(theme.name).toBe('A');
    expect(theme.colors.bg).toBe('#101010');
    // Non-string garbage and missing fields fall back to the base preset.
    expect(theme.colors.fg).toBe(THEME_PRESETS[0].colors.fg);
    expect(theme.fonts).toEqual(THEME_PRESETS[0].fonts);
    expect(theme.isDark).toBe(THEME_PRESETS[0].isDark);
  });

  it('rejects non-array palettes and customThemes', () => {
    const doc = createDocument() as Document & Record<string, unknown>;
    const bad = { ...doc, palettes: 'presets?' };
    const result = deserializeProject(JSON.stringify(bad, null, 2));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid-project');
    const badTheme = { ...doc, customThemes: {} };
    const result2 = deserializeProject(JSON.stringify(badTheme, null, 2));
    expect(result2.ok).toBe(false);
  });
});
