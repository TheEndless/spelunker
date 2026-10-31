// Stand-in backend for viewing the UI in a plain browser (`npm run dev`). Not used inside Tauri.
import type { ErrorRow, FileText, PreviewLine, QueryOptions, ResultRow, SearchMessage, UpdateInfo } from './types';
import type { DragOutcome, SearchRequest } from './backend';
import { DEMO_QUERY, demoPreview, demoRows } from './demoFixture';

declare global {
  interface Window {
    /** A test seam: paths the mock reports as gone, so scripts can watch rows of vanished files go. */
    __spMockMissingPaths?: string[];
    /** A test seam: what the update check finds. A string makes the check fail with that sentence. */
    __spMockUpdate?: UpdateInfo | string;
  }
}

let cancelled = false;

const TYPES: [string, string][] = [
  ['rs', 'Rust Source File'],
  ['ts', 'TypeScript Source File'],
  ['md', 'Markdown Source Document'],
  ['log', 'Text Document'],
  ['json', 'JSON Source File'],
  ['js', 'JavaScript File'],
];

/**
 * One formatter for every row. `toLocaleString` builds a new one per call, which made each batch of
 * 2,500 fake rows a long task on its own and muddied the map's timing checks.
 */
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' });

function fakeRow(index: number, withHits: boolean): ResultRow {
  const [extension, typeName] = TYPES[index % TYPES.length];
  const modifiedMs = Date.now() - ((index * 104729) % (400 * 86_400_000));
  return {
    path: `C:\\projects\\demo\\module_${index % 97}\\file_${index}.${extension}`,
    size: (index * 7919) % 5_000_000,
    modifiedMs,
    modifiedText: DATE_FORMAT.format(modifiedMs),
    hits: withHits ? 1 + (index % 6) : 0,
    typeName,
  };
}

/**
 * The deep fixture's file types, with images and archives so the map shows more than code and text,
 * and an extension no category knows, so it shows Other too.
 */
const DEEP_TYPES: [string, string][] = [
  ['rs', 'Rust Source File'],
  ['ts', 'TypeScript Source File'],
  ['md', 'Markdown Source Document'],
  ['log', 'Text Document'],
  ['png', 'PNG File'],
  ['zip', 'Compressed (zipped) Folder'],
  ['json', 'JSON Source File'],
  ['dat', 'DAT File'],
];

/** A deterministic path in a deep, uneven tree: the number of levels and the fan-out vary by index. */
export function deepPath(index: number): string {
  const levels = 3 + (index % 7);
  const parts = ['C:', 'data'];
  let seed = index * 2654435761;
  for (let level = 0; level < levels; level++) {
    seed = (seed ^ (seed >>> 13)) * 1274126177;
    const fanOut = 3 + ((level * 5 + (index % 11)) % 9);
    parts.push(`d${level}_${Math.abs(seed >> 3) % fanOut}`);
  }
  return `${parts.join('\\')}\\file_${index}.${DEEP_TYPES[index % DEEP_TYPES.length][0]}`;
}

const DAY_MS = 86_400_000;
/** The oldest file in the deep tree, so the Older age bucket is well filled. */
const DEEP_OLDEST_DAYS = 3 * 365;

