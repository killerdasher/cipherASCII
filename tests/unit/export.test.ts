import { asciiFallback, toAsciiOnly } from '../../src/core/export/fallback';
import { listExporters, runExport } from '../../src/core/export/index';
import { encodePng } from '../../src/core/export/png';
import {
  exportAnsi,
  exportAsc,
  exportJson,
  exportTxt,
  type ExportContext,
} from '../../src/core/export/textExporters';
import { exportHtml, exportSvg } from '../../src/core/export/webExporters';
import { gridToLines, linesToGrid } from '../../src/core/grid';
import {
  DEFAULT_EXPORT,
  StudioError,
  type ExportFormat,
  type Result,
} from '../../src/core/types';

const ESC = String.fromCharCode(27);

function hasControlChar(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Build an ExportContext from two equal-width rows. The settings constant is
 * exported as `DEFAULT_EXPORT` (there is no `DEFAULT_EXPORT_SETTINGS`), and
 * `ExportContext.document` is `Document | undefined` — the type carries no
 * `null`, so "no document" is expressed by leaving the optional field unset.
 */
function makeCtx(lines: readonly string[] = ['abc', 'def']): ExportContext {
  return {
    grid: linesToGrid(lines),
    settings: structuredClone(DEFAULT_EXPORT),
    document: undefined,
  };
}

function value<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok result, got ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

function failure<T>(result: Result<T>): StudioError {
  if (result.ok) throw new Error('expected an error result');
  return result.error;
}

describe('exportTxt', () => {
  it('joins rows with newlines, appends a trailing newline and matches the grid', () => {
    const ctx = makeCtx();
    expect(ctx.grid.width).toBe(3);
    expect(ctx.grid.height).toBe(2);

    const text = value(exportTxt(ctx));
    expect(text).toBe('abc\ndef\n');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.split('\n')).toEqual(['abc', 'def', '']);
    expect(text).toBe(`${gridToLines(ctx.grid).join('\n')}\n`);
  });

  it('rejects an empty grid with invalid-input', () => {
    expect(failure(exportTxt(makeCtx([]))).code).toBe('invalid-input');
  });
});

describe('exportAsc', () => {
  // Real contract (textExporters.ts): exportAsc is documented as "identical
  // to exportTxt but exposed as its own entry point" — there is NO "@" line
  // prefix; .asc is byte-for-byte the plain-text payload.
  it('produces the exact same payload as exportTxt, with no "@" prefix', () => {
    const ctx = makeCtx();
    const asc = value(exportAsc(ctx));
    expect(asc).toBe(value(exportTxt(ctx)));
    expect(asc).toBe('abc\ndef\n');
    expect(asc.startsWith('@')).toBe(false);
    expect(asc.split('\n')).toEqual(['abc', 'def', '']);
  });
});

describe('exportAnsi', () => {
  it('emits plain text when the grid carries no color planes', () => {
    const text = value(exportAnsi(makeCtx()));
    expect(text).toBe('abc\ndef\n');
    expect(text.includes(ESC)).toBe(false);
  });

  it('brackets every row with resets and emits truecolor foreground codes', () => {
    const ctx = makeCtx();
    ctx.grid.fg = new Int32Array(ctx.grid.width * ctx.grid.height).fill(0xff0000);

    const out = value(exportAnsi(ctx));
    expect(out).toBe(
      `${ESC}[0m${ESC}[38;2;255;0;0mabc${ESC}[0m\n` +
        `${ESC}[0m${ESC}[38;2;255;0;0mdef${ESC}[0m\n` +
        `${ESC}[0m`,
    );
    expect(out.split('\n')).toHaveLength(3);
    expect(out.endsWith(`${ESC}[0m`)).toBe(true);
  });

  it('emits background codes and never a bare ESC that lacks "["', () => {
    const ctx = makeCtx();
    const cells = ctx.grid.width * ctx.grid.height;
    ctx.grid.fg = new Int32Array(cells).fill(0x00ff00);
    ctx.grid.bg = new Int32Array(cells).fill(0x0000ff);

    const out = value(exportAnsi(ctx));
    expect(out).toContain(`${ESC}[38;2;0;255;0m`);
    expect(out).toContain(`${ESC}[48;2;0;0;255m`);
    expect(out.includes(ESC)).toBe(true);
    for (let i = 0; i < out.length; i++) {
      if (out[i] === ESC) expect(out[i + 1]).toBe('[');
    }
  });
});

