/**
 * Unicode character library.
 *
 * Presets are derived from contiguous Unicode blocks rather than thousands of
 * hand-copied literals, which keeps the source auditable and guarantees the
 * pool stays deterministic. Every preset is exposed through the same
 * `CharsetDescription` shape as the hand-written sets, so the UI, the mapping
 * engine and the export pipeline treat them identically.
 *
 * Ramps that are meant to carry tone (shades, braille density) are ordered
 * DARK -> LIGHT; the rest are symbol collections and say so in their
 * description.
 */

import type { CharsetDescription } from '../mapping';
import type { CharsetCategory } from './extendedCharsets';

/** Inclusive code-point range, skipping nothing (ranges chosen are printable). */
function range(start: number, end: number): string {
  let out = '';
  for (let cp = start; cp <= end; cp++) out += String.fromCodePoint(cp);
  return out;
}

/** Build a string from an ordered list of code points, dropping duplicates. */
function unique(codePoints: readonly number[]): string {
  const seen = new Set<number>();
  const out: string[] = [];
  for (const cp of codePoints) {
    if (seen.has(cp)) continue;
    seen.add(cp);
    out.push(String.fromCodePoint(cp));
  }
  return out.join('');
}

function block(
  id: string,
  label: string,
  category: CharsetCategory,
  chars: string,
  description: string,
): CharsetDescription {
  return { id, label, category, chars, description };
}

/** Number of set dots in a braille cell - used as an ink-density proxy. */
function dotCount(cp: number): number {
  const mask = cp - 0x2800;
  let count = 0;
  for (let bit = 0; bit < 8; bit++) if (mask & (1 << bit)) count++;
  return count;
}

/**
 * Braille patterns ordered dark -> light by dot count, so the set works as a
 * genuine tonal ramp instead of a code-point dump.
 */
function brailleByDensity(): string {
  const cps: number[] = [];
  for (let cp = 0x2800; cp <= 0x28ff; cp++) cps.push(cp);
  cps.sort((a, b) => dotCount(b) - dotCount(a) || a - b);
  return cps.map((cp) => String.fromCodePoint(cp)).join('');
}

/** Block elements sorted by how much ink they cover, dark -> light. */
const BLOCK_DENSITY = unique([
  0x2588, // full
  0x2593, // dark shade
  0x2592, // medium shade
  0x2591, // light shade
  0x2589, 0x258a, 0x258b, 0x258c, 0x258d, 0x258e, 0x258f, // 7/8 .. 1/8 left
  0x2580, // upper half
  0x2584, // lower half
  0x2582, 0x2583, 0x2585, 0x2586, 0x2587, // lower 1/4 .. 7/8
  0x2581, // lower 1/8
  0x2594, // upper 1/8
  0x2595, // right 1/8
  0x2590, // right half
  0x2596, 0x2597, 0x2598, 0x2599, 0x259a, 0x259b, 0x259c, 0x259d, 0x259e, 0x259f, // quadrants
  0x2596, 0x2597, 0x2598, 0x2599, 0x259a, 0x259b, 0x259c, 0x259d, 0x259e, 0x259f,
]);

