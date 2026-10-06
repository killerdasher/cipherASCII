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
