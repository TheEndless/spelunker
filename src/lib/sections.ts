import type { PreviewLine } from './types';

/**
 * The lines of a file that are loaded. The preview never holds a whole large file: it holds runs of
 * lines (the matches with their context, the start of the file, a stretch someone asked for) and
 * stands for everything between them with a gap. A run has no line missing, and the runs are in
 * file order with at least one line between neighbours.
 */
export type Run = PreviewLine[];

/** A stretch of lines that exist in the file but are not loaded. Both ends are included. */
export interface Gap {
  from: number;
  to: number;
}

export type Row = { kind: 'line'; line: PreviewLine } | ({ kind: 'gap' } & Gap);

/** Which end of a gap to load from: the lines after the run above it, those before the run below it, or all of it. */
export type Expand = 'below' | 'above' | 'all';

/** The runs with `incoming` lines added. A line already loaded is replaced, and runs that now touch become one. */
export function addLines(runs: Run[], incoming: PreviewLine[]): Run[] {
  const byNumber = new Map<number, PreviewLine>();
  for (const run of runs) {
    for (const line of run) byNumber.set(line.lineNumber, line);
  }
  for (const line of incoming) byNumber.set(line.lineNumber, line);

  const merged: Run[] = [];
  let current: Run = [];
  for (const lineNumber of [...byNumber.keys()].sort((left, right) => left - right)) {
    const previous = current[current.length - 1];
    if (previous && lineNumber !== previous.lineNumber + 1) {
      merged.push(current);
      current = [];
    }
    current.push(byNumber.get(lineNumber)!);
  }
  if (current.length > 0) merged.push(current);
  return merged;
}

/**
 * What the pane lists: every loaded line, and a gap row wherever lines of the file are missing. The
 * length of the file is `null` until it is counted, and until then nothing is said about the end.
 */
export function rowsOf(runs: Run[], totalLines: number | null): Row[] {
  const rows: Row[] = [];
  let nextWanted = 1;
  for (const run of runs) {
    const first = run[0].lineNumber;
    if (first > nextWanted) rows.push({ kind: 'gap', from: nextWanted, to: first - 1 });
    for (const line of run) rows.push({ kind: 'line', line });
    nextWanted = run[run.length - 1].lineNumber + 1;
  }
  if (totalLines !== null && totalLines >= nextWanted) {
    rows.push({ kind: 'gap', from: nextWanted, to: totalLines });
  }
  return rows;
}

/** The lines to ask for to fill part of `gap`, `step` lines at most. */
export function rangeToLoad(gap: Gap, expand: Expand, step: number): { first: number; count: number } {
  const size = gap.to - gap.from + 1;
  const count = expand === 'all' ? size : Math.min(step, size);
  const first = expand === 'above' ? gap.to - count + 1 : gap.from;
  return { first, count };
}

export function gapLabel(gap: Gap): string {
  const size = gap.to - gap.from + 1;
  return size === 1 ? '1 line not shown' : `${size.toLocaleString('en-US')} lines not shown`;
}

/** Where a line is in the rows, or -1 when it is not loaded. */
export function rowIndexOfLine(rows: Row[], lineNumber: number): number {
  return rows.findIndex((row) => row.kind === 'line' && row.line.lineNumber === lineNumber);
}

/** The numbers of the matching lines of all the runs, in file order. */
export function hitLineNumbers(runs: Run[]): number[] {
  return runs.flatMap((run) => run.filter((line) => line.isMatch).map((line) => line.lineNumber));
}

/** The first line from 1 to `target` that is not loaded, or null when all of them are. */
export function firstMissingLine(runs: Run[], target: number): number | null {
  let next = 1;
  for (const run of runs) {
    if (run[0].lineNumber > next) break;
    next = Math.max(next, run[run.length - 1].lineNumber + 1);
  }
  return next <= target ? next : null;
}
