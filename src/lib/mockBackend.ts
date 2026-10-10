// Stand-in backend for viewing the UI in a plain browser (`npm run dev`). Not used inside Tauri.
import type { ErrorRow, FileText, PreviewLine, QueryOptions, ResultRow, SearchMessage } from './types';
import type { SearchRequest } from './backend';

let cancelled = false;

const TYPES: [string, string][] = [
  ['rs', 'Rust Source File'],
  ['ts', 'TypeScript Source File'],
  ['md', 'Markdown Source Document'],
  ['log', 'Text Document'],
  ['json', 'JSON Source File'],
  ['js', 'JavaScript File'],
];

function fakeRow(index: number, withHits: boolean): ResultRow {
  const [extension, typeName] = TYPES[index % TYPES.length];
  const modifiedMs = Date.now() - ((index * 104729) % (400 * 86_400_000));
  return {
    path: `C:\\projects\\demo\\module_${index % 97}\\file_${index}.${extension}`,
    size: (index * 7919) % 5_000_000,
    modifiedMs,
    modifiedText: new Date(modifiedMs).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }),
    hits: withHits ? 1 + (index % 6) : 0,
    typeName,
  };
}

/** Sample skipped files with long paths and the reasons Windows gives, so the errors list can be seen. */
const SKIPPED_FILES: ErrorRow[] = Array.from({ length: 46 }, (_, index) => ({
  path: `C:\\Windows\\Service Profiles\\LocalService\\AppData\\Local\\Microsoft\\Windows\\Some Long Folder Name ${index + 1}\\cache.db`,
  message: 'Access is denied. (os error 5)',
}));

/** Typing "many" in the text box streams 100,000 rows so scrolling can be judged by eye. */
export function startSearch(request: SearchRequest, onMessage: (message: SearchMessage) => void) {
  cancelled = false;
  const total = ['many', 'slow'].includes(request.query.text) ? 100_000 : 400;
  const withHits = request.query.text !== '';
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
        errors: SKIPPED_FILES.length,
        binarySkipped: 4,
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
      rows.push(fakeRow(produced++, withHits));
    }
    // The skipped files arrive with the first batch, like the first locked folders a real walk meets.
    const errors = produced === rows.length ? SKIPPED_FILES : [];
    onMessage({ kind: 'batch', rows, errors, filesScanned: produced * 3 });
    setTimeout(step, 50);
  };
  step();
}

export function stopSearch() {
  cancelled = true;
}

export function previewFile(_path: string, query: QueryOptions, contextLines: number): PreviewLine[] {
  const lines: PreviewLine[] = [];
  const needle = query.text || 'needle';
  const matchLines = [12, 13, 40];
  for (const matchLine of matchLines) {
    for (let offset = -contextLines; offset <= contextLines; offset++) {
      const lineNumber = matchLine + offset;
      if (lines.some((line) => line.lineNumber === lineNumber)) continue;
      const isMatch = offset === 0 || matchLines.includes(lineNumber);
      const text = isMatch ? `    let result = find_${needle}(input); // caf\u00e9 ${needle}` : `    // context line ${lineNumber}`;
      const start = text.indexOf(needle);
      lines.push({
        lineNumber,
        text,
        isMatch,
        matchRanges: isMatch && start >= 0 ? [{ start, end: start + needle.length }] : [],
      });
    }
  }
  return lines.sort((left, right) => left.lineNumber - right.lineNumber);
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

export function validateNameRegex(pattern: string): string | null {
  return describeRegexError(pattern);
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

export function readFileText(_path: string, query: QueryOptions | null): FileText {
  const needle = query?.text || '';
  const lines: PreviewLine[] = Array.from({ length: 60 }, (_, index) => {
    const lineNumber = index + 1;
    const isMatch = needle !== '' && lineNumber % 9 === 0;
    const text = isMatch ? `    let result = find_${needle}(input);` : `    // line ${lineNumber} of a pretend file`;
    const start = isMatch ? text.indexOf(needle) : -1;
    return { lineNumber, text, isMatch, matchRanges: start >= 0 ? [{ start, end: start + needle.length }] : [] };
  });
  return { lines, truncated: false, binary: false };
}
