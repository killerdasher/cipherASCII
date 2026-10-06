/**
 * Electron preload script - secure bridge between renderer and main process
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // File dialogs
  openFile: (filters: Electron.FileFilter[]) => ipcRenderer.invoke('dialog:openFile', filters),
  saveFile: (defaultPath: string, filters: Electron.FileFilter[]) => ipcRenderer.invoke('dialog:saveFile', defaultPath, filters),

  // File system
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  // Binary read of a bundled app asset (relative to dist/), used to hand the
  // ffmpeg core files to the renderer when the page runs from file://.
  readAsset: (relPath: string) => ipcRenderer.invoke('fs:readAsset', relPath),

  // App info
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPath: (name: 'userData' | 'temp' | 'desktop') => ipcRenderer.invoke('app:getPath', name),

  // Events
  onMenuAction: (callback: (action: string) => void) => {
    ipcRenderer.on('menu-action', (_event, action) => callback(action));
    return () => ipcRenderer.removeAllListeners('menu-action');
  },
});

declare global {
  interface Window {
    electronAPI: {
      openFile: (filters: Electron.FileFilter[]) => Promise<Electron.OpenDialogReturnValue>;
      saveFile: (defaultPath: string, filters: Electron.FileFilter[]) => Promise<Electron.SaveDialogReturnValue>;
      readFile: (filePath: string) => Promise<string>;
      writeFile: (filePath: string, content: string) => Promise<boolean>;
      readAsset: (relPath: string) => Promise<Uint8Array>;
      getVersion: () => Promise<string>;
      getPath: (name: 'userData' | 'temp' | 'desktop') => Promise<string>;
      onMenuAction: (callback: (action: string) => void) => () => void;
    };
  }
}