import { describe, expect, it } from 'vitest';
import {
  EMPTY_SELECTION,
  moveCurrent,
  pressRow,
  pruneSelection,
  releaseRow,
  selectAll,
  selectOnly,
  selectedRows,
  toggleCurrent,
  type Modifiers,
  type SelectionState,
} from './selection';

const NONE: Modifiers = { ctrl: false, shift: false };
const CTRL: Modifiers = { ctrl: true, shift: false };
const SHIFT: Modifiers = { ctrl: false, shift: true };
const CTRL_SHIFT: Modifiers = { ctrl: true, shift: true };

function makeRows(...names: string[]) {
  return names.map((name) => ({ path: name }));
}

const rows = makeRows('a', 'b', 'c', 'd', 'e', 'f');

function state(anchor: string | null, current: string | null, ...paths: string[]): SelectionState {
  return { anchor, current, paths: new Set(paths) };
}

function sorted(selection: SelectionState): string[] {
  return [...selection.paths].sort();
}

/** A state whose set rejects writes, to prove the model builds new sets. */
function frozen(selection: SelectionState): SelectionState {
  const paths = new Set(selection.paths);
  const reject = () => {
    throw new Error('input set was mutated');
  };
  paths.add = reject;
  paths.delete = reject;
  paths.clear = reject;
  return Object.freeze({ ...selection, paths });
}

describe('pressRow', () => {
  it('selects only an unselected row and puts anchor and current on it', () => {
    const result = pressRow(state('a', 'a', 'a', 'b'), rows, 3, NONE);
    expect(sorted(result)).toEqual(['d']);
    expect(result.anchor).toBe('d');
    expect(result.current).toBe('d');
  });

  it('keeps the selection when a selected row is pressed, and moves current', () => {
    const before = state('a', 'a', 'a', 'b', 'c');
    const result = pressRow(before, rows, 2, NONE);
    expect(sorted(result)).toEqual(['a', 'b', 'c']);
    expect(result.current).toBe('c');
    expect(result.anchor).toBe('a');
  });

  it('adds an unselected row with ctrl and moves anchor and current', () => {
    const result = pressRow(state('a', 'a', 'a'), rows, 4, CTRL);
    expect(sorted(result)).toEqual(['a', 'e']);
    expect(result.anchor).toBe('e');
    expect(result.current).toBe('e');
  });

  it('leaves a selected row alone with ctrl except for current', () => {
    const result = pressRow(state('a', 'a', 'a', 'b'), rows, 1, CTRL);
    expect(sorted(result)).toEqual(['a', 'b']);
    expect(result.current).toBe('b');
    expect(result.anchor).toBe('a');
  });

  it('replaces the selection with a downward range on shift', () => {
    const result = pressRow(state('b', 'b', 'b', 'f'), rows, 3, SHIFT);
    expect(sorted(result)).toEqual(['b', 'c', 'd']);
    expect(result.anchor).toBe('b');
    expect(result.current).toBe('d');
  });

  it('replaces the selection with an upward range on shift', () => {
    const result = pressRow(state('e', 'e', 'e'), rows, 1, SHIFT);
    expect(sorted(result)).toEqual(['b', 'c', 'd', 'e']);
    expect(result.anchor).toBe('e');
    expect(result.current).toBe('b');
  });

  it('adds a second range on ctrl+shift and keeps the first', () => {
    const first = pressRow(selectOnly('a'), rows, 1, SHIFT);
    const second = pressRow(pressRow(first, rows, 4, CTRL), rows, 5, CTRL_SHIFT);
    expect(sorted(second)).toEqual(['a', 'b', 'e', 'f']);
    expect(second.anchor).toBe('e');
    expect(second.current).toBe('f');
  });

  it('finds the anchor at its new position after the list was re-sorted', () => {
    const resorted = makeRows('f', 'e', 'd', 'c', 'b', 'a');
    const result = pressRow(state('b', 'b', 'b'), resorted, 1, SHIFT);
    expect(sorted(result)).toEqual(['b', 'c', 'd', 'e']);
  });

  it('falls back to the clicked row when the anchor left the list', () => {
    const result = pressRow(state('gone', 'gone', 'gone', 'a'), rows, 3, SHIFT);
    expect(sorted(result)).toEqual(['d']);
    expect(result.anchor).toBe('d');
    expect(result.current).toBe('d');
  });

  it('treats a missing anchor as the clicked row', () => {
    const result = pressRow(EMPTY_SELECTION, rows, 2, SHIFT);
    expect(sorted(result)).toEqual(['c']);
    expect(result.anchor).toBe('c');
  });

  it('ignores an index outside the list', () => {
    const before = state('a', 'a', 'a');
    expect(pressRow(before, rows, 99, NONE)).toBe(before);
    expect(pressRow(before, rows, -1, NONE)).toBe(before);
  });
});

