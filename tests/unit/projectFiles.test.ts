// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getProjectBridge,
  openProjectViaDialog,
  saveProjectViaDialog,
  type ProjectDialogBridge,
} from '../../src/services/projectFiles';

function installBridge(overrides: Partial<ProjectDialogBridge> = {}): ProjectDialogBridge {
  const files = new Map<string, string>([['/projects/x.aap', '{"id":"x"}']]);
  const bridge: ProjectDialogBridge = {
    openFile: vi.fn(async () => ({ canceled: false, filePaths: ['/projects/x.aap'] })),
    saveFile: vi.fn(async () => ({ canceled: false, filePath: '/projects/out.aap' })),
    readFile: vi.fn(async (path: string) => files.get(path) ?? ''),
    writeFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
      return true;
    }),
    ...overrides,
  };
  (window as unknown as { electronAPI?: ProjectDialogBridge }).electronAPI = bridge;
  return bridge;
}

describe('native project dialogs', () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: ProjectDialogBridge }).electronAPI;
    vi.restoreAllMocks();
  });

  it('has no bridge outside Electron', () => {
    expect(getProjectBridge()).toBeNull();
  });

  it('opens a project through the bridge with a basename', async () => {
    const bridge = installBridge();
    expect(getProjectBridge()).toBe(bridge);
    const file = await openProjectViaDialog();
    expect(file).toEqual({ name: 'x.aap', data: '{"id":"x"}' });
    expect(bridge.openFile).toHaveBeenCalledWith([
      { name: 'CipherASCII Project', extensions: ['aap', 'json'] },
    ]);
  });

  it('returns null when the open dialog is canceled', async () => {
    installBridge({ openFile: vi.fn(async () => ({ canceled: true })) });
    expect(await openProjectViaDialog()).toBeNull();
  });

  it('returns null without a bridge', async () => {
    expect(await openProjectViaDialog()).toBeNull();
  });

  it('saves content through the bridge and reports the path', async () => {
    const bridge = installBridge();
    const path = await saveProjectViaDialog('my-art.aap', 'CONTENT');
    expect(path).toBe('/projects/out.aap');
    expect(bridge.saveFile).toHaveBeenCalledWith('my-art.aap', [
      { name: 'CipherASCII Project', extensions: ['aap', 'json'] },
    ]);
    expect(bridge.writeFile).toHaveBeenCalledWith('/projects/out.aap', 'CONTENT');
  });

  it('returns null when the save dialog is canceled and writes nothing', async () => {
    const bridge = installBridge({ saveFile: vi.fn(async () => ({ canceled: true })) });
    expect(await saveProjectViaDialog('my-art.aap', 'CONTENT')).toBeNull();
    expect(bridge.writeFile).not.toHaveBeenCalled();
  });

  it('returns null without a bridge', async () => {
    expect(await saveProjectViaDialog('my-art.aap', 'CONTENT')).toBeNull();
  });
});
