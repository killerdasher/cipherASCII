import { createGrid, linesToGrid } from '../../src/core/grid';
import { createDocument, validateAsciiGrid, validateDocument } from '../../src/core/project/schema';
import {
  deserializeProject,
  detectFormat,
  serializeProject,
} from '../../src/core/project/serialize';
import { MASK_KINDS, type MaskSpec } from '../../src/core/fx/mask';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_FX_SEED,
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

  it('round-trips the cell-effect stack including masks and parameters', () => {
    const original: Document = {
      ...sampleDocument(),
      cellEffects: [
        {
          effect: 'cipherlock',
          intensity: 0.6,
          params: { scroll: 30, glow: 0.5 },
          mask: { kind: 'band', thickness: 4, origin: 'top' },
          delay: 120,
        },
        { effect: 'rain', enabled: false },
      ],
    };
    const restored = value(deserializeProject(serializeProject(original)));
    expect(restored.cellEffects).toEqual(original.cellEffects);
    // `enabled: true` is the default, so it is normalised away on save.
    const explicit: Document = {
      ...sampleDocument(),
      cellEffects: [{ effect: 'rain', enabled: true }],
    };
    expect(value(deserializeProject(serializeProject(explicit))).cellEffects).toEqual([
      { effect: 'rain' },
    ]);
  });

  it('repairs malformed cell-effect entries instead of feeding them to the renderer', () => {
    const base = createDocument();
    const raw = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    raw.cellEffects = [
      { effect: 'rain', intensity: 4, params: { speed: 'fast', trail: 0.5 } },
      { effect: '' },
      { effect: 'glitch', mask: { kind: 'wormhole', x: 1 } },
      'not an object',
      { effect: 'unknown-effect-id' },
    ];
    const restored = value(deserializeProject(JSON.stringify(raw)));
    expect(restored.cellEffects).toHaveLength(3);
    const [rain, glitch, unknown] = restored.cellEffects;
    expect(rain.intensity).toBe(1); // clamped into range
    expect(rain.params).toEqual({ trail: 0.5 }); // non-numeric dropped
    expect(glitch.mask).toBeUndefined(); // unknown mask kind discarded
    expect(unknown.effect).toBe('unknown-effect-id'); // kept: stays unbound
  });

  it('defaults cellEffects to an empty stack on legacy documents', () => {
    const base = createDocument();
    const legacy: Record<string, unknown> = { ...base };
    delete legacy.cellEffects;
    const restored = value(deserializeProject(JSON.stringify(legacy)));
    expect(restored.cellEffects).toEqual([]);
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

describe('schema version 3', () => {
  it('bumps CURRENT_SCHEMA_VERSION to 3', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(3);
  });

  it('round-trips generators and fxSeed', () => {
    const original: Document = {
      ...sampleDocument(),
      fxSeed: 0xc0ffee,
      generators: [
        {
          id: 'graph-1',
          name: 'Noise',
          seed: 11,
          nodes: [{ id: 'n', kind: 'valueNoise', params: { scale: 8, octaves: 2 }, x: 12, y: 40 }],
          edges: [],
          output: 'n',
        },
      ],
    };
    const restored = value(deserializeProject(serializeProject(original)));
    expect(restored.generators).toEqual(original.generators);
    expect(restored.fxSeed).toBe(0xc0ffee);
  });

  it('adds generators and the default seed to documents written before version 3', () => {
    const legacy: Record<string, unknown> = { ...createDocument(), schemaVersion: 2 };
    delete legacy.generators;
    delete legacy.fxSeed;
    const migrated = value(deserializeProject(JSON.stringify(legacy)));
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.generators).toEqual([]);
    expect(migrated.fxSeed).toBe(DEFAULT_FX_SEED);
  });

  it('repairs unusable seeds and drops irreparable generator graphs', () => {
    const base = createDocument();
    const raw = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    raw.fxSeed = 'chaos';
    raw.generators = [
      { id: 'good', name: '', seed: 2, nodes: [{ id: 'n', kind: 'constant', params: {} }], edges: [], output: 'n' },
      { id: 'bad', nodes: 'nope' },
      'not-an-object',
    ];
    const restored = value(deserializeProject(JSON.stringify(raw)));
    expect(restored.fxSeed).toBe(DEFAULT_FX_SEED);
    expect(restored.generators.map((g) => g.id)).toEqual(['good']);

    raw.fxSeed = 42.9;
    expect(value(deserializeProject(JSON.stringify(raw))).fxSeed).toBe(42);
  });

  it('keeps unknown generator node kinds so newer projects still load', () => {
    const base = createDocument();
    const raw = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    raw.generators = [
      {
        id: 'future',
        name: '',
        seed: 0,
        nodes: [{ id: 'n', kind: 'neural-hologram', params: { intensity: 0.5 } }],
        edges: [],
        output: 'n',
      },
    ];
    const restored = value(deserializeProject(JSON.stringify(raw)));
    expect(restored.generators[0].nodes[0].kind).toBe('neural-hologram');
  });
});

