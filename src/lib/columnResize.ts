const SMALL_STEP = 8;
const LARGE_STEP = 32;

/** The new width after a Left or Right key on a column's resize handle, or null for other keys. */
export function resizeWithKey(width: number, key: string, shift: boolean, minimum: number): number | null {
  const step = shift ? LARGE_STEP : SMALL_STEP;
  if (key === 'ArrowRight') return width + step;
  if (key === 'ArrowLeft') return Math.max(minimum, width - step);
  return null;
}

export interface FitInput {
  /** Measured text widths of the cells in the column. */
  cellWidths: number[];
  headerWidth: number;
  /** Space around the text inside a cell. */
  padding: number;
  min: number;
  max: number;
}

/** The width that shows the widest cell (or the header) in full, within the allowed range. */
export function fitColumnWidth({ cellWidths, headerWidth, padding, min, max }: FitInput): number {
  const widest = Math.max(headerWidth, ...cellWidths);
  return Math.min(max, Math.max(min, Math.ceil(widest + padding)));
}
