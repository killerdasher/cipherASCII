import { useStore } from '../store';
import { describeTraits, type RenderRecommendation } from '../core/analyze';

/**
 * Suggestion chips from the auto glyph/dither analyzer ("auto analysis").
 * Shown after an image import or a palette-triggered analysis; applying a
 * chip writes the charset + dither into the render settings in one step.
 */
export function RenderSuggestions() {
  const analysis = useStore((s) => s.renderAnalysis);
  const setRenderAnalysis = useStore((s) => s.setRenderAnalysis);
  const imageSettings = useStore((s) => s.document.imageSettings);
  const setImageSettings = useStore((s) => s.setImageSettings);
  const setStatusMessage = useStore((s) => s.setStatusMessage);

  if (!analysis) return null;

  const apply = (r: RenderRecommendation) => {
    setImageSettings({
      output: { ...imageSettings.output, charset: r.chars },
      dither: { ...imageSettings.dither, algorithm: r.ditherId },
    });
    setStatusMessage(`Applied ${r.charsetLabel} x ${r.ditherLabel}`);
    setRenderAnalysis(null);
  };

  return (
    <div className="suggestion-strip" role="status" aria-label="Auto analysis suggestions">
      <span className="suggestion-title">
        Auto analysis: {analysis.source}
        <span className="suggestion-trait"> - {describeTraits(analysis.traits)}</span>
      </span>
      {analysis.recommendations.slice(0, 3).map((r) => (
        <button
          key={`${r.charsetId}:${r.ditherId}`}
          type="button"
          className="suggestion-chip"
          title={`${r.charsetLabel} x ${r.ditherLabel} - score ${r.score.toFixed(2)} (structure ${r.metrics.soft}, detail ${r.metrics.sharp}, banding ${r.metrics.deflat})`}
          onClick={() => apply(r)}
        >
          {r.charsetLabel}
          <span className="suggestion-dither">x {r.ditherLabel}</span>
          <span className="suggestion-score">{r.score.toFixed(2)}</span>
        </button>
      ))}
      <button
        type="button"
        className="suggestion-dismiss"
        onClick={() => setRenderAnalysis(null)}
      >
        Dismiss
      </button>
    </div>
  );
}