describe('exportJson', () => {
  it('emits a versioned document with dimensions and per-row lines', () => {
    const parsed = JSON.parse(value(exportJson(makeCtx()))) as Record<string, unknown>;

    expect(Object.keys(parsed).sort()).toEqual(['format', 'height', 'lines', 'version', 'width']);
    expect(parsed.format).toBe('ascii-art-studio/json');
    expect(parsed.version).toBe(1);
    expect(parsed.width).toBe(3);
    expect(parsed.height).toBe(2);
    expect(parsed.lines).toEqual(['abc', 'def']);
    expect(parsed).not.toHaveProperty('rows');
    expect(parsed).not.toHaveProperty('fg');
    expect(parsed).not.toHaveProperty('bg');
    expect(parsed).not.toHaveProperty('metadata');
  });

  it('adds per-row fg planes only when colors are included', () => {
    const ctx = makeCtx();
    ctx.grid.fg = new Int32Array(ctx.grid.width * ctx.grid.height).fill(0x112233);

    const colored = JSON.parse(value(exportJson(ctx))) as { fg?: number[][] };
    expect(colored.fg).toEqual([
      [0x112233, 0x112233, 0x112233],
      [0x112233, 0x112233, 0x112233],
    ]);

    ctx.settings.includeColors = false;
    const plain = JSON.parse(value(exportJson(ctx))) as { fg?: number[][] };
    expect(plain).not.toHaveProperty('fg');
  });
});

describe('exportHtml', () => {
  it('emits a doctype, the escaped title and a <pre> holding the rows', () => {
    const ctx = makeCtx();
    ctx.settings.html.title = 'My Art & <Lab>';

    const html = value(exportHtml(ctx));
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<title>My Art &amp; &lt;Lab&gt;</title>');
    expect(html).toContain('<pre>abc\ndef</pre>');
    expect(html.endsWith('</html>\n')).toBe(true);
    expect(failure(exportHtml(makeCtx([]))).code).toBe('invalid-input');
  });

  it('HTML-escapes cells containing "<" and "&"', () => {
    const html = value(exportHtml(makeCtx(['a<&', '<&b'])));
    expect(html).toContain('a&lt;&amp;');
    expect(html).toContain('&lt;&amp;b');
    expect(html).not.toContain('a<&');
    expect(html).not.toContain('<&b');
  });
});

describe('exportSvg', () => {
  it('sizes the root element from grid metrics and omits <title> without a document', () => {
    const ctx = makeCtx();
    const svg = value(exportSvg(ctx));

    expect(svg).toContain('<svg');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    const fontSize = ctx.settings.svg.fontSize;
    const charWidth = fontSize * 0.6;
    expect(svg).toContain(`width="${ctx.grid.width * charWidth}"`);
    expect(svg).toContain(`height="${ctx.grid.height * fontSize * ctx.settings.svg.lineHeight}"`);
    expect(svg).not.toContain('<title>');
    expect(svg.endsWith('</svg>\n')).toBe(true);
    expect(failure(exportSvg(makeCtx([]))).code).toBe('invalid-input');
  });

  it('XML-escapes row text', () => {
    const svg = value(exportSvg(makeCtx(['a<&', '<"b'])));
    expect(svg).toContain('>a&lt;&amp;</tspan>');
    expect(svg).toContain('&lt;&quot;b</tspan>');
    expect(svg).not.toContain('>a<&');
  });
});

describe('asciiFallback', () => {
  it('maps box-drawing characters to ASCII stand-ins', () => {
    expect(asciiFallback('─')).toBe('-');
    expect(asciiFallback('│')).toBe('|');
    expect(asciiFallback('┌')).toBe('+');
    expect(asciiFallback('└')).toBe('+');
    expect(asciiFallback('━')).toBe('=');
  });

  it('returns null for characters outside its table', () => {
    expect(asciiFallback('⣿')).toBeNull();
    expect(asciiFallback('a')).toBeNull();
    expect(asciiFallback(String.fromCharCode(0))).toBeNull();
  });
});

