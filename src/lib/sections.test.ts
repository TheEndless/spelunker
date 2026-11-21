import { describe, expect, it } from 'vitest';
import { addLines, firstMissingLine, gapLabel, hitLineNumbers, rangeToLoad, rowIndexOfLine, rowsOf, type Row, type Run } from './sections';
import type { PreviewLine } from './types';

function line(lineNumber: number, isMatch = false): PreviewLine {
  return { lineNumber, text: `line ${lineNumber}`, isMatch, matchRanges: [] };
}

function lines(...numbers: number[]): PreviewLine[] {
  return numbers.map((number) => line(number));
}

function numbersOf(runs: Run[]): number[][] {
  return runs.map((run) => run.map((entry) => entry.lineNumber));
}

describe('addLines', () => {
  it('groups lines into runs with no line missing', () => {
    expect(numbersOf(addLines([], lines(3, 4, 5, 9, 10)))).toEqual([
      [3, 4, 5],
      [9, 10],
    ]);
  });

  it('joins a new run to the runs it touches', () => {
    const runs = addLines([], lines(1, 2, 3, 7, 8));
    expect(numbersOf(addLines(runs, lines(4, 5, 6)))).toEqual([[1, 2, 3, 4, 5, 6, 7, 8]]);
  });

  it('keeps the gap when new lines touch only one side', () => {
    const runs = addLines([], lines(1, 2, 8, 9));
    expect(numbersOf(addLines(runs, lines(3, 4)))).toEqual([
      [1, 2, 3, 4],
      [8, 9],
    ]);
  });

  it('replaces a line it already has and does not repeat it', () => {
    const runs = addLines([], lines(1, 2, 3));
    const marked = addLines(runs, [line(2, true)]);
    expect(numbersOf(marked)).toEqual([[1, 2, 3]]);
    expect(marked[0][1].isMatch).toBe(true);
  });

  it('accepts lines in any order and keeps the last of a repeated line', () => {
    const merged = addLines(addLines([], lines(1, 2)), [line(6), line(4), line(5), line(4, true)]);
    expect(numbersOf(merged)).toEqual([[1, 2], [4, 5, 6]]);
    expect(merged[1][0].isMatch).toBe(true);
  });

  it('keeps the runs it did not touch as they were, so a large file is not copied for each section', () => {
    const runs = addLines([], lines(1, 2, 10, 11, 20, 21));
    const merged = addLines(runs, lines(12, 13));
    expect(merged[0]).toBe(runs[0]);
    expect(merged[2]).toBe(runs[2]);
    expect(numbersOf(merged)).toEqual([[1, 2], [10, 11, 12, 13], [20, 21]]);
  });

  it('does not change the runs it was given', () => {
    const runs = addLines([], lines(1, 2));
    addLines(runs, lines(3));
    expect(numbersOf(runs)).toEqual([[1, 2]]);
  });
});

describe('rowsOf', () => {
  const kinds = (rows: Row[]) => rows.map((row) => (row.kind === 'line' ? row.line.lineNumber : `gap ${row.from}-${row.to}`));

  it('puts a gap before, between and after the runs', () => {
    const runs = addLines([], lines(5, 6, 20, 21));
    expect(kinds(rowsOf(runs, 100))).toEqual(['gap 1-4', 5, 6, 'gap 7-19', 20, 21, 'gap 22-100']);
  });

  it('has no gap where the runs reach the ends of the file', () => {
    const runs = addLines([], lines(1, 2, 3));
    expect(kinds(rowsOf(runs, 3))).toEqual([1, 2, 3]);
  });

  it('is one gap when nothing is loaded yet and the length is known', () => {
    expect(kinds(rowsOf([], 50))).toEqual(['gap 1-50']);
  });

  it('is empty for an empty file and for nothing loaded with the length unknown', () => {
    expect(rowsOf([], 0)).toEqual([]);
    expect(rowsOf([], null)).toEqual([]);
  });

  it('leaves out the gap after the last run while the length is unknown', () => {
    const runs = addLines([], lines(1, 2, 3));
    expect(kinds(rowsOf(runs, null))).toEqual([1, 2, 3]);
  });
});

describe('rangeToLoad', () => {
  const gap = { from: 101, to: 1000 };

  it('continues from the lines before the gap', () => {
    expect(rangeToLoad(gap, 'below', 200)).toEqual({ first: 101, count: 200 });
  });

  it('continues backward from the lines after the gap', () => {
    expect(rangeToLoad(gap, 'above', 200)).toEqual({ first: 801, count: 200 });
  });

  it('never asks for more than the gap holds', () => {
    const small = { from: 10, to: 14 };
    expect(rangeToLoad(small, 'below', 200)).toEqual({ first: 10, count: 5 });
    expect(rangeToLoad(small, 'above', 200)).toEqual({ first: 10, count: 5 });
  });

  it('loads the whole gap on request', () => {
    expect(rangeToLoad(gap, 'all', 200)).toEqual({ first: 101, count: 900 });
  });
});

describe('gapLabel', () => {
  it('says how many lines are not shown, with a separator for thousands', () => {
    expect(gapLabel({ from: 5, to: 5 })).toBe('1 line not shown');
    expect(gapLabel({ from: 1, to: 4_812_090 })).toBe('4,812,090 lines not shown');
  });
});

describe('rowIndexOfLine', () => {
  it('finds the row of a loaded line, counting the gap rows before it', () => {
    const rows = rowsOf(addLines([], lines(5, 6, 20)), 30);
    expect(rowIndexOfLine(rows, 5)).toBe(1);
    expect(rowIndexOfLine(rows, 20)).toBe(4);
  });

  it('is -1 for a line that is not loaded', () => {
    const rows = rowsOf(addLines([], lines(5, 6)), 30);
    expect(rowIndexOfLine(rows, 12)).toBe(-1);
  });
});

describe('hitLineNumbers', () => {
  it('lists the matching lines of all the runs in order', () => {
    const runs = addLines([], [line(2), line(3, true), line(9, true), line(10), line(30, true)]);
    expect(hitLineNumbers(runs)).toEqual([3, 9, 30]);
  });
});

describe('firstMissingLine', () => {
  it('is the first line when nothing is loaded', () => {
    expect(firstMissingLine([], 100)).toBe(1);
  });

  it('is the line after the run that starts the file', () => {
    expect(firstMissingLine(addLines([], lines(1, 2, 3)), 100)).toBe(4);
  });

  it('is the first line before a run that does not start the file', () => {
    expect(firstMissingLine(addLines([], lines(5, 6)), 100)).toBe(1);
  });

  it('skips over a run in the middle to the next hole', () => {
    expect(firstMissingLine(addLines([], lines(1, 2, 3, 7, 8)), 100)).toBe(4);
  });

  it('is null once the lines up to the target are loaded', () => {
    expect(firstMissingLine(addLines([], lines(1, 2, 3)), 3)).toBeNull();
    expect(firstMissingLine(addLines([], lines(1, 2, 3, 4)), 3)).toBeNull();
  });

  it('is null for a target of zero', () => {
    expect(firstMissingLine([], 0)).toBeNull();
  });
});
