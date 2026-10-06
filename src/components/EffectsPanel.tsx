import { memo } from 'react';
import { useStore, useStoreShallow, selectEffectsPipeline, selectCellEffects, selectFxSeed } from '../store';
import type { EffectSettings, EffectId } from '../core/types';
import type { CellEffectEntry } from '../core/fx/pipeline';
import { effectsByCategory as cellEffectsByCategory, getCellEffect } from '../core/fx';
import { Slider } from './Slider';

function EffectsPanelInner() {
  const { effectsPipeline, removeEffect, reorderEffects, resetEffectsPipeline, cellEffects, fxSeed } =
    useStoreShallow((s) => ({
      effectsPipeline: selectEffectsPipeline(s),
      removeEffect: s.removeEffect,
      reorderEffects: s.reorderEffects,
      resetEffectsPipeline: s.resetEffectsPipeline,
      cellEffects: selectCellEffects(s),
      fxSeed: selectFxSeed(s),
    }));

  const availableEffects: { id: EffectId; category: string }[] = [
    { id: 'epsilonGlow', category: 'glow' },
    { id: 'jpegGlitch', category: 'glitch' },
    { id: 'chromaticAberration', category: 'glitch' },
    { id: 'scanlines', category: 'texture' },
    { id: 'vignette', category: 'style' },
    { id: 'filmGrain', category: 'texture' },
    { id: 'bloom', category: 'glow' },
    { id: 'diffractionStars', category: 'glow' },
    { id: 'crtCurvature', category: 'distortion' },
    { id: 'colorShift', category: 'color' },
    { id: 'paletteShift', category: 'color' },
    { id: 'ditherOverlay', category: 'texture' },
    { id: 'edgeEnhance', category: 'style' },
    { id: 'sharpen', category: 'style' },
    { id: 'blur', category: 'blur' },
    { id: 'noise', category: 'texture' },
    { id: 'halftoneOverlay', category: 'texture' },
    { id: 'medianFilter', category: 'blur' },
    { id: 'motionBlur', category: 'blur' },
    { id: 'lensDistortion', category: 'distortion' },
  ];

  const effectsByCategory = availableEffects.reduce((acc, effect) => {
    if (!acc[effect.category]) acc[effect.category] = [];
    acc[effect.category].push(effect.id);
    return acc;
  }, {} as Record<string, EffectId[]>);

  const moveEffect = (index: number, direction: number) => {
    const newIndex = index + direction;
    if (newIndex >= 0 && newIndex < effectsPipeline.effects.length) {
      reorderEffects(index, newIndex);
    }
  };

  return (
    <div className="effects-panel">
      <div className="panel-header">
        <h3>Effects Pipeline</h3>
        <div className="panel-actions">
          <button onClick={resetEffectsPipeline} title="Reset Pipeline">↺</button>
        </div>
      </div>

      <div className="effects-list">
        {effectsPipeline.effects.length === 0 ? (
          <div className="effects-empty">
            <p>No effects added</p>
            <p className="hint">Click an effect below to add it to the pipeline</p>
          </div>
        ) : (
          effectsPipeline.effects.map((effect, index) => (
            <EffectItem
              key={`${effect.id}-${index}`}
              effect={effect}
              index={index}
              count={effectsPipeline.effects.length}
              onMoveUp={() => moveEffect(index, -1)}
              onMoveDown={() => moveEffect(index, 1)}
              onRemove={() => removeEffect(index)}
              onToggle={(enabled) => useStore.getState().setEffectEnabled(index, enabled)}
              onIntensityChange={(intensity) => useStore.getState().setEffectIntensity(index, intensity)}
              onParamsChange={(params) => useStore.getState().updateEffectParams(index, params)}
            />
          ))
        )}
      </div>

      <div className="effects-library">
        <h4>Available Effects</h4>
        <div className="effects-categories">
          {Object.entries(effectsByCategory).map(([category, effects]) => (
            <div key={category} className="effect-category">
              <h5>{category.charAt(0).toUpperCase() + category.slice(1)}</h5>
              <div className="effect-buttons">
                {effects.map((effectId) => (
                  <button
                    key={effectId}
                    className="effect-add-btn"
                    onClick={() => useStore.getState().addEffect(effectId)}
                    title={effectId}
                  >
                    {effectId}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="cell-effects-section">
        <div className="panel-header">
          <h3>Cell Effects</h3>
          <div className="panel-actions">
            <input
              type="number"
              className="fx-seed-input"
              value={fxSeed}
              title="Random seed - the same seed always draws the same animation"
              onChange={(e) => useStore.getState().setFxSeed(Number(e.target.value))}
            />
            <button
              title="Randomise seed"
              onClick={() => useStore.getState().setFxSeed(Math.floor(Math.random() * 0x7fffffff))}
            >
              ⚄
            </button>
            <button onClick={() => useStore.getState().resetCellEffects()} title="Clear cell effects">
              ↺
            </button>
          </div>
        </div>

        <div className="effects-list">
          {cellEffects.length === 0 ? (
            <div className="effects-empty">
              <p>No cell effects</p>
              <p className="hint">Glyph animations that play over the document grid</p>
            </div>
          ) : (
            cellEffects.map((entry, index) => (
              <CellEffectItem
                key={`${entry.effect}-${index}`}
                entry={entry}
                index={index}
                count={cellEffects.length}
                onMoveUp={() => useStore.getState().reorderCellEffect(index, index - 1)}
                onMoveDown={() => useStore.getState().reorderCellEffect(index, index + 1)}
                onRemove={() => useStore.getState().removeCellEffect(index)}
                onToggle={(enabled) => useStore.getState().setCellEffectEnabled(index, enabled)}
                onIntensityChange={(intensity) =>
                  useStore.getState().setCellEffectIntensity(index, intensity)
                }
                onParamsChange={(params) => useStore.getState().updateCellEffectParams(index, params)}
              />
            ))
          )}
        </div>

        <div className="effects-library">
          <h4>Add Cell Effect</h4>
          <div className="effects-categories">
            {Array.from(cellEffectsByCategory()).map(([category, effects]) => (
              <div key={category} className="effect-category">
                <h5>{category}</h5>
                <div className="effect-buttons">
                  {effects.map((effect) => (
                    <button
                      key={effect.id}
                      className="effect-add-btn"
                      onClick={() => useStore.getState().addCellEffect(effect.id)}
                      title={effect.description}
                    >
                      {effect.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** One row of the cell-effect stack: toggle, intensity, parameters, order. */
function CellEffectItem({
  entry,
  index,
  count,
  onMoveUp,
  onMoveDown,
  onRemove,
  onToggle,
  onIntensityChange,
  onParamsChange,
}: {
  entry: CellEffectEntry;
  index: number;
  count: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onToggle: (enabled: boolean) => void;
  onIntensityChange: (intensity: number) => void;
  onParamsChange: (params: Record<string, number>) => void;
}) {
  const effect = getCellEffect(entry.effect);
  const intensity = entry.intensity ?? 1;
  return (
    <div className={`effect-item ${entry.enabled === false ? 'disabled' : 'enabled'}`}>
      <div className="effect-main">
        <label className="effect-toggle">
          <input
            type="checkbox"
            checked={entry.enabled !== false}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span className="effect-name">{effect?.label ?? entry.effect}</span>
        </label>
        <Slider
          variant="compact"
          label={`${effect?.label ?? entry.effect} intensity`}
          value={intensity}
          min={0}
          max={1}
          step={0.05}
          display={`${Math.round(intensity * 100)}%`}
          onChange={onIntensityChange}
        />
      </div>
      <div className="effect-controls">
        <button onClick={onMoveUp} disabled={index === 0} title="Move Up">
          ↑
        </button>
        <button onClick={onMoveDown} disabled={index === count - 1} title="Move Down">
          ↓
        </button>
        <button onClick={onRemove} title="Remove">
          ✕
        </button>
      </div>
      {effect && (
        <div className="effect-params">
          <p className="effect-description">{effect.description}</p>
          {effect.params.map((def) => (
            <Slider
              key={def.key}
              variant="compact"
              label={def.label}
              value={entry.params?.[def.key] ?? def.default}
              min={def.min}
              max={def.max}
              step={def.step}
              display={`${entry.params?.[def.key] ?? def.default}${def.unit ? ` ${def.unit}` : ''}`}
              onChange={(value) => onParamsChange({ [def.key]: value })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EffectItem({
  effect,
  index,
  count,
  onMoveUp,
  onMoveDown,
  onRemove,
  onToggle,
  onIntensityChange,
  onParamsChange,
}: {
  effect: EffectSettings;
  index: number;
  count: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onToggle: (enabled: boolean) => void;
  onIntensityChange: (intensity: number) => void;
  onParamsChange: (params: Record<string, any>) => void;
}) {
  return (
    <div className={`effect-item ${effect.enabled ? 'enabled' : 'disabled'}`}>
      <div className="effect-drag-handle" onMouseDown={(e) => e.stopPropagation()}>⋮⋮</div>
      <div className="effect-main">
        <label className="effect-toggle">
          <input
            type="checkbox"
            checked={effect.enabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span className="effect-name">{effect.id}</span>
        </label>
        <Slider
          variant="compact"
          label={`${effect.id} intensity`}
          value={effect.intensity}
          min={0}
          max={1}
          step={0.05}
          display={`${Math.round(effect.intensity * 100)}%`}
          onChange={onIntensityChange}
        />
      </div>
      <div className="effect-controls">
        <button onClick={onMoveUp} disabled={index === 0} title="Move Up">↑</button>
        <button onClick={onMoveDown} disabled={index === count - 1} title="Move Down">↓</button>
        <button onClick={onRemove} title="Remove">✕</button>
      </div>
      <div className="effect-params">
        {Object.entries(effect.params).map(([key, value]) => (
          <div key={key} className="param-row">
            <label>{key}:</label>
            {typeof value === 'boolean' ? (
              <input
                type="checkbox"
                checked={value}
                onChange={(e) => onParamsChange({ [key]: e.target.checked })}
              />
            ) : typeof value === 'number' ? (
              <input
                type="number"
                value={value}
                step="0.01"
                onChange={(e) => onParamsChange({ [key]: Number(e.target.value) })}
              />
            ) : (
              <input
                type="text"
                value={String(value)}
                onChange={(e) => onParamsChange({ [key]: e.target.value })}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export const EffectsPanel = memo(EffectsPanelInner);
