import { RectKind, type Layout } from './treemapLayout';

export type Direction = 'left' | 'right' | 'up' | 'down';

/** Answers "which rectangle is under this point" without scanning them all, and "what is next to this one". */
export class LayoutIndex {
  private readonly cellStart: Int32Array;
  private readonly cellEntries: Int32Array;
  private readonly cellWidth: number;
  private readonly cellHeight: number;
  private readonly fileRects = new Map<number, number>();

  constructor(
    private readonly layout: Layout,
    width: number,
    height: number,
    private readonly cells = 64,
  ) {
    this.cellWidth = width / cells;
    this.cellHeight = height / cells;
    const cellCount = cells * cells;
    const counts = new Int32Array(cellCount + 1);

    const range = (i: number) => ({
      firstColumn: this.clampCell(Math.floor(layout.x[i] / this.cellWidth)),
      lastColumn: this.clampCell(Math.floor((layout.x[i] + layout.w[i]) / this.cellWidth)),
      firstRow: this.clampCell(Math.floor(layout.y[i] / this.cellHeight)),
      lastRow: this.clampCell(Math.floor((layout.y[i] + layout.h[i]) / this.cellHeight)),
    });

    for (let i = 0; i < layout.count; i++) {
      if (layout.kind[i] === RectKind.File) this.fileRects.set(layout.id[i], i);
      const { firstColumn, lastColumn, firstRow, lastRow } = range(i);
      for (let row = firstRow; row <= lastRow; row++) {
        for (let column = firstColumn; column <= lastColumn; column++) counts[row * cells + column + 1]++;
      }
    }
    for (let cell = 0; cell < cellCount; cell++) counts[cell + 1] += counts[cell];
    this.cellStart = counts;
    this.cellEntries = new Int32Array(counts[cellCount]);

    const fillPosition = counts.slice(0, cellCount);
    for (let i = 0; i < layout.count; i++) {
      const { firstColumn, lastColumn, firstRow, lastRow } = range(i);
      for (let row = firstRow; row <= lastRow; row++) {
        for (let column = firstColumn; column <= lastColumn; column++) {
          this.cellEntries[fillPosition[row * cells + column]++] = i;
        }
      }
    }
  }

  /** The rectangle containing the point, or -1. */
  at(x: number, y: number): number {
    const { layout } = this;
    if (x < 0 || y < 0) return -1;
    const column = Math.floor(x / this.cellWidth);
    const row = Math.floor(y / this.cellHeight);
    if (column >= this.cells || row >= this.cells) return -1;
    const cell = row * this.cells + column;
    for (let entry = this.cellStart[cell]; entry < this.cellStart[cell + 1]; entry++) {
      const i = this.cellEntries[entry];
      if (x >= layout.x[i] && x < layout.x[i] + layout.w[i] && y >= layout.y[i] && y < layout.y[i] + layout.h[i]) return i;
    }
    return -1;
  }

  /** The File rectangle for a file id, or -1 when the file is folded into a group or not in view. */
  firstWithFileId(fileId: number): number {
    return this.fileRects.get(fileId) ?? -1;
  }

  /** The nearest rectangle whose centre lies in `direction` from `from`, favouring ones in line with it. */
  nearest(from: number, direction: Direction): number {
    const { layout } = this;
    const fromX = layout.x[from] + layout.w[from] / 2;
    const fromY = layout.y[from] + layout.h[from] / 2;
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < layout.count; i++) {
      if (i === from) continue;
      const deltaX = layout.x[i] + layout.w[i] / 2 - fromX;
      const deltaY = layout.y[i] + layout.h[i] / 2 - fromY;
      const along = direction === 'right' ? deltaX : direction === 'left' ? -deltaX : direction === 'down' ? deltaY : -deltaY;
      if (along <= 0) continue;
      const across = direction === 'left' || direction === 'right' ? Math.abs(deltaY) : Math.abs(deltaX);
      const score = along + 2 * across;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  private clampCell(value: number): number {
    return Math.min(this.cells - 1, Math.max(0, value));
  }
}
