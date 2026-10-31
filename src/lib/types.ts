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
  /** Unique for the life of the session and never reused, so other views can refer to a row after others are removed. */
  id: number;
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
  | { kind: 'batch'; rows: ResultRow[]; errors: ErrorRow[]; filesScanned: number | null; folder: string | null }
  | { kind: 'done'; summary: Summary | null; error: string | null };

export interface MatchRange {
  start: number;
  end: number;
}

/** What was cut off a line too long to keep whole. The kept text and these two counts add up to the line. */
export interface Clip {
  beforeBytes: number;
  afterBytes: number;
}

export interface PreviewLine {
  lineNumber: number;
  /** A very long line is only a window of it, around the first match or at its start. */
  text: string;
  isMatch: boolean;
  matchRanges: MatchRange[];
  /** Set when `text` is only part of the line. */
  clip?: Clip;
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

/** What a check for a newer release found. */
export interface UpdateInfo {
  /** The version of this app. */
  current: string;
  /** The version of the newest release. */
  latest: string;
  /** True when `latest` is newer than `current`. */
  available: boolean;
  /** The page of that release, which is what Download opens. */
  page: string;
  /** When it was published, as GitHub writes it. */
  published: string | null;
}

/** Lines of a text file for the preview, with the ones that match the search flagged. */
export interface FileText {
  lines: PreviewLine[];
  /** More lines (or matches) follow the ones returned: the preview's size limit was reached. */
  truncated: boolean;
  /** The file is not text. */
  binary: boolean;
}