describe('toAsciiOnly', () => {
  it('rewrites box-drawing and braille art to ASCII at identical dimensions', () => {
    const grid = linesToGrid(['─│┌', '⠀⣿A']);
    const rows = gridToLines(grid).map((line) => toAsciiOnly(line));

    expect(rows).toEqual(['-|+', ' @A']);
    for (const row of rows) {
      expect(row).toHaveLength(grid.width);
      for (const ch of row) {
        const code = ch.codePointAt(0) ?? 0;
        expect(code).toBeGreaterThanOrEqual(0x20);
        expect(code).toBeLessThanOrEqual(0x7e);
      }
    }
  });

  it('replaces control characters with "?" instead of leaking them', () => {
    const noisy = `a${String.fromCharCode(9)}b${String.fromCharCode(0)}c${String.fromCharCode(27)}d${String.fromCharCode(127)}e`;
    const cleaned = toAsciiOnly(noisy);

    expect(noisy).toHaveLength(9);
    expect(cleaned).toBe('a?b?c?d?e');
    expect(hasControlChar(cleaned)).toBe(false);
  });

  it('passes empty text through untouched', () => {
    expect(toAsciiOnly('')).toBe('');
  });
});

describe('encodePng', () => {
  const identity = (data: Uint8Array): Uint8Array => data;

  function readChunks(bytes: Uint8Array): Array<{ type: string; length: number; data: Uint8Array }> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out: Array<{ type: string; length: number; data: Uint8Array }> = [];
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7],
      );
      out.push({ type, length, data: bytes.subarray(offset + 8, offset + 8 + length) });
      offset += 12 + length;
    }
    return out;
  }

  it('encodes a 4x4 RGBA image into a signature + IHDR/IDAT/IEND stream', () => {
    const width = 4;
    const height = 4;
    const rgba = new Uint8Array(width * height * 4).fill(0x44);
    const png = encodePng(width, height, rgba, identity);

    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    const chunks = readChunks(png);
    expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(8 + chunks.reduce((sum, chunk) => sum + 12 + chunk.length, 0)).toBe(png.length);

    const ihdr = chunks[0];
    expect(ihdr.length).toBe(13);
    const header = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
    expect(header.getUint32(0)).toBe(width);
    expect(header.getUint32(4)).toBe(height);
    expect(ihdr.data[8]).toBe(8);
    expect(ihdr.data[9]).toBe(6);

    const idat = chunks[1];
    expect(idat.data[0]).toBe(0x78);
    expect(idat.data[1]).toBe(0x01);
    // zlib header + one filter byte per scanline + big-endian Adler-32
    expect(idat.length).toBe(2 + (width * 4 + 1) * height + 4);

    expect(chunks[2].length).toBe(0);
    expect(png.length).toBe(8 + (12 + 13) + (12 + idat.length) + 12);
  });

  it('throws StudioError invalid-input for bad dimensions or buffers', () => {
    const rgba = new Uint8Array(4 * 4 * 4);
    const attempts: Array<() => unknown> = [
      () => encodePng(0, 4, rgba, identity),
      () => encodePng(4, 0, rgba, identity),
      () => encodePng(4.5, 4, new Uint8Array(72), identity),
      () => encodePng(4, 4, new Uint8Array(3), identity),
      () => encodePng(-1, -1, new Uint8Array(0), identity),
    ];

    for (const attempt of attempts) {
      let thrown: unknown;
      try {
        attempt();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(StudioError);
      expect((thrown as StudioError).code).toBe('invalid-input');
    }
  });
});

describe('runExport / listExporters', () => {
  it("dispatches 'txt' and returns a string payload", () => {
    const result = runExport('txt', makeCtx());
    expect(result.ok).toBe(true);
    expect(typeof value(result)).toBe('string');
    expect(value(result)).toBe('abc\ndef\n');
  });

  it("answers unknown ids with the 'unsupported-format' error", () => {
    const error = failure(runExport('nope' as unknown as ExportFormat, makeCtx()));
    expect(error.code).toBe('unsupported-format');
    expect(error.message).toContain("Unknown export format 'nope'");
  });

  it("answers 'png' with 'unsupported-format' because the core has no canvas", () => {
    const error = failure(runExport('png', makeCtx()));
    expect(error.code).toBe('unsupported-format');
    expect(error.message).toContain('canvas');
  });

  it('lists every registered exporter in registration order', () => {
    const ids = listExporters().map((entry) => entry.id);
    expect(ids).toEqual(['txt', 'asc', 'ansi', 'json', 'html', 'svg', 'aap', 'png']);
    for (const id of ['txt', 'html', 'svg']) expect(ids).toContain(id);
    expect(listExporters()).not.toBe(listExporters());
  });
});
