export interface ResultRow {
  path: string;
  size: number;
  modifiedMs: number | null;
  /** The time as Windows shows it in Explorer (the user's regional settings), or empty when unknown. */
  modifiedText: string;
  hits: number;
  /** Explorer's description of the file type, for example "Text Document". */
  typeName: string;
}

/** A row plus the pieces derived once on arrival, so sorting and rendering stay cheap. */
export interface DisplayRow extends ResultRow {
  name: string;
  folder: string;
}

export interface ErrorRow {
  path: string;
  message: string;
}

export interface Summary {
  filesScanned: number;
  filesMatched: number;
  totalHits: number;
  errors: number;
  binarySkipped: number;
  elapsedMs: number;
  cancelled: boolean;
}

export type SearchMessage =
  | { kind: 'batch'; rows: ResultRow[]; errors: ErrorRow[]; filesScanned: number | null }
  | { kind: 'done'; summary: Summary | null; error: string | null };

export interface MatchRange {
  start: number;
  end: number;
}

export interface PreviewLine {
  lineNumber: number;
  text: string;
  isMatch: boolean;
  matchRanges: MatchRange[];
}

export interface QueryOptions {
  text: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  multiLine: boolean;
}

export type ThemePreference = 'system' | 'light' | 'dark';
export type SortColumn = 'name' | 'folder' | 'hits' | 'size' | 'modified' | 'type';
export type SortDirection = 'asc' | 'desc';

/** A whole text file for the preview, with lines that match the search flagged. */
export interface FileText {
  lines: PreviewLine[];
  /** The file is longer than the preview reads, so only its first lines are shown. */
  truncated: boolean;
  /** The file is not text. */
  binary: boolean;
}
