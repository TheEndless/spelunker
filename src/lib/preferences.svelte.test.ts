import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Preferences } from './preferences.svelte';

const STORAGE_KEY = 'spelunker.preferences.v1';

describe('Preferences', () => {
  let stored: Map<string, string>;

  beforeEach(() => {
    stored = new Map();
    vi.stubGlobal('window', { addEventListener: () => {} });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const loadWith = (raw: Record<string, unknown> | null) => {
    if (raw) stored.set(STORAGE_KEY, JSON.stringify(raw));
    return new Preferences();
  };

  describe('map shading', () => {
    it('starts as cushion when nothing is stored', () => {
      expect(loadWith(null).mapShading).toBe('cushion');
    });

    it('loads a stored flat choice', () => {
      expect(loadWith({ mapShading: 'flat' }).mapShading).toBe('flat');
    });

    it('loads anything else, or a missing value, as cushion', () => {
      for (const mapShading of ['glossy', 1, null, { flat: true }]) expect(loadWith({ mapShading }).mapShading).toBe('cushion');
      expect(loadWith({ theme: 'dark' }).mapShading).toBe('cushion');
    });

    it('is saved with the other preferences', () => {
      const preferences = loadWith(null);
      preferences.mapShading = 'flat';
      preferences.save();
      expect(JSON.parse(stored.get(STORAGE_KEY)!).mapShading).toBe('flat');
      expect(new Preferences().mapShading).toBe('flat');
    });
  });
});