export const UNICODE_CHARSET_PRESETS: CharsetDescription[] = [
  // ---------------------------------------------------------------- box drawing
  block(
    'box-grid-full',
    'Box Drawing - Complete',
    'box',
    range(0x2500, 0x257f),
    'All 128 box-drawing characters: light, heavy, double and mixed junctions.',
  ),
  block(
    'box-light-lines',
    'Box Drawing - Light Lines',
    'box',
    range(0x2500, 0x254b),
    'Light and light/heavy line set for thin frames and tables.',
  ),
  block(
    'box-double-lines',
    'Box Drawing - Double Lines',
    'box',
    range(0x2550, 0x256c),
    'Double-line frames, corners and tees.',
  ),
  block(
    'box-corners',
    'Box Drawing - Corners & Tees',
    'box',
    unique([
      0x250c, 0x2510, 0x2514, 0x2518, 0x2502, 0x2500, 0x251c, 0x2524, 0x252c, 0x2534,
      0x253c, 0x250f, 0x2513, 0x2517, 0x251b, 0x2503, 0x2501, 0x2523, 0x252b, 0x2533,
      0x253b, 0x254b, 0x2560, 0x2563, 0x2566, 0x2569, 0x256c, 0x2554, 0x2557, 0x255a,
      0x255d, 0x2551, 0x2550, 0x255e, 0x2561, 0x2564, 0x2567, 0x256a,
    ]),
    'Corners, tees and crosses only - the structural half of the box alphabet.',
  ),

  // ---------------------------------------------------------------- block elements
  block(
    'blocks-density',
    'Blocks - Density Ramp',
    'blocks',
    BLOCK_DENSITY,
    'Block elements ordered DARK -> LIGHT by ink coverage; usable as a ramp.',
  ),
  block(
    'blocks-all',
    'Blocks - Complete Table',
    'blocks',
    range(0x2580, 0x259f),
    'All 32 block elements including every quadrant combination.',
  ),

  // ---------------------------------------------------------------- braille
  block(
    'braille-density',
    'Braille - Density Ramp (256)',
    'braille',
    brailleByDensity(),
    'All 256 braille cells ordered by dot count, darkest first: a real tonal ramp.',
  ),
  block(
    'braille-heavy',
    'Braille - Heavy (6-8 dots)',
    'braille',
    (() => {
      const cps: number[] = [];
      for (let cp = 0x2800; cp <= 0x28ff; cp++) if (dotCount(cp) >= 6) cps.push(cp);
      cps.sort((a, b) => dotCount(b) - dotCount(a) || a - b);
      return cps.map((cp) => String.fromCodePoint(cp)).join('');
    })(),
    'High-ink braille cells for dense, dark output.',
  ),
  block(
    'braille-light',
    'Braille - Light (1-3 dots)',
    'braille',
    (() => {
      const cps: number[] = [];
      for (let cp = 0x2800; cp <= 0x28ff; cp++) {
        const n = dotCount(cp);
        if (n >= 1 && n <= 3) cps.push(cp);
      }
      cps.sort((a, b) => dotCount(b) - dotCount(a) || a - b);
      return cps.map((cp) => String.fromCodePoint(cp)).join('');
    })(),
    'Sparse braille cells for airy, light output.',
  ),

  // ---------------------------------------------------------------- geometric shapes
  block(
    'shapes-geometric',
    'Geometric Shapes - Complete',
    'shapes',
    range(0x25a0, 0x25ff),
    'All 96 geometric shapes: squares, circles, triangles, diamonds, stars.',
  ),
  block(
    'shapes-squares-circles',
    'Geometric - Squares & Circles',
    'shapes',
    range(0x25a0, 0x25d7),
    'Filled and outlined squares, circles and semicircles.',
  ),
  block(
    'shapes-triangles-stars',
    'Geometric - Triangles & Stars',
    'shapes',
    unique([
      0x25b2, 0x25b3, 0x25b4, 0x25b5, 0x25b6, 0x25b7, 0x25b8, 0x25b9, 0x25ba, 0x25bb,
      0x25bc, 0x25bd, 0x25be, 0x25bf, 0x25c0, 0x25c1, 0x25c2, 0x25c3, 0x25c4, 0x25c5,
      0x25c6, 0x25c7, 0x25c8, 0x25c9, 0x25ca, 0x25cb, 0x25cc, 0x25cd, 0x25ce, 0x25cf,
      0x25d0, 0x25d1, 0x25d2, 0x25d3, 0x25d4, 0x25d5, 0x25d6, 0x25d7,
      0x2605, 0x2606, 0x2726, 0x2727, 0x2728, 0x2b21, 0x2b22, 0x2b23, 0x2b24, 0x2b25,
      0x2b26, 0x2b27, 0x2b28, 0x2b29, 0x2b2a, 0x2b2b, 0x2b2c, 0x2b2d, 0x2b2e, 0x2b2f,
    ]),
    'Pointed shapes: triangles, diamonds, pentagons, hexagons and stars.',
  ),

  // ---------------------------------------------------------------- arrows
  block(
    'arrows-all',
    'Arrows - Complete (112)',
    'arrows',
    range(0x2190, 0x21ff),
    'Every arrow: simple, bold, doubled, striped, triangular and tail variants.',
  ),
  block(
    'arrows-simple',
    'Arrows - Simple Set',
    'arrows',
    unique([
      0x2190, 0x2191, 0x2192, 0x2193, 0x2194, 0x2195, 0x2196, 0x2197, 0x2198, 0x2199,
      0x219a, 0x219b, 0x21a9, 0x21aa, 0x21b0, 0x21b1, 0x21b2, 0x21b3, 0x21b5, 0x21b9,
      0x21ba, 0x21bb, 0x21c4, 0x21c6, 0x21c7, 0x21c8, 0x21c9, 0x21d0, 0x21d1, 0x21d2,
      0x21d3, 0x21d4, 0x21d5, 0x21e6, 0x21e7, 0x21e8, 0x21e9, 0x21f5, 0x21f8, 0x21f9,
    ]),
    'The everyday arrows, most useful for flow and direction art.',
  ),
  block(
    'arrows-heavy',
    'Arrows - Heavy & Bold',
    'arrows',
    unique([
      0x21a0, 0x21a3, 0x21a6, 0x21a7, 0x21a8, 0x21cb, 0x21cc, 0x21cd, 0x21ce, 0x21cf,
      0x21d6, 0x21d7, 0x21d8, 0x21d9, 0x21da, 0x21db, 0x21dd, 0x21e0, 0x21e1, 0x21e2,
      0x21e3, 0x21e4, 0x21e5, 0x21ea, 0x21eb, 0x21ec, 0x21ed, 0x21ee, 0x21ef, 0x21f0,
      0x21f1, 0x21f2, 0x21f3, 0x21f4, 0x21f6, 0x21f7, 0x21fa, 0x21fb, 0x21fc, 0x21fd,
      0x21fe, 0x21ff,
    ]),
    'Wide, striped and long-tailed arrows for emphatic direction.',
  ),

  // ---------------------------------------------------------------- math
  block(
    'math-operators',
    'Math Operators (256)',
    'math',
    range(0x2200, 0x22ff),
    'Full mathematical operators block: relations, operators, set notation.',
  ),
  block(
    'math-supplemental',
    'Supplemental Math (256)',
    'math',
    range(0x2a00, 0x2aff),
    'Supplemental mathematical operators: n-ary, brackets, relations.',
  ),
  block(
    'math-sets-logic',
    'Math - Sets & Logic',
    'math',
    unique([
      0x2200, 0x2201, 0x2202, 0x2203, 0x2204, 0x2205, 0x2206, 0x2207, 0x2208, 0x2209,
      0x220a, 0x220b, 0x220c, 0x220d, 0x220e, 0x220f, 0x2210, 0x2211, 0x2212, 0x2213,
      0x2214, 0x2215, 0x2216, 0x2217, 0x2218, 0x2219, 0x221a, 0x221b, 0x221c, 0x221d,
      0x221e, 0x221f, 0x2220, 0x2221, 0x2222, 0x2223, 0x2224, 0x2225, 0x2226, 0x2227,
      0x2228, 0x2229, 0x222a, 0x222b, 0x222c, 0x222d, 0x222e, 0x222f, 0x2230, 0x2231,
      0x2232, 0x2233, 0x2234, 0x2235, 0x2236, 0x2237, 0x2238, 0x2239, 0x223a, 0x223b,
      0x223c, 0x223d, 0x223e, 0x223f, 0x2240, 0x2241, 0x2242, 0x2243, 0x2244, 0x2245,
      0x2246, 0x2247, 0x2248, 0x2249, 0x224a, 0x224b, 0x224c, 0x224d, 0x224e, 0x224f,
      0x2250, 0x2251, 0x2252, 0x2253, 0x2254, 0x2255, 0x2256, 0x2257, 0x2258, 0x2259,
      0x225a, 0x225b, 0x225c, 0x225d, 0x225e, 0x225f, 0x2260, 0x2261, 0x2262, 0x2263,
      0x2264, 0x2265, 0x2266, 0x2267, 0x2268, 0x2269, 0x226a, 0x226b, 0x226c, 0x226d,
      0x226e, 0x226f, 0x2270, 0x2271, 0x2272, 0x2273, 0x2274, 0x2275, 0x2276, 0x2277,
      0x2278, 0x2279, 0x227a, 0x227b, 0x227c, 0x227d, 0x227e, 0x227f, 0x2280, 0x2281,
      0x2282, 0x2283, 0x2284, 0x2285, 0x2286, 0x2287, 0x2288, 0x2289, 0x228a, 0x228b,
      0x228c, 0x228d, 0x228e, 0x228f, 0x2290, 0x2291, 0x2292, 0x2293, 0x2294, 0x2295,
      0x2296, 0x2297, 0x2298, 0x2299, 0x229a, 0x229b, 0x229c, 0x229d, 0x229e, 0x229f,
      0x22a0, 0x22a1, 0x22a2, 0x22a3, 0x22a4, 0x22a5, 0x22a6, 0x22a7, 0x22a8, 0x22a9,
      0x22aa, 0x22ab, 0x22ac, 0x22ad, 0x22ae, 0x22af, 0x22b0, 0x22b1, 0x22b2, 0x22b3,
      0x22b4, 0x22b5, 0x22b6, 0x22b7, 0x22b8, 0x22b9, 0x22ba, 0x22bb, 0x22bc, 0x22bd,
      0x22be, 0x22bf, 0x22c0, 0x22c1, 0x22c2, 0x22c3, 0x22c4, 0x22c5, 0x22c6, 0x22c7,
      0x22c8, 0x22c9, 0x22ca, 0x22cb, 0x22cc, 0x22cd, 0x22ce, 0x22cf, 0x22d0, 0x22d1,
      0x22d2, 0x22d3, 0x22d4, 0x22d5, 0x22d6, 0x22d7, 0x22d8, 0x22d9, 0x22da, 0x22db,
      0x22dc, 0x22dd, 0x22de, 0x22df, 0x22e0, 0x22e1, 0x22e2, 0x22e3, 0x22e4, 0x22e5,
      0x22e6, 0x22e7, 0x22e8, 0x22e9, 0x22ea, 0x22eb, 0x22ec, 0x22ed, 0x22ee, 0x22ef,
      0x22f0, 0x22f1, 0x22f2, 0x22f3, 0x22f4, 0x22f5, 0x22f6, 0x22f7, 0x22f8, 0x22f9,
      0x22fa, 0x22fb, 0x22fc, 0x22fd, 0x22fe, 0x22ff,
    ]),
    'Set theory, logic, integrals, sums and every relational operator.',
  ),
  block(
    'math-fractions-approx',
    'Math - Fractions & Approximation',
    'math',
    unique([
      0x2150, 0x2151, 0x2152, 0x2153, 0x2154, 0x2155, 0x2156, 0x2157, 0x2158, 0x2159,
      0x215a, 0x215b, 0x215c, 0x215d, 0x215e, 0x215f, 0x2189,
      0x2248, 0x2243, 0x2245, 0x223c, 0x223d, 0x223e, 0x224d, 0x224e, 0x224f, 0x2250,
      0x2261, 0x2260, 0x2242, 0x2243, 0x2252, 0x2253, 0x2257, 0x2258, 0x2259, 0x225a,
      0x00b1, 0x2213, 0x2212, 0x00f7, 0x00d7, 0x2217, 0x2218, 0x22c5, 0x2219, 0x222f,
    ]),
    'Vulgar fractions, plus/minus and approximation marks.',
  ),

  // ---------------------------------------------------------------- technical
  block(
    'technical-misc',
    'Miscellaneous Technical (256)',
    'technical',
    range(0x2300, 0x23ff),
    'Angles, arcs, apices, keyboard and media symbols, control shapes.',
  ),
  block(
    'technical-circled',
    'Circled Numbers & Letters (240)',
    'technical',
    range(0x2460, 0x24ff),
    'Circled digits, parenthesised digits, double-circled and negative circled.',
  ),
  block(
    'technical-letterlike',
    'Letterlike Symbols (80)',
    'technical',
    range(0x2100, 0x214f),
    'Script capitals, ohm, angstrom, kelvin, landscape/portrait marks.',
  ),
  block(
    'technical-fractions',
    'Number Forms (64)',
    'technical',
    range(0x2150, 0x218f),
    'Vulgar fractions, roman numerals and counting rod numerals.',
  ),
  block(
    'technical-currency',
    'Currency Symbols (32)',
    'technical',
    range(0x20a0, 0x20bf),
    'Euro, pound, yen, cent, rupee, bitcoin and every other currency mark.',
  ),
  block(
    'technical-parenthesized',
    'Parenthesized & Padded',
    'technical',
    unique([
      ...Array.from({ length: 26 }, (_, i) => 0x24b6 + i), // Ⓐ-Ⓩ
      ...Array.from({ length: 26 }, (_, i) => 0x24d0 + i), // ⓐ-ⓩ
      ...Array.from({ length: 10 }, (_, i) => 0x2474 + i), // ⑴-⑽
      ...Array.from({ length: 20 }, (_, i) => 0x2460 + i), // ①-⑳
      ...Array.from({ length: 26 }, (_, i) => 0x249c + i), // ⒜-⒩
    ]),
    'Circled latin alphabet, lowercase and parenthesised digit runs.',
  ),

  // ---------------------------------------------------------------- dingbats / symbols
  block(
    'dingbats-all',
    'Dingbats - Complete (192)',
    'dingbats',
    range(0x2700, 0x27bf),
    'Scissors, pens, hearts, stars, checks, crosses and decorative marks.',
  ),
  block(
    'dingbats-marks',
    'Dingbats - Checks & Crosses',
    'dingbats',
    unique([
      0x2713, 0x2714, 0x2715, 0x2716, 0x2717, 0x2718, 0x2719, 0x271a, 0x271b, 0x271c,
      0x271d, 0x271e, 0x271f, 0x2720, 0x2721, 0x2722, 0x2723, 0x2724, 0x2725, 0x2726,
      0x2727, 0x272a, 0x272b, 0x272c, 0x272d, 0x272e, 0x272f, 0x2730, 0x2731, 0x2732,
      0x2733, 0x2734, 0x2735, 0x2736, 0x2737, 0x2738, 0x2739, 0x273a, 0x273b, 0x273c,
      0x273d, 0x273e, 0x273f, 0x2740, 0x2741, 0x2742, 0x2743, 0x2744, 0x2745, 0x2746,
      0x2747, 0x2748, 0x2749, 0x274a, 0x274b, 0x274c, 0x274d, 0x274e, 0x274f, 0x2750,
      0x2751, 0x2752, 0x2753, 0x2754, 0x2755, 0x2756, 0x2757, 0x2758, 0x2759, 0x275a,
      0x275b, 0x275c, 0x275d, 0x275e, 0x275f, 0x2760, 0x2761, 0x2762, 0x2763, 0x2764,
      0x2765, 0x2766, 0x2767, 0x2768, 0x2769, 0x276a, 0x276b, 0x276c, 0x276d, 0x276e,
      0x276f, 0x2770, 0x2771, 0x2772, 0x2773, 0x2774, 0x2775,
    ]),
    'Tick, cross, star, flower and heart marks for status and decoration.',
  ),
  block(
    'symbols-misc',
    'Miscellaneous Symbols',
    'dingbats',
    range(0x2600, 0x266f),
    'Weather, astronomy, zodiac, tools, hands and playing-card suits.',
  ),
  block(
    'symbols-games',
    'Games & Dice',
    'dingbats',
    unique([
      ...range0(0x2654, 0x265f), // chess
      ...range0(0x2660, 0x2667), // card suits
      ...range0(0x2668, 0x266f),
      ...range0(0x2680, 0x2685), // dice faces
      ...range0(0x2686, 0x2689),
      ...range0(0x268a, 0x268f),
      ...range0(0x2690, 0x2697), // dominoes / drams
      ...range0(0x2698, 0x269f),
      ...range0(0x26a0, 0x26af),
      ...range0(0x26e9, 0x26ff),
    ]),
    'Chess pieces, card suits, dice faces and warning marks.',
  ),

  // ---------------------------------------------------------------- typography
  block(
    'typography-general',
    'General Punctuation',
    'typography',
    range(0x2010, 0x205e),
    'Dashes, quotes, bullets, daggers, primes, ellipses and separators.',
  ),
  block(
    'typography-supplemental',
    'Supplemental Punctuation',
    'typography',
    range(0x2e00, 0x2e7f),
    'Ancient Greek quotation marks, editorial marks and half-tone spaces.',
  ),
  block(
    'typography-quotes-dashes',
    'Quotes, Dashes & Ellipses',
    'typography',
    unique([
      0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2016, 0x2017, 0x2018, 0x2019,
      0x201a, 0x201b, 0x201c, 0x201d, 0x201e, 0x201f, 0x2020, 0x2021, 0x2022, 0x2023,
      0x2024, 0x2025, 0x2026, 0x2027, 0x2030, 0x2031, 0x2032, 0x2033, 0x2034, 0x2035,
      0x2036, 0x2037, 0x2038, 0x2039, 0x203a, 0x203b, 0x203c, 0x203d, 0x203e, 0x203f,
      0x2040, 0x2041, 0x2042, 0x2043, 0x2044, 0x2045, 0x2046, 0x2047, 0x2048, 0x2049,
      0x204a, 0x204b, 0x204c, 0x204d, 0x204e, 0x204f, 0x2050, 0x2051, 0x2052, 0x2053,
      0x2054, 0x2055, 0x2056, 0x2057, 0x2058, 0x2059, 0x205a, 0x205b, 0x205c, 0x205d,
      0x205e,
      0x00a7, 0x00b6, 0x00b7, 0x00ac, 0x00ae, 0x00b0, 0x00b1, 0x00b9, 0x00b2, 0x00b3,
      0x00bc, 0x00bd, 0x00be, 0x2044, 0x00a9, 0x2122, 0x2039, 0x203a, 0x00ab, 0x00bb,
    ]),
    'Curated editorial punctuation for typographic compositions.',
  ),

  // ---------------------------------------------------------------- languages
  block(
    'lang-greek-full',
    'Greek - Complete',
    'languages',
    unique([
      ...range0(0x0391, 0x03a9), // Α-Ω
      ...range0(0x03b1, 0x03c9), // α-ω
      0x0386, 0x0388, 0x0389, 0x038a, 0x038c, 0x038e, 0x038f,
      0x03ac, 0x03ad, 0x03ae, 0x03af, 0x03cc, 0x03cd, 0x03ce,
      0x03d0, 0x03d1, 0x03d5, 0x03d6, 0x03f0, 0x03f1, 0x03f5,
    ]),
    'All Greek capitals and lowercase plus final sigma, theta and psi variants.',
  ),
  block(
    'lang-cyrillic-full',
    'Cyrillic - Complete',
    'languages',
    unique([
      ...range0(0x0410, 0x044f), // А-я
      ...range0(0x0400, 0x040f), // Ѐ-Џ accents
      ...range0(0x0450, 0x045f),
      0x0460, 0x0461, 0x0462, 0x0463, 0x0464, 0x0465, 0x0466, 0x0467, 0x0468, 0x0469,
      0x046a, 0x046b, 0x046c, 0x046d, 0x046e, 0x046f, 0x0470, 0x0471, 0x0472, 0x0473,
      0x0474, 0x0475, 0x0476, 0x0477, 0x0478, 0x0479, 0x047a, 0x047b, 0x047c, 0x047d,
      0x047e, 0x047f, 0x0480, 0x0481,
    ]),
    'Full Cyrillic alphabet including accented and archaic letters.',
  ),
  block(
    'lang-latin-ext-a',
    'Latin Extended-A',
    'languages',
    range(0x0100, 0x017f),
    'Latin Extended-A: letters with macrons, breves, ogoneks and carons.',
  ),
  block(
    'lang-latin-ext-b',
    'Latin Extended-B',
    'languages',
    range(0x0180, 0x024f),
    'Latin Extended-B: African, Vietnamese and historic European letters.',
  ),

  // ---------------------------------------------------------------- numeric
  block(
    'numeric-roman',
    'Roman Numerals',
    'numeric',
    unique([
      ...range0(0x2160, 0x2182), // Ⅰ-⅂
      ...range0(0x2170, 0x217f),
      0x2183, 0x2184, 0x2185, 0x2186, 0x2187, 0x2188,
    ]),
    'Uppercase and lowercase roman numerals plus ancient CI symbols.',
  ),
  block(
    'numeric-enclosed-paren',
    'Parenthesized Numbers',
    'numeric',
    unique([
      ...range0(0x2474, 0x2487), // ⑴-⒇
      ...range0(0x2488, 0x249b), // ⒈-⒛
      ...range0(0x249c, 0x24b5), // ⒜-⒵
    ]),
    'Parenthesised digits, full stop digits and circled lowercase letters.',
  ),

  // ---------------------------------------------------------------- presentation-ish helpers
  block(
    'symbols-blocky-mix',
    'Mixed Block & Shade Ensemble',
    'blocks',
    unique([
      0x2588, 0x2593, 0x2592, 0x2591, 0x2580, 0x2584, 0x258c, 0x2590,
      0x25a0, 0x25a1, 0x25aa, 0x25ab, 0x25ac, 0x25ad, 0x25ae, 0x25af,
      0x25b2, 0x25b3, 0x25bc, 0x25bd, 0x25c0, 0x25c1, 0x25c4, 0x25c6,
      0x25c7, 0x25c8, 0x25c9, 0x25ca, 0x25cb, 0x25cc, 0x25cd, 0x25ce,
      0x25cf, 0x25d8, 0x25d9, 0x25da, 0x25db, 0x25dc, 0x25dd, 0x25de, 0x25df,
      0x2b1b, 0x2b1c, 0x2b1c, 0x2b1d, 0x2b1e, 0x2b1f, 0x2b24, 0x2b25, 0x2b26,
      0x2b27, 0x2b28, 0x2b29, 0x2b2a, 0x2b2b, 0x2b2c, 0x2b2d, 0x2b2e, 0x2b2f,
      0x25e6, 0x25e7, 0x25e8, 0x25e9, 0x25ea, 0x25eb, 0x25ec, 0x25ed, 0x25ee, 0x25ef,
    ]),
    'A compact blend of solid blocks and geometric shapes for pixel-like art.',
  ),
];

