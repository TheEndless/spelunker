/**
 * The tab to move to after a key press on a row of tabs, by the keyboard pattern for tabs: Left and
 * Right step to the neighbour and wrap round at the ends, Home and End go to the first and last.
 * Null for any other key, which the tab leaves alone.
 */
export function tabAfterKey(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count;
    case 'ArrowLeft':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
