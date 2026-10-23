import { describe, expect, it } from 'vitest';
import { LayoutIndex } from './treemapIndex';
import { layoutTree, RectKind } from './treemapLayout';
import { FolderTree } from './treemapTree';

function build(count: number, width = 400, height = 300) {
  const tree = new FolderTree();
  for (let i = 0; i < count; i++) {
    tree.add({ id: i, folder: `C:\\d${i % 5}`, name: `f${i}.txt`, size: 100 + (i % 13), hits: 0, modifiedMs: null });
  }
  const layout = layoutTree(tree.root, { files: tree.fileCount, folders: tree.folderCount }, {
    width, height, metric: 'size', now: 0, minLeafArea: 0, minFolderSide: 0, inset: 0, insetMinSide: Infinity,
  });
  return { layout, index: new LayoutIndex(layout, width, height) };
}

describe('LayoutIndex', () => {
  it('finds the rectangle under the centre of every rectangle', () => {
    const { layout, index } = build(200);
    for (let i = 0; i < layout.count; i++) {
      const found = index.at(layout.x[i] + layout.w[i] / 2, layout.y[i] + layout.h[i] / 2);
      expect(found).toBe(i);
    }
  });

  it('returns -1 outside the map', () => {
    const { index } = build(10);
    expect(index.at(-5, 10)).toBe(-1);
    expect(index.at(10, 9999)).toBe(-1);
  });

  it('finds a File rectangle by file id', () => {
    const { layout, index } = build(50);
    const i = index.firstWithFileId(17);
    expect(layout.kind[i]).toBe(RectKind.File);
    expect(layout.id[i]).toBe(17);
    expect(index.firstWithFileId(99999)).toBe(-1);
  });

  it('moves to a neighbour in the requested direction', () => {
    const { layout, index } = build(40);
    const middle = index.at(200, 150);
    for (const direction of ['left', 'right', 'up', 'down'] as const) {
      const next = index.nearest(middle, direction);
      if (next === -1) continue;
      const dx = layout.x[next] + layout.w[next] / 2 - (layout.x[middle] + layout.w[middle] / 2);
      const dy = layout.y[next] + layout.h[next] / 2 - (layout.y[middle] + layout.h[middle] / 2);
      if (direction === 'left') expect(dx).toBeLessThan(0);
      if (direction === 'right') expect(dx).toBeGreaterThan(0);
      if (direction === 'up') expect(dy).toBeLessThan(0);
      if (direction === 'down') expect(dy).toBeGreaterThan(0);
    }
  });

  it('returns -1 when nothing lies in that direction', () => {
    const { layout, index } = build(10);
    let leftmost = 0;
    for (let i = 1; i < layout.count; i++) if (layout.x[i] < layout.x[leftmost]) leftmost = i;
    expect(index.nearest(leftmost, 'left')).toBe(-1);
  });

  it('builds quickly for 20000 rectangles', () => {
    const tree = new FolderTree();
    for (let i = 0; i < 20000; i++) tree.add({ id: i, folder: `C:\\d${i % 40}`, name: 'a.txt', size: 1 + (i % 50), hits: 0, modifiedMs: null });
    const layout = layoutTree(tree.root, { files: tree.fileCount, folders: tree.folderCount }, {
      width: 1600, height: 500, metric: 'size', now: 0, minLeafArea: 0, minFolderSide: 0, inset: 0, insetMinSide: Infinity,
    });
    const started = performance.now();
    new LayoutIndex(layout, 1600, 500);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
