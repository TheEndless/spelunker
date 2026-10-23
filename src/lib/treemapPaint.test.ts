import { describe, expect, it } from 'vitest';
import { bestTextOn } from './colors';
import { fittedLabel, paintLayout, type Context2D, type PaintStyle } from './treemapPaint';
import { layoutTree } from './treemapLayout';
import { FolderTree } from './treemapTree';
import { mapColors } from './treemapColors';
import { PALETTES } from './palettes';

function fakeContext() {
  const calls: Array<{ name: string; args: unknown[]; fill: unknown }> = [];
  const context = {
    fillStyle: '', strokeStyle: '', globalAlpha: 1, font: '', textBaseline: '', lineWidth: 1,
    fillRect: (...args: unknown[]) => calls.push({ name: 'fillRect', args, fill: context.fillStyle }),
    strokeRect: (...args: unknown[]) => calls.push({ name: 'strokeRect', args, fill: context.strokeStyle }),
    fillText: (...args: unknown[]) => calls.push({ name: 'fillText', args, fill: context.fillStyle }),
    measureText: (text: string) => ({ width: text.length * 6 }),
    save: () => {}, restore: () => {}, beginPath: () => {}, rect: () => {}, clip: () => {},
  };
  return { context: context as unknown as Context2D, calls };
}

const style = (overrides: Partial<PaintStyle> = {}): PaintStyle => ({
  colors: mapColors(PALETTES[0].dark, 'dark'),
  colorMode: 'type',
  forced: null,
  font: '12px sans-serif',
  labelColorFor: bestTextOn,
  pixelRatio: 1,
  ...overrides,
});

function sampleLayout() {
  const tree = new FolderTree();
  tree.add({ id: 1, folder: 'C:\\a', name: 'wide-file-name.rs', size: 800, hits: 0, modifiedMs: null });
  tree.add({ id: 2, folder: 'C:\\a', name: 'b.png', size: 200, hits: 0, modifiedMs: null });
  return layoutTree(tree.root, { files: 2, folders: tree.folderCount }, {
    width: 400, height: 200, metric: 'size', now: 0, minLeafArea: 0, minFolderSide: 0, inset: 0, insetMinSide: Infinity,
  });
}

/** Uneven sizes in an odd-sized area, so the squarified rectangles start and end between pixels. */
function fractionalLayout() {
  const tree = new FolderTree();
  const sizes = [977, 613, 401, 389, 251, 173, 97, 61, 37, 23, 11, 7];
  sizes.forEach((size, index) => tree.add({ id: index + 1, folder: 'C:\\a', name: `f${index}.rs`, size, hits: 0, modifiedMs: null }));
  return layoutTree(tree.root, { files: sizes.length, folders: tree.folderCount }, {
    width: 333, height: 177, metric: 'size', now: 0, minLeafArea: 0, minFolderSide: 0, inset: 0, insetMinSide: Infinity,
  });
}