/** A well-mixed number in 0..1 for an index, so dates do not line up with folders or types. */
function unitHash(index: number): number {
  let value = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

/**
 * One row of the deep fixture. Sizes are heavy tailed (a few files are hundreds of times larger than
 * most), match counts vary, and dates run from minutes to three years old, with a few unknown.
 */
export function deepRow(index: number): ResultRow {
  const typeName = DEEP_TYPES[index % DEEP_TYPES.length][1];
  // Cubing the hash crowds most dates near today while still reaching three years back.
  const modifiedMs = index % 53 === 0 ? null : Date.now() - Math.floor(unitHash(index) ** 3 * DEEP_OLDEST_DAYS * DAY_MS);
  return {
    path: deepPath(index),
    size: Math.floor(1000 * Math.pow(1.0003, index % 40000)) + ((index * 7919) % 5_000_000),
    modifiedMs,
    modifiedText: modifiedMs === null ? '' : DATE_FORMAT.format(modifiedMs),
    hits: 1 + ((index * 31) % 17 === 0 ? index % 200 : index % 6),
    typeName,
  };
}

/** Sample skipped files with long paths and the reasons Windows gives, so the errors list can be seen. */
const SKIPPED_FILES: ErrorRow[] = Array.from({ length: 46 }, (_, index) => ({
  path: `C:\\Windows\\Service Profiles\\LocalService\\AppData\\Local\\Microsoft\\Windows\\Some Long Folder Name ${index + 1}\\cache.db`,
  message: 'Access is denied. (os error 5)',
}));

/** True when the search text asks for the invented documents folder in demoFixture.ts. */
const isDemoQuery = (text: string): boolean => text.trim().toLowerCase() === DEMO_QUERY;

const SMALL_FILE_LINES = 60;
/** Typing "huge" as the search text or the name pattern previews every result as a file of four million lines, to see how the preview copes. */
const HUGE_QUERY = 'huge';
const HUGE_FILE_LINES = 4_000_000;

/** How long the pretend file every row previews as is, and where it matches, set by the search text. */
let pretendLineCount = SMALL_FILE_LINES;
let pretendMatchLines = [12, 13, 40];

/**
 * Typing "many" in the text box streams 100,000 rows so scrolling can be judged by eye. "deep"
 * streams 100,000 rows in a deep, uneven folder tree, the fair test for the results map. "invoice"
 * streams a few hundred rows of an invented documents folder, which the README screenshot shows.
 */
export function startSearch(request: SearchRequest, onMessage: (message: SearchMessage) => void) {
  cancelled = false;
  const huge = [request.query.text, request.namePatterns].some((text) => text.trim().toLowerCase() === HUGE_QUERY);
  pretendLineCount = huge ? HUGE_FILE_LINES : SMALL_FILE_LINES;
  pretendMatchLines = huge ? [12, 13, 2_000_000, HUGE_FILE_LINES - 5] : [12, 13, 40];
  const demo = isDemoQuery(request.query.text) ? demoRows() : null;
  const total = demo ? demo.length : ['many', 'slow', 'deep'].includes(request.query.text) ? 100_000 : 400;
  const withHits = request.query.text !== '';
  const makeRow = demo ? (index: number) => demo[index] : request.query.text === 'deep' ? deepRow : (index: number) => fakeRow(index, withHits);
  // The invented folder is a clean one: nothing was unreadable and nothing was binary.
  const skippedFiles = demo ? [] : SKIPPED_FILES;
  const batchSize = Math.max(50, Math.floor(total / 40));
  let produced = 0;
  const started = performance.now();

  const finish = () => {
    onMessage({
      kind: 'done',
      error: null,
      summary: {
        filesScanned: produced * 3,
        filesMatched: produced,
        totalHits: produced * 3,
        errors: skippedFiles.length,
        binarySkipped: demo ? 0 : 4,
        elapsedMs: Math.round(performance.now() - started),
        cancelled,
      },
    });
  };

  // Searching for "slow" takes three seconds to honour Stop, to see the Stopping dialog.
  const stopDelayMs = request.query.text === 'slow' ? 3000 : 0;
  let finishing = false;

  const step = () => {
    if (finishing) return;
    if (cancelled || produced >= total) {
      finishing = true;
      setTimeout(finish, cancelled ? stopDelayMs : 0);
      return;
    }
    const rows: ResultRow[] = [];
    for (let count = 0; count < batchSize && produced < total; count++) {
      rows.push(makeRow(produced++));
    }
    // The skipped files arrive with the first batch, like the first locked folders a real walk meets.
    const errors = produced === rows.length ? skippedFiles : [];
    // The last row of the batch says where the walk is, as the real progress report does.
    const lastPath = rows.at(-1)?.path ?? '';
    onMessage({ kind: 'batch', rows, errors, filesScanned: produced * 3, folder: lastPath.replace(/[\\/][^\\/]*$/, '') || null });
    setTimeout(step, 50);
  };
  step();
}

export function stopSearch() {
  cancelled = true;
}

/** Most lines one preview call returns, like the real backend's limit. */
const MOCK_MAX_LINES = 5000;

/** The line at `lineNumber` of the pretend file, a match when the file matches there. */
function pretendLine(lineNumber: number, needle: string): PreviewLine {
  const isMatch = needle !== '' && pretendMatchLines.includes(lineNumber);
  const text = isMatch ? `    let result = find_${needle}(input); // caf\u00e9 ${needle}` : `    // line ${lineNumber} of a pretend file`;
  const start = isMatch ? text.indexOf(needle) : -1;
  return { lineNumber, text, isMatch, matchRanges: start >= 0 ? [{ start, end: start + needle.length }] : [] };
}

export function previewFile(_path: string, query: QueryOptions, contextLines: number): FileText {
  if (isDemoQuery(query.text)) return { lines: demoPreview(contextLines), truncated: false, binary: false };
  const wanted = new Set<number>();
  for (const matchLine of pretendMatchLines) {
    for (let offset = -contextLines; offset <= contextLines; offset++) {
      const lineNumber = matchLine + offset;
      if (lineNumber >= 1 && lineNumber <= pretendLineCount) wanted.add(lineNumber);
    }
  }
  const needle = query.text || 'needle';
  const lines = [...wanted].sort((left, right) => left - right).map((lineNumber) => pretendLine(lineNumber, needle));
  return { lines, truncated: false, binary: false };
}

// Browser-only approximations. The real app validates with the Rust regex engine.
function describeRegexError(pattern: string): string | null {
  try {
    new RegExp(pattern);
    return null;
  } catch (error) {
    return String(error instanceof Error ? error.message : error);
  }
}

export function validateContent(query: QueryOptions): string | null {
  return query.regex ? describeRegexError(query.text) : null;
}

/** The browser has no drives, so the mock pretends to have two. */
/** Finds no newer release, unless a script says otherwise in `window.__spMockUpdate`. */
export async function checkForUpdates(): Promise<UpdateInfo> {
  const scripted = window.__spMockUpdate;
  if (typeof scripted === 'string') throw scripted;
  return scripted ?? { current: 'development', latest: 'development', available: false, page: '', published: null };
}

export function thisPcLabel(): string {
  return 'This PC (C:, D:)';
}

export function validateNameRegex(pattern: string): string | null {
  return describeRegexError(pattern);
}

/** The fake files never go away, except the ones a script names in `window.__spMockMissingPaths`. */
export function existingPaths(paths: string[]): string[] {
  const missing = new Set(typeof window === 'undefined' ? [] : (window.__spMockMissingPaths ?? []));
  return paths.filter((path) => !missing.has(path));
}

/**
 * The folders to search for dropped paths, without a disk to ask: a path whose last part has an
 * extension counts as a file and stands for its folder.
 */
export function foldersFromDroppedPaths(paths: string[]): string[] {
  const folders = paths.map((path) => {
    const separator = path.lastIndexOf('\\');
    const looksLikeFile = path.slice(separator + 1).includes('.');
    return looksLikeFile && separator > 0 ? path.slice(0, separator) : path;
  });
  return [...new Set(folders)];
}

/** A browser has no native file drag, so the drag ends at once with nothing done. */
export function startFileDrag(_paths: string[]): DragOutcome {
  return { started: true, effect: 'none', skipped: [] };
}

const SAVED_KEY = 'spelunker.mock.saved-searches';

export function loadSavedSearches() {
  try {
    return { json: localStorage.getItem(SAVED_KEY) ?? '[]', warning: null };
  } catch {
    return { json: '[]', warning: null };
  }
}

export function saveSavedSearches(json: string) {
  try {
    localStorage.setItem(SAVED_KEY, json);
  } catch {
    // Mock storage only.
  }
}

export function readLines(_path: string, query: QueryOptions | null, firstLine: number, count: number): FileText {
  const wantedCount = Math.min(count, MOCK_MAX_LINES);
  if (query && isDemoQuery(query.text)) {
    const later = demoPreview(Number.MAX_SAFE_INTEGER).filter((line) => line.lineNumber >= firstLine);
    return { lines: later.slice(0, wantedCount), truncated: later.length > wantedCount, binary: false };
  }
  const needle = query?.text ?? '';
  const last = Math.min(pretendLineCount, firstLine + wantedCount - 1);
  const lines = Array.from({ length: Math.max(0, last - firstLine + 1) }, (_, index) => pretendLine(firstLine + index, needle));
  return { lines, truncated: last < pretendLineCount, binary: false };
}

export function countLines(_path: string): number {
  return pretendLineCount;
}
