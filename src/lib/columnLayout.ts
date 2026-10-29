import type { SortColumn } from './types';

export type ColumnId = SortColumn;

export const COLUMN_IDS: readonly ColumnId[] = ['name', 'folder', 'hits', 'size', 'modified', 'type'];

export const MIN_COLUMN_WIDTH = 48;
export const MAX_COLUMN_WIDTH = 1200;
/** A pane narrower than this has not been measured yet, or is too small to lay columns out in. */
export const MIN_PANE_WIDTH = 200;

interface ColumnDefinition {
  label: string;
  align: 'left' | 'right';
  defaultWidth: number;
}

export const COLUMN_DEFINITIONS: Record<ColumnId, ColumnDefinition> = {
  name: { label: 'Name', align: 'left', defaultWidth: 300 },
  folder: { label: 'Folder', align: 'left', defaultWidth: 420 },
  hits: { label: 'Matches', align: 'right', defaultWidth: 80 },
  size: { label: 'Size', align: 'right', defaultWidth: 80 },
  modified: { label: 'Modified', align: 'left', defaultWidth: 150 },
  type: { label: 'Type', align: 'left', defaultWidth: 190 },
};

/** Which columns the results grid shows, in what order, and how wide. */
export interface ColumnLayout {
  /** Every column, visible or not, in display order. Hidden columns keep their place here. */
  order: ColumnId[];
  hidden: ColumnId[];
  widths: Record<ColumnId, number>;
  /** Columns are fitted to the rows in view as results arrive, until the user sizes one by hand. Off unless asked for. */
  autoSize: boolean;
  /** Which rules the layout was last made under, so a saved one can be brought up to date once. */
  version: number;
}

/**
 * Layouts before 2 showed Matches, which is now hidden by default, so older ones get it hidden once.
 * Layouts before 3 fitted columns to their content as results arrived, which now has to be asked
 * for, so older ones have it turned off once. Layouts before 4 saved the widths as squeezed to fit
 * the window, which left Modified and Type too narrow, so older ones get the default widths once.
 */
const LAYOUT_VERSION = 4;

const defaultWidths = (): Record<ColumnId, number> =>
  Object.fromEntries(COLUMN_IDS.map((id) => [id, COLUMN_DEFINITIONS[id].defaultWidth])) as Record<ColumnId, number>;

export function defaultLayout(): ColumnLayout {
  return { order: [...COLUMN_IDS], hidden: ['hits'], widths: defaultWidths(), autoSize: false, version: LAYOUT_VERSION };
}

export const visibleColumns = (layout: ColumnLayout): ColumnId[] =>
  layout.order.filter((id) => !layout.hidden.includes(id));

const clampWidth = (width: number): number => Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));

/** Shows or hides a column. The last visible column stays, since a grid with no columns is useless. */
export function toggleColumn(layout: ColumnLayout, id: ColumnId): ColumnLayout {
  if (layout.hidden.includes(id)) {
    return { ...layout, hidden: layout.hidden.filter((hiddenId) => hiddenId !== id) };
  }
  if (visibleColumns(layout).length <= 1) return layout;
  return { ...layout, hidden: [...layout.hidden, id] };
}

/** Moves `id` so it sits just before `beforeId`, or at the very end when `beforeId` is null. */
export function moveColumnBefore(layout: ColumnLayout, id: ColumnId, beforeId: ColumnId | null): ColumnLayout {
  if (id === beforeId) return layout;
  const without = layout.order.filter((other) => other !== id);
  const target = beforeId === null ? without.length : without.indexOf(beforeId);
  if (target < 0) return layout;
  return { ...layout, order: [...without.slice(0, target), id, ...without.slice(target)] };
}

/** Moves a column one place left (-1) or right (1) among the visible columns. */
export function moveColumnByStep(layout: ColumnLayout, id: ColumnId, direction: -1 | 1): ColumnLayout {
  const visible = visibleColumns(layout);
  const neighbour = visible[visible.indexOf(id) + direction];
  if (neighbour === undefined) return layout;
  return direction === -1 ? moveColumnBefore(layout, id, neighbour) : moveColumnBefore(layout, neighbour, id);
}

/** When the pane is too narrow for the columns, they give up space in this order, and never below their floor. */
const SHRINK_ORDER: { id: ColumnId; floor: number }[] = [
  { id: 'type', floor: 90 },
  { id: 'modified', floor: 130 },
  { id: 'folder', floor: 90 },
  { id: 'name', floor: 100 },
  { id: 'size', floor: 56 },
  { id: 'hits', floor: 72 },
];

/**
 * Narrows the visible columns, least important first, until they fit in `available` pixels, so
 * automatic sizing never makes a horizontal scroll bar by itself. Columns stop at their floor,
 * so with very little room the grid can still scroll. Widths of hidden columns are left alone.
 */
export function shrinkToFit(widths: Record<ColumnId, number>, visible: ColumnId[], available: number): Record<ColumnId, number> {
  const result = { ...widths };
  let excess = visible.reduce((sum, id) => sum + result[id], 0) - available;
  for (const { id, floor } of SHRINK_ORDER) {
    if (excess <= 0) break;
    if (!visible.includes(id)) continue;
    const reducible = Math.max(0, result[id] - floor);
    const taken = Math.min(reducible, excess);
    result[id] -= taken;
    excess -= taken;
  }
  return result;
}

