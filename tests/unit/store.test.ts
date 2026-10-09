// @vitest-environment jsdom
// The store applies the active theme to the document at creation time.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useStore, selectCrtGlow } from '../../src/store';
import { terminateWorker } from '../../src/worker/client';
import { History } from '../../src/core/history/history';
import { linesToGrid } from '../../src/core/grid';
import { defaultGeneratorGraph, setNodeParam } from '../../src/core/generators/edit';
import type { CreativeLayer, Document } from '../../src/core/types';

describe('view state', () => {
  beforeEach(() => {
    useStore.setState({ crtGlow: false });
  });

  it('starts with CRT glow off', () => {
    expect(selectCrtGlow(useStore.getState())).toBe(false);
  });

  it('toggles CRT glow on and off', () => {
    useStore.getState().toggleCrtGlow();
    expect(selectCrtGlow(useStore.getState())).toBe(true);
    useStore.getState().toggleCrtGlow();
    expect(selectCrtGlow(useStore.getState())).toBe(false);
  });

  it('keeps zoom clamped to a sane range', () => {
    useStore.getState().setZoom(0);
    expect(useStore.getState().zoomLevel).toBe(0.1);
    useStore.getState().setZoom(99);
    expect(useStore.getState().zoomLevel).toBe(10);
  });

  it('toggles GPU preview as pure view state', () => {
    useStore.setState({ gpuPreview: false, isDirty: false });
    const gen = useStore.getState().renderGeneration;
    useStore.getState().toggleGpuPreview();
    expect(useStore.getState().gpuPreview).toBe(true);
    expect(useStore.getState().isDirty).toBe(false);
    expect(useStore.getState().renderGeneration).toBe(gen);

    useStore.getState().disableGpuPreview('no WebGL');
    expect(useStore.getState().gpuPreview).toBe(false);
    expect(useStore.getState().statusMessage).toContain('2D canvas');
    expect(useStore.getState().statusMessage).toContain('no WebGL');
    expect(useStore.getState().isDirty).toBe(false);
    expect(useStore.getState().renderGeneration).toBe(gen);
  });
});

describe('cell effects', () => {
  beforeEach(() => {
    useStore.setState({ cellEffects: [], fxSeed: 0x5eed, isDirty: false });
  });

  it('adds an entry with resolved parameter defaults', () => {
    useStore.getState().addCellEffect('cipherlock');
    const entries = useStore.getState().cellEffects;
    expect(entries).toHaveLength(1);
    expect(entries[0].effect).toBe('cipherlock');
    expect(entries[0].enabled).toBe(true);
    expect(entries[0].params?.scroll).toBe(26);
  });

  it('ignores unknown effect ids', () => {
    useStore.getState().addCellEffect('not-a-real-effect');
    expect(useStore.getState().cellEffects).toHaveLength(0);
  });

  it('edits, reorders and removes entries immutably', () => {
    const add = useStore.getState().addCellEffect;
    add('rain');
    add('glitch');
    add('pulse');
    const before = useStore.getState().cellEffects;
    useStore.getState().updateCellEffectParams(0, { speed: 40 });
    const afterParams = useStore.getState().cellEffects;
    expect(afterParams).not.toBe(before);
    expect(afterParams[0].params?.speed).toBe(40);
    expect(afterParams[1]).toBe(before[1]); // untouched entries keep identity

    useStore.getState().reorderCellEffect(0, 2);
    expect(useStore.getState().cellEffects.map((e) => e.effect)).toEqual([
      'glitch',
      'pulse',
      'rain',
    ]);

    useStore.getState().setCellEffectIntensity(1, 0.25);
    expect(useStore.getState().cellEffects[1].intensity).toBe(0.25);
    useStore.getState().setCellEffectEnabled(1, false);
    expect(useStore.getState().cellEffects[1].enabled).toBe(false);

    useStore.getState().removeCellEffect(1);
    expect(useStore.getState().cellEffects.map((e) => e.effect)).toEqual(['glitch', 'rain']);
  });

  it('mirrors the stack into the document so the project file keeps it', () => {
    useStore.getState().addCellEffect('hexfall');
    expect(useStore.getState().document.cellEffects).toHaveLength(1);
    expect(useStore.getState().isDirty).toBe(true);
    useStore.getState().resetCellEffects();
    expect(useStore.getState().cellEffects).toHaveLength(0);
    expect(useStore.getState().document.cellEffects).toHaveLength(0);
  });

  it('restores a stack when a project is loaded', () => {
    const doc = { ...useStore.getState().document, cellEffects: [{ effect: 'keyshift' }] };
    useStore.getState().setDocument(doc);
    expect(useStore.getState().cellEffects).toEqual([{ effect: 'keyshift' }]);
  });
});

