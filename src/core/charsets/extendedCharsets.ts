/**
 * Extended character sets for Script Slayer-style ASCII art.
 * 48+ character sets across 11 categories with live preview support.
 */

import type { CharsetDescription } from '../mapping';
import { UNICODE_CHARSET_PRESETS } from './unicodeCharsets';

export const EXTENDED_CHARSET_PRESETS: CharsetDescription[] = [
  // Classic ASCII (5 sets)
  {
    id: 'classic-standard',
    label: 'Classic Standard',
    category: 'classic',
    chars: '@%#*+=-:. ',
    description: 'The classic 10-level ASCII ramp.',
  },
  {
    id: 'classic-dense',
    label: 'Classic Dense',
    category: 'classic',
    chars: '@%#WM8&0Oox?~:;=+-. ',
    description: 'Denser mid-tones for photographic output.',
  },
  {
    id: 'classic-fine',
    label: 'Classic Fine',
    category: 'classic',
    chars: "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,^`'. ",
    description: '70-level ramp for maximum tonal resolution.',
  },
  {
    id: 'classic-minimal',
    label: 'Classic Minimal',
    category: 'classic',
    chars: '#. ',
    description: 'Three levels: strong, light, empty.',
  },
  {
    id: 'classic-binary',
    label: 'Classic Binary',
    category: 'classic',
    chars: '# ',
    description: 'Hard black and white only.',
  },

  // Block Elements (5 sets)
  {
    id: 'blocks-standard',
    label: 'Blocks Standard',
    category: 'blocks',
    chars: '█▓▒░ ',
    description: 'Unicode shade blocks; reads well in modern terminals.',
  },
  {
    id: 'blocks-half',
    label: 'Half Blocks',
    category: 'blocks',
    chars: '█▓▒░',
    description: 'Four-level block ramp without a blank cell.',
  },
  {
    id: 'blocks-lower',
    label: 'Lower Blocks',
    category: 'blocks',
    chars: '▁▂▃▄▅▆▇█',
    description: 'Lower block elements for horizontal bars.',
  },
  {
    id: 'blocks-upper',
    label: 'Upper Blocks',
    category: 'blocks',
    chars: '▏▎▍▌▋▊▉█',
    description: 'Vertical block elements for vertical bars.',
  },
  {
    id: 'blocks-quadrant',
    label: 'Quadrant Blocks',
    category: 'blocks',
    chars: '█▛▜▙▟▚▞▗▖▘▝',
    description: 'Quadrant block elements for fine detail.',
  },

  // Braille (4 sets)
  {
    id: 'braille-fill',
    label: 'Braille Fill',
    category: 'braille',
    chars: '⣿⣶⣦⣤⣄⣀⠀ ',
    description: 'Braille density ramp for braille render mode.',
  },
  {
    id: 'braille-patterns',
    label: 'Braille Patterns',
    category: 'braille',
    chars: '⠁⠃⠇⠏⠟⠿⡿⣿',
    description: 'Braille pattern progression.',
  },
  {
    id: 'braille-dots',
    label: 'Braille Dots',
    category: 'braille',
    chars: '⠁⠂⠄⠈⠐⠠⡀⢀',
    description: 'Individual braille dots for dot-matrix style.',
  },
  {
    id: 'braille-art',
    label: 'Braille Art',
    category: 'braille',
    chars: '⠀⠁⠂⠃⠄⠅⠆⠇⠈⠉⠊⠋⠌⠍⠎⠏⠐⠑⠒⠓⠔⠕⠖⠗⠘⠙⠚⠛⠜⠝⠞⠟⠠⠡⠢⠣⠤⠥⠦⠧⠨⠩⠪⠫⠬⠭⠮⠯⠰⠱⠲⠳⠴⠵⠶⠷⠸⠹⠺⠻⠼⠽⠾⠿',
    description: 'Full braille pattern set for detailed art.',
  },

  // Symbols & Geometric (5 sets)
  {
    id: 'symbols-quadrant',
    label: 'Quadrant Marks',
    category: 'symbols',
    chars: '▞▌▐▚▘▝▖▗ ',
    description: 'Sparse quadrant glyphs for a mosaic look.',
  },
  {
    id: 'symbols-dots',
    label: 'Dots',
    category: 'symbols',
    chars: '@0Oo*:·. ',
    description: 'Soft dot ramp; good for low-contrast images.',
  },
  {
    id: 'symbols-punct',
    label: 'Punctuation',
    category: 'symbols',
    chars: '@80GCLft1i;:,. ',
    description: 'Tom Thumb-inspired punctuation ramp.',
  },
  {
    id: 'symbols-arrows',
    label: 'Arrows',
    category: 'symbols',
    chars: '▲▶▼◀◆◇○●□■△▽',
    description: 'Directional arrow symbols for flow visualization.',
  },
  {
    id: 'symbols-math',
    label: 'Mathematical',
    category: 'symbols',
    chars: '∑∏∫∂∇∆∞≈≠≤≥±×÷√∝',
    description: 'Mathematical symbols for technical aesthetics.',
  },

  // Numeric (3 sets)
  {
    id: 'numeric-standard',
    label: 'Numeric Standard',
    category: 'numeric',
    chars: '0123456789',
    description: 'Digit ramp for a data/terminal aesthetic.',
  },
  {
    id: 'numeric-hex',
    label: 'Hexadecimal',
    category: 'numeric',
    chars: '0123456789ABCDEF',
    description: 'Hexadecimal digit ramp.',
  },
  {
    id: 'numeric-binary',
    label: 'Binary Visual',
    category: 'numeric',
    chars: '01',
    description: 'Binary visual representation.',
  },

  // Languages (4 sets)
  {
    id: 'lang-greek',
    label: 'Greek',
    category: 'languages',
    chars: 'ΩΨΦΧΞΠΟΝΜΛΚΙΘΗΖΕΔΓΒΑωψφχξπονμλκιθηζεδγβα',
    description: 'Greek alphabet for classical aesthetic.',
  },
  {
    id: 'lang-cyrillic',
    label: 'Cyrillic',
    category: 'languages',
    chars: 'ЯЮЭЪЫЬШЩЧЦХФУТСРПОНМЛКЙИЗЖЕДГВБАяюэъыьшщчцхфутсрпонмлкйизжедгвба',
    description: 'Cyrillic alphabet for eastern aesthetic.',
  },
  {
    id: 'lang-hebrew',
    label: 'Hebrew',
    category: 'languages',
    chars: 'תשרקצפעסנמלכיטחזוהדגבא',
    description: 'Hebrew alphabet for traditional aesthetic.',
  },
  {
    id: 'lang-ipa',
    label: 'IPA Phonetic',
    category: 'languages',
    chars: 'ɐʌʊɔɑɒæɜɞəɛɘɵʉɯœɤøʏɪi',
    description: 'International Phonetic Alphabet symbols.',
  },

  // Cards & Games (3 sets)
  {
    id: 'cards-suits',
    label: 'Card Suits',
    category: 'cards',
    chars: '♠♥♦♣',
    description: 'Playing card suits.',
  },
  {
    id: 'cards-faces',
    label: 'Card Faces',
    category: 'cards',
    chars: 'A23456789JQK',
    description: 'Playing card face values.',
  },
  {
    id: 'dice',
    label: 'Dice Faces',
    category: 'cards',
    chars: '⚀⚁⚂⚃⚄⚅',
    description: 'Six-sided dice faces.',
  },

  // Unicode Box Drawing (4 sets)
  {
    id: 'box-single',
    label: 'Box Single',
    category: 'box',
    chars: '┌┐└┘├┤┬┴┼─│',
    description: 'Single line box drawing characters.',
  },
  {
    id: 'box-double',
    label: 'Box Double',
    category: 'box',
    chars: '╔╗╚╝╠╣╦╩╬═║',
    description: 'Double line box drawing characters.',
  },
  {
    id: 'box-rounded',
    label: 'Box Rounded',
    category: 'box',
    chars: '╭╮╰╯├┤┬┴┼─│',
    description: 'Rounded corner box drawing.',
  },
  {
    id: 'box-heavy',
    label: 'Box Heavy',
    category: 'box',
    chars: '┏┓┗┛┣┫┳┻╋━┃',
    description: 'Heavy/thick box drawing characters.',
  },

  // Shapes & Geometric (4 sets)
  {
    id: 'shapes-circles',
    label: 'Circles',
    category: 'shapes',
    chars: '⬤●◉⦿⭘◎○',
    description: 'Circle and dot variations.',
  },
  {
    id: 'shapes-squares',
    label: 'Squares',
    category: 'shapes',
    chars: '■□▨▧▩▦▤▥',
    description: 'Square and rectangle variations.',
  },
  {
    id: 'shapes-triangles',
    label: 'Triangles',
    category: 'shapes',
    chars: '◆▲▼▶◀◇△▽▷◁',
    description: 'Triangle and diamond variations.',
  },
  {
    id: 'shapes-stars',
    label: 'Stars',
    category: 'shapes',
    chars: '★☆✦✧✩✪✫✬✭✮✯',
    description: 'Star and asterisk variations.',
  },

  // Special Effects (5 sets)
  {
    id: 'fx-noise',
    label: 'Noise',
    category: 'effects',
    chars: '█▇▓▆▅▄▒▃▂░▁',
    description: 'Noise texture progression.',
  },
  {
    id: 'fx-scanlines',
    label: 'Scanlines',
    category: 'effects',
    chars: '█▇▆▅▄▃▂▁',
    description: 'CRT scanline effect.',
  },
  {
    id: 'fx-dither',
    label: 'Dither Pattern',
    category: 'effects',
    chars: '▌▐▀▄█ ',
    description: 'Ordered dither pattern characters.',
  },
  {
    id: 'fx-glitch',
    label: 'Glitch',
    category: 'effects',
    chars: '█▓▌▐▀▄▒░',
    description: 'Glitch art character set.',
  },
  {
    id: 'fx-wave',
    label: 'Wave',
    category: 'effects',
    chars: '≋≈≃∼∽∾∿',
    description: 'Wave and oscillation patterns.',
  },

  // Custom Injection Support (1 set + API)
  {
    id: 'custom-injection',
    label: 'Custom Injection (10 chars)',
    category: 'custom',
    chars: '█▓▒░▁▂▃▄▅▆',
    description: 'Template for custom 10-character injection.',
  },
];

