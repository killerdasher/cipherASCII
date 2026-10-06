import { createGrid, linesToGrid } from '../../src/core/grid';
import { createDocument, validateAsciiGrid, validateDocument } from '../../src/core/project/schema';
import {
  deserializeProject,
  detectFormat,
  serializeProject,
} from '../../src/core/project/serialize';
import {
  CURRENT_SCHEMA_VERSION,
  type AsciiLayer,
  type Document,
  type Result,
  type StudioError,
} from '../../src/core/types';

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

function expectInvalidProject(input: unknown): void {
  expect(failure(validateDocument(input)).code).toBe('invalid-project');
}

function sampleDocument(): Document {
  const base = createDocument();
  const background = base.layers[0] as AsciiLayer;
  const layer: AsciiLayer = { ...background, grid: linesToGrid(['ab', 'cde']) };
  return {
    ...base,
    layers: [layer],
    activeLayerId: layer.id,
    metadata: { ...base.metadata, name: 'Round Trip' },
  };
}

describe('createDocument', () => {
  it('carries the current schema version, a non-empty id and parseable ISO timestamps', () => {
    const doc = createDocument();
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(doc.id.length).toBeGreaterThan(0);
    for (const stamp of [doc.metadata.createdAt, doc.metadata.updatedAt]) {
      const parsed = new Date(stamp);
      expect(Number.isNaN(parsed.getTime())).toBe(false);
      expect(parsed.toISOString()).toBe(stamp);
    }
  });

  it('creates exactly one ascii layer whose grid matches its dimensions and is active', () => {
    const doc = createDocument();
    expect(doc.layers).toHaveLength(1);
    const layer = doc.layers[0];
    expect(layer.kind).toBe('ascii');
    const grid = (layer as AsciiLayer).grid;
    expect(grid.chars).toHaveLength(grid.width * grid.height);
    expect(doc.activeLayerId).toBe(layer.id);
  });

  it('applies shallow overrides', () => {
    const base = createDocument();
    const doc = createDocument({
      id: 'custom-id',
      metadata: { ...base.metadata, name: 'My Art' },
    });
    expect(doc.id).toBe('custom-id');
    expect(doc.metadata.name).toBe('My Art');
    expect(doc.metadata.createdAt).toBe(base.metadata.createdAt);
    expect(doc.layers.length).toBe(base.layers.length);
    const baseLayer = base.layers[0];
    const docLayer = doc.layers[0];
    expect(baseLayer).toBeDefined();
    expect(docLayer).toBeDefined();
    if (baseLayer && docLayer && baseLayer.kind === 'ascii' && docLayer.kind === 'ascii') {
      expect(docLayer.kind).toBe(baseLayer.kind);
      expect(docLayer.grid.width).toBe(baseLayer.grid.width);
      expect(docLayer.grid.height).toBe(baseLayer.grid.height);
    }
  });
});

describe('validateDocument', () => {
  it('accepts a fresh createDocument result', () => {
    const result = validateDocument(createDocument());
    expect(result.ok).toBe(true);
    expect(value(result).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('rejects non-object inputs without throwing', () => {
    for (const input of [null, 42, [], 'x']) {
      expect(() => validateDocument(input)).not.toThrow();
      expectInvalidProject(input);
    }
  });

  it('rejects documents without a usable layers array', () => {
    const missing: Record<string, unknown> = { ...createDocument() };
    delete missing.layers;
    expectInvalidProject(missing);
    expectInvalidProject({ ...createDocument(), layers: [] });
    expectInvalidProject({ ...createDocument(), layers: 'nope' });
  });

  it('rejects a layer grid whose chars length does not match width * height', () => {
    const doc = structuredClone(createDocument());
    (doc.layers[0] as AsciiLayer).grid.chars.pop();
    expectInvalidProject(doc);
  });

  it('rejects a cell containing a multi-character string', () => {
    const doc = structuredClone(createDocument());
    (doc.layers[0] as AsciiLayer).grid.chars[0] = 'ab';
    expectInvalidProject(doc);
  });

  it('rejects layer opacity outside 0..1', () => {
    for (const opacity of [1.5, -0.1, Number.NaN]) {
      const doc = structuredClone(createDocument());
      doc.layers[0].opacity = opacity;
      expectInvalidProject(doc);
    }
  });

  it('accepts layer opacity at the 0 and 1 boundaries', () => {
    for (const opacity of [0, 1]) {
      const doc = structuredClone(createDocument());
      doc.layers[0].opacity = opacity;
      expect(validateDocument(doc).ok).toBe(true);
    }
  });
});

describe('validateAsciiGrid', () => {
  it('accepts a valid grid', () => {
    const result = validateAsciiGrid(createGrid(4, 3), 'grid');
    expect(result.ok).toBe(true);
    expect(value(result).chars).toHaveLength(12);
  });

  it('rejects a zero width', () => {
    const grid = { ...createGrid(4, 3), width: 0 };
    expect(failure(validateAsciiGrid(grid, 'grid')).code).toBe('invalid-project');
  });

  it('rejects a non-integer width', () => {
    const grid = { ...createGrid(4, 3), width: 2.5 };
    expect(failure(validateAsciiGrid(grid, 'grid')).code).toBe('invalid-project');
  });

  it('rejects a chars length mismatch', () => {
    const grid = createGrid(4, 3);
    const truncated = { ...grid, chars: grid.chars.slice(1) };
    expect(failure(validateAsciiGrid(truncated, 'grid')).code).toBe('invalid-project');
  });
});

describe('serializeProject / deserializeProject', () => {
  it('round-trips a document back to a deep-equal document', () => {
    const original = sampleDocument();
    const restored = value(deserializeProject(serializeProject(original)));
    expect(JSON.parse(JSON.stringify(restored))).toEqual(JSON.parse(JSON.stringify(original)));
  });

  it('reports malformed JSON as invalid-project', () => {
    expect(failure(deserializeProject('{"schemaVersion": ')).code).toBe('invalid-project');
    expect(failure(deserializeProject('not json at all')).code).toBe('invalid-project');
  });

  it('reports a future schema version as unsupported-version', () => {
    const future = JSON.stringify({ ...createDocument(), schemaVersion: 999 });
    expect(failure(deserializeProject(future)).code).toBe('unsupported-version');
  });

  it('migrates a schema version 1 document and fills editor and guides', () => {
    const base = createDocument();
    const legacy: Record<string, unknown> = { ...base, schemaVersion: 1 };
    delete legacy.editor;
    delete legacy.guides;

    const migrated = value(deserializeProject(JSON.stringify(legacy)));
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.id).toBe(base.id);
    expect(migrated.layers).toHaveLength(1);
    expect(migrated.editor).toEqual({
      cursor: { x: 0, y: 0 },
      anchor: null,
      tabSize: 4,
      showWhitespace: false,
      showLineNumbers: false,
    });
    expect(migrated.guides).toEqual([]);
  });
});

describe('detectFormat', () => {
  it('maps JSON text to json', () => {
    expect(detectFormat('{"a": 1}')).toBe('json');
    expect(detectFormat('  [1, 2, 3]')).toBe('json');
  });

  it('maps an flf2a header to flf', () => {
    expect(detectFormat('flf2a 2 16 20 15 3 63 32\n@@@')).toBe('flf');
  });

  it('maps text starting with @ to asc', () => {
    expect(detectFormat('@---@\n|   |\n@---@')).toBe('asc');
  });

  it('maps anything else non-empty to txt', () => {
    expect(detectFormat('hello world')).toBe('txt');
    expect(detectFormat('   plain text')).toBe('txt');
  });
});
