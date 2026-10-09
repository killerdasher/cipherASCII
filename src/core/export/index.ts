/**
 * Exporter registry: the single dispatch point for every output format.
 *
 * Each format is described by an {@link Exporter} entry (id, file extension,
 * MIME type and an `export` function returning a {@link Result}). The UI asks
 * {@link listExporters} what it can offer and calls {@link runExport} to get
 * the payload; unknown ids fail with `unsupported-format` instead of throwing.
 */

import { Registry } from '../registry';
import { err, type ExportFormat, type Result } from '../types';
import {
  exportAnsi,
  exportAsc,
  exportJson,
  exportTxt,
  type ExportContext,
} from './textExporters';
import { exportHtml, exportSvg } from './webExporters';

export type { ExportContext };
export { renderExportFrame, createExportFrameSession } from './frame';
export type { ExportFrameOptions } from './frame';

/**
 * One selectable output format.
 */
export interface Exporter {
  /** Matches a member of {@link ExportFormat}. */
  id: ExportFormat;
  /** File extension without the dot (e.g. `txt`). */
  ext: string;
  /** MIME type used when downloading or sharing the payload. */
  mime: string;
  /** Produce the file content, or an error `Result` when it cannot be built. */
  export(ctx: ExportContext): Result<string | Uint8Array>;
}

const exporters = new Registry<Exporter>('exporter');

exporters.registerAll([
  { id: 'txt', ext: 'txt', mime: 'text/plain;charset=utf-8', export: exportTxt },
  { id: 'asc', ext: 'asc', mime: 'text/plain;charset=utf-8', export: exportAsc },
  { id: 'ansi', ext: 'ans', mime: 'text/plain;charset=utf-8', export: exportAnsi },
  { id: 'json', ext: 'json', mime: 'application/json', export: exportJson },
  { id: 'html', ext: 'html', mime: 'text/html;charset=utf-8', export: exportHtml },
  { id: 'svg', ext: 'svg', mime: 'image/svg+xml', export: exportSvg },
  {
    /** Native project format: the serialized document itself. */
    id: 'aap',
    ext: 'aap',
    mime: 'application/json',
    export: (ctx) =>
      ctx.document
        ? { ok: true, value: JSON.stringify(ctx.document, null, 2) }
        : err<string | Uint8Array>(
            'invalid-input',
            'Cannot export an .aap project without a document',
          ),
  },
  {
    /**
     * PNG is registered so the format appears in pickers and so dispatch
     * answers deterministically, but it CANNOT rasterize by itself: the core
     * has no canvas. The UI draws with `drawGridToContext` from `./png` and
     * encodes with `encodePng`; calling this entry returns `unsupported-format`.
     */
    id: 'png',
    ext: 'png',
    mime: 'image/png',
    export: () =>
      err<string | Uint8Array>(
        'unsupported-format',
        'PNG export requires a canvas rasterizer; use the application exporter',
      ),
  },
]);

/**
 * Run `format` against `ctx` through the exporter registry.
 *
 * @param format - Target {@link ExportFormat}.
 * @param ctx - Grid, export settings and optional source document.
 * @returns The exporter payload, or `unsupported-format` for an unknown id
 * (plus whatever error the chosen exporter itself reports).
 */
export function runExport(format: ExportFormat, ctx: ExportContext): Result<string | Uint8Array> {
  const exporter = exporters.get(format);
  if (!exporter) {
    return err<string | Uint8Array>(
      'unsupported-format',
      `Unknown export format '${format}'`,
      `Known: ${exporters.ids().join(', ')}`,
    );
  }
  return exporter.export(ctx);
}

/**
 * All registered exporters, in registration order (so the UI can build a
 * stable format picker).
 *
 * @returns A fresh array of {@link Exporter} entries.
 */
export function listExporters(): Exporter[] {
  return exporters.list();
}
