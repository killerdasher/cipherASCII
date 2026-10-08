// @vitest-environment jsdom
// The store applies the active theme to the document at creation time.
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore, selectCrtGlow } from '../../src/store';
import type { Document } from '../../src/core/types';

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
