import { Channel, convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { EditorLaunch } from './editors';
import { createSelfDropFilter, OutgoingPaths, type FolderDropEvent } from './fileDrag';
import type { MillisRange } from './filters';
import type { FileText, PreviewLine, QueryOptions, SearchMessage, UpdateInfo } from './types';

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
  // A test seam like the shell menu hook: end-to-end scripts record which file Enter or a double-click
  // opens. A release build drops it. Outside Tauri opening does nothing, so there was nothing to observe.
  const hook = import.meta.env.DEV ? window.__spOpenPathHook : undefined;
  if (hook) return hook(path);
  if (insideTauri) await invoke('open_path', { path });
}

export async function revealPath(path: string): Promise<void> {
  if (insideTauri) await invoke('reveal_path', { path });
}

/**
 * The files the results list is dragging out. The list fills it when it starts a drag and clears
 * it on the next press, and `watchFolderDrops` ignores drop events for exactly these files, so
 * releasing them over the window itself does not change Look in.
 */
export const outgoingDragPaths = new OutgoingPaths();

/**
 * Calls `onFolders` with the folders to search when files or folders are dropped on the window,
 * and `onHover` while something is being dragged over it. Returns a function that stops listening.
 * A drag of the files the list is dragging out is ignored throughout.
 */
export async function watchFolderDrops(
  onFolders: (folders: string[]) => void,
  onHover: (over: boolean) => void,
): Promise<() => void> {
  const foldersFor = async (paths: string[]) =>
    insideTauri ? invoke<string[]>('folders_from_dropped_paths', { paths }) : (await mock()).foldersFromDroppedPaths(paths);
  const handle = folderDropHandler(onFolders, onHover, foldersFor);
  if (!insideTauri) {
    // A browser gets no drop events from the windowing library, so in development the end-to-end
    // scripts deliver them through this seam. A release build drops it.
    if (!import.meta.env.DEV) return () => {};
    window.__spEmitFolderDrop = handle;
    return () => {
      if (window.__spEmitFolderDrop === handle) delete window.__spEmitFolderDrop;
    };
  }
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  return getCurrentWebview().onDragDropEvent((event) => handle(event.payload));
}

function folderDropHandler(
  onFolders: (folders: string[]) => void,
  onHover: (over: boolean) => void,
  foldersFor: (paths: string[]) => Promise<string[]>,
): (event: FolderDropEvent) => Promise<void> {
  const shouldHandle = createSelfDropFilter((paths) => outgoingDragPaths.coversAll(paths));
  return async (event) => {
    if (!shouldHandle(event)) return;
    if (event.type === 'enter' || event.type === 'over') {
      onHover(true);
    } else if (event.type === 'leave') {
      onHover(false);
    } else {
      onHover(false);
      const folders = await foldersFor(event.paths);
      if (folders.length > 0) onFolders(folders);
    }
  };
}

/**
 * The folder the user picks in the native dialog, or null when they cancel. Choosing This PC gives
 * its label with the drive letters, since it is not a folder with a path.
 */
export async function pickFolder(): Promise<string | null> {
  if (!insideTauri) return null;
  return invoke<string | null>('pick_folder');
}

/**
 * A URL for the system's icon for files ending in `extension` (without the dot), the larger one a
 * card shows when `large`, or null when there is none, or in a plain browser, which has no system
 * icons to ask for.
 */
export async function fileIconUrl(extension: string, large: boolean): Promise<string | null> {
  if (!insideTauri) return null;
  const png = await invoke<ArrayBuffer>('file_icon', { extension, large });
  return png.byteLength === 0 ? null : URL.createObjectURL(new Blob([png], { type: 'image/png' }));
}

/** What Look in shows for This PC: its name and the letters of the local drives, such as "This PC (C:, D:)". */
export async function thisPcLabel(): Promise<string> {
  if (!insideTauri) return (await mock()).thisPcLabel();
  return invoke<string>('this_pc_label');
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
 * The given paths that still exist, used to drop rows after the system menu or a drag deleted,
 * renamed or moved files, in the order given. One call checks them all.
 */
export async function existingPaths(paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  if (!insideTauri) return (await mock()).existingPaths(paths);
  return invoke<string[]>('existing_paths', { paths });
}

/** Opens a file in the editor chosen in Settings, at a line. Without a launch it opens normally. */
export async function openInEditor(launch: EditorLaunch | null, path: string, line: number): Promise<void> {
  if (!insideTauri) return;
  if (launch === null) await invoke('open_path', { path });
  else await invoke('open_in_editor', { editor: launch.editor, customTemplate: launch.customTemplate, path, line });
}

/**
 * Asks where to save, and writes `content` there. Resolves to false when the user cancels. The
 * backend shows the dialog and writes the file, so the page never names the place it writes to.
 */
export async function saveTextFile(suggestedName: string, extension: string, content: string): Promise<boolean> {
  if (!insideTauri) return false;
  return invoke<boolean>('save_text_file', { suggestedName, extension, content });
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
  /** The shell carried out one of its own commands, which may have deleted or renamed files. */
  ranShellCommand: boolean;
  /** The requested paths that no longer existed, which the menu left out. */
  skipped: string[];
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
    /** A test seam in development builds. Given the path of each file the app is asked to open, it replaces opening. */
    __spOpenPathHook?: (path: string) => void;
    /**
     * A test seam in development builds. The native file drag is modal and would drop wherever the
     * real cursor is, so end-to-end scripts install this to record the request instead.
     */
    __spFileDragHook?: (request: FileDragRequest) => DragOutcome;
    /** A test seam in development builds outside Tauri: delivers a drag and drop event to the window's handler. */
    __spEmitFolderDrop?: (event: FolderDropEvent) => Promise<void>;
  }
}

