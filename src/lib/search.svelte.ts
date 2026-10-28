import { startSearch, stopSearch, type SearchRequest } from './backend';
import { splitPath } from './format';
import { sortRows } from './sort';
import type {
  DisplayRow,
  ErrorRow,
  QueryOptions,
  ResultRow,
  SearchMessage,
  SortColumn,
  SortDirection,
  Summary,
} from './types';

export interface SessionListener {
  /** Rows accepted from a batch, in arrival order, already carrying their ids. */
  appended(rows: DisplayRow[]): void;
  /** A row left the results (for example its file was deleted). */
  removed(id: number): void;
  /** A new search started. `startedAtMs` is the reference time for ages. */
  reset(startedAtMs: number): void;
}

function toDisplayRow(row: ResultRow, id: number): DisplayRow {
  return { ...row, ...splitPath(row.path), id };
}

/** Live state of the current (or most recent) search. */
/** How long a stop must take before the "Stopping" notice appears, so quick stops never flash it. */
export const STOPPING_NOTICE_DELAY_MS = 250;

export class SearchSession {
  rows = $state.raw<DisplayRow[]>([]);
  errors = $state.raw<ErrorRow[]>([]);
  running = $state(false);
  /** Stop was requested and the backend has not finished yet. */
  stopping = $state(false);
  /** True once stopping has taken long enough to deserve an on-screen explanation. */
  stoppingNoticeVisible = $state(false);
  filesScanned = $state(0);
  elapsedMs = $state(0);
  summary = $state.raw<Summary | null>(null);
  /** Set when the search could not start, for example an invalid regex. */
  failure = $state<string | null>(null);
  /** The criteria of the search whose results are listed, used when previewing files. */
  query = $state.raw<QueryOptions | null>(null);
  includeBinary = $state(false);

  sortColumn = $state<SortColumn | null>(null);
  sortDirection = $state<SortDirection>('asc');

  /** Results in sort order. Arrival order while a search runs, because sorting 100k rows every 50 ms is wasteful. */
  sortedRows = $derived.by(() => {
    if (this.sortColumn === null || this.running) return this.rows;
    return sortRows(this.rows, this.sortColumn, this.sortDirection);
  });

  private runId = 0;
  private seenPaths = new Set<string>();
  private nextRowId = 0;
  private rowsById = new Map<number, DisplayRow>();
  private listeners = new Set<SessionListener>();
  private startedAt = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  rowById(id: number): DisplayRow | undefined {
    return this.rowsById.get(id);
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(request: SearchRequest) {
    const runId = ++this.runId;
    this.clearStopping();
    this.rows = [];
    this.seenPaths = new Set();
    this.rowsById = new Map();
    for (const listener of this.listeners) listener.reset(Date.now());
    this.errors = [];
    this.filesScanned = 0;
    this.elapsedMs = 0;
    this.summary = null;
    this.failure = null;
    this.query = request.query;
    this.includeBinary = request.includeBinary;
    this.running = true;

    this.startedAt = performance.now();
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.elapsedMs = Math.round(performance.now() - this.startedAt);
    }, 100);

    startSearch(request, (message) => {
      // Messages from a superseded search are dropped.
      if (runId === this.runId) this.handle(message);
    });
  }

  stop() {
    if (!this.running || this.stopping) return;
    this.stopping = true;
    void stopSearch();
    this.noticeTimer = setTimeout(() => {
      this.stoppingNoticeVisible = true;
    }, STOPPING_NOTICE_DELAY_MS);
  }

  /** Takes a row out of the results, for example after its file was deleted from the system menu. */
  removeRow(path: string) {
    this.removeRows([path]);
  }

  /**
   * Takes many rows out of the results in one pass. Unknown paths are ignored. Listeners hear one
   * removal per row in the rows' order, after rows already holds the final list.
   */
  removeRows(paths: ReadonlySet<string> | string[]) {
    const doomedPaths = paths instanceof Set ? paths : new Set(paths);
    if (doomedPaths.size === 0) return;
    const kept: DisplayRow[] = [];
    const removed: DisplayRow[] = [];
    for (const row of this.rows) {
      (doomedPaths.has(row.path) ? removed : kept).push(row);
    }
    if (removed.length === 0) return;
    this.rows = kept;
    for (const row of removed) {
      this.rowsById.delete(row.id);
      this.seenPaths.delete(row.path);
    }
    for (const row of removed) {
      for (const listener of this.listeners) listener.removed(row.id);
    }
  }

  /** Dismisses the notice without cancelling anything. The search is still stopping. */
  hideStoppingNotice() {
    clearTimeout(this.noticeTimer);
    this.stoppingNoticeVisible = false;
  }

  toggleSort(column: SortColumn) {
    if (this.sortColumn !== column) {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    } else if (this.sortDirection === 'asc') {
      this.sortDirection = 'desc';
    } else {
      this.sortColumn = null;
    }
  }

  private handle(message: SearchMessage) {
    if (message.kind === 'batch') {
      // The list is keyed by path, so a path must never appear twice, whatever the backend sends.
      const fresh = message.rows.filter((row) => {
        if (this.seenPaths.has(row.path)) return false;
        this.seenPaths.add(row.path);
        return true;
      });
      if (fresh.length > 0) {
        const accepted = fresh.map((row) => toDisplayRow(row, this.nextRowId++));
        for (const row of accepted) this.rowsById.set(row.id, row);
        this.rows = this.rows.concat(accepted);
        for (const listener of this.listeners) listener.appended(accepted);
      }
      if (message.errors.length > 0) this.errors = this.errors.concat(message.errors);
      if (message.filesScanned !== null) this.filesScanned = message.filesScanned;
      return;
    }
    clearInterval(this.timer);
    this.clearStopping();
    this.running = false;
    this.failure = message.error;
    if (message.summary) {
      this.summary = message.summary;
      this.filesScanned = message.summary.filesScanned;
      this.elapsedMs = message.summary.elapsedMs;
    }
  }

  private clearStopping() {
    clearTimeout(this.noticeTimer);
    this.stopping = false;
    this.stoppingNoticeVisible = false;
  }
}
