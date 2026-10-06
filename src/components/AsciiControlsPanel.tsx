import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Slider } from './Slider';
import { ALL_CHARSET_PRESETS, CHARSET_CATEGORIES } from '../core/charsets/extendedCharsets';
import { countUniqueCharacters, sortCharactersByDensity } from '../core/charsets/unicodeCharsets';
import { sortCharactersByDensity as sortCharactersByMeasuredInk } from '../utils/characterSets.js';
import { listDitherAlgorithms } from '../core/dither';
import type {
  ImageRenderSettings,
  ColorMode,
  RenderMode,
  DitherId,
  LuminanceStandard,
  MappingOutputSettings,
  ResizeFilter,
} from '../core/types';

/**
 * ASCII conversion controls: charset ramp, custom glyph injection, character
 * offset, cell size (columns), color mode, dither and tone shaping — plus the
 * Live Glyph Preview showing exactly which characters the ramp currently uses.
 */
export function AsciiControlsPanel() {
  const imageSettings = useStore((s) => s.document.imageSettings);
  const setImageSettings = useStore((s) => s.setImageSettings);

  const output = imageSettings.output;
  const [customChars, setCustomChars] = useState(output.charset);
  const [charsetOpen, setCharsetOpen] = useState<string | null>(null);

  const patchOutput = (patch: Partial<MappingOutputSettings>) =>
    setImageSettings({ output: { ...output, ...patch } });

  const patchPreprocess = (patch: Partial<ImageRenderSettings['preprocess']>) =>
    setImageSettings({ preprocess: { ...imageSettings.preprocess, ...patch } });

  const dithers = useMemo(() => listDitherAlgorithms(), []);
  const ramp = output.charset;

  const stats = useMemo(
    () => ({ presets: ALL_CHARSET_PRESETS.length, chars: countUniqueCharacters(ALL_CHARSET_PRESETS) }),
    [],
  );
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryCategory, setLibraryCategory] = useState<string>('all');
  const libraryChars = useMemo(() => {
    const seen = new Set<string>();
    for (const preset of ALL_CHARSET_PRESETS) {
      if (libraryCategory !== 'all' && preset.category !== libraryCategory) continue;
      for (const ch of preset.chars) seen.add(ch);
    }
    return Array.from(seen);
  }, [libraryCategory]);

  return (
    <div className="ascii-controls">
      {/* ---------------- Cell size ---------------- */}
      <div className="prop-section">
        <h4>Cell Size</h4>
        <Slider
          label="Columns"
          value={imageSettings.columns}
          min={1}
          max={1000}
          step={1}
          onChange={(v) => setImageSettings({ columns: v })}
        />
        <div className="prop-row">
          <label>Render mode</label>
          <select
            value={imageSettings.mode}
            onChange={(e) => setImageSettings({ mode: e.target.value as RenderMode })}
          >
            <option value="chars">Characters</option>
            <option value="braille">Braille</option>
            <option value="halfblocks">Half blocks</option>
            <option value="quadrants">Quadrants</option>
          </select>
        </div>
      </div>

      {/* ---------------- Sampling ---------------- */}
      <div className="prop-section">
        <h4>Sampling</h4>
        <div className="prop-row">
          <label>Resize filter</label>
          <select
            value={imageSettings.resizeFilter}
            onChange={(e) => setImageSettings({ resizeFilter: e.target.value as ResizeFilter })}
            title="How the source image is resampled onto the character grid"
          >
            <option value="area">Area (averaging)</option>
            <option value="nearest">Nearest (hard pixels)</option>
            <option value="bilinear">Bilinear</option>
            <option value="bicubic">Bicubic (Catmull-Rom)</option>
            <option value="lanczos">Lanczos 3</option>
          </select>
        </div>
        <div className="prop-row">
          <label>Supersample: {imageSettings.supersample}x</label>
          <select
            value={String(imageSettings.supersample)}
            onChange={(e) => setImageSettings({ supersample: Number(e.target.value) })}
            title="Samples per cell before averaging; higher values soften edges"
          >
            <option value="1">1x (off)</option>
            <option value="2">2x</option>
            <option value="3">3x</option>
            <option value="4">4x</option>
            <option value="6">6x</option>
            <option value="8">8x</option>
          </select>
        </div>
        <div className="prop-row">
          <label>Luminance</label>
          <select
            value={imageSettings.luminanceStandard ?? 'rec709'}
            onChange={(e) =>
              setImageSettings({ luminanceStandard: e.target.value as LuminanceStandard })
            }
            title="Weighting used to turn RGB into brightness for glyph selection"
          >
            <option value="rec709">BT.709 (HDTV)</option>
            <option value="rec601">BT.601 (classic)</option>
            <option value="luma">Luma (NTSC 601)</option>
            <option value="average">Average (R+G+B)/3</option>
            <option value="srgb-linear">sRGB linear (perceptual)</option>
          </select>
        </div>
      </div>

      {/* ---------------- Live glyph preview ---------------- */}
      <div className="prop-section">
        <h4>Live Glyph Preview</h4>
        <div className="glyph-preview" aria-live="polite">
          {Array.from(ramp).map((ch, i) => (
            <span
              key={`${i}-${ch}`}
              className="glyph-cell"
              title={`index ${i} of ${ramp.length}`}
              style={{ opacity: 0.45 + (0.55 * (i + 1)) / ramp.length }}
            >
              {ch === ' ' ? '\u00B7' : ch}
            </span>
          ))}
        </div>
        <p className="glyph-hint">Dark → Light · {ramp.length} levels</p>
      </div>

      {/* ---------------- Character set ---------------- */}
      <div className="prop-section">
        <h4>Character Set</h4>
        <p className="glyph-hint">
          {stats.presets} presets · {stats.chars.toLocaleString()} unique characters
        </p>
        <select
          value=""
          onChange={(e) => {
            const preset = ALL_CHARSET_PRESETS.find((p) => p.id === e.target.value);
            if (!preset) return;
            setCustomChars(preset.chars);
            patchOutput({ charset: preset.chars });
          }}
        >
          <option value="">Choose a preset…</option>
          {CHARSET_CATEGORIES.map((cat) => {
            const sets = ALL_CHARSET_PRESETS.filter((p) => p.category === cat);
            if (sets.length === 0) return null;
            return (
              <optgroup key={cat} label={cat.toUpperCase()}>
                {sets.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </optgroup>
            );
          })}
        </select>

        <button
          className="collapse-toggle"
          onClick={() => setLibraryOpen(!libraryOpen)}
        >
          {libraryOpen ? '▾' : '▸'} Character Library ({libraryChars.length})
        </button>
        {libraryOpen && (
          <div className="char-library">
            <select
              value={libraryCategory}
              onChange={(e) => setLibraryCategory(e.target.value)}
            >
              <option value="all">All categories</option>
              {CHARSET_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <div className="char-grid">
              {libraryChars.map((ch, i) => (
                <button
                  key={`${i}-${ch.codePointAt(0)}`}
                  className="char-chip"
                  title={`U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')} — click to add to the ramp`}
                  onClick={() => {
                    const next = (customChars + ch).slice(0, 10);
                    setCustomChars(next);
                    patchOutput({ charset: next });
                  }}
                >
                  {ch}
                </button>
              ))}
            </div>
            <p className="glyph-hint">Click a character to append it to the 1–10 character ramp.</p>
          </div>
        )}

        <button
          className="collapse-toggle"
          onClick={() => setCharsetOpen(charsetOpen === 'custom' ? null : 'custom')}
        >
          {charsetOpen === 'custom' ? '▾' : '▸'} Custom Injection (1–10)
        </button>
        {charsetOpen === 'custom' && (
          <div className="prop-row">
            <input
              type="text"
              maxLength={10}
              value={customChars}
              placeholder="e.g. @#*+=-:. "
              onChange={(e) => setCustomChars(e.target.value)}
              onBlur={() => {
                const v = customChars.slice(0, 10);
                if (v.length >= 1) patchOutput({ charset: v });
              }}
            />
            <p className="glyph-hint">Type 1–10 characters, dark → light.</p>
          </div>
        )}

        <div className="prop-row">
          <button
            type="button"
            onClick={() => {
              const sorted = sortCharactersByDensity(output.charset);
              setCustomChars(sorted);
              patchOutput({ charset: sorted });
            }}
          >
            Sort ramp dark → light
          </button>
          <button
            type="button"
            title="Rasterises every glyph on a 24x24 canvas and sorts by measured ink"
            onClick={() => {
              const measured = sortCharactersByMeasuredInk(Array.from(output.charset)).join('');
              setCustomChars(measured);
              patchOutput({ charset: measured });
            }}
          >
            Sort by measured ink
          </button>
          <p className="glyph-hint">
            Heuristic coverage table, or a canvas measurement for injected text (CJK, emoji).
          </p>
        </div>
      </div>

      {/* ---------------- Character offset ---------------- */}
      <div className="prop-section">
        <h4>Character Offset</h4>
        <Slider
          label="Offset"
          value={output.offset}
          min={-10}
          max={10}
          step={1}
          onChange={(v) => patchOutput({ offset: v })}
        />
        <Slider
          label="Density"
          value={output.density}
          min={0.25}
          max={4}
          step={0.05}
          display={output.density.toFixed(2)}
          onChange={(v) => patchOutput({ density: v })}
        />
        <div className="prop-row">
          <label>Invert ramp</label>
          <input
            type="checkbox"
            checked={output.invert}
            onChange={(e) => patchOutput({ invert: e.target.checked })}
          />
        </div>
      </div>

      {/* ---------------- Color mode ---------------- */}
      <div className="prop-section">
        <h4>Color Mode</h4>
        <select
          value={imageSettings.colorMode}
          onChange={(e) => setImageSettings({ colorMode: e.target.value as ColorMode })}
        >
          <option value="none">Monotone (single color)</option>
          <option value="sample">Original source color</option>
          <option value="ansi16">Palette · 16 color</option>
          <option value="ansi256">Palette · 256 color</option>
          <option value="truecolor">Palette · True color</option>
        </select>
      </div>

      {/* ---------------- Dither ---------------- */}
      <div className="prop-section">
        <h4>Dither</h4>
        <div className="prop-row">
          <select
            value={imageSettings.dither.algorithm}
            onChange={(e) =>
              setImageSettings({ dither: { ...imageSettings.dither, algorithm: e.target.value as DitherId } })
            }
          >
            {dithers.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </div>
        <Slider
          label="Strength"
          value={imageSettings.dither.strength}
          min={0}
          max={1}
          step={0.05}
          display={imageSettings.dither.strength.toFixed(2)}
          onChange={(v) =>
            setImageSettings({ dither: { ...imageSettings.dither, strength: v } })
          }
        />
      </div>

      {/* ---------------- Tone ---------------- */}
      <div className="prop-section">
        <h4>Tone</h4>
        <Slider
          label="Brightness"
          value={imageSettings.preprocess.brightness}
          min={-1}
          max={1}
          step={0.05}
          display={imageSettings.preprocess.brightness.toFixed(2)}
          onChange={(v) => patchPreprocess({ brightness: v })}
        />
        <Slider
          label="Contrast"
          value={imageSettings.preprocess.contrast}
          min={-1}
          max={1}
          step={0.05}
          display={imageSettings.preprocess.contrast.toFixed(2)}
          onChange={(v) => patchPreprocess({ contrast: v })}
        />
        <Slider
          label="Gamma"
          value={imageSettings.preprocess.gamma}
          min={0.2}
          max={3}
          step={0.05}
          display={imageSettings.preprocess.gamma.toFixed(2)}
          onChange={(v) => patchPreprocess({ gamma: v })}
        />
      </div>
    </div>
  );
}