/** Numeric helper kept separate so the preset table above stays declarative. */
function range0(start: number, end: number): number[] {
  const out: number[] = [];
  for (let cp = start; cp <= end; cp++) out.push(cp);
  return out;
}

/** Total number of distinct characters across every charset preset. */
export function countUniqueCharacters(presets: readonly CharsetDescription[]): number {
  const all = new Set<string>();
  for (const preset of presets) {
    for (const ch of preset.chars) all.add(ch);
  }
  return all.size;
}

// ---------------------------------------------------------------------------
// Density ordering (dark -> light ramps)
// ---------------------------------------------------------------------------

/**
 * Approximate ink coverage for printable ASCII, indexed by `code - 32`
 * (space .. tilde). Hand-tuned: the core cannot rasterise glyphs because it
 * must stay DOM-free.
 */
const ASCII_DENSITY: readonly number[] = [
  0.02, 0.12, 0.1, 0.45, 0.45, 0.55, 0.55, 0.06, 0.18, 0.18, 0.25, 0.3, 0.12, 0.12, 0.08, 0.25,
  0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 0.55,
  0.12, 0.12, 0.25, 0.3, 0.25, 0.35, 0.8,
  0.6, 0.55, 0.55, 0.6, 0.5, 0.5, 0.6, 0.6, 0.3, 0.45, 0.55, 0.5, 0.7, 0.6, 0.6, 0.55, 0.65, 0.6,
  0.55, 0.5, 0.6, 0.6, 0.75, 0.6, 0.55, 0.55,
  0.15, 0.25, 0.15, 0.25, 0.12, 0.1,
  0.55, 0.55, 0.5, 0.55, 0.55, 0.4, 0.55, 0.55, 0.25, 0.4, 0.5, 0.25, 0.7, 0.55, 0.55, 0.55, 0.55,
  0.4, 0.5, 0.4, 0.55, 0.55, 0.7, 0.55, 0.55, 0.5,
  0.2, 0.2, 0.2, 0.25,
];

