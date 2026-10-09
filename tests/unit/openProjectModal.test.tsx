// @vitest-environment jsdom
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenProjectModal } from '../../src/components/OpenProjectModal';
import { createDocument } from '../../src/core/project/schema';
import { serializeProject } from '../../src/core/project/serialize';
import type { Document } from '../../src/core/types';
import type { ProjectDialogBridge } from '../../src/services/projectFiles';

describe('<OpenProjectModal />', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async (element: ReactElement) => {
    await act(async () => {
      root.render(element);
    });
  };

  const openTrigger = () =>
    Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Open Project'),
    )!;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    delete (window as unknown as { electronAPI?: ProjectDialogBridge }).electronAPI;
    vi.restoreAllMocks();
  });

  it('offers the browser file picker when no native bridge exists', async () => {
    await render(<OpenProjectModal onOpen={() => {}} />);
    await act(async () => {
      openTrigger().click();
    });
    expect(container.querySelector('input[type="file"]')).toBeTruthy();
    expect(container.textContent).not.toContain('Choose file');
  });

  it('deserializes a picked file and hands the document to onOpen', async () => {
    const onOpen = vi.fn();
    await render(<OpenProjectModal onOpen={onOpen} />);
    await act(async () => {
      openTrigger().click();
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const payload = serializeProject(createDocument({ metadata: { ...createDocument().metadata, name: 'Picked' } }));
    const file = new File([payload], 'picked.aap', { type: 'application/json' });
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).toContain('Selected: picked.aap');
    await act(async () => {
      const openButton = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === 'Open',
      )!;
      openButton.click();
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
    const doc = onOpen.mock.calls[0][0] as Document;
    expect(doc.metadata.name).toBe('Picked');
    const handle = onOpen.mock.calls[0][1] as { name: string; data: string };
    expect(handle.name).toBe('picked.aap');
    expect(handle.data).toBe(payload);
  });

  it('reports an invalid project instead of calling onOpen', async () => {
    const onOpen = vi.fn();
    await render(<OpenProjectModal onOpen={onOpen} />);
    await act(async () => {
      openTrigger().click();
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['{not a project'], 'broken.aap', { type: 'application/json' });
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      const openButton = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === 'Open',
      )!;
      openButton.click();
    });
    expect(onOpen).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Failed to open project',
    );
  });

  it('uses the native dialog bridge when available', async () => {
    const payload = serializeProject(createDocument());
    const bridge: ProjectDialogBridge = {
      openFile: vi.fn(async () => ({ canceled: false, filePaths: ['/tmp/native.aap'] })),
      saveFile: vi.fn(),
      readFile: vi.fn(async () => payload),
      writeFile: vi.fn(),
    };
    (window as unknown as { electronAPI?: ProjectDialogBridge }).electronAPI = bridge;

    const onOpen = vi.fn();
    await render(<OpenProjectModal onOpen={onOpen} />);
    await act(async () => {
      openTrigger().click();
    });
    expect(container.querySelector('input[type="file"]')).toBeNull();
    const choose = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Choose file'),
    )!;
    await act(async () => {
      choose.click();
    });
    expect(container.textContent).toContain('Selected: native.aap');
    await act(async () => {
      const openButton = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === 'Open',
      )!;
      openButton.click();
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect((onOpen.mock.calls[0][1] as { name: string }).name).toBe('native.aap');
  });

  it('stays open with nothing pending when the native dialog is canceled', async () => {
    const bridge: ProjectDialogBridge = {
      openFile: vi.fn(async () => ({ canceled: true })),
      saveFile: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
    };
    (window as unknown as { electronAPI?: ProjectDialogBridge }).electronAPI = bridge;

    const onOpen = vi.fn();
    await render(<OpenProjectModal onOpen={onOpen} />);
    await act(async () => {
      openTrigger().click();
    });
    await act(async () => {
      const choose = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Choose file'),
      )!;
      choose.click();
    });
    expect(onOpen).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Selected:');
    expect(container.textContent).toContain('Open Project'); // modal still open
  });
});
