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

  it('asks the backend about the first path only, since the native menu acts on that one alone', async () => {
    invoke.mockResolvedValue(true);
    await backend.existingPaths(paths);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('path_exists', { path: paths[0] });
  });

  it('keeps every path when the first still exists', async () => {
    invoke.mockResolvedValue(true);
    expect(await backend.existingPaths(paths)).toEqual(paths);
  });

  it('drops only the first path when it is gone, and keeps the others', async () => {
    invoke.mockResolvedValue(false);
    expect(await backend.existingPaths(paths)).toEqual(paths.slice(1));
  });

  it('asks nothing for no paths', async () => {
    expect(await backend.existingPaths([])).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });
});
