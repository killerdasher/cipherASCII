# Themes

Ten complete visual personalities. A theme is data, not CSS: switching one
rewrites a single injected `<style>` block, and every component bound to a
theme variable recolours immediately.

## 1. The model

```ts
interface Theme {
  id: string; name: string; description: string;
  colors: ThemeColors;    // ~30 roles, see below
  fonts:   { mono; sans; display? };
  spacing: { xs; sm; md; lg; xl };
  borderRadius: { sm; md; lg; full };
  shadows: { sm; md; lg; xl };
  transitions: { fast; normal; slow };
  isDark: boolean;
}
```

`ThemeColors` is organised by *role*, never by literal colour:

| Group | Roles |
| --- | --- |
| Base | `bg`, `bgElevated`, `bgHover`, `bgActive` |
| Text | `fg`, `fgMuted`, `fgDisabled`, `fgInverse` |
| Accent | `accent`, `accentHover`, `accentActive`, `accentMuted` |
| Borders | `border`, `borderLight`, `borderFocus` |
| Status | `success`, `warning`, `danger`, `info` |
| Code | `codeBg`, `codeFg`, `keyword`, `string`, `number`, `comment`, `function` |
| Effects | `glow`, `selection` |

Because components reference *roles*, a light theme needs no special-case CSS —
it supplies a light `bg` and a dark `fg`.

## 2. The ten presets

Defined in `src/core/theme/theme.ts` (`THEME_PRESETS`), listed in default
order; `medieval` is the default (`getDefaultTheme()`).

| id | name | personality | dark |
| --- | --- | --- | --- |
| `medieval` | Medieval | Script Slayer inspired dark theme with parchment tones | ✓ |
| `ditherboy` | Dither Boy | Dither Boy inspired retro terminal aesthetic | ✓ |
| `terminal-green` | Terminal Green | Classic green monochrome monitor | ✓ |
| `terminal-amber` | Terminal Amber | Classic amber monochrome monitor | ✓ |
| `light` | Light | Clean light theme for daylight work | — |
| `high-contrast` | High Contrast | Maximum contrast for accessibility | ✓ |
| `gothic` | Gothic Medieval | Obsidian surfaces, forged iron borders, parchment text, aged gold | ✓ |
| `cyber` | Cyber Y2K | Chrome on black, neon cyan and magenta, wireframe edges, CRT glow | ✓ |
| `cafe` | Cozy Cafe French | Cream and beige, sepia shadows, elegant serif headers, espresso UI | — |
| `zelda` | Zelda / RPG | Ancient stone, Sheikah-blue glow, Triforce gold, fantasy borders | ✓ |

The first six are the baseline personalities; the last four are the cipher
set — they also lean on `colors.glow` and `colors.selection`, the two roles
added for halo/wash effects.

## 3. How a theme reaches the screen

```ts
applyTheme(theme)
  └─ generateCSSVariables(theme)   // :root { --bg: #0c0c10; --accent: ...; }
     └─ injected <style id="theme-variables">   (replaced in place on switch)
     + <html data-theme="gothic" data-theme-dark="true">
```

* **CSS variables** — every role becomes `--<role>`; Tailwind utilities are
  bound to them in `tailwind.config.js`, so `bg-surface`, `text-muted`,
  `border-line` … follow the theme without any component change.
* **data attributes** — `data-theme` / `data-theme-dark` let CSS select
  theme-specific rules (e.g. glow intensity) without JS branches.
* **Canvas** — `EditorCanvas` reads `--bg-elevated`, `--fg` and `--border`
  through `getComputedStyle` and rejects `var()` references, so the artboard
  and grid lines always get a literal, serialisable colour.
* **Editor chrome** — `src/utils/themeColor.ts` resolves a role to a hex value
  for places CSS cannot reach.

Store flow: `setTheme(id)` → look up the preset → `applyTheme()` → `themeId`
is written into the document, so the project file remembers it.

## 4. Custom themes

```ts
import { createCustomTheme, getTheme, applyTheme } from 'core/theme/theme';

const midnight = createCustomTheme(getTheme('medieval')!, {
  id: 'midnight',
  name: 'Midnight',
  colors: { accent: '#7dd3fc', glow: '#38bdf8' },
});
applyTheme(midnight);
```

`createCustomTheme` deep-merges each block (colours, fonts, spacing, radius,
shadows, transitions) onto the base, so an override can touch one role and
leave the rest intact.

Persistence: `availableThemes` in the store carries presets plus any custom
themes created in the session; the active theme id is stored in the document
(`themeId`) and restored with the project.

## 5. Adding a preset

1. Append an entry to `THEME_PRESETS` in `src/core/theme/theme.ts`.
2. Fill **every** `ThemeColors` role — a missing role falls back to whatever
   the previous theme left behind, which is exactly the bug roles exist to
   prevent.
3. Set `isDark` correctly: it drives `data-theme-dark` and the CRT/glow
   treatment.
4. Set `fonts.display` if the personality wants a serif/condensed voice.
5. Check contrast on `fg` against `bg` *and* `bgElevated` (the artboard sits on
   the elevated surface).
6. Verify the canvas readout: switch to the theme and confirm the editor
   artboard, grid lines and glyph fallback colour look right.

## 6. Tests

`tests/unit/theme.test.ts` covers preset integrity (all roles present, ids
unique, hex well-formed), `getTheme`/`createCustomTheme` merging, CSS variable
generation and the default theme. `tests/unit/color.test.ts` covers the colour
math used by the effects that read theme colours.
