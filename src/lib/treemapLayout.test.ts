import { describe, expect, it } from 'vitest';
import { AGE_BUCKET_COUNT, ageBucket, layoutTree, RectKind, type LayoutOptions } from './treemapLayout';
import { FolderTree, type TreemapRecord } from './treemapTree';

const NOW = Date.UTC(2026, 9, 22);
const exact: Partial<LayoutOptions> = { minLeafArea: 0, minFolderSide: 0, inset: 0, insetMinSide: Infinity };

function treeOf(records: Array<Partial<TreemapRecord> & { id: number }>): FolderTree {
  const tree = new FolderTree();
  for (const partial of records) {
    tree.add({ folder: 'C:\\a', name: `f${partial.id}.txt`, size: 1, hits: 0, modifiedMs: null, ...partial });
  }
  return tree;
}

function layout(tree: FolderTree, options: Partial<LayoutOptions> = {}) {
  return layoutTree(tree.root, { files: tree.fileCount, folders: tree.folderCount }, {
    width: 100, height: 100, metric: 'size', now: NOW, ...options,
  });
}

const area = (result: ReturnType<typeof layout>, index: number) => result.w[index] * result.h[index];

describe('layoutTree', () => {
  it('fills the whole area when nothing is folded or inset', () => {
    const tree = treeOf([{ id: 1, size: 5 }, { id: 2, size: 3 }, { id: 3, size: 2 }]);
    const result = layout(tree, exact);
    let total = 0;
    for (let i = 0; i < result.count; i++) total += area(result, i);
    expect(total).toBeCloseTo(10000, 0);
  });

  it('gives each file an area proportional to its weight', () => {
    const tree = treeOf([{ id: 1, size: 75 }, { id: 2, size: 25 }]);
    const result = layout(tree, exact);
    const byId = new Map<number, number>();
    for (let i = 0; i < result.count; i++) byId.set(result.id[i], area(result, i));
    expect(byId.get(1)! / byId.get(2)!).toBeCloseTo(3, 1);
  });

  it('keeps every rectangle inside the bounds and none overlapping', () => {
    const tree = treeOf(Array.from({ length: 30 }, (_, i) => ({ id: i, size: 1 + (i % 7) })));
    const result = layout(tree, exact);
    for (let i = 0; i < result.count; i++) {
      expect(result.x[i]).toBeGreaterThanOrEqual(-1e-3);
      expect(result.y[i]).toBeGreaterThanOrEqual(-1e-3);
      expect(result.x[i] + result.w[i]).toBeLessThanOrEqual(100 + 1e-3);
      expect(result.y[i] + result.h[i]).toBeLessThanOrEqual(100 + 1e-3);
      for (let j = i + 1; j < result.count; j++) {
        const overlapX = Math.min(result.x[i] + result.w[i], result.x[j] + result.w[j]) - Math.max(result.x[i], result.x[j]);
        const overlapY = Math.min(result.y[i] + result.h[i], result.y[j] + result.h[j]) - Math.max(result.y[i], result.y[j]);
        expect(overlapX <= 1e-2 || overlapY <= 1e-2).toBe(true);
      }
    }
  });

  it('produces nearly square rectangles for equal weights', () => {
    const tree = treeOf(Array.from({ length: 20 }, (_, i) => ({ id: i, size: 10 })));
    const result = layout(tree, exact);
    for (let i = 0; i < result.count; i++) {
      const ratio = Math.max(result.w[i] / result.h[i], result.h[i] / result.w[i]);
      expect(ratio).toBeLessThan(3);
    }
  });

  it('omits zero-weight files and counts them', () => {
    const tree = treeOf([{ id: 1, size: 10 }, { id: 2, size: 0 }]);
    const result = layout(tree, exact);
    expect(result.count).toBe(1);
    expect(result.omitted).toBe(1);
    expect(result.totalFiles).toBe(2);
  });

  it('weighs by match count in the Matches metric', () => {
    const tree = treeOf([{ id: 1, size: 100, hits: 1 }, { id: 2, size: 1, hits: 3 }]);
    const result = layout(tree, { ...exact, metric: 'matches' });
    const byId = new Map<number, number>();
    for (let i = 0; i < result.count; i++) byId.set(result.id[i], area(result, i));
    expect(byId.get(2)! / byId.get(1)!).toBeCloseTo(3, 1);
  });

  it('keeps a folder\'s files inside the folder\'s frame', () => {
    const tree = treeOf([
      { id: 1, folder: 'C:\\a\\b', size: 5 }, { id: 2, folder: 'C:\\a\\b', size: 5 }, { id: 3, folder: 'C:\\a\\c', size: 10 },
    ]);
    const result = layout(tree, { ...exact, inset: 1, insetMinSide: 0 });
    const frameOf = new Map<number, number>();
    for (let i = 0; i < result.frameCount; i++) frameOf.set(result.frameFolderId[i], i);
    for (let i = 0; i < result.count; i++) {
      const frame = frameOf.get(result.folderId[i])!;
      expect(result.x[i]).toBeGreaterThanOrEqual(result.frameX[frame] - 1e-3);
      expect(result.x[i] + result.w[i]).toBeLessThanOrEqual(result.frameX[frame] + result.frameW[frame] + 1e-3);
      expect(result.y[i]).toBeGreaterThanOrEqual(result.frameY[frame] - 1e-3);
      expect(result.y[i] + result.h[i]).toBeLessThanOrEqual(result.frameY[frame] + result.frameH[frame] + 1e-3);
    }
  });

  it('folds tiny files into one group so the rectangle count stays small', () => {
    const records = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, size: 1 }));
    records.push({ id: 5000, size: 1_000_000 });
    const tree = treeOf(records);
    const result = layout(tree, { minLeafArea: 4, minFolderSide: 0, inset: 0, insetMinSide: Infinity });
    expect(result.count).toBeLessThan(10);
    const groupIndex = Array.from({ length: result.count }, (_, i) => i).find((i) => result.kind[i] === RectKind.SmallFiles)!;
    expect(result.fileCount[groupIndex]).toBe(1000);
    expect(result.folderId[groupIndex]).toBe(tree.folderOfFile(1)!.id);
  });

  it('paints a folder that is too narrow as one block without descending', () => {
    const tree = treeOf([
      { id: 1, folder: 'C:\\big', size: 1_000_000 },
      { id: 2, folder: 'C:\\tiny\\x', size: 1 },
      { id: 3, folder: 'C:\\tiny\\y', size: 1 },
    ]);
    const result = layout(tree, { minLeafArea: 0, minFolderSide: 6, inset: 0, insetMinSide: Infinity });
    const kinds = Array.from({ length: result.count }, (_, i) => result.kind[i]);
    expect(kinds).toContain(RectKind.FolderBlock);
    expect(result.count).toBeLessThan(5);
  });

  it('reports the dominant category and age of a group', () => {
    const tree = new FolderTree();
    for (let i = 0; i < 50; i++) tree.add({ id: i, folder: 'C:\\a', name: `x${i}.rs`, size: 1, hits: 0, modifiedMs: NOW - 1000 });
    tree.add({ id: 99, folder: 'C:\\a', name: 'big.png', size: 1_000_000, hits: 0, modifiedMs: NOW - 400 * 86_400_000 });
    const result = layoutTree(tree.root, { files: tree.fileCount, folders: tree.folderCount }, {
      width: 100, height: 100, metric: 'size', now: NOW, minLeafArea: 4, inset: 0, insetMinSide: Infinity, minFolderSide: 0,
    });
    const group = Array.from({ length: result.count }, (_, i) => i).find((i) => result.kind[i] === RectKind.SmallFiles)!;
    expect(result.category[group]).toBe(0); // code
    expect(result.age[group]).toBe(0);      // today
  });

  it('is deterministic', () => {
    const records = Array.from({ length: 200 }, (_, i) => ({ id: i, folder: `C:\\d${i % 9}`, size: 1 + ((i * 7919) % 100) }));
    const first = layout(treeOf(records));
    const second = layout(treeOf(records));
    expect(Array.from(first.x)).toEqual(Array.from(second.x));
    expect(first.count).toBe(second.count);
  });

  it('totals the weight by category and age for the legend', () => {
    const tree = new FolderTree();
    tree.add({ id: 1, folder: 'C:\\a', name: 'a.rs', size: 10, hits: 0, modifiedMs: NOW });
    tree.add({ id: 2, folder: 'C:\\a', name: 'b.png', size: 30, hits: 0, modifiedMs: null });
    const result = layout(tree, exact);
    expect(result.totalWeight).toBe(40);
    expect(result.categoryWeight[0]).toBe(10);
    expect(result.categoryWeight[3]).toBe(30);
    expect(result.ageWeight[0]).toBe(10);
    expect(result.ageWeight[5]).toBe(30);
  });

  it('reports the heaviest child folder of the laid-out folder, ignoring its own files', () => {
    const tree = new FolderTree();
    tree.add({ id: 1, folder: 'C:\\top', name: 'loose.bin', size: 500, hits: 0, modifiedMs: null });
    tree.add({ id: 2, folder: 'C:\\top\\light', name: 'a.txt', size: 10, hits: 9, modifiedMs: null });
    tree.add({ id: 3, folder: 'C:\\top\\heavy\\deeper', name: 'b.txt', size: 60, hits: 1, modifiedMs: null });
    tree.add({ id: 4, folder: 'C:\\top\\heavy', name: 'c.txt', size: 5, hits: 0, modifiedMs: null });
    const top = tree.folderOfFile(1)!;
    const counts = { files: tree.fileCount, folders: tree.folderCount };
    const bySize = layoutTree(top, counts, { width: 100, height: 100, metric: 'size', now: NOW });
    expect(bySize.largestChildFolderId).toBe(tree.folderOfFile(4)!.id);
    const byMatches = layoutTree(top, counts, { width: 100, height: 100, metric: 'matches', now: NOW });
    expect(byMatches.largestChildFolderId).toBe(tree.folderOfFile(2)!.id);
    const leaf = layoutTree(tree.folderOfFile(2)!, counts, { width: 100, height: 100, metric: 'size', now: NOW });
    expect(leaf.largestChildFolderId).toBe(-1);
  });

  it('gives every typed array its own buffer, so the worker can transfer them all', () => {
    const tree = treeOf([{ id: 1, folder: 'C:\\a\\b', size: 5 }, { id: 2, folder: 'C:\\a\\c', size: 3 }]);
    const result = layout(tree, exact);
    const buffers = Object.values(result).filter((value) => ArrayBuffer.isView(value)).map((view) => view.buffer);
    expect(new Set(buffers).size).toBe(buffers.length);
  });
});

describe('ageBucket', () => {
  const day = 86_400_000;
  it('buckets by age', () => {
    expect(ageBucket(NOW - 1000, NOW)).toBe(0);
    expect(ageBucket(NOW - 3 * day, NOW)).toBe(1);
    expect(ageBucket(NOW - 20 * day, NOW)).toBe(2);
    expect(ageBucket(NOW - 200 * day, NOW)).toBe(3);
    expect(ageBucket(NOW - 900 * day, NOW)).toBe(4);
    expect(ageBucket(null, NOW)).toBe(AGE_BUCKET_COUNT - 1);
  });
  it('treats a future time as today', () => {
    expect(ageBucket(NOW + day, NOW)).toBe(0);
  });
});
