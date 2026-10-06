// @ts-nocheck - palette helpers predate strict typing (legacy quantizer code)
/**
 * Palette System - color palette extraction, mapping, and management.
 *
 * Supports: automatic extraction from images, manual creation,
 * palette mapping (color quantization), palette sharing, import/export.
 */

import type { Raster } from '../types';

export interface PaletteColor {
  rgb: number;        // 0xRRGGBB
  name?: string;
  locked?: boolean;   // protected from auto-removal
}

export interface Palette {
  id: string;
  name: string;
  colors: PaletteColor[];
  description?: string;
  source?: 'auto' | 'manual' | 'imported';
  createdAt: string;
  updatedAt: string;
}

export const PRESET_PALETTES: Palette[] = [
  {
    id: 'ditherboy-default',
    name: 'Dither Boy Default',
    colors: [
      { rgb: 0x000000, name: 'Black' },
      { rgb: 0x1d2b53, name: 'Dark Blue' },
      { rgb: 0x7e2553, name: 'Dark Purple' },
      { rgb: 0x008751, name: 'Dark Green' },
      { rgb: 0xab5236, name: 'Brown' },
      { rgb: 0x5f574f, name: 'Dark Gray' },
      { rgb: 0xc2c3c7, name: 'Light Gray' },
      { rgb: 0xfff1e8, name: 'Off White' },
      { rgb: 0xff004d, name: 'Red' },
      { rgb: 0xffa300, name: 'Orange' },
      { rgb: 0xffec27, name: 'Yellow' },
      { rgb: 0x00e436, name: 'Green' },
      { rgb: 0x29adff, name: 'Blue' },
      { rgb: 0x83769c, name: 'Lavender' },
      { rgb: 0xff77a8, name: 'Pink' },
      { rgb: 0xffccaa, name: 'Peach' },
    ],
    description: 'Classic 16-color Dither Boy palette',
    source: 'manual',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'cga',
    name: 'CGA 4-Color',
    colors: [
      { rgb: 0x000000, name: 'Black' },
      { rgb: 0x00aaaa, name: 'Cyan' },
      { rgb: 0xaa00aa, name: 'Magenta' },
      { rgb: 0xaaaaaa, name: 'White' },
    ],
    description: 'Classic CGA palette (mode 4/5)',
    source: 'manual',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'ega',
    name: 'EGA 16-Color',
    colors: [
      { rgb: 0x000000, name: 'Black' },
      { rgb: 0x0000aa, name: 'Blue' },
      { rgb: 0x00aa00, name: 'Green' },
      { rgb: 0x00aaaa, name: 'Cyan' },
      { rgb: 0xaa0000, name: 'Red' },
      { rgb: 0xaa00aa, name: 'Magenta' },
      { rgb: 0xaa5500, name: 'Brown' },
      { rgb: 0xaaaaaa, name: 'Light Gray' },
      { rgb: 0x555555, name: 'Dark Gray' },
      { rgb: 0x5555ff, name: 'Light Blue' },
      { rgb: 0x55ff55, name: 'Light Green' },
      { rgb: 0x55ffff, name: 'Light Cyan' },
      { rgb: 0xff5555, name: 'Light Red' },
      { rgb: 0xff55ff, name: 'Light Magenta' },
      { rgb: 0xffff55, name: 'Yellow' },
      { rgb: 0xffffff, name: 'White' },
    ],
    description: 'Enhanced Graphics Adapter 16-color palette',
    source: 'manual',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'vga',
    name: 'VGA 256-Color (First 16)',
    colors: [
      { rgb: 0x000000, name: 'Black' },
      { rgb: 0x800000, name: 'Maroon' },
      { rgb: 0x008000, name: 'Green' },
      { rgb: 0x808000, name: 'Olive' },
      { rgb: 0x000080, name: 'Navy' },
      { rgb: 0x800080, name: 'Purple' },
      { rgb: 0x008080, name: 'Teal' },
      { rgb: 0xc0c0c0, name: 'Silver' },
      { rgb: 0x808080, name: 'Gray' },
      { rgb: 0xff0000, name: 'Red' },
      { rgb: 0x00ff00, name: 'Lime' },
      { rgb: 0xffff00, name: 'Yellow' },
      { rgb: 0x0000ff, name: 'Blue' },
      { rgb: 0xff00ff, name: 'Fuchsia' },
      { rgb: 0x00ffff, name: 'Aqua' },
      { rgb: 0xffffff, name: 'White' },
    ],
    description: 'Standard VGA 256-color palette (first 16)',
    source: 'manual',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'gameboy',
    name: 'Game Boy',
    colors: [
      { rgb: 0x0f380f, name: 'Darkest' },
      { rgb: 0x306230, name: 'Dark' },
      { rgb: 0x8bac0f, name: 'Light' },
      { rgb: 0x9bbc0f, name: 'Lightest' },
    ],
    description: 'Original Game Boy 4-shade green palette',
    source: 'manual',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'pico8',
    name: 'PICO-8',
    colors: [
      { rgb: 0x000000, name: 'Black' },
      { rgb: 0x1d2b53, name: 'Dark Blue' },
      { rgb: 0x7e2553, name: 'Dark Purple' },
      { rgb: 0x008751, name: 'Dark Green' },
      { rgb: 0xab5236, name: 'Brown' },
      { rgb: 0x5f574f, name: 'Dark Gray' },
      { rgb: 0xc2c3c7, name: 'Light Gray' },
      { rgb: 0xfff1e8, name: 'White' },
      { rgb: 0xff004d, name: 'Red' },
      { rgb: 0xffa300, name: 'Orange' },
      { rgb: 0xffec27, name: 'Yellow' },
      { rgb: 0x00e436, name: 'Green' },
      { rgb: 0x29adff, name: 'Blue' },
      { rgb: 0x83769c, name: 'Lavender' },
      { rgb: 0xff77a8, name: 'Pink' },
      { rgb: 0xffccaa, name: 'Peach' },
    ],
    description: 'PICO-8 fantasy console palette',
    source: 'manual',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'apollo',
    name: 'Apollo',
    colors: [
      { rgb: 0x000000, name: 'Black' },
      { rgb: 0x2b2b2b, name: 'Dark Gray' },
      { rgb: 0x555555, name: 'Medium Gray' },
      { rgb: 0x888888, name: 'Light Gray' },
      { rgb: 0xaaaaaa, name: 'Lighter Gray' },
      { rgb: 0xcccccc, name: 'Light Gray' },
      { rgb: 0xeeeeee, name: 'Off White' },
      { rgb: 0xffffff, name: 'White' },
    ],
    description: 'Grayscale Apollo palette for clean monochrome',
    source: 'manual',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'c64',
    name: 'Commodore 64',
    colors: [
      { rgb: 0x000000, name: 'Black' },
      { rgb: 0xffffff, name: 'White' },
      { rgb: 0x880000, name: 'Red' },
      { rgb: 0xaaffee, name: 'Cyan' },
      { rgb: 0xcc44cc, name: 'Purple' },
      { rgb: 0x00cc55, name: 'Green' },
      { rgb: 0x0000aa, name: 'Blue' },
      { rgb: 0xeeee77, name: 'Yellow' },
      { rgb: 0xdd8855, name: 'Orange' },
      { rgb: 0x664400, name: 'Brown' },
      { rgb: 0xff7777, name: 'Light Red' },
      { rgb: 0x333333, name: 'Dark Gray' },
      { rgb: 0x777777, name: 'Medium Gray' },
      { rgb: 0xaaff66, name: 'Light Green' },
      { rgb: 0x0088ff, name: 'Light Blue' },
      { rgb: 0xbbbbbb, name: 'Light Gray' },
    ],
    description: 'Commodore 64 16-color palette',
    source: 'manual',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'zx-spectrum',
    name: 'ZX Spectrum',
    colors: [
      { rgb: 0x000000, name: 'Black' },
      { rgb: 0x0000d7, name: 'Blue' },
      { rgb: 0xd70000, name: 'Red' },
      { rgb: 0xd700d7, name: 'Magenta' },
      { rgb: 0x00d700, name: 'Green' },
      { rgb: 0x00d7d7, name: 'Cyan' },
      { rgb: 0xd7d700, name: 'Yellow' },
      { rgb: 0xd7d7d7, name: 'White' },
      { rgb: 0x000000, name: 'Bright Black' },
      { rgb: 0x0000ff, name: 'Bright Blue' },
      { rgb: 0xff0000, name: 'Bright Red' },
      { rgb: 0xff00ff, name: 'Bright Magenta' },
      { rgb: 0x00ff00, name: 'Bright Green' },
      { rgb: 0x00ffff, name: 'Bright Cyan' },
      { rgb: 0xffff00, name: 'Bright Yellow' },
      { rgb: 0xffffff, name: 'Bright White' },
    ],
    description: 'ZX Spectrum 16-color palette (with bright variants)',
    source: 'manual',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'monochrome-green',
    name: 'Monochrome Green',
    colors: [
      { rgb: 0x000000, name: 'Black' },
      { rgb: 0x001100, name: 'Very Dark' },
      { rgb: 0x002200, name: 'Dark' },
      { rgb: 0x003300, name: 'Dark-Mid' },
      { rgb: 0x004400, name: 'Mid-Dark' },
      { rgb: 0x005500, name: 'Mid' },
      { rgb: 0x006600, name: 'Mid-Light' },
      { rgb: 0x007700, name: 'Light-Mid' },
      { rgb: 0x008800, name: 'Light' },
      { rgb: 0x009900, name: 'Light-Light' },
      { rgb: 0x00aa00, name: 'Lighter' },
      { rgb: 0x00bb00, name: 'Very Light' },
      { rgb: 0x00cc00, name: 'Bright' },
      { rgb: 0x00dd00, name: 'Brighter' },
      { rgb: 0x00ee00, name: 'Very Bright' },
      { rgb: 0x00ff00, name: 'Brightest' },
    ],
    description: 'Amber/monochrome monitor green palette',
    source: 'manual',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'monochrome-amber',
    name: 'Monochrome Amber',
    colors: [
      { rgb: 0x000000, name: 'Black' },
      { rgb: 0x221100, name: 'Very Dark' },
      { rgb: 0x442200, name: 'Dark' },
      { rgb: 0x663300, name: 'Dark-Mid' },
      { rgb: 0x884400, name: 'Mid-Dark' },
      { rgb: 0xaa5500, name: 'Mid' },
      { rgb: 0xcc6600, name: 'Mid-Light' },
      { rgb: 0xee7700, name: 'Light-Mid' },
      { rgb: 0xff8800, name: 'Light' },
      { rgb: 0xff9900, name: 'Light-Light' },
      { rgb: 0xffaa00, name: 'Lighter' },
      { rgb: 0xffbb00, name: 'Very Light' },
      { rgb: 0xffcc00, name: 'Bright' },
      { rgb: 0xffdd00, name: 'Brighter' },
      { rgb: 0xffee00, name: 'Very Bright' },
      { rgb: 0xffff00, name: 'Brightest' },
    ],
    description: 'Classic amber monitor palette',
    source: 'manual',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export interface PaletteExtractionOptions {
  maxColors?: number;
  quality?: number;      // 1-10, higher = slower but better
  includeLocked?: boolean;
  colorSpace?: 'rgb' | 'lab' | 'oklab';
  dithering?: boolean;
}

export function extractPalette(
  raster: Raster,
  options: PaletteExtractionOptions = {},
): Palette {
  const maxColors = Math.min(options.maxColors ?? 256, 256);

  // Simple median-cut quantization for palette extraction
  const colors = new Map<number, number>(); // rgb -> count
  const { width, height, data } = raster;

  // Sample pixels (stride for performance on large images)
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 50000)));
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3];
      if (alpha < 128) continue; // Skip transparent
      const rgb = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      colors.set(rgb, (colors.get(rgb) ?? 0) + 1);
    }
  }

  // Convert to array and sort by frequency
  const colorArray = Array.from(colors.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxColors)
    .map(([rgb]) => ({ rgb }));

  return {
    id: `extracted_${Date.now()}`,
    name: `Extracted (${colorArray.length} colors)`,
    colors: colorArray,
    description: `Auto-extracted from image (${colorArray.length} colors)`,
    source: 'auto',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function mapToPalette(
  raster: Raster,
  palette: Palette,
  _dither: boolean = false,
): Raster {
  const colorArray = palette.colors.map((c) => c.rgb);
  if (colorArray.length === 0) return raster;

  const output = { ...raster, data: new Uint8ClampedArray(raster.data) };
  const { data } = output;

  // Build KD-tree or simple linear search for nearest color
  // For simplicity, using linear search (fine for <= 256 colors)
  function nearestColor(rgb: number): number {
    let best = colorArray[0];
    let bestDist = Infinity;
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;

    for (const c of colorArray) {
      const cr = (c >> 16) & 0xff;
      const cg = (c >> 8) & 0xff;
      const cb = c & 0xff;
      const dr = r - cr;
      const dg = g - cg;
      const db = b - cb;
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
    return best;
  }

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 128) continue;
    const rgb = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    const mapped = nearestColor(rgb);
    data[i] = (mapped >> 16) & 0xff;
    data[i + 1] = (mapped >> 8) & 0xff;
    data[i + 2] = mapped & 0xff;
  }

  return output;
}

