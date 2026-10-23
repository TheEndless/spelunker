import { FILE_CATEGORIES } from './fileKinds';
import { addRidge, CUSHION_HEIGHT, CUSHION_SCALE } from './treemapCushion';
import type { FolderNode, TreeFile } from './treemapTree';

export type Metric = 'size' | 'matches';

export const CATEGORY_COUNT = FILE_CATEGORIES.length;
/** Today, this week, this month, this year, older, unknown. */
export const AGE_BUCKET_COUNT = 6;

export const RectKind = { File: 0, SmallFiles: 1, FolderBlock: 2 } as const;

const DAY_MS = 86_400_000;

export function ageBucket(modifiedMs: number | null, now: number): number {
  if (modifiedMs === null) return AGE_BUCKET_COUNT - 1;
  const age = now - modifiedMs;
  if (age < DAY_MS) return 0;
  if (age < 7 * DAY_MS) return 1;
  if (age < 30 * DAY_MS) return 2;
  if (age < 365 * DAY_MS) return 3;
  return 4;
}

export interface LayoutOptions {
  width: number;
  height: number;
  metric: Metric;
  /** The reference time for ages. */
  now: number;
  /** Files whose area would be under this many square pixels are folded into one group. */
  minLeafArea?: number;
  /** A folder with a side under this many pixels is painted as one block. */
  minFolderSide?: number;
  /** The gap between a folder and what it holds. */
  inset?: number;
  /** The gap is only applied to folders with both sides at least this many pixels. */
  insetMinSide?: number;
}

export interface Layout {
  count: number;
  x: Float32Array;
  y: Float32Array;
  w: Float32Array;
  h: Float32Array;
  id: Int32Array;
  kind: Uint8Array;
  depth: Uint8Array;
  category: Uint8Array;
  age: Uint8Array;
  weight: Float64Array;
  fileCount: Uint32Array;
  folderId: Int32Array;
  /** Four cushion coefficients [linearX, quadraticX, linearY, quadraticY] per rectangle, in emit order. */
  surface: Float32Array;
  frameCount: number;
  frameX: Float32Array;
  frameY: Float32Array;
  frameW: Float32Array;
  frameH: Float32Array;
  frameFolderId: Int32Array;
  omitted: number;
  totalFiles: number;
  totalWeight: number;
  categoryWeight: Float64Array;
  ageWeight: Float64Array;
  /** The child folder of the laid-out folder that carries the most weight, or -1 when it has none. */
  largestChildFolderId: number;
}

/*
 * Every folder's totals live in one flat slab, one row per folder, so summing a tree of a hundred
 * thousand folders allocates once instead of twice per folder. Rows are numbered in depth-first
 * order from the laid-out folder, which is row 0, so a folder's children follow it and a child's
 * row is found from its parent's row and the subtree sizes of the siblings before it.
 */
const WEIGHT = 0;
const FILES = 1;
const ZERO_WEIGHT = 2;
/** Folders in the subtree, the folder itself included. */
const SUBTREE_FOLDERS = 3;
const CATEGORY_START = 4;
const AGE_START = CATEGORY_START + CATEGORY_COUNT;
const SUMMARY_STRIDE = AGE_START + AGE_BUCKET_COUNT;

/** How many rectangles' coefficients the surface holds before it first grows. */
const SURFACE_START_RECTS = 4096;

/** What a small-files group shows, worked out when the group is made. */
interface GroupSummary {
  files: number;
  category: number;
  age: number;
}

interface Item {
  weight: number;
  file: TreeFile | null;
  folder: FolderNode | null;
  /** The folder's row in the summary slab, or -1 for a file or a group. */
  folderRow: number;
  group: GroupSummary | null;
}

const weightOf = (file: TreeFile, metric: Metric) => (metric === 'size' ? file.size : file.hits);

/** The position of the largest of `count` values starting at `start`, counted from `start`. The first wins a tie. */
function indexOfLargest(values: Float64Array, start: number, count: number): number {
  let best = 0;
  for (let i = 1; i < count; i++) if (values[start + i] > values[start + best]) best = i;
  return best;
}

