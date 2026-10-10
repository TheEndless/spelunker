export interface VirtualWindowInput {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  rowCount: number;
  /** Extra rows rendered above and below the viewport to hide scroll flicker. */
  overscan: number;
}

export interface VirtualWindow {
  /** First row to render. */
  start: number;
  /** One past the last row to render. */
  end: number;
  /** Pixel offset of the first rendered row from the top of the scroll area. */
  offsetY: number;
  totalHeight: number;
}

export function visibleWindow(input: VirtualWindowInput): VirtualWindow {
  const { scrollTop, viewportHeight, rowHeight, rowCount, overscan } = input;
  const totalHeight = rowCount * rowHeight;
  if (rowCount === 0) {
    return { start: 0, end: 0, offsetY: 0, totalHeight };
  }
  const maxScrollTop = Math.max(0, totalHeight - viewportHeight);
  const clampedScrollTop = Math.min(Math.max(0, scrollTop), maxScrollTop);
  const firstVisible = Math.floor(clampedScrollTop / rowHeight);
  const lastVisible = Math.ceil((clampedScrollTop + viewportHeight) / rowHeight);
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(rowCount, lastVisible + overscan);
  return { start, end, offsetY: start * rowHeight, totalHeight };
}
