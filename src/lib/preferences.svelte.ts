import { defaultLayout, normalizeLayout, type ColumnLayout } from './columnLayout';
import { normalizeMapHeight, normalizePreviewWidth } from './paneSplit';
import { DEFAULT_CRITERIA, normalizeCriteria, type Criteria } from './criteria';
import { DEFAULT_EDITOR, normalizeEditor, type EditorSettings } from './editors';
import { parseRoots } from './request';
import { TOKEN_NAMES, PALETTES, accentTextFor, placeholderColorFor, tokensFor } from './palettes';
import { resolveTheme } from './theme';
import type { Shading } from './treemapPaint';
import type { ThemePreference } from './types';

const STORAGE_KEY = 'spelunker.preferences.v1';
const MAX_RECENT_FOLDERS = 12;

interface Stored {
  criteria: Criteria;
  contextLines: number;
  recentFolders: string[];
  theme: ThemePreference;
  /** Id of the color theme, see palettes.ts. */
  palette: string;
  filtersOpen: boolean;
  columns: ColumnLayout;
  editor: EditorSettings;
  /** The preview's width in pixels, or null until the user drags the splitter (then a share of the window applies). */
  previewWidth: number | null;
  previewCollapsed: boolean;
  mapCollapsed: boolean;
  /** The results map's height in pixels, or null until the user drags its splitter (then a default applies). */
  mapHeight: number | null;
  mapMetric: 'size' | 'matches';
  mapColor: 'type' | 'age' | 'size';
  mapShading: Shading;
  /** Look for a newer release when the app starts, at most once a day. */
  checkForUpdates: boolean;
  /** When a check last ran, in milliseconds, or null if none has. */
  lastUpdateCheck: number | null;
  /** The version whose banner was dismissed, so that one is not announced again. */
  dismissedUpdate: string | null;
}

const THEMES: ThemePreference[] = ['system', 'light', 'dark'];

/** Every preference as it is on a first run. */
function defaultStored(): Stored {
  return {
    criteria: normalizeCriteria(DEFAULT_CRITERIA),
    contextLines: 2,
    recentFolders: [],
    theme: 'system',
    palette: PALETTES[0].id,
    filtersOpen: false,
    columns: defaultLayout(),
    editor: DEFAULT_EDITOR,
    previewWidth: null,
    previewCollapsed: false,
    mapCollapsed: false,
    mapHeight: null,
    mapMetric: 'size',
    mapColor: 'size',
    mapShading: 'facet',
    checkForUpdates: true,
    lastUpdateCheck: null,
    dismissedUpdate: null,
  };
}

function load(): Stored {
  const defaults = defaultStored();
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return defaults;
    return {
      // Earlier versions stored the criteria fields flat at the top level, so fall back to that.
      criteria: normalizeCriteria(raw.criteria ?? raw),
      contextLines: typeof raw.contextLines === 'number' ? raw.contextLines : defaults.contextLines,
      recentFolders: Array.isArray(raw.recentFolders)
        ? raw.recentFolders.filter((folder: unknown) => typeof folder === 'string')
        : defaults.recentFolders,
      theme: THEMES.includes(raw.theme) ? raw.theme : defaults.theme,
      palette: PALETTES.some((palette) => palette.id === raw.palette) ? raw.palette : defaults.palette,
      filtersOpen: raw.filtersOpen === true,
      columns: normalizeLayout(raw.columns),
      editor: normalizeEditor(raw.editor),
      previewWidth: normalizePreviewWidth(raw.previewWidth),
      previewCollapsed: raw.previewCollapsed === true,
      mapCollapsed: raw.mapCollapsed === true,
      mapHeight: normalizeMapHeight(raw.mapHeight),
      mapMetric: raw.mapMetric === 'matches' ? 'matches' : 'size',
      mapColor: raw.mapColor === 'type' || raw.mapColor === 'age' ? raw.mapColor : defaults.mapColor,
      mapShading: raw.mapShading === 'flat' || raw.mapShading === 'cushion' ? raw.mapShading : defaults.mapShading,
      checkForUpdates: raw.checkForUpdates !== false,
      lastUpdateCheck: typeof raw.lastUpdateCheck === 'number' && Number.isFinite(raw.lastUpdateCheck) ? raw.lastUpdateCheck : null,
      dismissedUpdate: typeof raw.dismissedUpdate === 'string' ? raw.dismissedUpdate : null,
    };
  } catch {
    // Storage can be unavailable or corrupt. Start from defaults.
    return defaults;
  }
}

