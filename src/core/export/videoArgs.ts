/**
 * FFmpeg command lines for the video exporters. Pure data - the actual
 * encoding runs through @ffmpeg/ffmpeg in the renderer (this module keeps the
 * core DOM-free and lets the tests assert the exact arguments).
 */

export type VideoFormatId = 'mp4' | 'gif';

export const VIDEO_FORMATS: ReadonlyArray<{ id: VideoFormatId; label: string; ext: string }> = [
  { id: 'mp4', label: 'MP4 Video (.mp4)', ext: 'mp4' },
  { id: 'gif', label: 'Animated GIF (.gif)', ext: 'gif' },
];

/** PNG frame file name pattern consumed by the image2 demuxer. */
export const FRAME_PATTERN = 'frame_%04d.png';

/** Frame number of the i-th exported frame (0-based). */
export function frameFileName(index: number): string {
  return FRAME_PATTERN.replace('%04d', String(index).padStart(4, '0'));
}

/**
 * The FFmpeg argv for one export run.
 *
 * - MP4: H.264 (`libx264`, present in the bundled core) at the timeline fps,
 *   `yuv420p` + `+faststart` for player compatibility. Cell rasters are always
 *   an even number of pixels (18/36 px cells), which `yuv420p` requires.
 * - GIF: single-pass palettegen/paletteuse with Bayer dithering, looping
 *   forever (`-loop 0`).
 *
 * `codec` lets the caller retry with `mpeg4` when libx264 is unavailable in a
 * differently-built core.
 */
export function buildVideoArgs(
  format: VideoFormatId,
  fps: number,
  codec: 'libx264' | 'mpeg4' = 'libx264',
): string[] {
  const rate = String(Math.max(1, Math.round(fps)));
  const input = ['-framerate', rate, '-start_number', '0', '-i', FRAME_PATTERN];
  if (format === 'mp4') {
    return [
      ...input,
      '-c:v', codec,
      ...(codec === 'libx264' ? ['-preset', 'veryfast'] : []),
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y', 'out.mp4',
    ];
  }
  return [
    ...input,
    '-vf', 'split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
    '-loop', '0',
    '-y', 'out.gif',
  ];
}

/** Output file name inside the ffmpeg virtual FS for a format. */
export function videoOutputName(format: VideoFormatId): string {
  return format === 'mp4' ? 'out.mp4' : 'out.gif';
}

/**
 * Frame numbers to export for a timeline of `duration` frames - always the
 * full range so the clip length matches `duration / fps` seconds.
 */
export function videoFrameNumbers(duration: number): number[] {
  const count = Math.max(1, Math.floor(duration));
  return Array.from({ length: count }, (_, i) => i);
}