/** Explicit coverage for block, geometric and box-drawing glyphs. */
const COVERAGE_BY_GLYPH: Record<string, number> = {
  ' ': 0.02,
  '█': 1,
  '▉': 0.9,
  '▊': 0.8,
  '▋': 0.7,
  '▌': 0.5,
  '▍': 0.4,
  '▎': 0.3,
  '▏': 0.15,
  '▓': 0.75,
  '▒': 0.5,
  '░': 0.25,
  '▀': 0.5,
  '▔': 0.125,
  '▄': 0.5,
  '▁': 0.12,
  '▂': 0.25,
  '▃': 0.37,
  '▅': 0.62,
  '▆': 0.75,
  '▇': 0.87,
  '▐': 0.5,
  '■': 0.8,
  '□': 0.35,
  '▪': 0.4,
  '▫': 0.2,
  '▲': 0.5,
  '▼': 0.5,
  '◄': 0.35,
  '►': 0.35,
  '◆': 0.6,
  '◇': 0.35,
  '●': 0.6,
  '○': 0.35,
  '◉': 0.55,
  '◎': 0.35,
  '★': 0.6,
  '☆': 0.3,
  '◼': 0.75,
  '◻': 0.3,
  '⚫': 0.6,
  '⚪': 0.3,
  '─': 0.12,
  '━': 0.18,
  '│': 0.15,
  '┃': 0.22,
  '═': 0.2,
  '║': 0.25,
  '·': 0.08,
  '•': 0.3,
};

/**
 * Approximate ink coverage of a single character: 0 = blank, 1 = solid.
 * Used to order character ramps dark -> light.
 */
export function characterDensity(ch: string): number {
  if (!ch) return 0;
  const known = COVERAGE_BY_GLYPH[ch];
  if (known !== undefined) return known;
  const cp = ch.codePointAt(0) ?? 0;
  if (cp >= 32 && cp <= 126) return ASCII_DENSITY[cp - 32];
  // Geometric shapes and block elements without an explicit entry.
  if ((cp >= 0x2580 && cp <= 0x25ff) || (cp >= 0x2b00 && cp <= 0x2bff)) return 0.45;
  return 0.5;
}

/**
 * Sort a ramp dark -> light by ink coverage. Stable: characters with equal
 * density keep their original relative order.
 */
export function sortCharactersByDensity(chars: string): string {
  return Array.from(chars)
    .map((ch, index) => ({ ch, index, density: characterDensity(ch) }))
    .sort((a, b) => a.density - b.density || a.index - b.index)
    .map((entry) => entry.ch)
    .join('');
}
