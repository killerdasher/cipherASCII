/**
 * Native open/save dialogs for project files.
 *
 * Inside Electron the preload bridge (`window.electronAPI`, see
 * `electron/preload.ts`) offers real OS dialogs plus filesystem reads and
 * writes; in the browser there is no bridge and callers fall back to the
 * `<input type=file>` / download paths the modals already ship with.
 *
 * Every function is safe to call anywhere: when the bridge is missing they
 * resolve `null` instead of throwing, so the UI only needs one branch.
 */

export interface DialogOpenResult {
  canceled?: boolean;
  filePaths?: string[];
}

export interface DialogSaveResult {
  canceled?: boolean;
  filePath?: string;
}

/** The bridge surface this module uses (mirrors `electron/preload.ts`). */
export interface ProjectDialogBridge {
  openFile(filters: { name: string; extensions: string[] }[]): Promise<DialogOpenResult>;
  saveFile(
    defaultPath: string,
    filters: { name: string; extensions: string[] }[],
  ): Promise<DialogSaveResult>;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<boolean>;
}

/** File-type filters offered to the native dialogs. */
export const PROJECT_FILTERS: { name: string; extensions: string[] }[] = [
  { name: 'CipherASCII Project', extensions: ['aap', 'json'] },
];

/**
 * The native dialog bridge, or `null` outside Electron.
 *
 * @returns the bridge or `null`
 */
export function getProjectBridge(): ProjectDialogBridge | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: ProjectDialogBridge }).electronAPI;
  return api ?? null;
}

/**
 * Open a project through the native file dialog.
 *
 * @returns the chosen file's basename and contents, or `null` when the
 * dialog was canceled or no bridge exists
 */
export async function openProjectViaDialog(): Promise<{ name: string; data: string } | null> {
  const bridge = getProjectBridge();
  if (!bridge) return null;
  const result = await bridge.openFile(PROJECT_FILTERS);
  const path = result.filePaths?.[0];
  if (result.canceled || !path) return null;
  const data = await bridge.readFile(path);
  const name = path.split(/[\\/]/).pop() ?? path;
  return { name, data };
}

/**
 * Save project content through the native file dialog.
 *
 * @param defaultPath - suggested filename (e.g. `my-art.aap`)
 * @param content - full file text
 * @returns the path written, or `null` when canceled or no bridge exists
 * @throws whatever the bridge rejects with (I/O failures) — callers surface it
 */
export async function saveProjectViaDialog(
  defaultPath: string,
  content: string,
): Promise<string | null> {
  const bridge = getProjectBridge();
  if (!bridge) return null;
  const result = await bridge.saveFile(defaultPath, PROJECT_FILTERS);
  if (result.canceled || !result.filePath) return null;
  await bridge.writeFile(result.filePath, content);
  return result.filePath;
}