describe('releaseRow', () => {
  it('collapses to the row on a plain release after pressing a selected row', () => {
    const result = releaseRow(state('a', 'c', 'a', 'b', 'c'), rows, 2, NONE, true);
    expect(sorted(result)).toEqual(['c']);
    expect(result.anchor).toBe('c');
    expect(result.current).toBe('c');
  });

  it('removes the row on a ctrl release and keeps current and anchor on it', () => {
    const result = releaseRow(state('a', 'b', 'a', 'b', 'c'), rows, 1, CTRL, true);
    expect(sorted(result)).toEqual(['a', 'c']);
    expect(result.current).toBe('b');
    expect(result.anchor).toBe('b');
  });

  it('is ignored when the press was not on a selected row', () => {
    const before = state('a', 'a', 'a', 'b');
    expect(releaseRow(before, rows, 0, NONE, false)).toBe(before);
    expect(releaseRow(before, rows, 0, CTRL, false)).toBe(before);
  });

  it('is ignored with shift', () => {
    const before = state('a', 'c', 'a', 'b', 'c');
    expect(releaseRow(before, rows, 2, SHIFT, true)).toBe(before);
    expect(releaseRow(before, rows, 2, CTRL_SHIFT, true)).toBe(before);
  });

  it('ignores an index outside the list', () => {
    const before = state('a', 'a', 'a', 'b');
    expect(releaseRow(before, rows, 99, NONE, true)).toBe(before);
  });
});

describe('moveCurrent', () => {
  it('selects only the target with no modifiers', () => {
    const result = moveCurrent(state('a', 'c', 'a', 'b', 'c'), rows, 3, NONE);
    expect(sorted(result)).toEqual(['d']);
    expect(result.anchor).toBe('d');
    expect(result.current).toBe('d');
  });

  it('replaces the selection with the range from the anchor on shift', () => {
    const result = moveCurrent(state('b', 'b', 'b', 'f'), rows, 3, SHIFT);
    expect(sorted(result)).toEqual(['b', 'c', 'd']);
    expect(result.anchor).toBe('b');
    expect(result.current).toBe('d');
  });

  it('shrinks the range when shift moves back toward the anchor', () => {
    const grown = moveCurrent(selectOnly('b'), rows, 4, SHIFT);
    const shrunk = moveCurrent(grown, rows, 2, SHIFT);
    expect(sorted(shrunk)).toEqual(['b', 'c']);
  });

  it('moves current and anchor but not the selection on ctrl', () => {
    const result = moveCurrent(state('a', 'b', 'a', 'b'), rows, 4, CTRL);
    expect(sorted(result)).toEqual(['a', 'b']);
    expect(result.current).toBe('e');
    expect(result.anchor).toBe('e');
  });

  it('adds the range from the anchor on ctrl+shift and keeps the anchor', () => {
    const result = moveCurrent(state('b', 'b', 'b', 'f'), rows, 3, CTRL_SHIFT);
    expect(sorted(result)).toEqual(['b', 'c', 'd', 'f']);
    expect(result.anchor).toBe('b');
    expect(result.current).toBe('d');
  });

  it('uses the target as the anchor when there is none', () => {
    const result = moveCurrent(EMPTY_SELECTION, rows, 2, SHIFT);
    expect(sorted(result)).toEqual(['c']);
    expect(result.anchor).toBe('c');
  });

  it('uses the target as the anchor when it left the list', () => {
    const result = moveCurrent(state('gone', 'gone', 'gone'), rows, 2, CTRL_SHIFT);
    expect(sorted(result)).toEqual(['c', 'gone']);
    expect(result.anchor).toBe('c');
  });

  it('ignores a target outside the list', () => {
    const before = state('a', 'a', 'a');
    expect(moveCurrent(before, rows, 6, NONE)).toBe(before);
    expect(moveCurrent(before, [], 0, NONE)).toBe(before);
  });
});

describe('toggleCurrent', () => {
  it('adds an unselected current row and sets the anchor', () => {
    const result = toggleCurrent(state('a', 'c', 'a'));
    expect(sorted(result)).toEqual(['a', 'c']);
    expect(result.anchor).toBe('c');
    expect(result.current).toBe('c');
  });

  it('removes a selected current row and still sets the anchor', () => {
    const result = toggleCurrent(state('a', 'c', 'a', 'c'));
    expect(sorted(result)).toEqual(['a']);
    expect(result.anchor).toBe('c');
    expect(result.current).toBe('c');
  });

  it('does nothing without a current row', () => {
    const before = state('a', null, 'a');
    expect(toggleCurrent(before)).toBe(before);
    expect(toggleCurrent(EMPTY_SELECTION)).toBe(EMPTY_SELECTION);
  });
});

