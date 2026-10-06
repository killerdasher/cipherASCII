import { err, NO_COLOR, type Result } from '../types';
import { toHex } from '../color';
import type { ExportContext } from './textExporters';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeXml(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

interface Run {
  text: string;
  fg: number;
  bg: number;
}

function htmlRuns(ctx: ExportContext, y: number): Run[] {
  const { grid, settings } = ctx;
  const useFg = settings.includeColors && grid.fg !== null;
  const useBg = settings.includeColors && grid.bg !== null;
  const runs: Run[] = [];
  let cur: Run | null = null;
  for (let x = 0; x < grid.width; x++) {
    const i = y * grid.width + x;
    const fg = useFg && grid.fg ? grid.fg[i] : NO_COLOR;
    const bg = useBg && grid.bg ? grid.bg[i] : NO_COLOR;
    if (cur && cur.fg === fg && cur.bg === bg) {
      cur.text += grid.chars[i];
    } else {
      cur = { text: grid.chars[i], fg, bg };
      runs.push(cur);
    }
  }
  return runs;
}

function htmlRow(ctx: ExportContext, y: number): string {
  return htmlRuns(ctx, y)
    .map((run) => {
      const styles: string[] = [];
      if (run.fg !== NO_COLOR) styles.push(`color: ${toHex(run.fg)}`);
      if (run.bg !== NO_COLOR) styles.push(`background-color: ${toHex(run.bg)}`);
      const content = escapeHtml(run.text);
      return styles.length > 0 ? `<span style="${styles.join('; ')}">${content}</span>` : content;
    })
    .join('');
}

function svgRuns(ctx: ExportContext, y: number): Run[] {
  const { grid } = ctx;
  const runs: Run[] = [];
  let cur: Run | null = null;
  for (let x = 0; x < grid.width; x++) {
    const i = y * grid.width + x;
    const fg = grid.fg ? grid.fg[i] : NO_COLOR;
    if (cur && cur.fg === fg) {
      cur.text += grid.chars[i];
    } else {
      cur = { text: grid.chars[i], fg, bg: NO_COLOR };
      runs.push(cur);
    }
  }
  return runs;
}

/**
 * Export the grid as a complete, self-contained HTML5 document: the export
 * settings drive the inline stylesheet (background, foreground, font and line
 * metrics) and, when colors are enabled, consecutive cells sharing the same
 * foreground or background are coalesced into a single inline-styled span.
 * Every piece of art text and the document title are HTML-escaped.
 *
 * @param ctx - Grid plus export settings and optional source document.
 * @returns The HTML payload, or an `invalid-input` error for an empty grid.
 */
export function exportHtml(ctx: ExportContext): Result<string> {
  const { grid, settings } = ctx;
  if (grid.width === 0 || grid.height === 0) {
    return err<string>(
      'invalid-input',
      'Cannot export an empty grid',
      `width=${grid.width}, height=${grid.height}`,
    );
  }
  const bg = settings.html.background === null ? 'transparent' : toHex(settings.html.background);
  const color = settings.html.foreground === null ? '' : `\n  color: ${toHex(settings.html.foreground)};`;
  const rows: string[] = [];
  for (let y = 0; y < grid.height; y++) {
    rows.push(htmlRow(ctx, y));
  }
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(settings.html.title)}</title>
<style>
body {
  margin: 0;
  padding: 0;
}
pre {
  background: ${bg};${color}
  font-family: ${settings.html.fontFamily};
  font-size: ${settings.html.fontSize}px;
  line-height: ${settings.html.lineHeight};
  white-space: pre;
  margin: 0;
  padding: 16px;
}
</style>
</head>
<body>
<pre>${rows.join('\n')}</pre>
</body>
</html>
`;
  return { ok: true, value: html };
}

/**
 * Export the grid as a standalone SVG document: a root element sized from the
 * grid dimensions, font metrics and a `0.6` character-width factor, an
 * optional background rectangle, and one `<text>` element per row whose
 * `<tspan>` children are coalesced by foreground color and positioned with
 * `x`/`dy` attributes. Text is XML-escaped, and the project name becomes the
 * SVG `<title>` when a document is supplied.
 *
 * @param ctx - Grid plus export settings and optional source document.
 * @returns The SVG payload, or an `invalid-input` error for an empty grid.
 */
export function exportSvg(ctx: ExportContext): Result<string> {
  const { grid, settings, document } = ctx;
  if (grid.width === 0 || grid.height === 0) {
    return err<string>(
      'invalid-input',
      'Cannot export an empty grid',
      `width=${grid.width}, height=${grid.height}`,
    );
  }
  const fontSize = settings.svg.fontSize;
  const charWidth = fontSize * 0.6;
  const width = grid.width * charWidth;
  const height = grid.height * fontSize * settings.svg.lineHeight;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  );
  if (settings.svg.background !== null) {
    parts.push(`<rect width="${width}" height="${height}" fill="${toHex(settings.svg.background)}"/>`);
  }
  for (let y = 0; y < grid.height; y++) {
    const baseline = fontSize * (1 + y * settings.svg.lineHeight);
    const tspans: string[] = [];
    let x = 0;
    let first = true;
    for (const run of svgRuns(ctx, y)) {
      const fill = run.fg !== NO_COLOR ? ` fill="${toHex(run.fg)}"` : '';
      const dy = first ? baseline : 0;
      tspans.push(
        `<tspan x="${x * charWidth}" dy="${dy}"${fill}>${escapeXml(run.text)}</tspan>`,
      );
      x += run.text.length;
      first = false;
    }
    parts.push(
      `<text xml:space="preserve" font-family="${escapeXml(settings.svg.fontFamily)}" font-size="${fontSize}">${tspans.join('')}</text>`,
    );
  }
  if (document) {
    parts.push(`<title>${escapeXml(document.metadata.name)}</title>`);
  }
  parts.push('</svg>');
  return { ok: true, value: `${parts.join('\n')}\n` };
}