/** Adds one slab row into another. */
function addRow(values: Float64Array, target: number, source: number): void {
  for (let i = 0; i < SUMMARY_STRIDE; i++) values[target + i] += values[source + i];
}

/** Totals for `root` and every folder below it, one slab row each in depth-first order. */
function summarize(root: FolderNode, folderCapacity: number, metric: Metric, now: number): Float64Array {
  const slab = new Float64Array(folderCapacity * SUMMARY_STRIDE);
  /** Fills the rows of `node`'s subtree from `row` on and returns the row after them. */
  const walk = (node: FolderNode, row: number): number => {
    const base = row * SUMMARY_STRIDE;
    for (const file of node.files) {
      const weight = weightOf(file, metric);
      slab[base + FILES] += 1;
      if (weight > 0) {
        slab[base + WEIGHT] += weight;
        slab[base + CATEGORY_START + file.category] += weight;
        slab[base + AGE_START + ageBucket(file.modifiedMs, now)] += weight;
      } else {
        slab[base + ZERO_WEIGHT] += 1;
      }
    }
    let next = row + 1;
    for (const child of node.folders.values()) {
      const childRow = next;
      next = walk(child, childRow);
      addRow(slab, base, childRow * SUMMARY_STRIDE);
    }
    // The children's subtree sizes were added in with their rows, so this sets the total afresh.
    slab[base + SUBTREE_FOLDERS] = next - row;
    return next;
  };
  walk(root, 0);
  return slab;
}

/** Calls `visit` with each child folder of the folder at `row` and the child's own row. */
function forEachChildRow(slab: Float64Array, node: FolderNode, row: number, visit: (child: FolderNode, childRow: number) => void): void {
  let childRow = row + 1;
  for (const child of node.folders.values()) {
    visit(child, childRow);
    childRow += slab[childRow * SUMMARY_STRIDE + SUBTREE_FOLDERS];
  }
}

/** The standard squarified treemap row builder (Bruls, Huizing, van Wijk). `items` are in descending weight order. */
function squarify(
  items: Item[],
  scale: number,
  bounds: { x: number; y: number; w: number; h: number },
  place: (item: Item, x: number, y: number, w: number, h: number) => void,
): void {
  let { x, y, w, h } = bounds;
  let start = 0;
  const worstRatio = (sum: number, largest: number, smallest: number, side: number) =>
    Math.max((side * side * largest) / (sum * sum), (sum * sum) / (side * side * smallest));

  while (start < items.length) {
    const side = Math.min(w, h);
    if (side <= 0) return;
    let end = start + 1;
    let sum = items[start].weight * scale;
    const largest = sum;
    let ratio = worstRatio(sum, largest, sum, side);
    while (end < items.length) {
      const area = items[end].weight * scale;
      const nextSum = sum + area;
      // Items are descending, so the item being added is the smallest in the row.
      const nextRatio = worstRatio(nextSum, largest, area, side);
      if (nextRatio > ratio) break;
      sum = nextSum;
      ratio = nextRatio;
      end++;
    }
    // Lay the row along the short side.
    if (w >= h) {
      const rowWidth = sum / h;
      let cursorY = y;
      for (let i = start; i < end; i++) {
        const itemHeight = (items[i].weight * scale) / rowWidth;
        place(items[i], x, cursorY, rowWidth, itemHeight);
        cursorY += itemHeight;
      }
      x += rowWidth;
      w -= rowWidth;
    } else {
      const rowHeight = sum / w;
      let cursorX = x;
      for (let i = start; i < end; i++) {
        const itemWidth = (items[i].weight * scale) / rowHeight;
        place(items[i], cursorX, y, itemWidth, rowHeight);
        cursorX += itemWidth;
      }
      y += rowHeight;
      h -= rowHeight;
    }
    start = end;
  }
}

