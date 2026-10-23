import { FILE_CATEGORIES } from './fileKinds';
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
}

interface Summary {
  weight: number;
  files: number;
  zeroWeight: number;
  category: Float64Array;
  age: Float64Array;
}

interface Item {
  weight: number;
  file: TreeFile | null;
  folder: FolderNode | null;
  summary: Summary | null;
  isGroup: boolean;
}

const emptySummary = (): Summary => ({
  weight: 0,
  files: 0,
  zeroWeight: 0,
  category: new Float64Array(CATEGORY_COUNT),
  age: new Float64Array(AGE_BUCKET_COUNT),
});

function addSummary(target: Summary, source: Summary): void {
  target.weight += source.weight;
  target.files += source.files;
  target.zeroWeight += source.zeroWeight;
  for (let i = 0; i < CATEGORY_COUNT; i++) target.category[i] += source.category[i];
  for (let i = 0; i < AGE_BUCKET_COUNT; i++) target.age[i] += source.age[i];
}

const weightOf = (file: TreeFile, metric: Metric) => (metric === 'size' ? file.size : file.hits);

function indexOfLargest(values: Float64Array): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

function summarize(node: FolderNode, metric: Metric, now: number, cache: Map<FolderNode, Summary>): Summary {
  const summary = emptySummary();
  for (const file of node.files) {
    const weight = weightOf(file, metric);
    summary.files += 1;
    if (weight > 0) {
      summary.weight += weight;
      summary.category[file.category] += weight;
      summary.age[ageBucket(file.modifiedMs, now)] += weight;
    } else {
      summary.zeroWeight += 1;
    }
  }
  for (const child of node.folders.values()) addSummary(summary, summarize(child, metric, now, cache));
  cache.set(node, summary);
  return summary;
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

  const cache = new Map<FolderNode, Summary>();
  const rootSummary = summarize(root, metric, now, cache);

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
    frameCount: 0,
    frameX: new Float32Array(counts.folders + 1),
    frameY: new Float32Array(counts.folders + 1),
    frameW: new Float32Array(counts.folders + 1),
    frameH: new Float32Array(counts.folders + 1),
    frameFolderId: new Int32Array(counts.folders + 1),
    omitted: rootSummary.zeroWeight,
    totalFiles: rootSummary.files,
    totalWeight: rootSummary.weight,
    categoryWeight: rootSummary.category,
    ageWeight: rootSummary.age,
  };

  const emit = (
    kind: number, id: number, x: number, y: number, w: number, h: number, depth: number,
    category: number, age: number, weight: number, fileCount: number, folderId: number,
  ) => {
    const i = layout.count++;
    layout.x[i] = x; layout.y[i] = y; layout.w[i] = w; layout.h[i] = h;
    layout.id[i] = id; layout.kind[i] = kind; layout.depth[i] = Math.min(depth, 255);
    layout.category[i] = category; layout.age[i] = age; layout.weight[i] = weight;
    layout.fileCount[i] = fileCount; layout.folderId[i] = folderId;
  };

  const emitFrame = (folderId: number, x: number, y: number, w: number, h: number) => {
    const i = layout.frameCount++;
    layout.frameX[i] = x; layout.frameY[i] = y; layout.frameW[i] = w; layout.frameH[i] = h;
    layout.frameFolderId[i] = folderId;
  };

  const fill = (node: FolderNode, x: number, y: number, w: number, h: number, depth: number) => {
    const items: Item[] = [];
    for (const file of node.files) {
      const weight = weightOf(file, metric);
      if (weight > 0) items.push({ weight, file, folder: null, summary: null, isGroup: false });
    }
    for (const child of node.folders.values()) {
      const summary = cache.get(child)!;
      if (summary.weight > 0) items.push({ weight: summary.weight, file: null, folder: child, summary, isGroup: false });
    }
    if (items.length === 0 || w <= 0 || h <= 0) return;

    items.sort((left, right) => right.weight - left.weight);
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    const scale = (w * h) / total;

    // Fold the smallest items into one group so the rectangle count tracks what can be seen.
    let firstSmall = items.length;
    while (firstSmall > 0 && items[firstSmall - 1].weight * scale < minLeafArea) firstSmall--;
    if (items.length - firstSmall >= 2) {
      const small = items.splice(firstSmall);
      const merged = emptySummary();
      let mergedWeight = 0;
      for (const item of small) {
        mergedWeight += item.weight;
        if (item.file) {
          merged.files += 1;
          merged.weight += item.weight;
          merged.category[item.file.category] += item.weight;
          merged.age[ageBucket(item.file.modifiedMs, now)] += item.weight;
        } else {
          addSummary(merged, item.summary!);
        }
      }
      items.push({ weight: mergedWeight, file: null, folder: node, summary: merged, isGroup: true });
      items.sort((left, right) => right.weight - left.weight);
    }

    squarify(items, scale, { x, y, w, h }, (item, itemX, itemY, itemWidth, itemHeight) => {
      if (item.file) {
        emit(
          RectKind.File, item.file.id, itemX, itemY, itemWidth, itemHeight, depth,
          item.file.category, ageBucket(item.file.modifiedMs, now), item.weight, 1, node.id,
        );
      } else if (item.isGroup) {
        const summary = item.summary!;
        emit(
          RectKind.SmallFiles, node.id, itemX, itemY, itemWidth, itemHeight, depth,
          indexOfLargest(summary.category), indexOfLargest(summary.age), item.weight, summary.files, node.id,
        );
      } else {
        const child = item.folder!;
        const summary = item.summary!;
        if (itemWidth < minFolderSide || itemHeight < minFolderSide) {
          emit(
            RectKind.FolderBlock, child.id, itemX, itemY, itemWidth, itemHeight, depth,
            indexOfLargest(summary.category), indexOfLargest(summary.age), item.weight, summary.files, node.id,
          );
          return;
        }
        emitFrame(child.id, itemX, itemY, itemWidth, itemHeight);
        const gap = itemWidth >= insetMinSide && itemHeight >= insetMinSide ? inset : 0;
        fill(child, itemX + gap, itemY + gap, itemWidth - 2 * gap, itemHeight - 2 * gap, depth + 1);
      }
    });
  };

  emitFrame(root.id, 0, 0, width, height);
  fill(root, 0, 0, width, height, 0);
  return layout;
}
