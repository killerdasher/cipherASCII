import { describe, expect, it } from 'vitest';
import {
  FRAME_PATTERN,
  VIDEO_FORMATS,
  buildVideoArgs,
  frameFileName,
  videoFrameNumbers,
  videoOutputName,
} from '../../src/core/export/videoArgs';

describe('VIDEO_FORMATS', () => {
  it('exposes mp4 and gif with matching extensions', () => {
    expect(VIDEO_FORMATS.map((f) => f.id)).toEqual(['mp4', 'gif']);
    expect(VIDEO_FORMATS.map((f) => f.ext)).toEqual(['mp4', 'gif']);
    for (const f of VIDEO_FORMATS) expect(f.label).toContain(f.id.toUpperCase());
  });
});

describe('frame naming', () => {
  it('zero-pads frame file names to the image2 pattern', () => {
    expect(FRAME_PATTERN).toBe('frame_%04d.png');
    expect(frameFileName(0)).toBe('frame_0000.png');
    expect(frameFileName(42)).toBe('frame_0042.png');
    expect(frameFileName(1234)).toBe('frame_1234.png');
  });

  it('maps formats to their output names', () => {
    expect(videoOutputName('mp4')).toBe('out.mp4');
    expect(videoOutputName('gif')).toBe('out.gif');
  });
});

describe('videoFrameNumbers', () => {
  it('returns the full 0-based frame range', () => {
    expect(videoFrameNumbers(300)).toHaveLength(300);
    expect(videoFrameNumbers(300)[0]).toBe(0);
    expect(videoFrameNumbers(300)[299]).toBe(299);
  });

  it('clamps degenerate durations to a single frame', () => {
    expect(videoFrameNumbers(0)).toEqual([0]);
    expect(videoFrameNumbers(-5)).toEqual([0]);
    expect(videoFrameNumbers(1.9)).toEqual([0]);
  });
});

describe('buildVideoArgs', () => {
  it('builds an H.264 MP4 command at the timeline fps', () => {
    const args = buildVideoArgs('mp4', 30);
    expect(args[0]).toBe('-framerate');
    expect(args[1]).toBe('30');
    expect(args).toContain('-start_number');
    expect(args).toContain('-i');
    expect(args[args.indexOf('-i') + 1]).toBe(FRAME_PATTERN);
    expect(args[args.indexOf('-c:v') + 1]).toBe('libx264');
    expect(args).toContain('-preset');
    expect(args[args.indexOf('-pix_fmt') + 1]).toBe('yuv420p');
    expect(args[args.indexOf('-movflags') + 1]).toBe('+faststart');
    expect(args[args.length - 1]).toBe('out.mp4');
  });

  it('falls back to mpeg4 without the libx264-only preset', () => {
    const args = buildVideoArgs('mp4', 24, 'mpeg4');
    expect(args[args.indexOf('-c:v') + 1]).toBe('mpeg4');
    expect(args).not.toContain('-preset');
    expect(args).toContain('-pix_fmt');
    expect(args[args.length - 1]).toBe('out.mp4');
  });

  it('builds a single-pass palette GIF command that loops forever', () => {
    const args = buildVideoArgs('gif', 12);
    const vf = args[args.indexOf('-vf') + 1];
    expect(vf).toContain('palettegen');
    expect(vf).toContain('paletteuse');
    expect(vf).toContain('dither=bayer');
    expect(args[args.indexOf('-loop') + 1]).toBe('0');
    expect(args).not.toContain('-c:v');
    expect(args[args.length - 1]).toBe('out.gif');
  });

  it('rounds fps and floors zero/negative rates to at least 1', () => {
    expect(buildVideoArgs('mp4', 29.97)[1]).toBe('30');
    expect(buildVideoArgs('mp4', 0)[1]).toBe('1');
    expect(buildVideoArgs('gif', -10)[1]).toBe('1');
  });
});