describe('layer blend persistence', () => {
  it('round-trips a non-default blend', () => {
    const doc = createDocument();
    const layered: Document = {
      ...doc,
      layers: [{ ...doc.layers[0], blend: 'multiply' }],
    };
    const restored = value(deserializeProject(serializeProject(layered)));
    expect(restored.layers[0].blend).toBe('multiply');
  });

  it('defaults layers written without a blend to normal', () => {
    const raw = JSON.parse(JSON.stringify(createDocument())) as Record<string, unknown>;
    const layers = raw.layers as Record<string, unknown>[];
    delete layers[0].blend;
    const restored = value(deserializeProject(JSON.stringify(raw)));
    expect(restored.layers[0].blend).toBe('normal');
  });

  it('repairs unknown blend ids to normal', () => {
    const raw = JSON.parse(JSON.stringify(createDocument())) as Record<string, unknown>;
    const layers = raw.layers as Record<string, unknown>[];
    layers[0].blend = 'plaid';
    const restored = value(deserializeProject(JSON.stringify(raw)));
    expect(restored.layers[0].blend).toBe('normal');
  });

  it('creates new documents on the default blend', () => {
    expect(createDocument().layers[0].blend).toBe('normal');
  });
});

describe('phantom layer fields (A7)', () => {
  function rawProject(): Record<string, unknown> {
    return JSON.parse(JSON.stringify(createDocument())) as Record<string, unknown>;
  }

  it('strips image-layer settings and cacheKey written by older builds', () => {
    const raw = rawProject();
    const layers = raw.layers as Record<string, unknown>[];
    layers[0] = {
      ...layers[0],
      kind: 'image',
      source: { name: 'a.png', dataUrl: 'data:image/png;base64,AA==', width: 1, height: 1, mime: 'image/png' },
      settings: { mapping: 'luminance' },
      cacheKey: 'stale-key',
      grid: null,
    };
    const restored = value(deserializeProject(JSON.stringify(raw)));
    expect(restored.layers[0]).not.toHaveProperty('settings');
    expect(restored.layers[0]).not.toHaveProperty('cacheKey');
    expect(restored.layers[0].kind).toBe('image');
  });

  it('strips the same fields from text layers', () => {
    const raw = rawProject();
    const layers = raw.layers as Record<string, unknown>[];
    layers[0] = { ...layers[0], kind: 'text', text: 'hi', settings: {}, cacheKey: 'x', grid: null };
    const restored = value(deserializeProject(JSON.stringify(raw)));
    expect(restored.layers[0]).not.toHaveProperty('settings');
    expect(restored.layers[0]).not.toHaveProperty('cacheKey');
    expect(restored.layers[0].kind).toBe('text');
  });

  it('keeps the creative layer cache key (Phase 6 renders through it)', () => {
    const raw = rawProject();
    const layers = raw.layers as Record<string, unknown>[];
    layers[0] = { ...layers[0], kind: 'creative', grid: null, cacheKey: 'kept' };
    const restored = value(deserializeProject(JSON.stringify(raw)));
    expect((restored.layers[0] as unknown as Record<string, unknown>).cacheKey).toBe('kept');
  });
});