describe('layer render guards (A2)', () => {
  beforeEach(() => {
    useStore.getState().newDocument();
    useStore.setState({ isDirty: false });
  });

  it('style-only layer updates do not bump the render generation', () => {
    const gen = useStore.getState().renderGeneration;
    const layer = useStore.getState().document.layers[0];
    useStore.getState().updateLayer(layer.id, { opacity: 0.5, blend: 'multiply' });
    expect(useStore.getState().document.layers[0].opacity).toBe(0.5);
    expect(useStore.getState().document.layers[0].blend).toBe('multiply');
    expect(useStore.getState().renderGeneration).toBe(gen);
  });

  it('text and image source edits do bump the render generation', () => {
    const layer = useStore.getState().document.layers[0];
    useStore.getState().updateLayer(layer.id, { text: 'HI' });
    const genAfterText = useStore.getState().renderGeneration;
    expect(genAfterText).toBeGreaterThan(0);

    useStore.getState().updateLayer(layer.id, {
      source: { name: 'px', dataUrl: 'data:image/png;base64,AA==', width: 1, height: 1, mime: 'image/png' },
    });
    expect(useStore.getState().renderGeneration).toBeGreaterThan(genAfterText);
  });

  it('reordering layers is compose-time only', () => {
    const first = useStore.getState().document.layers[0];
    const second = { ...first, id: 'layer-2', name: 'Two' };
    useStore.getState().addLayer(second);
    const gen = useStore.getState().renderGeneration;
    useStore.getState().moveLayer(second.id, 0);
    expect(useStore.getState().document.layers[0].id).toBe(second.id);
    expect(useStore.getState().document.layers[1].id).toBe(first.id);
    expect(useStore.getState().renderGeneration).toBe(gen);
  });
});

describe('fx seed', () => {
  it('mirrors the seed into the document so the project file keeps it', () => {
    useStore.getState().setFxSeed(0x1234);
    expect(useStore.getState().fxSeed).toBe(0x1234);
    expect(useStore.getState().document.fxSeed).toBe(0x1234);
    expect(useStore.getState().isDirty).toBe(true);
  });

  it('hydrates the seed from a loaded project', () => {
    const doc = { ...useStore.getState().document, fxSeed: 4242 };
    useStore.getState().setDocument(doc);
    expect(useStore.getState().fxSeed).toBe(4242);
  });

  it('re-syncs the seed from the restored document on undo', () => {
    useStore.getState().setDocument({ ...useStore.getState().document, fxSeed: 4242 });
    useStore.getState().setMetadata({ name: 'Step' });
    useStore.setState({ fxSeed: 999 });
    useStore.getState().undo();
    expect(useStore.getState().fxSeed).toBe(4242);
  });

  it('applies a seed override on a new document', () => {
    useStore.getState().newDocument({ fxSeed: 77 });
    expect(useStore.getState().fxSeed).toBe(77);
    expect(useStore.getState().document.fxSeed).toBe(77);
  });

  it('falls back to the default seed for documents without one', () => {
    const legacy = { ...useStore.getState().document } as Record<string, unknown>;
    delete legacy.fxSeed;
    useStore.getState().setDocument(legacy as unknown as Document);
    expect(useStore.getState().fxSeed).toBe(0x5eed);
  });
});

