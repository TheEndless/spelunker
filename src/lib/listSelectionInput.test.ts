import { describe, expect, it } from 'vitest';
import { gridKeyAction, keyboardMenuTarget, menuRowsFor, modifiersOf, type GridKeyEvent } from './listSelectionInput';
import { EMPTY_SELECTION, type SelectionState } from './selection';

const rows = ['a', 'b', 'c', 'd', 'e'].map((path) => ({ path, name: path.toUpperCase() }));

function selection(current: string | null, ...paths: string[]): SelectionState {
  return { anchor: current, current, paths: new Set(paths) };
}

function keyEvent(key: string, held: Partial<Omit<GridKeyEvent, 'key'>> = {}): GridKeyEvent {
  return { key, ctrlKey: false, shiftKey: false, altKey: false, ...held };
}

describe('menuRowsFor', () => {
  it('gives the whole selection in list order when the clicked row is selected', () => {
    const chosen = menuRowsFor(selection('d', 'd', 'b', 'e'), rows, rows[3]);
    expect(chosen.map((row) => row.path)).toEqual(['b', 'd', 'e']);
  });

  it('gives just the clicked row when it is not selected', () => {
    expect(menuRowsFor(selection('a', 'a', 'b'), rows, rows[4])).toEqual([rows[4]]);
  });

  it('gives just the clicked row when nothing is selected', () => {
    expect(menuRowsFor(EMPTY_SELECTION, rows, rows[2])).toEqual([rows[2]]);
  });

  it('gives the one row when it is the only one selected', () => {
    expect(menuRowsFor(selection('c', 'c'), rows, rows[2])).toEqual([rows[2]]);
  });

  it('falls back to the clicked row when the selection names it but the list does not', () => {
    const outsider = { path: 'z', name: 'Z' };
    expect(menuRowsFor(selection('z', 'z'), rows, outsider)).toEqual([outsider]);
  });
});

describe('modifiersOf', () => {
  it('reads Ctrl and Shift from an event', () => {
    expect(modifiersOf({ ctrlKey: true, shiftKey: false })).toEqual({ ctrl: true, shift: false });
    expect(modifiersOf({ ctrlKey: false, shiftKey: true })).toEqual({ ctrl: false, shift: true });
  });
});

describe('gridKeyAction', () => {
  const act = (event: GridKeyEvent, currentIndex = 1, rowCount = 5, pageSize = 3) => gridKeyAction(event, currentIndex, rowCount, pageSize);

  it('turns a movement key into a move with no modifiers', () => {
    expect(act(keyEvent('ArrowDown'))).toEqual({ kind: 'move', targetIndex: 2, modifiers: { ctrl: false, shift: false } });
  });

  it('carries Shift, Ctrl and both with a move', () => {
    expect(act(keyEvent('ArrowUp', { shiftKey: true }))).toEqual({ kind: 'move', targetIndex: 0, modifiers: { ctrl: false, shift: true } });
    expect(act(keyEvent('End', { ctrlKey: true }))).toEqual({ kind: 'move', targetIndex: 4, modifiers: { ctrl: true, shift: false } });
    expect(act(keyEvent('PageDown', { ctrlKey: true, shiftKey: true }))).toEqual({
      kind: 'move',
      targetIndex: 4,
      modifiers: { ctrl: true, shift: true },
    });
  });

  it('starts at the top when there is no current row', () => {
    expect(act(keyEvent('ArrowDown'), -1)).toEqual({ kind: 'move', targetIndex: 0, modifiers: { ctrl: false, shift: false } });
  });

  it('ignores every key combined with Alt', () => {
    for (const key of ['ArrowDown', 'Home', ' ', 'a', 'Enter', 'ContextMenu']) {
      expect(act(keyEvent(key, { altKey: true }))).toBeNull();
      expect(act(keyEvent(key, { altKey: true, ctrlKey: true }))).toBeNull();
      expect(act(keyEvent(key, { altKey: true, shiftKey: true }))).toBeNull();
    }
  });

  it('selects all on Ctrl+A in either case, but not with Shift', () => {
    expect(act(keyEvent('a', { ctrlKey: true }))).toEqual({ kind: 'selectAll' });
    expect(act(keyEvent('A', { ctrlKey: true }))).toEqual({ kind: 'selectAll' });
    expect(act(keyEvent('a', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(act(keyEvent('a'))).toBeNull();
  });

  it('toggles the current row on Ctrl+Space', () => {
    expect(act(keyEvent(' ', { ctrlKey: true }))).toEqual({ kind: 'toggleCurrent' });
  });

  it('swallows Space and Shift+Space so the grid does not scroll', () => {
    expect(act(keyEvent(' '))).toEqual({ kind: 'swallow' });
    expect(act(keyEvent(' ', { shiftKey: true }))).toEqual({ kind: 'swallow' });
  });

  it('opens on Enter and asks for the menu on the Menu key and Shift+F10', () => {
    expect(act(keyEvent('Enter'))).toEqual({ kind: 'open' });
    expect(act(keyEvent('ContextMenu'))).toEqual({ kind: 'menu' });
    expect(act(keyEvent('F10', { shiftKey: true }))).toEqual({ kind: 'menu' });
    expect(act(keyEvent('F10'))).toBeNull();
  });

  it('leaves other keys alone', () => {
    expect(act(keyEvent('Escape'))).toBeNull();
    expect(act(keyEvent('F6'))).toBeNull();
    expect(act(keyEvent('l', { ctrlKey: true }))).toBeNull();
  });

  it('does not move in an empty list', () => {
    expect(act(keyEvent('ArrowDown'), -1, 0)).toBeNull();
  });
});

describe('keyboardMenuTarget', () => {
  /** Rows 1 to 3 are on screen. */
  const target = (state: SelectionState) => keyboardMenuTarget(state, rows, 1, 4);

  it('opens on a selected current row without changing the selection', () => {
    const state: SelectionState = { anchor: 'c', current: 'c', paths: new Set(['a', 'c']) };
    expect(target(state)).toEqual({ index: 2, selectFirst: false });
  });

  it('selects an unselected current row alone first, as a right-click does', () => {
    const state: SelectionState = { anchor: 'd', current: 'd', paths: new Set(['a', 'b']) };
    expect(target(state)).toEqual({ index: 3, selectFirst: true });
  });

  it('anchors on the current row even when it is off screen', () => {
    const state: SelectionState = { anchor: 'e', current: 'e', paths: new Set(['e']) };
    expect(target(state)).toEqual({ index: 4, selectFirst: false });
  });

  it('without a current row, anchors on the first selected row on screen', () => {
    const state: SelectionState = { anchor: null, current: null, paths: new Set(['a', 'c', 'd']) };
    expect(target(state)).toEqual({ index: 2, selectFirst: false });
  });

  it('without a current row, does nothing when no selected row is on screen', () => {
    const state: SelectionState = { anchor: null, current: null, paths: new Set(['a', 'e']) };
    expect(target(state)).toBeNull();
  });

  it('does nothing with no current row and nothing selected', () => {
    expect(target(EMPTY_SELECTION)).toBeNull();
  });

  it('treats a current row that left the list as no current row', () => {
    const state: SelectionState = { anchor: 'z', current: 'z', paths: new Set(['b']) };
    expect(target(state)).toEqual({ index: 1, selectFirst: false });
  });
});
