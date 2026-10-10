export type GridKey = 'ArrowDown' | 'ArrowUp' | 'PageDown' | 'PageUp' | 'Home' | 'End';

/**
 * The row to select after a navigation key in the results grid, or `null` when the key does not
 * navigate (or there are no rows). `current` is -1 when nothing is selected, in which case keys
 * that move forward start at the top and keys that move backward start at the bottom.
 * Movement stops at the ends, it does not wrap, since the grid is a long list.
 */
export function nextRowIndex(key: string, current: number, count: number, pageSize: number): number | null {
  if (count === 0) return null;
  const last = count - 1;
  const nothingSelected = current < 0;
  const clamped = Math.min(current, last);
  const page = Math.max(1, pageSize);

  switch (key) {
    case 'ArrowDown':
      return nothingSelected ? 0 : Math.min(last, current + 1);
    case 'ArrowUp':
      return nothingSelected ? last : Math.max(0, clamped - 1);
    case 'PageDown':
      return nothingSelected ? 0 : Math.min(last, current + page);
    case 'PageUp':
      return nothingSelected ? last : Math.max(0, clamped - page);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}
