import { findRowIndex } from './rowLookup';

/**
 * The results list selection, as pure functions over immutable state. It follows File Explorer's
 * press and release rules for the mouse and the keyboard grid pattern for the arrow keys.
 */
export interface SelectionState {
  /** Where a range starts. */
  anchor: string | null;
  /** The focused row, which drives the preview, the map and Enter. */
  current: string | null;
  /** Every selected path. */
  paths: ReadonlySet<string>;
}

export const EMPTY_SELECTION: SelectionState = Object.freeze({
  anchor: null,
  current: null,
  paths: new Set<string>(),
});

export interface Modifiers {
  ctrl: boolean;
  shift: boolean;
}

type PathRow = { path: string };

function isRowIndex(rows: PathRow[], index: number): boolean {
  return index >= 0 && index < rows.length;
}

/** The paths from row `fromIndex` (-1 means the target itself) to row `toIndex`, in list order, in either direction. */
function rangePaths(rows: PathRow[], fromIndex: number, toIndex: number): string[] {
  const start = fromIndex < 0 ? toIndex : Math.min(fromIndex, toIndex);
  const end = fromIndex < 0 ? toIndex : Math.max(fromIndex, toIndex);
  const paths: string[] = [];
  for (let i = start; i <= end; i++) paths.push(rows[i].path);
  return paths;
}

/**
 * The state after extending the selection from the anchor to row `targetIndex`. The anchor stays
 * unless it left the list, in which case the target becomes the anchor. `addToSelection` keeps the
 * paths already selected (Ctrl+Shift), otherwise the range replaces them.
 */
function extendRange(state: SelectionState, rows: PathRow[], targetIndex: number, addToSelection: boolean): SelectionState {
  const targetPath = rows[targetIndex].path;
  const anchorIndex = findRowIndex(rows, state.anchor, -1);
  const anchorLeft = anchorIndex < 0;
  const paths = new Set(addToSelection ? state.paths : []);
  for (const path of rangePaths(rows, anchorIndex, targetIndex)) paths.add(path);
  return { anchor: anchorLeft ? targetPath : state.anchor, current: targetPath, paths };
}

/** A mouse press on row `index`. Returns the new state. `pressedOnSelected` tells release whether to collapse. */
export function pressRow(state: SelectionState, rows: PathRow[], index: number, modifiers: Modifiers): SelectionState {
  if (!isRowIndex(rows, index)) return state;
  const path = rows[index].path;
  if (modifiers.shift) return extendRange(state, rows, index, modifiers.ctrl);
  if (state.paths.has(path)) return { ...state, current: path };
  if (modifiers.ctrl) return { anchor: path, current: path, paths: new Set(state.paths).add(path) };
  return selectOnly(path);
}

/** The mouse release on the same row without a drag: the deferred collapse or Ctrl removal. */
export function releaseRow(
  state: SelectionState,
  rows: PathRow[],
  index: number,
  modifiers: Modifiers,
  pressedOnSelected: boolean,
): SelectionState {
  if (!pressedOnSelected || modifiers.shift || !isRowIndex(rows, index)) return state;
  const path = rows[index].path;
  if (!modifiers.ctrl) return selectOnly(path);
  const paths = new Set(state.paths);
  paths.delete(path);
  return { anchor: path, current: path, paths };
}

/** A keyboard move of the current row to `targetIndex` (from nextRowIndex), with the held modifiers. */
export function moveCurrent(state: SelectionState, rows: PathRow[], targetIndex: number, modifiers: Modifiers): SelectionState {
  if (!isRowIndex(rows, targetIndex)) return state;
  if (modifiers.shift) return extendRange(state, rows, targetIndex, modifiers.ctrl);
  const path = rows[targetIndex].path;
  if (modifiers.ctrl) return { anchor: path, current: path, paths: state.paths };
  return selectOnly(path);
}

/** Ctrl+Space. */
export function toggleCurrent(state: SelectionState): SelectionState {
  const path = state.current;
  if (path === null) return state;
  const paths = new Set(state.paths);
  if (!paths.delete(path)) paths.add(path);
  return { anchor: path, current: path, paths };
}

/** Ctrl+A. */
export function selectAll(state: SelectionState, rows: PathRow[]): SelectionState {
  if (rows.length === 0) return state;
  const firstPath = rows[0].path;
  return {
    anchor: state.anchor ?? firstPath,
    current: state.current ?? firstPath,
    paths: new Set(rows.map((row) => row.path)),
  };
}

/** Only the one row, with anchor and current on it. */
export function selectOnly(path: string): SelectionState {
  return { anchor: path, current: path, paths: new Set([path]) };
}

/** Drops selected paths that are no longer in `rows`, and the anchor or current when they left. */
export function pruneSelection(state: SelectionState, rows: PathRow[]): SelectionState {
  const present = new Set(rows.map((row) => row.path));
  const paths = new Set<string>();
  for (const path of state.paths) if (present.has(path)) paths.add(path);
  const anchor = state.anchor !== null && present.has(state.anchor) ? state.anchor : null;
  const current = state.current !== null && present.has(state.current) ? state.current : null;
  const unchanged = paths.size === state.paths.size && anchor === state.anchor && current === state.current;
  return unchanged ? state : { anchor, current, paths };
}

/** The selected rows in list order. */
export function selectedRows<T extends PathRow>(state: SelectionState, rows: T[]): T[] {
  if (state.paths.size === 0) return [];
  return rows.filter((row) => state.paths.has(row.path));
}
