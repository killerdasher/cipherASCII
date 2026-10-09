// @vitest-environment jsdom
import { Profiler, act } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useStore } from '../../src/store';
import { StatusBar } from '../../src/components/StatusBar';
import { LayerPanel } from '../../src/components/LayerPanel';
import { PropertyPanel } from '../../src/components/PropertyPanel';
import { ExportPanel } from '../../src/components/ExportPanel';

/**
 * P5 (docs/V2_AUDIT.md section 5): whole-app re-render on store changes.
 *
 * These panels are `React.memo`ized but used to subscribe with a bare
 * `useStore()` — a whole-state snapshot — so every `set()` (status messages,
 * 2 Hz perfStats, view flags) re-rendered them anyway. With narrow selectors
 * they must ignore writes they do not consume, while still updating on the
 * ones they do.
 */
describe('panel store subscriptions stay narrow (P5)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let commits = 0;

  const onRender = () => {
    commits += 1;
  };

  const render = async (element: ReactElement) => {
    await act(async () => {
      root.render(<Profiler id="panel" onRender={onRender}>{element}</Profiler>);
    });
  };

  const rerender = async (element: ReactElement) => {
    await act(async () => {
      root.render(<Profiler id="panel" onRender={onRender}>{element}</Profiler>);
    });
  };

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    commits = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useStore.getState().newDocument();
    useStore.setState({ crtGlow: false });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    useStore.setState({ crtGlow: false });
  });

  it('StatusBar ignores view-state writes but shows status messages', async () => {
    await render(
      <StatusBar
        isDirty={false}
        renderGeneration={1}
        pendingRender={false}
        cursor={null}
        zoomLevel={1}
      />,
    );
    const baseline = commits;
    expect(baseline).toBeGreaterThan(0);

    await act(async () => {
      useStore.setState({ crtGlow: true });
    });
    expect(commits).toBe(baseline);

    await act(async () => {
      useStore.getState().setStatusMessage('analysis done');
    });
    expect(commits).toBe(baseline + 1);
    expect(container.textContent).toContain('analysis done');
  });

  it('LayerPanel ignores every store write (it only consumes actions + props)', async () => {
    await render(<LayerPanel layers={[]} activeLayerId={null} />);
    const baseline = commits;

    await act(async () => {
      useStore.setState({ crtGlow: true });
      useStore.getState().setStatusMessage('unrelated');
    });
    expect(commits).toBe(baseline);

    // Props are the input that must still land.
    await rerender(<LayerPanel layers={[]} activeLayerId={null} />);
    expect(commits).toBe(baseline + 1);
  });

  it('PropertyPanel ignores store writes it does not consume', async () => {
    await render(<PropertyPanel layer={null} />);
    const baseline = commits;

    await act(async () => {
      useStore.setState({ crtGlow: true });
      useStore.getState().setStatusMessage('still unrelated');
    });
    expect(commits).toBe(baseline);
    expect(container.textContent).toContain('No layer selected');
  });

  it('ExportPanel ignores unrelated writes but re-renders on document edits', async () => {
    await render(<ExportPanel />);
    const baseline = commits;

    await act(async () => {
      useStore.getState().setStatusMessage('typing elsewhere');
    });
    expect(commits).toBe(baseline);

    await act(async () => {
      useStore.setState({ document: { ...useStore.getState().document } });
    });
    expect(commits).toBe(baseline + 1);
  });
});
