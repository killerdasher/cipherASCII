// @ts-nocheck - timeline UI still uses implicit any while it is migrated
import { memo } from 'react';
import React, { useState } from 'react';
import { useStore, useStoreShallow, selectTimeline, selectActiveTimelineId } from '../store';
import { Slider } from './Slider';
import { ANIMATABLE_PROPERTIES, readTrackValue } from '../core/timeline/playback';

function TimelinePanelInner() {
  const {
    timeline,
    createTimeline,
    addTimelineTrack,
    removeTimelineTrack,
    setTimelineCurrentFrame,
    setTimelinePlaying,
    setTimelineLoop,
    setOnionSkin,
  } = useStoreShallow(
    (s) => ({
      timeline: selectTimeline(s),
      activeTimelineId: selectActiveTimelineId(s),
      createTimeline: s.createTimeline,
      addTimelineTrack: s.addTimelineTrack,
      removeTimelineTrack: s.removeTimelineTrack,
      setTimelineCurrentFrame: s.setTimelineCurrentFrame,
      setTimelinePlaying: s.setTimelinePlaying,
      setTimelineLoop: s.setTimelineLoop,
      setOnionSkin: s.setOnionSkin,
    })
  );
  const [trackProperty, setTrackProperty] = useState('x');

  if (!timeline) {
    return (
      <div className="timeline-panel">
        <div className="panel-header">
          <h3>Timeline</h3>
          <button onClick={() => createTimeline()}>+ New Timeline</button>
        </div>
        <div className="timeline-empty">No timeline created</div>
      </div>
    );
  }

  const layers = useStore.getState().document.layers;

  const handleAddTrack = () => {
    if (layers.length === 0) return;
    const prop = ANIMATABLE_PROPERTIES.find((p) => p.path === trackProperty)
      ?? ANIMATABLE_PROPERTIES[0];
    addTimelineTrack(layers[0].id, prop.path, prop.label);
  };

  const formatTime = (frame: number, fps: number) => {
    const totalSeconds = frame / fps;
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    const frames = frame % fps;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${frames.toString().padStart(2, '0')}`;
  };

  const seekFromEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
    setTimelineCurrentFrame(Math.round(pct * (timeline.duration - 1)));
  };

  return (
    <div className="timeline-panel">
      <div className="panel-header">
        <h3>Timeline</h3>
        <div className="panel-actions">
          <button onClick={() => createTimeline()}>+</button>
        </div>
      </div>

      <div className="timeline-toolbar">
        <div className="transport-controls">
          <button
            onClick={() => setTimelineCurrentFrame(0)}
            title="Jump to Start"
            disabled={timeline.currentFrame === 0}
          >
            ⏮
          </button>
          <button
            onClick={() => setTimelineCurrentFrame(Math.max(0, timeline.currentFrame - 1))}
            title="Previous Frame"
            disabled={timeline.currentFrame === 0}
          >
            ◀
          </button>
          <button
            onClick={() => setTimelinePlaying(!timeline.playing)}
            className={timeline.playing ? 'playing' : ''}
            title={timeline.playing ? 'Pause' : 'Play'}
          >
            {timeline.playing ? '⏸' : '▶'}
          </button>
          <button
            onClick={() => setTimelineCurrentFrame(Math.min(timeline.duration - 1, timeline.currentFrame + 1))}
            title="Next Frame"
            disabled={timeline.currentFrame >= timeline.duration - 1}
          >
            ▶
          </button>
          <button
            onClick={() => setTimelineCurrentFrame(timeline.duration - 1)}
            title="Jump to End"
            disabled={timeline.currentFrame >= timeline.duration - 1}
          >
            ⏭
          </button>
          <label className="loop-toggle">
            <input
              type="checkbox"
              checked={timeline.loop}
              onChange={(e) => setTimelineLoop(e.target.checked)}
            />
            Loop
          </label>
        </div>

        <div className="time-display">
          <span>{formatTime(timeline.currentFrame, timeline.fps)} / {formatTime(timeline.duration, timeline.fps)}</span>
          <span>@{timeline.fps}fps</span>
        </div>

        <div className="timeline-options">
          <label>
            FPS:
            <input
              type="number"
              min="1"
              max="120"
              value={timeline.fps}
              onChange={(e) => useStore.getState().timeline && useStore.setState({ timeline: { ...useStore.getState().timeline!, fps: Number(e.target.value) } })}
            />
          </label>
          <label>
            Duration:
            <input
              type="number"
              min="1"
              max="10000"
              value={timeline.duration}
              onChange={(e) => useStore.getState().timeline && useStore.setState({ timeline: { ...useStore.getState().timeline!, duration: Number(e.target.value) } })}
            />
          </label>
        </div>
      </div>

      <div className="timeline-tracks">
        <div className="track-header">
          <div className="track-name-col">Track</div>
          <div className="track-ruler" onClick={seekFromEvent} title="Click to seek">
            {Array.from({ length: 20 }, (_, k) => {
              const pct = k * 5;
              const frame = Math.round((pct / 100) * timeline.duration);
              return k % 2 === 0 ? (
                <div key={k} className="ruler-mark major" style={{ left: `${pct}%` }}>{frame}</div>
              ) : (
                <div key={k} className="ruler-mark minor" style={{ left: `${pct}%` }} />
              );
            })}
          </div>
        </div>

        {timeline.tracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            timeline={timeline}
            onRemoveTrack={() => removeTimelineTrack(track.id)}
          />
        ))}

        <div className="add-track-row">
          <select
            value={trackProperty}
            onChange={(e) => setTrackProperty(e.target.value)}
            aria-label="Track property"
          >
            {ANIMATABLE_PROPERTIES.map((p) => (
              <option key={p.path} value={p.path}>{p.label}</option>
            ))}
          </select>
          <button className="add-track-btn" onClick={handleAddTrack}>
            + Add Track
          </button>
        </div>
      </div>

      <div className="onion-skin-controls">
        <label>
          <input
            type="checkbox"
            checked={timeline.onionSkinEnabled}
            onChange={(e) => setOnionSkin(e.target.checked, timeline.onionSkinFrames, timeline.onionSkinOpacity)}
          />
          Onion Skin
        </label>
        <label>
          Frames:
          <input
            type="number"
            min="0"
            max="10"
            value={timeline.onionSkinFrames}
            onChange={(e) => setOnionSkin(timeline.onionSkinEnabled, Number(e.target.value), timeline.onionSkinOpacity)}
          />
        </label>
        <Slider
          variant="inline"
          label="Opacity"
          value={timeline.onionSkinOpacity}
          min={0}
          max={1}
          step={0.1}
          display={`${Math.round(timeline.onionSkinOpacity * 100)}%`}
          onChange={(v) => setOnionSkin(timeline.onionSkinEnabled, timeline.onionSkinFrames, v)}
        />
      </div>
    </div>
  );
}

function TrackRow({
  track,
  timeline,
  onRemoveTrack,
}: {
  track: any;
  timeline: any;
  onRemoveTrack: () => void;
}) {
  const layer = useStore.getState().document.layers.find((l) => l.id === track.layerId);

  return (
    <div className="track-row">
      <div className="track-info">
        <button className="track-remove" onClick={onRemoveTrack} title="Remove Track">✕</button>
        <span className="track-name">{track.name}</span>
        <span className="track-target">{layer?.name} - {track.property}</span>
        <button
          className="track-add-kf"
          title={`Add a ${track.property} keyframe for frame ${timeline.currentFrame} with the current value`}
          onClick={() => {
            const store = useStore.getState();
            const value = readTrackValue(store.document, track.layerId, track.property);
            if (value === null) {
              store.setStatusMessage(`Cannot keyframe "${track.property}" on this layer`);
              return;
            }
            store.setTimelineKeyframe(track.id, timeline.currentFrame, value);
            store.setStatusMessage(
              `Keyframe added: ${track.name} = ${value} at frame ${timeline.currentFrame}`,
            );
          }}
        >
          ◆
        </button>
      </div>
      <div
        className="track-timeline"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
          useStore.getState().setTimelineCurrentFrame(Math.round(pct * (timeline.duration - 1)));
        }}
        title="Click to seek"
      >
        <div className="keyframes">
          {track.keyframes.map((kf: any) => {
            const pct = (kf.frame / timeline.duration) * 100;
            const offset = kf.frame === 0 ? 5 : kf.frame >= timeline.duration - 1 ? -5 : 0;
            return (
              <div
                key={kf.frame}
                className="keyframe"
                style={{ left: `calc(${pct}% + ${offset}px)` }}
                title={`Frame ${kf.frame}: ${JSON.stringify(kf.value)} - click to remove`}
                onClick={(e) => {
                  e.stopPropagation();
                  useStore.getState().removeTimelineKeyframe(track.id, kf.frame);
                }}
              />
            );
          })}
        </div>
        <div
          className="playhead"
          style={{
            left: `calc(${(timeline.currentFrame / timeline.duration) * 100}% + ${
              timeline.currentFrame === 0 ? 5 : 0
            }px)`,
          }}
        />
      </div>
    </div>
  );
}

export const TimelinePanel = memo(TimelinePanelInner);