export function layoutTree(
  root: FolderNode,
  counts: { files: number; folders: number },
  options: LayoutOptions,
): Layout {
  const { width, height, metric, now } = options;
  const minLeafArea = options.minLeafArea ?? 4;
  const minFolderSide = options.minFolderSide ?? 6;
  const inset = options.inset ?? 1;
  const insetMinSide = options.insetMinSide ?? 8;

  const slab = summarize(root, counts.folders + 1, metric, now);

  let largestChildFolderId = -1;
  // A child with no weight is not the largest, so a folder whose children all weigh nothing has none.
  let largestChildWeight = 0;
  forEachChildRow(slab, root, 0, (child, childRow) => {
    const weight = slab[childRow * SUMMARY_STRIDE + WEIGHT];
    if (weight > largestChildWeight) {
      largestChildWeight = weight;
      largestChildFolderId = child.id;
    }
  });

  const capacity = counts.files + counts.folders + 2;
  const layout: Layout = {
    count: 0,
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    w: new Float32Array(capacity),
    h: new Float32Array(capacity),
    id: new Int32Array(capacity),
    kind: new Uint8Array(capacity),
    depth: new Uint8Array(capacity),
    category: new Uint8Array(capacity),
    age: new Uint8Array(capacity),
    weight: new Float64Array(capacity),
    fileCount: new Uint32Array(capacity),
    folderId: new Int32Array(capacity),
    // Grown on demand in `emit`: sized for the worst case it would cost a measurable share of the layout time.
    surface: new Float32Array(SURFACE_START_RECTS * 4),
    frameCount: 0,
    frameX: new Float32Array(counts.folders + 1),
    frameY: new Float32Array(counts.folders + 1),
    frameW: new Float32Array(counts.folders + 1),
    frameH: new Float32Array(counts.folders + 1),
    frameFolderId: new Int32Array(counts.folders + 1),
    omitted: slab[ZERO_WEIGHT],
    totalFiles: slab[FILES],
    totalWeight: slab[WEIGHT],
    // Copies with buffers of their own: the worker transfers every buffer of the layout, and two
    // views on one buffer in a transfer list cannot be sent.
    categoryWeight: slab.slice(CATEGORY_START, CATEGORY_START + CATEGORY_COUNT),
    ageWeight: slab.slice(AGE_START, AGE_START + AGE_BUCKET_COUNT),
    largestChildFolderId,
  };
  /** Reused for each small-files group, whose totals are read as soon as they are summed. */
  const groupRow = new Float64Array(SUMMARY_STRIDE);

  const emit = (
    kind: number, id: number, x: number, y: number, w: number, h: number, depth: number,
    category: number, age: number, weight: number, fileCount: number, folderId: number,
    inherited: ArrayLike<number>,
  ) => {
    const i = layout.count++;
    layout.x[i] = x; layout.y[i] = y; layout.w[i] = w; layout.h[i] = h;
    layout.id[i] = id; layout.kind[i] = kind; layout.depth[i] = Math.min(depth, 255);
    layout.category[i] = category; layout.age[i] = age; layout.weight[i] = weight;
    layout.fileCount[i] = fileCount; layout.folderId[i] = folderId;
    // The rectangle is a cushion of its own on top of the folders around it.
    if (i * 4 + 4 > layout.surface.length) {
      const grown = new Float32Array(Math.min(capacity, layout.surface.length / 4 * 2) * 4);
      grown.set(layout.surface);
      layout.surface = grown;
    }
    for (let k = 0; k < 4; k++) layout.surface[i * 4 + k] = inherited[k];
    addRidge(layout.surface, i * 4, x, y, x + w, y + h, CUSHION_HEIGHT * CUSHION_SCALE ** (depth + 1));
  };

  const emitFrame = (folderId: number, x: number, y: number, w: number, h: number) => {
    const i = layout.frameCount++;
    layout.frameX[i] = x; layout.frameY[i] = y; layout.frameW[i] = w; layout.frameH[i] = h;
    layout.frameFolderId[i] = folderId;
  };

  /** `inherited` holds the coefficients of the folders around `node`. It is only read, never kept. */
  const fill = (node: FolderNode, row: number, x: number, y: number, w: number, h: number, depth: number, inherited: ArrayLike<number>) => {
    const items: Item[] = [];
    for (const file of node.files) {
      const weight = weightOf(file, metric);
      if (weight > 0) items.push({ weight, file, folder: null, folderRow: -1, group: null });
    }
    forEachChildRow(slab, node, row, (child, childRow) => {
      const weight = slab[childRow * SUMMARY_STRIDE + WEIGHT];
      if (weight > 0) items.push({ weight, file: null, folder: child, folderRow: childRow, group: null });
    });
    if (items.length === 0 || w <= 0 || h <= 0) return;

    items.sort((left, right) => right.weight - left.weight);
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    const scale = (w * h) / total;

    // Fold the smallest items into one group so the rectangle count tracks what can be seen.
    let firstSmall = items.length;
    while (firstSmall > 0 && items[firstSmall - 1].weight * scale < minLeafArea) firstSmall--;
    if (items.length - firstSmall >= 2) {
      const small = items.splice(firstSmall);
      groupRow.fill(0);
      let mergedWeight = 0;
      for (const item of small) {
        mergedWeight += item.weight;
        if (item.file) {
          groupRow[FILES] += 1;
          groupRow[CATEGORY_START + item.file.category] += item.weight;
          groupRow[AGE_START + ageBucket(item.file.modifiedMs, now)] += item.weight;
        } else {
          const base = item.folderRow * SUMMARY_STRIDE;
          groupRow[FILES] += slab[base + FILES];
          for (let i = CATEGORY_START; i < SUMMARY_STRIDE; i++) groupRow[i] += slab[base + i];
        }
      }
      const group: GroupSummary = {
        files: groupRow[FILES],
        category: indexOfLargest(groupRow, CATEGORY_START, CATEGORY_COUNT),
        age: indexOfLargest(groupRow, AGE_START, AGE_BUCKET_COUNT),
      };
      items.push({ weight: mergedWeight, file: null, folder: node, folderRow: -1, group });
      items.sort((left, right) => right.weight - left.weight);
    }

    squarify(items, scale, { x, y, w, h }, (item, itemX, itemY, itemWidth, itemHeight) => {
      if (item.file) {
        emit(
          RectKind.File, item.file.id, itemX, itemY, itemWidth, itemHeight, depth,
          item.file.category, ageBucket(item.file.modifiedMs, now), item.weight, 1, node.id, inherited,
        );
      } else if (item.group) {
        emit(
          RectKind.SmallFiles, node.id, itemX, itemY, itemWidth, itemHeight, depth,
          item.group.category, item.group.age, item.weight, item.group.files, node.id, inherited,
        );
      } else {
        const child = item.folder!;
        if (itemWidth < minFolderSide || itemHeight < minFolderSide) {
          const base = item.folderRow * SUMMARY_STRIDE;
          emit(
            RectKind.FolderBlock, child.id, itemX, itemY, itemWidth, itemHeight, depth,
            indexOfLargest(slab, base + CATEGORY_START, CATEGORY_COUNT), indexOfLargest(slab, base + AGE_START, AGE_BUCKET_COUNT),
            item.weight, slab[base + FILES], node.id, inherited,
          );
          return;
        }
        emitFrame(child.id, itemX, itemY, itemWidth, itemHeight);
        const gap = itemWidth >= insetMinSide && itemHeight >= insetMinSide ? inset : 0;
        // The frame's ridge spans its outer rectangle, before the gap. Each descended folder owns its
        // coefficients because its siblings go on reading theirs after it returns.
        const childSurface = new Float64Array(4);
        for (let k = 0; k < 4; k++) childSurface[k] = inherited[k];
        addRidge(childSurface, 0, itemX, itemY, itemX + itemWidth, itemY + itemHeight, CUSHION_HEIGHT * CUSHION_SCALE ** depth);
        fill(child, item.folderRow, itemX + gap, itemY + gap, itemWidth - 2 * gap, itemHeight - 2 * gap, depth + 1, childSurface);
      }
    });
  };

  emitFrame(root.id, 0, 0, width, height);
  fill(root, 0, 0, 0, width, height, 0, [0, 0, 0, 0]);
  return layout;
}
