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

  describe('a custom highlight color from an earlier version', () => {
    it('is ignored when loading and not written back, since the theme sets the highlight', () => {
      const preferences = loadWith({ theme: 'dark', highlightColor: '#ff0000' });
      expect('highlightColor' in preferences).toBe(false);
      preferences.save();
      expect(JSON.parse(stored.get(STORAGE_KEY)!)).not.toHaveProperty('highlightColor');
    });
  });

  describe('reset', () => {
    it('puts every preference back to its first-run value and saves that', () => {
      const preferences = loadWith({
        theme: 'dark',
        contextLines: 9,
        mapShading: 'cushion',
        mapColor: 'size',
        recentFolders: ['C:\\Work'],
        previewWidth: 400,
        columns: { order: ['size', 'name'], hidden: ['folder'], widths: { name: 500 }, autoSize: false, version: 2 },
      });
      preferences.reset();
      const fresh = loadWith(null);
      expect($state.snapshot(preferences.columns)).toEqual($state.snapshot(fresh.columns));
      expect(preferences.theme).toBe('system');
      expect(preferences.contextLines).toBe(2);
      expect(preferences.mapShading).toBe('facet');
      expect(preferences.mapColor).toBe('size');
      expect(preferences.recentFolders).toEqual([]);
      expect(preferences.previewWidth).toBeNull();
      const saved = JSON.parse(stored.get(STORAGE_KEY)!);
      expect(saved.theme).toBe('system');
      expect(saved.columns.hidden).toEqual(['hits']);
    });
  });

  describe('map shading', () => {
    it('starts as facet when nothing is stored', () => {
      expect(loadWith(null).mapShading).toBe('facet');
    });

    it('loads a stored color mode, and falls back to size for anything else', () => {
      expect(loadWith({ mapColor: 'size' }).mapColor).toBe('size');
      expect(loadWith({ mapColor: 'age' }).mapColor).toBe('age');
      expect(loadWith({ mapColor: 'type' }).mapColor).toBe('type');
      expect(loadWith({ mapColor: 'rainbow' }).mapColor).toBe('size');
      expect(loadWith(null).mapColor).toBe('size');
    });

    it('loads a stored cushion choice', () => {
      expect(loadWith({ mapShading: 'cushion' }).mapShading).toBe('cushion');
    });

    it('loads a stored flat choice', () => {
      expect(loadWith({ mapShading: 'flat' }).mapShading).toBe('flat');
    });

    it('loads anything else, or a missing value, as facet', () => {
      for (const mapShading of ['glossy', 1, null, { flat: true }]) expect(loadWith({ mapShading }).mapShading).toBe('facet');
      expect(loadWith({ theme: 'dark' }).mapShading).toBe('facet');
    });

    it('is saved with the other preferences', () => {
      const preferences = loadWith(null);
      preferences.mapShading = 'flat';
      preferences.save();
      expect(JSON.parse(stored.get(STORAGE_KEY)!).mapShading).toBe('flat');
      expect(new Preferences().mapShading).toBe('flat');
    });
  });

  describe('update checks', () => {
    it('start on, never run, with nothing dismissed', () => {
      const preferences = loadWith(null);
      expect(preferences.checkForUpdates).toBe(true);
      expect(preferences.lastUpdateCheck).toBeNull();
      expect(preferences.dismissedUpdate).toBeNull();
    });

    it('load what was stored, and ignore values of the wrong type', () => {
      const kept = loadWith({ checkForUpdates: false, lastUpdateCheck: 1_700_000_000_000, dismissedUpdate: '1.2.0' });
      expect(kept.checkForUpdates).toBe(false);
      expect(kept.lastUpdateCheck).toBe(1_700_000_000_000);
      expect(kept.dismissedUpdate).toBe('1.2.0');
      const junk = loadWith({ checkForUpdates: 'no', lastUpdateCheck: '1', dismissedUpdate: 7 });
      expect(junk.checkForUpdates).toBe(true);
      expect(junk.lastUpdateCheck).toBeNull();
      expect(junk.dismissedUpdate).toBeNull();
    });

    it('are saved with the other preferences', () => {
      const preferences = loadWith(null);
      preferences.checkForUpdates = false;
      preferences.dismissedUpdate = '1.3.0';
      preferences.save();
      const reloaded = new Preferences();
      expect(reloaded.checkForUpdates).toBe(false);
      expect(reloaded.dismissedUpdate).toBe('1.3.0');
    });
  });
});
