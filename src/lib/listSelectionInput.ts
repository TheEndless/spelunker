import { nextRowIndex } from './gridNavigation';
import { selectedRows, type Modifiers, type SelectionState } from './selection';

/**
 * The results list's input rules that need no page: which keys do what to the selection, and which
 * rows a context menu applies to. The list component only wires events to these.
 */

export const NO_MODIFIERS: Modifiers = Object.freeze({ ctrl: false, shift: false });

/**
 * A left-button press on a row, kept until its click. `pressedOnSelected` is whether the row was
 * selected before the press, which decides what the release does. `dragged` turns true once the
 * pointer has travelled far enough with the button down that the press is a drag, not a click.
 */
export interface RowPress {
  path: string;
  index: number;
  pressedOnSelected: boolean;
  startX: number;
  startY: number;
  dragged: boolean;
}

export function modifiersOf(event: { ctrlKey: boolean; shiftKey: boolean }): Modifiers {
  return { ctrl: event.ctrlKey, shift: event.shiftKey };
}

/** The parts of a keydown event the grid reads. */
export interface GridKeyEvent {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export type GridKeyAction =
  | { kind: 'move'; targetIndex: number; modifiers: Modifiers }
  | { kind: 'selectAll' }
  | { kind: 'toggleCurrent' }
  /** Space and Shift+Space do nothing, but are claimed so the grid does not scroll. */
  | { kind: 'swallow' }
  | { kind: 'open' }
  | { kind: 'menu' };

/**
 * What a key pressed on the grid itself does, or null when the grid leaves it alone. `currentIndex`
 * is the current row's position (-1 for none). Any combination with Alt is left to the app.
 */
export function gridKeyAction(event: GridKeyEvent, currentIndex: number, rowCount: number, pageSize: number): GridKeyAction | null {
  if (event.altKey) return null;
  const targetIndex = nextRowIndex(event.key, currentIndex, rowCount, pageSize);
  if (targetIndex !== null) return { kind: 'move', targetIndex, modifiers: modifiersOf(event) };
  if (event.key === ' ') return event.ctrlKey ? { kind: 'toggleCurrent' } : { kind: 'swallow' };
  if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'a') return { kind: 'selectAll' };
  if (event.key === 'Enter') return { kind: 'open' };
  if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) return { kind: 'menu' };
  return null;
}

/**
 * The rows a context menu on `clicked` applies to: the whole selection in list order when the
 * clicked row is part of it, otherwise that row alone.
 */
export function menuRowsFor<T extends { path: string }>(selection: SelectionState, rows: T[], clicked: T): T[] {
  if (!selection.paths.has(clicked.path)) return [clicked];
  const chosen = selectedRows(selection, rows);
  return chosen.length > 0 ? chosen : [clicked];
}