describe('selectAll', () => {
  it('selects every row and keeps anchor and current', () => {
    const result = selectAll(state('b', 'c', 'b'), rows);
    expect(sorted(result)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(result.anchor).toBe('b');
    expect(result.current).toBe('c');
  });

  it('puts anchor and current on the first row when there are none', () => {
    const result = selectAll(EMPTY_SELECTION, rows);
    expect(result.anchor).toBe('a');
    expect(result.current).toBe('a');
    expect(result.paths.size).toBe(6);
  });

  it('does nothing for an empty list', () => {
    expect(selectAll(EMPTY_SELECTION, [])).toBe(EMPTY_SELECTION);
  });

  it('handles 100,000 rows well under 100 ms', () => {
    const big = Array.from({ length: 100_000 }, (_, i) => ({ path: `p${i}` }));
    const start = performance.now();
    const result = selectAll(EMPTY_SELECTION, big);
    const ranged = pressRow(result, big, 99_999, SHIFT);
    const elapsed = performance.now() - start;
    expect(result.paths.size).toBe(100_000);
    expect(ranged.paths.size).toBe(100_000);
    expect(elapsed).toBeLessThan(100);
  });
});

describe('selectOnly', () => {
  it('selects the one path with anchor and current on it', () => {
    const result = selectOnly('x');
    expect(sorted(result)).toEqual(['x']);
    expect(result.anchor).toBe('x');
    expect(result.current).toBe('x');
  });
});

describe('pruneSelection', () => {
  it('drops selected paths that are no longer in the list', () => {
    const result = pruneSelection(state('a', 'a', 'a', 'b', 'zzz'), rows);
    expect(sorted(result)).toEqual(['a', 'b']);
    expect(result.anchor).toBe('a');
    expect(result.current).toBe('a');
  });

  it('drops a gone anchor and a gone current', () => {
    const result = pruneSelection(state('gone', 'alsoGone', 'gone', 'b'), rows);
    expect(sorted(result)).toEqual(['b']);
    expect(result.anchor).toBeNull();
    expect(result.current).toBeNull();
  });

  it('returns the same state when nothing left', () => {
    const before = state('a', 'b', 'a', 'b');
    expect(pruneSelection(before, rows)).toBe(before);
  });

  it('empties everything for an empty list', () => {
    const result = pruneSelection(state('a', 'a', 'a'), []);
    expect(result.paths.size).toBe(0);
    expect(result.anchor).toBeNull();
    expect(result.current).toBeNull();
  });
});

describe('selectedRows', () => {
  it('returns the selected rows in list order whatever the set order', () => {
    const wide = [
      { path: 'a', size: 1 },
      { path: 'b', size: 2 },
      { path: 'c', size: 3 },
    ];
    const result = selectedRows(state('c', 'c', 'c', 'a'), wide);
    expect(result).toEqual([wide[0], wide[2]]);
    expect(result[0]).toBe(wide[0]);
  });

  it('returns nothing for an empty selection or list', () => {
    expect(selectedRows(EMPTY_SELECTION, rows)).toEqual([]);
    expect(selectedRows(state('a', 'a', 'a'), [])).toEqual([]);
  });
});

describe('immutability and edge lists', () => {
  it('never mutates a frozen input', () => {
    const input = frozen(state('b', 'b', 'b', 'c'));
    const calls: Array<() => SelectionState> = [
      () => pressRow(input, rows, 0, NONE),
      () => pressRow(input, rows, 1, CTRL),
      () => pressRow(input, rows, 4, CTRL),
      () => pressRow(input, rows, 4, SHIFT),
      () => pressRow(input, rows, 4, CTRL_SHIFT),
      () => releaseRow(input, rows, 2, NONE, true),
      () => releaseRow(input, rows, 2, CTRL, true),
      () => moveCurrent(input, rows, 4, NONE),
      () => moveCurrent(input, rows, 4, SHIFT),
      () => moveCurrent(input, rows, 4, CTRL),
      () => moveCurrent(input, rows, 4, CTRL_SHIFT),
      () => toggleCurrent(input),
      () => selectAll(input, rows),
      () => pruneSelection(input, makeRows('b')),
    ];
    for (const call of calls) expect(call).not.toThrow();
    expect([...input.paths]).toEqual(['b', 'c']);
  });

  it('copes with an empty list', () => {
    expect(pressRow(EMPTY_SELECTION, [], 0, NONE)).toBe(EMPTY_SELECTION);
    expect(selectedRows(EMPTY_SELECTION, [])).toEqual([]);
  });

  it('copes with a one-row list', () => {
    const one = makeRows('only');
    const pressed = pressRow(EMPTY_SELECTION, one, 0, SHIFT);
    expect(sorted(pressed)).toEqual(['only']);
    const moved = moveCurrent(pressed, one, 0, CTRL_SHIFT);
    expect(sorted(moved)).toEqual(['only']);
  });
});
