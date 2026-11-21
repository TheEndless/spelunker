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

/**
 * The runs with `incoming` lines added. A line already loaded is replaced, and runs that now touch become one.
 * Runs the new lines do not reach or touch are returned as they were, so a large file is not copied for each section.
 */
export function addLines(runs: Run[], incoming: PreviewLine[]): Run[] {
  const added = inFileOrder(incoming);
  if (added.length === 0) return runs;
  const lowest = added[0].lineNumber;
  const highest = added[added.length - 1].lineNumber;

  const before = runs.filter((run) => run[run.length - 1].lineNumber < lowest - 1);
  const after = runs.filter((run) => run[0].lineNumber > highest + 1);
  const touched = runs.slice(before.length, runs.length - after.length);

  const merged = touchedAllBefore(touched, lowest) ? appendRuns(touched, added) : runsOf(mergeInFileOrder(touched.flat(), added));
  return [...before, ...merged, ...after];
}

/** Whether every touched line is before `lineNumber`, as when scrolling loads the lines after the last run. */
function touchedAllBefore(touched: Run[], lineNumber: number): boolean {
  return touched.length === 0 || touched[touched.length - 1].at(-1)!.lineNumber < lineNumber;
}

/** The runs with `added` after them, joined to the last run when they follow on from it. Copies only that last run. */
function appendRuns(runs: Run[], added: PreviewLine[]): Run[] {
  const [first, ...rest] = runsOf(added);
  const last = runs.at(-1);
  if (last && last.at(-1)!.lineNumber + 1 === first[0].lineNumber) return [...runs.slice(0, -1), last.concat(first), ...rest];
  return [...runs, first, ...rest];
}

/** Lines in file order as runs with no line missing. */
function runsOf(lines: PreviewLine[]): Run[] {
  const runs: Run[] = [];
  let current: Run = [];
  for (const entry of lines) {
    const previous = current[current.length - 1];
    if (previous && entry.lineNumber !== previous.lineNumber + 1) {
      runs.push(current);
      current = [];
    }
    current.push(entry);
  }
  runs.push(current);
  return runs;
}

/** The lines by line number, a repeated line once (the last one given). */
function inFileOrder(lines: PreviewLine[]): PreviewLine[] {
  const ordered = lines.every((entry, index) => index === 0 || entry.lineNumber > lines[index - 1].lineNumber)
    ? lines
    : [...lines].sort((left, right) => left.lineNumber - right.lineNumber);
  return ordered.filter((entry, index) => index === ordered.length - 1 || ordered[index + 1].lineNumber !== entry.lineNumber);
}

/** Two lists of lines in file order as one, `added` winning where both have a line. */
function mergeInFileOrder(loaded: PreviewLine[], added: PreviewLine[]): PreviewLine[] {
  const merged: PreviewLine[] = [];
  let loadedIndex = 0;
  let addedIndex = 0;
  while (loadedIndex < loaded.length && addedIndex < added.length) {
    const loadedNumber = loaded[loadedIndex].lineNumber;
    const addedNumber = added[addedIndex].lineNumber;
    if (loadedNumber < addedNumber) merged.push(loaded[loadedIndex++]);
    else {
      if (loadedNumber === addedNumber) loadedIndex++;
      merged.push(added[addedIndex++]);
    }
  }
  while (loadedIndex < loaded.length) merged.push(loaded[loadedIndex++]);
  while (addedIndex < added.length) merged.push(added[addedIndex++]);
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
