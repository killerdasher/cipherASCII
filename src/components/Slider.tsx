import { useId } from 'react';
import type { CSSProperties } from 'react';

export type SliderVariant = 'block' | 'inline' | 'compact';

export interface SliderProps {
  /** Visible label (block/inline) or aria-label only (compact). */
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Value text shown next to the track; defaults to the raw number. */
  display?: string;
  variant?: SliderVariant;
  disabled?: boolean;
  title?: string;
  className?: string;
}

/**
 * Normalised fill of the track in percent, clamped to 0..100. Drives the
 * accent gradient through the `--pct` custom property on the wrapper.
 */
export function sliderFillPercent(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return 0;
  }
  const pct = ((value - min) / (max - min)) * 100;
  return Math.min(100, Math.max(0, pct));
}

/**
 * The one range slider used across every panel: a filled track with a glowing
 * thumb, a header row (label + monospace value) and full keyboard support via
 * the native input. Variants:
 *
 * - `block`    - label/value above the track (prop rows)
 * - `inline`   - label, track and value on one row (onion skin controls)
 * - `compact`  - track + value only, label as aria-label (effect intensity)
 */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  variant = 'block',
  disabled,
  title,
  className,
}: SliderProps) {
  const id = useId();
  const pct = sliderFillPercent(value, min, max);
  const cls = ['slider', `slider--${variant}`, className].filter(Boolean).join(' ');

  return (
    <div className={cls} style={{ '--pct': `${pct}%` } as CSSProperties}>
      {variant !== 'compact' && (
        <label className="slider-label" htmlFor={id}>
          {label}
        </label>
      )}
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        title={title}
        aria-label={variant === 'compact' ? label : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="slider-value">{display ?? String(value)}</span>
    </div>
  );
}