/** Search criteria and UI choices that survive restarts. Persisted by `save()`. */
export class Preferences {
  criteria = $state<Criteria>(normalizeCriteria(DEFAULT_CRITERIA));
  contextLines = $state(2);
  recentFolders = $state<string[]>([]);
  theme = $state<ThemePreference>('system');
  palette = $state(PALETTES[0].id);
  filtersOpen = $state(false);
  columns = $state<ColumnLayout>(defaultLayout());
  editor = $state<EditorSettings>(DEFAULT_EDITOR);
  previewWidth = $state<number | null>(null);
  previewCollapsed = $state(false);
  mapCollapsed = $state(false);
  mapHeight = $state<number | null>(null);
  mapMetric = $state<'size' | 'matches'>('size');
  mapColor = $state<'type' | 'age' | 'size'>('size');
  mapShading = $state<Shading>('facet');
  checkForUpdates = $state(true);
  lastUpdateCheck = $state<number | null>(null);
  dismissedUpdate = $state<string | null>(null);

  constructor() {
    Object.assign(this, load());
    window.addEventListener('pagehide', () => this.saveIfPending());
  }

  get roots(): string[] {
    return parseRoots(this.criteria.lookIn);
  }

  /** Replaces every criterion, for example when a saved search is recalled. */
  applyCriteria(criteria: Criteria) {
    this.criteria = normalizeCriteria(criteria);
  }

  /** Puts every preference back as it is on a first run, and saves that. */
  reset() {
    Object.assign(this, defaultStored());
    this.save();
  }

  rememberFolders() {
    const roots = this.roots;
    const merged = [...roots, ...this.recentFolders.filter((folder) => !roots.includes(folder))];
    this.recentFolders = merged.slice(0, MAX_RECENT_FOLDERS);
  }

  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  /** Saves shortly after the last change, for values that change many times a second (a drag, a color picker). */
  saveSoon() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 300);
  }

  /** Writes a pending change at once, so closing or reloading the window right after a change loses nothing. */
  private saveIfPending() {
    if (this.saveTimer === undefined) return;
    clearTimeout(this.saveTimer);
    this.save();
  }

  save() {
    this.saveTimer = undefined;
    const snapshot: Stored = {
      criteria: $state.snapshot(this.criteria),
      contextLines: this.contextLines,
      recentFolders: $state.snapshot(this.recentFolders),
      theme: this.theme,
      palette: this.palette,
      filtersOpen: this.filtersOpen,
      columns: $state.snapshot(this.columns),
      editor: $state.snapshot(this.editor),
      previewWidth: this.previewWidth,
      previewCollapsed: this.previewCollapsed,
      mapCollapsed: this.mapCollapsed,
      mapHeight: this.mapHeight,
      mapMetric: this.mapMetric,
      mapColor: this.mapColor,
      mapShading: this.mapShading,
      checkForUpdates: this.checkForUpdates,
      lastUpdateCheck: this.lastUpdateCheck,
      dismissedUpdate: this.dismissedUpdate,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Losing a preference is better than interrupting a search.
    }
  }
}

/**
 * Applies the color theme to the document: sets every color token as a CSS variable, and keeps
 * following Windows while the mode preference is "system".
 */
export function applyTheme(preference: ThemePreference, paletteId: string): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    const mode = resolveTheme(preference, media.matches);
    const tokens = tokensFor(paletteId, mode);
    const root = document.documentElement;
    root.dataset.theme = mode;
    root.style.colorScheme = mode;
    for (const name of TOKEN_NAMES) root.style.setProperty(`--${name}`, tokens[name]);
    root.style.setProperty('--accent-text', accentTextFor(tokens));
    root.style.setProperty('--placeholder', placeholderColorFor(tokens));
    root.style.setProperty(
      '--shadow',
      mode === 'dark' ? '0 8px 22px rgba(0, 0, 0, 0.55)' : '0 6px 18px rgba(20, 26, 36, 0.16)',
    );
  };
  media.addEventListener('change', apply);
  apply();
  return () => media.removeEventListener('change', apply);
}
