import { Channel, convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { MillisRange } from './filters';
import type { FileText, PreviewLine, QueryOptions, SearchMessage } from './types';

export interface SearchRequest {
  roots: string[];
  namePatterns: string;
  query: QueryOptions;
  recurse: boolean;
  maxDepth: number | null;
  includeHidden: boolean;
  includeBinary: boolean;
  followLinks: boolean;
  nameIsRegex: boolean;
  minSize: number | null;
  maxSize: number | null;
  modified: MillisRange;
  created: MillisRange;
}

/** True inside the Tauri window. A plain browser (npm run dev) falls back to a fake backend. */
const insideTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function mock() {
  return import('./mockBackend');
}

export function startSearch(request: SearchRequest, onMessage: (message: SearchMessage) => void) {
  if (!insideTauri) {
    void mock().then((backend) => backend.startSearch(request, onMessage));
    return;
  }
  const channel = new Channel<SearchMessage>();
  channel.onmessage = onMessage;
  void invoke('start_search', { request, onMessage: channel });
}

export async function stopSearch(): Promise<void> {
  if (!insideTauri) return (await mock()).stopSearch();
  await invoke('stop_search');
}

export async function previewFile(
  path: string,
  query: QueryOptions,
  contextLines: number,
  includeBinary: boolean,
): Promise<PreviewLine[]> {
  if (!insideTauri) return (await mock()).previewFile(path, query, contextLines);
  return invoke<PreviewLine[]>('preview', { path, query, contextLines, includeBinary });
}

export async function openPath(path: string): Promise<void> {
  if (insideTauri) await invoke('open_path', { path });
}

export async function revealPath(path: string): Promise<void> {
  if (insideTauri) await invoke('reveal_path', { path });
}

/**
 * Calls `onFolders` with the folders to search when files or folders are dropped on the window,
 * and `onHover` while something is being dragged over it. Returns a function that stops listening.
 */
export async function watchFolderDrops(
  onFolders: (folders: string[]) => void,
  onHover: (over: boolean) => void,
): Promise<() => void> {
  if (!insideTauri) return () => {};
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  return getCurrentWebview().onDragDropEvent(async (event) => {
    const payload = event.payload;
    if (payload.type === 'enter' || payload.type === 'over') {
      onHover(true);
    } else if (payload.type === 'leave') {
      onHover(false);
    } else if (payload.type === 'drop') {
      onHover(false);
      const folders = await invoke<string[]>('folders_from_dropped_paths', { paths: payload.paths });
      if (folders.length > 0) onFolders(folders);
    }
  });
}

export async function pickFolder(): Promise<string | null> {
  if (!insideTauri) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const chosen = await open({ directory: true, multiple: false });
  return typeof chosen === 'string' ? chosen : null;
}

/** The regex engine's complaint about a content query, or null when it is valid. */
export async function validateContent(query: QueryOptions): Promise<string | null> {
  if (!insideTauri) return (await mock()).validateContent(query);
  return invoke<string | null>('validate_content', { query });
}

export async function validateNameRegex(pattern: string): Promise<string | null> {
  if (!insideTauri) return (await mock()).validateNameRegex(pattern);
  return invoke<string | null>('validate_name_regex', { pattern });
}

export interface LoadedSearches {
  json: string;
  /** Set when the stored file was unreadable and was set aside. */
  warning: string | null;
}

export async function loadSavedSearches(): Promise<LoadedSearches> {
  if (!insideTauri) return (await mock()).loadSavedSearches();
  return invoke<LoadedSearches>('load_saved_searches');
}

export async function saveSavedSearches(json: string): Promise<void> {
  if (!insideTauri) return (await mock()).saveSavedSearches(json);
  await invoke('save_saved_searches', { json });
}

/** Reads a whole text file for the preview. Lines containing `query` are flagged when it is given. */
export async function readFileText(path: string, query: QueryOptions | null): Promise<FileText> {
  if (!insideTauri) return (await mock()).readFileText(path, query);
  return invoke<FileText>('read_file_text', { path, query });
}

/**
 * A URL the webview can load a previewed file from (picture, PDF, audio, video). The file is
 * allowed on the backend first, one at a time, and a file named like a PDF must really be one.
 * Rejects with the reason when the file may not be previewed.
 */
export async function previewSource(path: string): Promise<string> {
  if (!insideTauri) return '';
  await invoke('allow_preview', { path });
  return convertFileSrc(path);
}

/**
 * The given paths that still exist, used to drop rows after the system menu deleted or renamed
 * files. The browser mock has no files to lose, so every path exists there.
 * The native menu still acts on the first path alone (see `showShellMenu`), so only that one can
 * have gone, and only that one is checked. Plan Task 6 replaces this with the batch
 * `existing_paths` command once the menu takes every path.
 */
export async function existingPaths(paths: string[]): Promise<string[]> {
  if (!insideTauri || paths.length === 0) return [...paths];
  const [first, ...others] = paths;
  const firstExists = await invoke<boolean>('path_exists', { path: first });
  return firstExists ? [...paths] : others;
}

/** Opens a file in the editor chosen in Settings, at a line. Without a command it opens normally. */
export async function openInEditor(template: string | null, path: string, line: number): Promise<void> {
  if (!insideTauri) return;
  if (template === null) await invoke('open_path', { path });
  else await invoke('open_in_editor', { template, path, line });
}

/** Asks where to save, and writes `content` there. Resolves to false when the user cancels. */
export async function saveTextFile(suggestedName: string, extension: string, content: string): Promise<boolean> {
  if (!insideTauri) return false;
  const { save } = await import('@tauri-apps/plugin-dialog');
  const target = await save({ defaultPath: suggestedName, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
  if (!target) return false;
  await invoke('write_text_file', { path: target, content });
  return true;
}

export async function shellIntegrationEnabled(): Promise<boolean> {
  return insideTauri ? invoke<boolean>('shell_integration_enabled') : false;
}

export async function setShellIntegration(enabled: boolean): Promise<void> {
  if (insideTauri) await invoke('set_shell_integration', { enabled });
}

/** The folder Explorer passed when it started the app from a folder's right-click menu. */
export async function takeLaunchFolder(): Promise<string | null> {
  return insideTauri ? invoke<string | null>('take_launch_folder') : null;
}

/** Calls `onFolder` when another launch from Explorer hands a folder to the running window. */
export async function watchOpenFolder(onFolder: (folder: string) => void): Promise<() => void> {
  if (!insideTauri) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<string>('open-folder', (event) => onFolder(event.payload));
}

/** What the user did in the system menu. */
export interface ShellMenuResult {
  /** Index of the entry of ours that was chosen, or null. */
  extra: number | null;
  /** The shell carried out one of its own commands, which may have deleted or renamed the file. */
  ranShellCommand: boolean;
}

/** A request for Windows' own context menu, as the DEV hook records it. `x` and `y` are device pixels. */
export interface ShellMenuRequest {
  /** Every file the menu applies to, in list order. */
  paths: string[];
  x: number;
  y: number;
  extraLabels: string[];
}

declare global {
  interface Window {
    /**
     * A test seam. The system menu is modal on the app's main thread and cannot be closed from
     * outside, so end-to-end scripts install this to answer the request without showing the menu.
     */
    __spShellMenuHook?: (request: ShellMenuRequest) => ShellMenuResult;
  }
}

/**
 * Shows Windows' own context menu for `paths`, with our `extraLabels` entries on top.
 * `x` and `y` are in CSS pixels relative to the window.
 */
export async function showShellMenu(paths: string[], x: number, y: number, extraLabels: string[]): Promise<ShellMenuResult> {
  if (!insideTauri || paths.length === 0) return { extra: null, ranShellCommand: false };
  const scale = window.devicePixelRatio || 1;
  const request: ShellMenuRequest = { paths, x: Math.round(x * scale), y: Math.round(y * scale), extraLabels };
  // The hook exists only in development builds, where the end-to-end scripts run. A release build drops it.
  const hook = import.meta.env.DEV ? window.__spShellMenuHook : undefined;
  if (hook) return hook(request);
  // The native command still takes one path, so the menu shows for the first file only. Plan Task 6
  // makes it take every path, and this then passes `paths` through unchanged.
  return invoke<ShellMenuResult>('show_shell_menu', { path: paths[0], x: request.x, y: request.y, extraLabels });
}

/** True when the system menu is available, so the app uses it instead of its own list. */
export const hasShellMenu = insideTauri;

/**
 * Puts text on the clipboard. Inside the app this goes through the system directly, because the
 * webview's own clipboard needs the window to have focus, and a native menu has just taken it.
 */
export async function copyText(text: string): Promise<void> {
  if (insideTauri) {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
    await writeText(text);
  } else {
    await navigator.clipboard.writeText(text);
  }
}