/**
 * Shows Windows' own context menu for `paths`, with our `extraLabels` entries on top.
 * `x` and `y` are in CSS pixels relative to the window.
 */
export async function showShellMenu(paths: string[], x: number, y: number, extraLabels: string[]): Promise<ShellMenuResult> {
  if (!insideTauri || paths.length === 0) return { extra: null, ranShellCommand: false, skipped: [] };
  const scale = window.devicePixelRatio || 1;
  const request: ShellMenuRequest = { paths, x: Math.round(x * scale), y: Math.round(y * scale), extraLabels };
  // The hook exists only in development builds, where the end-to-end scripts run. A release build drops it.
  const hook = import.meta.env.DEV ? window.__spShellMenuHook : undefined;
  if (hook) return hook(request);
  return invoke<ShellMenuResult>('show_shell_menu', { paths, x: request.x, y: request.y, extraLabels });
}

/** How a native file drag ended. */
export interface DragOutcome {
  /** False when the drag was refused before it began, with the reason for the user. */
  started: boolean;
  effect: 'none' | 'copy' | 'move' | 'link';
  /** The requested paths that no longer existed, which the drag left out. */
  skipped: string[];
  reason?: string;
}

/** A request for a native file drag, as the DEV hook records it. */
export interface FileDragRequest {
  /** Every file the drag carries, in list order. */
  paths: string[];
}

/**
 * Drags `paths` out of the window as files, while the user still holds the mouse button, and
 * resolves when the drag has ended. The backend refuses (`started: false`) unless the physical
 * button is really down, because a drag started without it would drop at once wherever the
 * cursor is.
 */
export async function startFileDrag(paths: string[]): Promise<DragOutcome> {
  // The hook exists only in development builds, where the end-to-end scripts run, and is checked
  // before anything else so no script can reach the real drag. A release build drops it.
  const hook = import.meta.env.DEV ? window.__spFileDragHook : undefined;
  if (hook) return hook({ paths });
  if (paths.length > MAX_SHELL_ITEMS) {
    const count = paths.length.toLocaleString('en-US');
    const limit = MAX_SHELL_ITEMS.toLocaleString('en-US');
    return { started: false, effect: 'none', skipped: [], reason: `${count} files is too many to drag at once. The limit is ${limit}.` };
  }
  if (!insideTauri) return (await mock()).startFileDrag(paths);
  return invoke<DragOutcome>('start_file_drag', { paths });
}

/**
 * The most files one drag or system menu may name. It must equal `MAX_ITEMS` in
 * `src-tauri/src/shell_items.rs` (a test compares them): the backend parses every file, which can
 * stall on offline shares, so it refuses more.
 */
export const MAX_SHELL_ITEMS = 5000;

/**
 * Whether the system menu is shown for `rowCount` rows. More rows than the backend accepts get the
 * app's own menu (Copy paths, Copy names) instead of an error.
 */
export function systemMenuCovers(rowCount: number): boolean {
  return hasShellMenu && rowCount <= MAX_SHELL_ITEMS;
}

/** True when the system menu is available, so the app uses it instead of its own list. */
export const hasShellMenu = insideTauri;

/**
 * Puts text on the clipboard. Inside the app this goes through the system directly, because the
 * webview's own clipboard needs the window to have focus, and a native menu has just taken it.
 */
/** The version of the app, as its build says. A plain browser has no build to ask. */
export async function appVersion(): Promise<string> {
  if (!insideTauri) return 'development';
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}

/** Asks GitHub whether a newer release exists. Rejects with a sentence saying why it could not tell. */
export async function checkForUpdates(): Promise<UpdateInfo> {
  if (!insideTauri) return (await mock()).checkForUpdates();
  return invoke<UpdateInfo>('check_for_updates');
}

/** Opens a release page in the browser. The backend refuses any address that is not one of this project's. */
export async function openReleasePage(address: string): Promise<void> {
  if (insideTauri) await invoke('open_release_page', { address });
}

export async function copyText(text: string): Promise<void> {
  if (insideTauri) {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
    await writeText(text);
  } else {
    await navigator.clipboard.writeText(text);
  }
}