export function createPalette(
  name: string,
  colors: PaletteColor[],
  description?: string,
): Palette {
  return {
    id: `palette_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    colors,
    description,
    source: 'manual',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function mergePalettes(
  palettes: Palette[],
  name: string,
): Palette {
  const seen = new Set<number>();
  const colors: PaletteColor[] = [];
  for (const p of palettes) {
    for (const c of p.colors) {
      if (!seen.has(c.rgb)) {
        seen.add(c.rgb);
        colors.push(c);
        if (colors.length >= 256) break;
      }
    }
    if (colors.length >= 256) break;
  }
  return createPalette(name, colors, `Merged from ${palettes.length} palettes`);
}

export function sortPalette(palette: Palette, mode: 'luminance' | 'hue' | 'saturation' | 'frequency' = 'luminance'): Palette {
  const colors = [...palette.colors];
  switch (mode) {
    case 'luminance':
      colors.sort((a, b) => {
        const lumA = luminance(a.rgb);
        const lumB = luminance(b.rgb);
        return lumA - lumB;
      });
      break;
    case 'hue':
      colors.sort((a, b) => hue(a.rgb) - hue(b.rgb));
      break;
    case 'saturation':
      colors.sort((a, b) => saturation(b.rgb) - saturation(a.rgb));
      break;
    case 'frequency':
      // Already sorted by frequency if from extraction
      break;
  }
  return { ...palette, colors, updatedAt: new Date().toISOString() };
}

function luminance(rgb: number): number {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function hue(rgb: number): number {
  const r = ((rgb >> 16) & 0xff) / 255;
  const g = ((rgb >> 8) & 0xff) / 255;
  const b = (rgb & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  return h * 60;
}

function saturation(rgb: number): number {
  const r = ((rgb >> 16) & 0xff) / 255;
  const g = ((rgb >> 8) & 0xff) / 255;
  const b = (rgb & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

export function paletteToCSS(palette: Palette): string {
  return palette.colors.map((c) => `#${c.rgb.toString(16).padStart(6, '0')}`).join(', ');
}

export function paletteToASE(palette: Palette): string {
  // Adobe Swatch Exchange format (simplified)
  // In production, would generate proper binary ASE format
  return palette.colors.map((c) => `#${c.rgb.toString(16).padStart(6, '0')}`).join('\n');
}

export function importPaletteFromText(text: string): Palette {
  const hexColors = text.match(/#[0-9a-fA-F]{6}/g) || [];
  const colors: PaletteColor[] = hexColors.map((hex) => ({
    rgb: parseInt(hex.slice(1), 16),
  }));
  return createPalette('Imported', colors, `Imported ${colors.length} colors`);
}

export function exportPaletteAsText(palette: Palette): string {
  return palette.colors.map((c) => `#${c.rgb.toString(16).padStart(6, '0')}`).join('\n');
}