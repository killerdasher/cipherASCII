import { memo } from 'react';
import { useStore } from '../store';
import { CipherAsciiLogo } from './CipherAsciiLogo';
import { Slider } from './Slider';
import {
  CELL_SIZE,
  DEFAULT_SUBTEXTURE,
  type ImageRenderSettings,
  type TextRenderSettings,
  type CanvasSettings,
  type SubtexturePattern,
} from '../core/types';
import {
  CANVAS_PRESETS,
  matchCanvasPreset,
  type CanvasPresetId,
} from '../core/canvasPresets';

interface SettingsPanelProps {
  imageSettings: ImageRenderSettings;
  textSettings: TextRenderSettings;
  canvasSettings: CanvasSettings;
}

function SettingsPanelInner({ imageSettings, textSettings, canvasSettings }: SettingsPanelProps) {
  const { setImageSettings, setTextSettings, setCanvasSettings, applyCanvasPreset } = useStore();

  return (
    <div className="settings-panel">
      <h3>Image Settings</h3>
      <div className="prop-row">
        <label>Columns:</label>
        <input type="number" value={imageSettings.columns} min="1" max="1000" onChange={(e) => setImageSettings({ columns: Number(e.target.value) })} />
      </div>
      <div className="prop-row">
        <label>Mode:</label>
        <select value={imageSettings.mode} onChange={(e) => setImageSettings({ mode: e.target.value as any })}>
          <option value="chars">Characters</option>
          <option value="braille">Braille</option>
          <option value="halfblocks">Half-blocks</option>
          <option value="quadrants">Quadrants</option>
        </select>
      </div>
      <div className="prop-row">
        <label>Fit:</label>
        <select value={imageSettings.fit} onChange={(e) => setImageSettings({ fit: e.target.value as any })}>
          <option value="contain">Contain</option>
          <option value="cover">Cover</option>
          <option value="stretch">Stretch</option>
        </select>
      </div>
      <div className="prop-row">
        <label>Dither:</label>
        <select value={imageSettings.dither.algorithm} onChange={(e) => setImageSettings({ dither: { ...imageSettings.dither, algorithm: e.target.value as any } })}>
          <option value="none">None</option>
          <option value="threshold">Threshold</option>
          <option value="bayer">Bayer</option>
          <option value="floydSteinberg">Floyd-Steinberg</option>
          <option value="atkinson">Atkinson</option>
          <option value="jarvisJudiceNinke">JJN</option>
          <option value="stucki">Stucki</option>
          <option value="burkes">Burkes</option>
        </select>
      </div>
      <div className="prop-row">
        <label>Invert:</label>
        <input type="checkbox" checked={imageSettings.output.invert} onChange={(e) => setImageSettings({ output: { ...imageSettings.output, invert: e.target.checked } })} />
      </div>

      <h3>Text Settings</h3>
      <div className="prop-row">
        <label>Font:</label>
        <select value={textSettings.font} onChange={(e) => setTextSettings({ font: e.target.value })}>
          <option value="block">Block</option>
          <option value="banner">Banner</option>
          <option value="slim">Slim</option>
          <option value="slant">Slant</option>
          <option value="outline">Outline</option>
        </select>
      </div>
      <div className="prop-row">
        <label>Style:</label>
        <select value={textSettings.style} onChange={(e) => setTextSettings({ style: e.target.value as any })}>
          <option value="plain">Plain</option>
          <option value="shadow">Shadow</option>
          <option value="outline">Outline</option>
          <option value="double">Double</option>
          <option value="banner">Banner</option>
          <option value="frame">Frame</option>
        </select>
      </div>
      <div className="prop-row">
        <label>Scale:</label>
        <input type="number" value={textSettings.scale} min="1" max="16" step="1" onChange={(e) => setTextSettings({ scale: Number(e.target.value) })} />
      </div>

      <h3>Canvas</h3>
      <div className="prop-row">
        <label>Preset:</label>
        <select
          value={matchCanvasPreset(canvasSettings.width, canvasSettings.height)}
          onChange={(e) => {
            const id = e.target.value as CanvasPresetId;
            if (id !== 'custom') applyCanvasPreset(id);
          }}
          title="Resize the artboard and the image columns to a platform size; sizes snap to the 8 x 16 cell grid"
        >
          {CANVAS_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="prop-row">
        <label>
          Size: {canvasSettings.width} x {canvasSettings.height} cells (
          {canvasSettings.width * CELL_SIZE.width} x {canvasSettings.height * CELL_SIZE.height} px)
        </label>
      </div>
      <div className="prop-row">
        <label>Width:</label>
        <input type="number" value={canvasSettings.width} min="1" max="500" onChange={(e) => setCanvasSettings({ width: Number(e.target.value) })} />
      </div>
      <div className="prop-row">
        <label>Height:</label>
        <input type="number" value={canvasSettings.height} min="1" max="500" onChange={(e) => setCanvasSettings({ height: Number(e.target.value) })} />
      </div>

      <div className="prop-row">
        <label>Subtexture:</label>
        <select
          value={canvasSettings.subtexture?.pattern ?? 'none'}
          onChange={(e) =>
            setCanvasSettings({
              subtexture: {
                ...(canvasSettings.subtexture ?? DEFAULT_SUBTEXTURE),
                pattern: e.target.value as SubtexturePattern,
              },
            })
          }
          title="Mask multiplied over the preview and the exported PNG"
        >
          <option value="none">None</option>
          <option value="scanlines">Scanlines</option>
          <option value="rgbStripes">RGB stripes (aperture grille)</option>
          <option value="rgbRosette">RGB rosettes (phosphor triads)</option>
          <option value="grid">Grid</option>
        </select>
      </div>
      {(canvasSettings.subtexture?.pattern ?? 'none') !== 'none' && (
        <>
          <Slider
            label="Mask scale"
            value={canvasSettings.subtexture.scale}
            min={1}
            max={16}
            step={1}
            display={`${canvasSettings.subtexture.scale}px`}
            onChange={(v) =>
              setCanvasSettings({
                subtexture: { ...canvasSettings.subtexture, scale: v },
              })
            }
          />
          <Slider
            label="Mask opacity"
            value={canvasSettings.subtexture.opacity ?? 0}
            min={0}
            max={1}
            step={0.05}
            display={`${Math.round((canvasSettings.subtexture.opacity ?? 0) * 100)}%`}
            onChange={(v) =>
              setCanvasSettings({
                subtexture: { ...canvasSettings.subtexture, opacity: v },
              })
            }
          />
          <div className="prop-row">
            <label>Mask edges:</label>
            <select
              value={canvasSettings.subtexture.interpolation}
              onChange={(e) =>
                setCanvasSettings({
                  subtexture: {
                    ...canvasSettings.subtexture,
                    interpolation: e.target.value as 'nearest' | 'linear',
                  },
                })
              }
            >
              <option value="linear">Smooth (cosine)</option>
              <option value="nearest">Hard (nearest)</option>
            </select>
          </div>
        </>
      )}

      <div className="mt-4 flex items-center gap-3 border-t border-line pt-3">
        <CipherAsciiLogo size={34} />
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-wide">cipherASCII</p>
          <p className="text-xs text-muted">
            Created by{' '}
            <a href="https://github.com/killerdasher" target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
              killerdasher
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export const SettingsPanel = memo(SettingsPanelInner);