describe('selection and clipboard', () => {
  /** Put `rows` into the active layer so selection has something to bite. */
  function seed(rows: string[]): void {
    const doc = useStore.getState().document;
    const grid = linesToGrid(rows);
    const layer = { ...doc.layers[0], grid };
    const next = { ...doc, layers: [layer], activeLayerId: layer.id };
    // Rebase history on the seeded document so undo restores *it*, not the
    // blank document `newDocument` created.
    useStore.setState({ document: next, history: new History(next, { limit: 200, coalesceWindowMs: 800 }) });
  }

  beforeEach(() => {
    useStore.getState().newDocument();
    seed(['abcd', 'efgh']);
    useStore.setState({ clipboard: null, selection: { type: 'rectangle', bounds: null, mask: null } });
  });

  it('setSelection replaces wholesale and null clears it', () => {
    const st = useStore.getState();
    st.setSelection({ type: 'rectangle', bounds: { x: 0, y: 0, width: 2, height: 1 }, mask: null });
    expect(useStore.getState().selection.bounds).toEqual({ x: 0, y: 0, width: 2, height: 1 });
    // Replace, not merge: switching to a region drops the rectangle fields.
    useStore.getState().setSelection({
      type: 'region',
      bounds: { x: 1, y: 1, width: 1, height: 1 },
      mask: Uint8Array.from([1]),
    });
    expect(useStore.getState().selection.type).toBe('region');
    useStore.getState().setSelection(null);
    expect(useStore.getState().selection.bounds).toBeNull();
  });

  it('copy fills the clipboard without touching the document', () => {
    const before = useStore.getState().document;
    useStore.getState().setSelection({
      type: 'rectangle',
      bounds: { x: 1, y: 0, width: 2, height: 1 },
      mask: null,
    });
    useStore.getState().copySelection();
    const st = useStore.getState();
    expect(st.clipboard).not.toBeNull();
    expect(st.clipboard!.chars.join('')).toBe('bc');
    expect(st.document).toBe(before);
    expect(st.statusMessage).toContain('Copied');
  });

  it('copy with nothing selected reports it and leaves the clipboard alone', () => {
    useStore.getState().copySelection();
    expect(useStore.getState().clipboard).toBeNull();
    expect(useStore.getState().statusMessage).toBe('Nothing selected');
  });

  it('cut blanks the selection in one undoable step and keeps the stamp', () => {
    useStore.getState().setSelection({
      type: 'rectangle',
      bounds: { x: 1, y: 0, width: 2, height: 2 },
      mask: null,
    });
    const before = useStore.getState().document.layers[0].grid!.chars.join('');
    useStore.getState().cutSelection();
    const st = useStore.getState();
    expect(st.document.layers[0].grid!.chars.slice(0, 4).join('')).toBe('a  d');
    expect(st.document.layers[0].grid!.chars.slice(4).join('')).toBe('e  h');
    expect(st.clipboard!.chars.join('')).toBe('bc' + 'fg');
    expect(st.isDirty).toBe(true);
    useStore.getState().undo();
    expect(useStore.getState().document.layers[0].grid!.chars.join('')).toBe(before);
    // The clipboard survives undo.
    expect(useStore.getState().clipboard!.chars.join('')).toBe('bcfg');
  });

  it('paste lands at the selection origin (cut → paste restores in place)', () => {
    useStore.getState().setSelection({
      type: 'rectangle',
      bounds: { x: 1, y: 0, width: 2, height: 1 },
      mask: null,
    });
    useStore.getState().cutSelection();
    useStore.getState().pasteClipboard();
    expect(useStore.getState().document.layers[0].grid!.chars.slice(0, 4).join('')).toBe('abcd');
    expect(useStore.getState().statusMessage).toContain('Pasted');
  });

  it('paste without a selection goes to the top-left corner', () => {
    useStore.getState().setSelection({
      type: 'rectangle',
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      mask: null,
    });
    useStore.getState().copySelection();
    useStore.getState().setSelection(null);
    useStore.getState().pasteClipboard();
    expect(useStore.getState().document.layers[0].grid!.chars[0]).toBe('a');
  });

  it('paste with an empty clipboard reports it', () => {
    useStore.getState().pasteClipboard();
    expect(useStore.getState().statusMessage).toBe('Clipboard is empty');
    expect(useStore.getState().isDirty).toBe(false);
  });

  it('delete clears the selection without filling the clipboard', () => {
    useStore.getState().setSelection({
      type: 'rectangle',
      bounds: { x: 0, y: 0, width: 4, height: 1 },
      mask: null,
    });
    useStore.getState().deleteSelection();
    expect(useStore.getState().document.layers[0].grid!.chars.slice(0, 4).join('')).toBe('    ');
    expect(useStore.getState().clipboard).toBeNull();
    useStore.getState().undo();
    expect(useStore.getState().document.layers[0].grid!.chars.slice(0, 4).join('')).toBe('abcd');
  });

  it('delete with nothing selected is a no-op', () => {
    const before = useStore.getState().document;
    useStore.getState().deleteSelection();
    expect(useStore.getState().document).toBe(before);
    expect(useStore.getState().statusMessage).toBe('Nothing selected');
  });

  it('locked layers refuse cuts and pastes but still allow copying', () => {
    const doc = useStore.getState().document;
    useStore.setState({
      document: { ...doc, layers: [{ ...doc.layers[0], locked: true }] },
      selection: { type: 'rectangle', bounds: { x: 0, y: 0, width: 2, height: 1 }, mask: null },
    });
    useStore.getState().copySelection();
    expect(useStore.getState().clipboard).not.toBeNull();

    useStore.getState().cutSelection();
    expect(useStore.getState().statusMessage).toContain('locked');
    expect(useStore.getState().document.layers[0].grid!.chars.slice(0, 2).join('')).toBe('ab');

    useStore.getState().pasteClipboard();
    expect(useStore.getState().statusMessage).toContain('locked');
  });

  it('a new document clears the selection but keeps the clipboard', () => {
    useStore.getState().setSelection({
      type: 'rectangle',
      bounds: { x: 0, y: 0, width: 2, height: 1 },
      mask: null,
    });
    useStore.getState().copySelection();
    useStore.getState().newDocument();
    expect(useStore.getState().selection.bounds).toBeNull();
    expect(useStore.getState().clipboard).not.toBeNull();
  });
});


