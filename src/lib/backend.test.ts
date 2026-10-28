import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, Channel: class {}, convertFileSrc: (path: string) => path }));

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
