// @vitest-environment jsdom
// The store applies the active theme to the document at creation time.
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore, selectCrtGlow } from '../../src/store';

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