describe('generative layers (store)', () => {
  beforeEach(() => {
    useStore.getState().newDocument();
  });

  it('addCreativeLayer creates a starter graph and its layer as one undo step', () => {
    const before = useStore.getState().document;
    const layerId = useStore.getState().addCreativeLayer();
    expect(layerId).toBeTruthy();

    const st = useStore.getState();
    expect(st.document).not.toBe(before);
    expect(st.document.generators).toHaveLength(1);
    expect(st.document.generators[0].name).toBe('Drift');
    const created = st.document.layers.find((l) => l.id === layerId);
    expect(created?.kind).toBe('creative');
    expect((created as CreativeLayer).grid).toBeNull();
    expect((created as CreativeLayer).graphId).toBe(st.document.generators[0].id);
    expect(st.isDirty).toBe(true);

    // A single undo takes the layer *and* its graph back out.
    useStore.getState().undo();
    const back = useStore.getState().document;
    expect(back.layers.some((l) => l.id === layerId)).toBe(false);
    expect(back.generators).toHaveLength(0);
  });

  it('refreshCreativeLayers fills the derived cache and then goes quiet', async () => {
    const layerId = useStore.getState().addCreativeLayer()!;
    expect(await useStore.getState().refreshCreativeLayers()).toBe(1);

    const doc = useStore.getState().document;
    const layer = doc.layers.find((l) => l.id === layerId) as CreativeLayer;
    expect(layer.grid).not.toBeNull();
    expect(layer.grid!.width).toBe(doc.canvas.width);
    expect(layer.grid!.height).toBe(doc.canvas.height);
    expect(layer.cacheKey).not.toBe('');
    // Fresh now: the next pass has nothing to evaluate.
    expect(await useStore.getState().refreshCreativeLayers()).toBe(0);
  });

  it('the refresh stays out of history: undo still removes layer and graph together', async () => {
    const layerId = useStore.getState().addCreativeLayer()!;
    await useStore.getState().refreshCreativeLayers();
    useStore.getState().undo();
    const doc = useStore.getState().document;
    expect(doc.layers.some((l) => l.id === layerId)).toBe(false);
    expect(doc.generators).toHaveLength(0);
  });

  it('re-evaluates after a graph edit and reports a broken graph binding', async () => {
    const layerId = useStore.getState().addCreativeLayer()!;
    await useStore.getState().refreshCreativeLayers();
    const firstKey = (useStore.getState().document.layers.find((l) => l.id === layerId) as CreativeLayer)
      .cacheKey;

    const graph = useStore.getState().document.generators[0];
    const edited = setNodeParam(graph, 'cut', 'threshold', 0.9);
    if (!edited.ok) throw new Error(edited.error.message);
    expect(useStore.getState().upsertGenerator(edited.value)).toBe(true);
    expect(await useStore.getState().refreshCreativeLayers()).toBe(1);
    const after = useStore.getState().document.layers.find((l) => l.id === layerId) as CreativeLayer;
    expect(after.cacheKey).not.toBe(firstKey);
    expect(after.grid).not.toBeNull();

    // A dangling graph id reports instead of throwing, and changes nothing.
    useStore.getState().updateCreativeLayer(layerId, { graphId: 'missing' });
    const broken = useStore.getState().document;
    expect(await useStore.getState().refreshCreativeLayers()).toBe(0);
    expect(useStore.getState().document).toBe(broken);
    expect(useStore.getState().statusMessage).toContain('missing');
  });

  it('upsertGenerator rejects an invalid graph with a message', () => {
    const before = useStore.getState().document;
    const ok = useStore.getState().upsertGenerator({
      id: 'bad',
      name: '',
      seed: 0,
      nodes: [],
      edges: [],
      output: '',
    });
    expect(ok).toBe(false);
    expect(useStore.getState().document).toBe(before);
    expect(useStore.getState().statusMessage).toContain('Generator graph invalid');
  });

  it('removeGenerator refuses while a layer points at the graph', () => {
    const layerId = useStore.getState().addCreativeLayer()!;
    const inUse = useStore.getState().document.generators[0].id;

    expect(useStore.getState().removeGenerator(inUse)).toBe(false);
    expect(useStore.getState().statusMessage).toContain('used by');
    expect(useStore.getState().document.generators).toHaveLength(1);

    expect(useStore.getState().upsertGenerator(defaultGeneratorGraph('spare'))).toBe(true);
    useStore.getState().updateCreativeLayer(layerId, { graphId: 'spare' });
    expect(useStore.getState().removeGenerator(inUse)).toBe(true);
    expect(useStore.getState().document.generators.map((g) => g.id)).toEqual(['spare']);
  });
});