/** Name and Folder are the text people read most, so they share the spare room equally when both are shown. */
const SHARED_GROW: ColumnId[] = ['name', 'folder'];

/**
 * Who takes the spare room when neither Name nor Folder is shown, in order. The numeric columns
 * never grow while a text column is shown.
 */
const GROW_ORDER: ColumnId[] = ['type', 'modified'];

/**
 * Gives the spare room to one column so the grid fills its pane instead of leaving a blank strip
 * on the right: Name and Folder share it, or the next text column if both are hidden. With none of
 * those shown, the shown columns share it equally. Widths already wide enough are left alone.
 */
export function growToFill(widths: Record<ColumnId, number>, visible: ColumnId[], available: number): Record<ColumnId, number> {
  const spare = Math.floor(available - visible.reduce((sum, id) => sum + widths[id], 0));
  if (spare <= 0 || visible.length === 0) return widths;

  const result = { ...widths };
  const sharers = SHARED_GROW.filter((id) => visible.includes(id));
  if (sharers.length > 0) {
    shareRoom(result, sharers, spare);
    return result;
  }
  const receiver = GROW_ORDER.find((id) => visible.includes(id));
  if (receiver !== undefined) {
    result[receiver] += spare;
    return result;
  }
  // Only numeric columns are shown, so they share the room.
  shareRoom(result, visible, spare);
  return result;
}

/** Adds `spare` pixels to the given columns in equal parts, with the rounding going to the first. */
function shareRoom(widths: Record<ColumnId, number>, receivers: ColumnId[], spare: number) {
  const share = Math.floor(spare / receivers.length);
  for (const id of receivers) widths[id] += share;
  widths[receivers[0]] += spare - share * receivers.length;
}

/** The widths to show: the saved ones, made to fill the pane by the rules of `shrinkToFit` and `growToFill`. */
export function widthsInPane(widths: Record<ColumnId, number>, visible: ColumnId[], available: number): Record<ColumnId, number> {
  // Before the pane has been measured there is nothing sensible to fill.
  if (available < MIN_PANE_WIDTH) return widths;
  return growToFill(shrinkToFit(widths, visible, available), visible, available);
}

/**
 * Resizes one column the way a splitter does: the room comes from, or goes to, its neighbours, so
 * the columns still fill the pane. A column trades with the ones to its right, nearest first, and
 * the last column trades with the ones to its left. Nothing goes below the minimum, so a request
 * the neighbours cannot pay for is cut short.
 */
export function resizeColumn(
  widths: Record<ColumnId, number>,
  visible: ColumnId[],
  id: ColumnId,
  requested: number,
): Record<ColumnId, number> {
  const index = visible.indexOf(id);
  if (index < 0 || visible.length < 2) return widths;
  const neighbours = index < visible.length - 1 ? visible.slice(index + 1) : visible.slice(0, index).reverse();

  const result = { ...widths };
  const wanted = Math.max(MIN_COLUMN_WIDTH, Math.round(requested)) - widths[id];
  if (wanted >= 0) {
    let stillNeeded = wanted;
    for (const neighbour of neighbours) {
      const taken = Math.min(stillNeeded, Math.max(0, result[neighbour] - MIN_COLUMN_WIDTH));
      result[neighbour] -= taken;
      stillNeeded -= taken;
    }
    result[id] += wanted - stillNeeded;
  } else {
    result[id] += wanted;
    result[neighbours[0]] -= wanted;
  }
  return result;
}

const isColumnId = (value: unknown): value is ColumnId => COLUMN_IDS.includes(value as ColumnId);

/** Builds a valid layout from untrusted stored data. Anything unusable falls back to the default. */
export function normalizeLayout(raw: unknown): ColumnLayout {
  const base = defaultLayout();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return base;
  const source = raw as Record<string, unknown>;

  const storedOrder = Array.isArray(source.order) ? source.order.filter(isColumnId) : [];
  const order = [...new Set(storedOrder)];
  // A column the stored layout does not know (added in a later version) is appended.
  for (const id of COLUMN_IDS) if (!order.includes(id)) order.push(id);

  let hidden = Array.isArray(source.hidden) ? [...new Set(source.hidden.filter(isColumnId))] : base.hidden;
  const storedVersion = typeof source.version === 'number' ? source.version : 1;
  if (storedVersion < 2 && !hidden.includes('hits')) hidden = [...hidden, 'hits'];
  // A grid needs at least one column, so if everything was hidden only Name is kept.
  if (COLUMN_IDS.every((id) => hidden.includes(id))) hidden = COLUMN_IDS.filter((id) => id !== 'name');
  const layout: ColumnLayout = { order, hidden, widths: base.widths, autoSize: storedVersion >= 3 && source.autoSize === true, version: LAYOUT_VERSION };

  const storedWidths =
    storedVersion >= 4 && typeof source.widths === 'object' && source.widths !== null ? (source.widths as Record<string, unknown>) : {};
  for (const id of COLUMN_IDS) {
    const width = storedWidths[id];
    if (typeof width === 'number' && Number.isFinite(width)) layout.widths[id] = clampWidth(width);
  }
  return layout;
}