describe('cell-effect mask persistence', () => {
  const MASK_SAMPLES: MaskSpec[] = [
    { kind: 'all' },
    { kind: 'rect', x: 1, y: 2, w: 3, h: 4 },
    { kind: 'rows', rowStart: 1, rowEnd: 3 },
    { kind: 'columns', colStart: 0, colEnd: 5 },
    { kind: 'checker', cell: 3 },
    { kind: 'band', thickness: 2, origin: 'bottom' },
    { kind: 'glyphClass', glyphClass: 'digit' },
    { kind: 'foreground', hasForeground: true },
    { kind: 'background', hasBackground: false },
  ];

  it('persists every registered mask kind with its own fields', () => {
    expect(MASK_SAMPLES.map((m) => m.kind).sort()).toEqual([...MASK_KINDS].sort());
    expect(MASK_KINDS).toHaveLength(9);

    const original: Document = {
      ...sampleDocument(),
      cellEffects: MASK_SAMPLES.map((mask) => ({ effect: 'rain', mask })),
    };
    const restored = value(deserializeProject(serializeProject(original)));
    expect(restored.cellEffects.map((e) => e.mask)).toEqual(original.cellEffects.map((e) => e.mask));
  });

  it('drops an unknown glyph class but keeps the mask kind', () => {
    const base = createDocument();
    const raw = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    raw.cellEffects = [{ effect: 'rain', mask: { kind: 'glyphClass', glyphClass: 'emoji' } }];
    const restored = value(deserializeProject(JSON.stringify(raw)));
    expect(restored.cellEffects[0].mask).toEqual({ kind: 'glyphClass' });
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

describe('timeline persistence', () => {
  it('round-trips tracks, keyframes and easing through .aap', () => {
    const base = createDocument();
    const timeline: NonNullable<Document['timeline']> = {
      ...base.timeline!,
      name: 'Scene',
      fps: 24,
      duration: 96,
      currentFrame: 12,
      tracks: [
        {
          id: 't1',
          name: 'Opacity',
          layerId: base.layers[0].id,
          property: 'opacity',
          keyframes: [
            { frame: 0, value: 0, easing: 'easeInOut' },
            { frame: 48, value: 1 },
          ],
          enabled: true,
        },
      ],
    };
    const restored = value(deserializeProject(serializeProject({ ...base, timeline })));
    expect(restored.timeline).toEqual(timeline);
  });

  it('repairs a malformed timeline field by field instead of trusting it', () => {
    const base = createDocument();
    const raw = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    raw.timeline = {
      id: 7,
      name: 42,
      fps: null,
      duration: 0,
      currentFrame: 9999,
      loop: 'yes',
      playing: true,
      onionSkinEnabled: 1,
      onionSkinFrames: -5,
      onionSkinOpacity: 9,
      tracks: [
        {
          id: 'ok',
          layerId: 'l',
          property: 'x',
          keyframes: [
            { frame: 5, value: 1 },
            { frame: 1, value: 0 },
            { frame: 'x', value: 2 },
          ],
        },
        { id: '', layerId: 'l', property: 'x', keyframes: [] },
        { nope: true },
      ],
    };
    const restored = value(deserializeProject(JSON.stringify(raw)));
    const tl = restored.timeline;
    expect(tl).not.toBeNull();
    expect(tl!.id).toBe('timeline_main');
    expect(tl!.name).toBe('Timeline');
    expect(tl!.fps).toBe(30);
    expect(tl!.duration).toBe(300);
    expect(tl!.currentFrame).toBe(299);
    expect(tl!.loop).toBe(true);
    expect(tl!.playing).toBe(false);
    expect(tl!.onionSkinEnabled).toBe(false);
    expect(tl!.onionSkinFrames).toBe(1);
    expect(tl!.onionSkinOpacity).toBe(1);
    expect(tl!.tracks).toHaveLength(1);
    expect(tl!.tracks[0].name).toBe('x');
    expect(tl!.tracks[0].enabled).toBe(true);
    expect(tl!.tracks[0].keyframes.map((k) => k.frame)).toEqual([1, 5]);
  });

  it('keeps an explicitly absent timeline null', () => {
    const base = createDocument({ timeline: null });
    const restored = value(deserializeProject(serializeProject(base)));
    expect(restored.timeline).toBeNull();
  });
});