describe('timeline wired to the document', () => {
  beforeEach(() => {
    useStore.getState().newDocument();
  });

  it('a fresh document ships a paused default timeline mirrored into the slice', () => {
    const st = useStore.getState();
    expect(st.document.timeline?.id).toBe('timeline_main');
    expect(st.document.timeline?.playing).toBe(false);
    expect(st.timeline).toBe(st.document.timeline);
    expect('timelines' in (st as unknown as Record<string, unknown>)).toBe(false);
    expect('activeTimelineId' in (st as unknown as Record<string, unknown>)).toBe(false);
  });

  it('createTimeline is one undoable, dirtying document edit', () => {
    useStore.getState().createTimeline('Cut', 24, 96);
    let st = useStore.getState();
    expect(st.document.timeline?.name).toBe('Cut');
    expect(st.document.timeline?.fps).toBe(24);
    expect(st.isDirty).toBe(true);
    expect(st.timeline?.id).toBe(st.document.timeline?.id);

    useStore.getState().undo();
    st = useStore.getState();
    expect(st.document.timeline?.id).toBe('timeline_main');
    expect(st.timeline?.id).toBe('timeline_main');

    useStore.getState().redo();
    expect(useStore.getState().document.timeline?.name).toBe('Cut');
  });

  it('track and keyframe edits persist to the document and undo restores it', () => {
    const layerId = useStore.getState().document.layers[0].id;
    useStore.getState().addTimelineTrack(layerId, 'opacity', 'Opacity');
    expect(useStore.getState().document.timeline?.tracks).toHaveLength(1);
    expect(useStore.getState().timeline?.tracks).toHaveLength(1);

    const trackId = useStore.getState().document.timeline!.tracks[0].id;
    useStore.getState().setTimelineKeyframe(trackId, 10, 0.5);
    expect(useStore.getState().document.timeline?.tracks[0].keyframes).toHaveLength(1);

    // The track add and the keyframe share a coalesce key inside the 800 ms
    // window, so they leave history as a single step.
    useStore.getState().undo();
    expect(useStore.getState().document.timeline?.tracks).toHaveLength(0);
    expect(useStore.getState().timeline?.tracks).toHaveLength(0);
    useStore.getState().redo();
    expect(useStore.getState().document.timeline?.tracks[0].keyframes).toHaveLength(1);
  });

  it('transport is view state: seeking never dirties the project or renders', () => {
    useStore.getState().markClean();
    const gen = useStore.getState().renderGeneration;
    const docTl = useStore.getState().document.timeline;

    useStore.getState().setTimelineCurrentFrame(42);
    useStore.getState().setTimelinePlaying(true);
    useStore.getState().setOnionSkin(true, 2, 0.5);

    const st = useStore.getState();
    expect(st.timeline?.currentFrame).toBe(42);
    expect(st.timeline?.playing).toBe(true);
    expect(st.timeline?.onionSkinFrames).toBe(2);
    expect(st.document.timeline).toBe(docTl);
    expect(st.isDirty).toBe(false);
    expect(st.renderGeneration).toBe(gen);
  });

  it('undoing an authoring edit keeps the live transport on screen', () => {
    const layerId = useStore.getState().document.layers[0].id;
    useStore.getState().setTimelineCurrentFrame(17);
    useStore.getState().setTimelinePlaying(true);
    useStore.getState().addTimelineTrack(layerId, 'x', 'X');

    useStore.getState().undo();
    const st = useStore.getState();
    expect(st.document.timeline?.tracks).toHaveLength(0);
    expect(st.timeline?.currentFrame).toBe(17);
    expect(st.timeline?.playing).toBe(true);
  });

  it('loading a project adopts its timeline and starts paused', () => {
    const saved = {
      ...useStore.getState().document.timeline!,
      name: 'Saved',
      fps: 12,
      currentFrame: 9,
      playing: true,
    };
    useStore.getState().setDocument({ ...useStore.getState().document, timeline: saved });
    const st = useStore.getState();
    expect(st.timeline?.name).toBe('Saved');
    expect(st.timeline?.currentFrame).toBe(9);
    expect(st.timeline?.playing).toBe(false);
    expect(st.isDirty).toBe(false);
  });
});

