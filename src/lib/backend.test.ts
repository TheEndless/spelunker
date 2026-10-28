import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import shellItems from '../../src-tauri/src/shell_items.rs?raw';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, Channel: class {}, convertFileSrc: (path: string) => path }));

/** The listener the backend gave the webview's drag and drop events, as the windowing library would call it. */
const webviewDrops = vi.hoisted(() => ({ listener: null as null | ((event: { payload: unknown }) => unknown) }));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (listener: (event: { payload: unknown }) => unknown) => {
      webviewDrops.listener = listener;
      return () => (webviewDrops.listener = null);
    },
  }),
}));

/** The backend decides once, when it loads, whether it runs inside Tauri. These tests load it as if it did. */
let backend: typeof import('./backend');

beforeAll(async () => {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  backend = await import('./backend');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  invoke.mockReset();
});

describe('existingPaths inside Tauri', () => {
  const paths = Array.from({ length: 1000 }, (_, index) => `C:\\data\\file_${index}.txt`);

  it('asks the backend about every path in one call', async () => {
    invoke.mockResolvedValue(paths);
    await backend.existingPaths(paths);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('existing_paths', { paths });
  });

  it('returns what the backend found, in its order', async () => {
    const found = [paths[0], paths[2], paths[999]];
    invoke.mockResolvedValue(found);
    expect(await backend.existingPaths(paths)).toEqual(found);
  });

  it('asks nothing for no paths', async () => {
    expect(await backend.existingPaths([])).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('startFileDrag inside Tauri', () => {
  const paths = ['C:\\one\\a.txt', 'C:\\two\\b.txt'];

  it('asks the backend for the drag with every path', async () => {
    const outcome = { started: true, effect: 'copy', skipped: [] };
    invoke.mockResolvedValue(outcome);
    expect(await backend.startFileDrag(paths)).toEqual(outcome);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('start_file_drag', { paths });
  });

  it('passes a refusal through with its reason', async () => {
    const refusal = { started: false, effect: 'none', skipped: [], reason: 'The mouse button was released.' };
    invoke.mockResolvedValue(refusal);
    expect(await backend.startFileDrag(paths)).toEqual(refusal);
  });

  it('answers through the DEV hook and never calls the backend when the hook is installed', async () => {
    const requests: unknown[] = [];
    const hook = (request: { paths: string[] }) => {
      requests.push(request);
      return { started: true, effect: 'none', skipped: [] };
    };
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, __spFileDragHook: hook });
    try {
      expect(await backend.startFileDrag(paths)).toEqual({ started: true, effect: 'none', skipped: [] });
      expect(requests).toEqual([{ paths }]);
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    }
  });
});

describe('the limit of files for one drag or system menu', () => {
  const manyPaths = (count: number) => Array.from({ length: count }, (_, index) => `C:\\data\\file_${index}.txt`);

  it('is the same number the native side enforces', () => {
    const native = /pub const MAX_ITEMS: usize = (\d+);/.exec(shellItems);
    expect(native, 'MAX_ITEMS in shell_items.rs').not.toBeNull();
    expect(Number(native![1])).toBe(backend.MAX_SHELL_ITEMS);
    expect(backend.MAX_SHELL_ITEMS).toBe(5000);
  });

  it('refuses a drag of more files without calling the backend, naming the limit', async () => {
    const outcome = await backend.startFileDrag(manyPaths(5001));
    expect(invoke).not.toHaveBeenCalled();
    expect(outcome.started).toBe(false);
    expect(outcome.effect).toBe('none');
    expect(outcome.skipped).toEqual([]);
    expect(outcome.reason).toBe('5,001 files is too many to drag at once. The limit is 5,000.');
  });

  it('asks the backend for a drag of exactly the limit', async () => {
    invoke.mockResolvedValue({ started: true, effect: 'none', skipped: [] });
    await backend.startFileDrag(manyPaths(5000));
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('leaves more rows than the limit to the in-page menu, and up to it to the system menu', () => {
    expect(backend.systemMenuCovers(1)).toBe(true);
    expect(backend.systemMenuCovers(5000)).toBe(true);
    expect(backend.systemMenuCovers(5001)).toBe(false);
  });
});

describe('watchFolderDrops inside Tauri', () => {
  const own = ['C:\\data\\a.txt', 'C:\\data\\b.txt'];
  const position = { x: 10, y: 10 };

  async function watch() {
    const folders: string[][] = [];
    const hovers: boolean[] = [];
    const stop = await backend.watchFolderDrops((found) => folders.push(found), (over) => hovers.push(over));
    const send = async (payload: unknown) => {
      await webviewDrops.listener?.({ payload });
    };
    return { folders, hovers, send, stop };
  }

  it('ignores the enter, over and drop of the files the app is dragging out, in any case', async () => {
    backend.outgoingDragPaths.replace(own);
    const { folders, hovers, send, stop } = await watch();
    const shouted = own.map((path) => path.toUpperCase());
    await send({ type: 'enter', paths: shouted, position });
    await send({ type: 'over', position });
    await send({ type: 'drop', paths: shouted, position });
    expect(hovers).not.toContain(true);
    expect(folders).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
    stop();
    backend.outgoingDragPaths.clear();
  });

  it('still shows the overlay for other files and searches their folders on drop', async () => {
    backend.outgoingDragPaths.replace(own);
    const { folders, hovers, send, stop } = await watch();
    invoke.mockResolvedValue(['C:\\elsewhere']);
    await send({ type: 'enter', paths: ['C:\\elsewhere\\c.txt'], position });
    await send({ type: 'over', position });
    await send({ type: 'drop', paths: ['C:\\elsewhere\\c.txt'], position });
    expect(hovers).toEqual([true, true, false]);
    expect(invoke).toHaveBeenCalledWith('folders_from_dropped_paths', { paths: ['C:\\elsewhere\\c.txt'] });
    expect(folders).toEqual([['C:\\elsewhere']]);
    stop();
    backend.outgoingDragPaths.clear();
  });

  it('handles the same files as a user drop once the outgoing set is cleared', async () => {
    backend.outgoingDragPaths.replace(own);
    backend.outgoingDragPaths.clear();
    const { folders, hovers, send, stop } = await watch();
    invoke.mockResolvedValue(['C:\\data']);
    await send({ type: 'enter', paths: own, position });
    await send({ type: 'drop', paths: own, position });
    expect(hovers).toEqual([true, false]);
    expect(folders).toEqual([['C:\\data']]);
    stop();
  });
});

describe('showShellMenu inside Tauri', () => {
  const paths = ['C:\\one\\a.txt', 'C:\\two\\b.txt', 'C:\\two\\c.txt'];

  it('sends every path to the native menu with the position in device pixels', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, devicePixelRatio: 2 });
    try {
      const answer = { extra: null, ranShellCommand: false, skipped: [paths[1]] };
      invoke.mockResolvedValue(answer);
      expect(await backend.showShellMenu(paths, 10, 20.4, ['Copy paths'])).toEqual(answer);
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledWith('show_shell_menu', { paths, x: 20, y: 41, extraLabels: ['Copy paths'] });
    } finally {
      vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    }
  });

  it('shows nothing for no paths', async () => {
    expect(await backend.showShellMenu([], 0, 0, [])).toEqual({ extra: null, ranShellCommand: false, skipped: [] });
    expect(invoke).not.toHaveBeenCalled();
  });
});