/**
 * Hand-written presets plus the generated Unicode library. Together these are
 * what the Character Set dropdown, the mapping engine and the exporters see.
 */
export const ALL_CHARSET_PRESETS: CharsetDescription[] = [
  ...EXTENDED_CHARSET_PRESETS,
  ...UNICODE_CHARSET_PRESETS,
];

export const CHARSET_CATEGORIES = [
  'classic',
  'blocks',
  'braille',
  'symbols',
  'numeric',
  'languages',
  'cards',
  'box',
  'shapes',
  'effects',
  'arrows',
  'math',
  'technical',
  'dingbats',
  'typography',
  'custom',
] as const;

export type CharsetCategory = typeof CHARSET_CATEGORIES[number];

export function getCharsetsByCategory(category: CharsetCategory): CharsetDescription[] {
  return ALL_CHARSET_PRESETS.filter((c) => c.category === category);
}

export function getCharsetById(id: string): CharsetDescription | undefined {
  return ALL_CHARSET_PRESETS.find((c) => c.id === id);
}

export function validateCustomCharset(chars: string): { ok: boolean; message?: string; normalized: string } {
  if (chars.length === 0) return { ok: false, message: 'Custom charset must contain at least 1 character.', normalized: '' };
  if (chars.length > 256) return { ok: false, message: 'Custom charset limited to 256 characters.', normalized: chars.slice(0, 256) };
  for (const ch of chars) {
    const code = ch.codePointAt(0)!;
    if (code < 32 || (code >= 0x7f && code <= 0x9f)) {
      return { ok: false, message: 'Control characters not allowed in custom charset.', normalized: chars };
    }
  }
  return { ok: true, normalized: chars };
}