describe('creative refresh through the worker pool', () => {
  let instances: any[] = [];

  class PoolWorker {
    onmessage: ((e: { data: any }) => void) | null = null;
    onerror: ((e: any) => void) | null = null;
    posted: any[] = [];
    constructor() {
      instances.push(this);
    }
    postMessage(msg: any) {
      this.posted.push(msg);
    }
    terminate() {
      /* noop */
    }
  }

  /** Reply to a slot's most recent creative post with the given cache key. */
  function replyCreative(slot: any, cacheKey: string): void {
    const posted = slot.posted[slot.posted.length - 1];
    slot.onmessage?.({
      data: {
        kind: 'creative-result',
        jobId: posted.jobId,
        generationId: posted.generationId,
        grid: { width: 4, height: 2, chars: ['@'], fg: null, bg: null },
        cacheKey,
      },
    });
  }

  beforeEach(() => {
    instances = [];
    vi.stubGlobal('Worker', PoolWorker);
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 });
    terminateWorker();
    useStore.getState().newDocument();
  });

  afterEach(() => {
    terminateWorker();
    vi.unstubAllGlobals();
  });

  it('dispatches a creative job and derives the grid when the reply lands', async () => {
    const layerId = useStore.getState().addCreativeLayer()!;
    const promise = useStore.getState().refreshCreativeLayers();
    expect(instances).toHaveLength(1);
    expect(instances[0].posted[0].kind).toBe('creative');

    replyCreative(instances[0], 'key-1');
    expect(await promise).toBe(1);

    const layer = useStore.getState().document.layers.find(
      (l) => l.id === layerId,
    ) as CreativeLayer;
    expect(layer.grid).not.toBeNull();
    expect(layer.cacheKey).toBe('key-1');
  });

  it('drops an out-of-order reply when a newer refresh already dispatched', async () => {
    const layerId = useStore.getState().addCreativeLayer()!;

    const first = useStore.getState().refreshCreativeLayers();
    const second = useStore.getState().refreshCreativeLayers();
    // Slot 0 is busy, so the second dispatch spawned slot 1.
    expect(instances).toHaveLength(2);

    // The newer reply lands first and derives.
    replyCreative(instances[1], 'fresh');
    await expect(second).resolves.toBe(1);
    expect(
      (useStore.getState().document.layers.find((l) => l.id === layerId) as CreativeLayer)
        .cacheKey,
    ).toBe('fresh');

    // The older reply lands afterwards and must be ignored (epoch mismatch).
    replyCreative(instances[0], 'stale');
    await expect(first).resolves.toBe(0);
    expect(
      (useStore.getState().document.layers.find((l) => l.id === layerId) as CreativeLayer)
        .cacheKey,
    ).toBe('fresh');
  });
});