describe('paintLayout', () => {
  it('fills the background, then one rectangle per layout rectangle', () => {
    const { context, calls } = fakeContext();
    const layout = sampleLayout();
    paintLayout(context, layout, 400, 200, style(), null, null);
    const fills = calls.filter((call) => call.name === 'fillRect');
    expect(fills[0].args).toEqual([0, 0, 400, 200]);
    expect(fills.length).toBeGreaterThanOrEqual(1 + layout.count);
  });

  it('uses the category color in type mode and the age color in age mode', () => {
    const colors = mapColors(PALETTES[0].dark, 'dark');
    const layout = sampleLayout();
    const typeRun = fakeContext();
    paintLayout(typeRun.context, layout, 400, 200, style({ colorMode: 'type' }), null, null);
    expect(typeRun.calls.some((call) => call.fill === colors.category[layout.category[0]])).toBe(true);
    const ageRun = fakeContext();
    paintLayout(ageRun.context, layout, 400, 200, style({ colorMode: 'age' }), null, null);
    expect(ageRun.calls.some((call) => call.fill === colors.age[layout.age[0]])).toBe(true);
  });

  it('draws labels only on rectangles big enough to hold one', () => {
    const { context, calls } = fakeContext();
    const layout = sampleLayout();
    paintLayout(context, layout, 400, 200, style(), null, (rect) => `name${rect}`);
    expect(calls.filter((call) => call.name === 'fillText').length).toBeGreaterThanOrEqual(1);
  });

  it('puts every fill edge on a whole device pixel, so no rectangle has a soft edge', () => {
    for (const pixelRatio of [1, 1.25, 1.5, 2]) {
      const { context, calls } = fakeContext();
      const layout = fractionalLayout();
      paintLayout(context, layout, 333, 177, style({ pixelRatio }), null, null);
      const fills = calls.filter((call) => call.name === 'fillRect').slice(1);
      expect(fills).toHaveLength(layout.count);
      for (const { args } of fills) {
        const [x, y, w, h] = args as number[];
        for (const edge of [x, y, x + w, y + h]) expect(edge * pixelRatio).toBeCloseTo(Math.round(edge * pixelRatio), 6);
      }
    }
  });

  it('keeps a seam between neighbours without letting any rectangle vanish', () => {
    const { context, calls } = fakeContext();
    const layout = fractionalLayout();
    paintLayout(context, layout, 333, 177, style({ pixelRatio: 1 }), null, null);
    const fills = calls.filter((call) => call.name === 'fillRect').slice(1).map((call) => call.args as number[]);
    for (const [, , w, h] of fills) expect(w > 0 && h > 0).toBe(true);
    // No two fills overlap: the seam is taken from inside each rectangle.
    for (let i = 0; i < fills.length; i++) {
      for (let j = i + 1; j < fills.length; j++) {
        const [ax, ay, aw, ah] = fills[i];
        const [bx, by, bw, bh] = fills[j];
        const overlaps = ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
        expect(overlaps).toBe(false);
      }
    }
  });

  it('draws only outlines in forced-colors mode', () => {
    const { context, calls } = fakeContext();
    paintLayout(context, sampleLayout(), 400, 200, style({ forced: { canvas: 'rgb(0, 0, 0)', text: 'rgb(255, 255, 255)', highlight: 'rgb(0, 0, 255)' } }), null, null);
    expect(calls.filter((call) => call.name === 'strokeRect').length).toBeGreaterThan(0);
    const fillColors = new Set(calls.filter((call) => call.name === 'fillRect').map((call) => call.fill));
    expect(fillColors).toEqual(new Set(['rgb(0, 0, 0)']));
  });

  it('fades rectangles outside the highlighted buckets, skips their labels and restores full opacity', () => {
    const alphaAtFill: number[] = [];
    const { context, calls } = fakeContext();
    const recordedFillRect = context.fillRect.bind(context);
    context.fillRect = (...args: [number, number, number, number]) => {
      alphaAtFill.push(context.globalAlpha);
      recordedFillRect(...args);
    };
    // No rectangle has bucket -1, so every rectangle counts as outside the highlighted set.
    const highlightedBuckets = new Set([-1]);
    paintLayout(context, sampleLayout(), 400, 200, style(), highlightedBuckets, () => 'name-long-enough');
    expect(calls.filter((call) => call.name === 'fillText')).toHaveLength(0);
    expect(alphaAtFill[0]).toBe(1);
    expect(alphaAtFill.slice(1).every((alpha) => alpha < 1)).toBe(true);
    expect(context.globalAlpha).toBe(1);
  });
});

describe('fittedLabel', () => {
  const measure = (text: string) => text.length * 6;
  it('keeps a label that fits', () => expect(fittedLabel(measure, 'abc.txt', 100)).toBe('abc.txt'));
  it('shortens with three dots in the middle of a long name and keeps the extension end', () => {
    const result = fittedLabel(measure, 'a-very-long-file-name.txt', 90);
    expect(result).toContain('...');
    expect(result.endsWith('.txt')).toBe(true);
    expect(measure(result)).toBeLessThanOrEqual(90);
  });
  it('returns an empty string when nothing fits', () => expect(fittedLabel(measure, 'abcdef', 6)).toBe(''));
  it('returns an empty string when even the three dots do not fit', () => {
    expect(fittedLabel(measure, 'abcdef', 17)).toBe('');
  });
  it('returns just the dots when exactly they fit', () => expect(fittedLabel(measure, 'abcdef', 18)).toBe('...'));
  it('always measures within the width for every width', () => {
    const text = 'a-very-long-file-name.txt';
    for (let maxWidth = 0; maxWidth <= 160; maxWidth++) {
      expect(measure(fittedLabel(measure, text, maxWidth))).toBeLessThanOrEqual(maxWidth);
    }
  });
});
