import { describe, expect, it } from 'vitest';
import { bestTextOn } from './colors';
import { paintCushion, paintLayout, paintMap, type Context2D, type PaintStyle } from './treemapPaint';
import { AGE_BUCKET_COUNT, CATEGORY_COUNT, layoutTree, RectKind, type Layout } from './treemapLayout';
import { FolderTree } from './treemapTree';
import { labelColorOn, mapColors } from './treemapColors';
import { PALETTES } from './palettes';
import { addRidge, brightnessAt, CUSHION_HEIGHT, CUSHION_SCALE, shadeChannel } from './treemapCushion';

interface FakeImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * Records every drawing call. The image calls are backed by a real pixel buffer, like a canvas:
 * putImageData copies the image in, and getImageData copies a region back out.
 */
function fakeContext() {
  const calls: Array<{ name: string; args: unknown[]; fill: unknown }> = [];
  let canvasPixels: FakeImage | null = null;
  const context = {
    fillStyle: '', strokeStyle: '', globalAlpha: 1, font: '', textBaseline: '', lineWidth: 1,
    fillRect: (...args: unknown[]) => calls.push({ name: 'fillRect', args, fill: context.fillStyle }),
    strokeRect: (...args: unknown[]) => calls.push({ name: 'strokeRect', args, fill: context.strokeStyle }),
    fillText: (...args: unknown[]) => calls.push({ name: 'fillText', args, fill: context.fillStyle }),
    measureText: (text: string) => ({ width: text.length * 6 }),
    save: () => {}, restore: () => {}, beginPath: () => {}, rect: () => {}, clip: () => {},
    createImageData: (width: number, height: number): FakeImage => {
      calls.push({ name: 'createImageData', args: [width, height], fill: null });
      return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    },
    putImageData: (image: FakeImage, dx: number, dy: number) => {
      calls.push({ name: 'putImageData', args: [image.width, image.height, dx, dy], fill: null });
      canvasPixels = { width: image.width, height: image.height, data: image.data.slice() };
    },
    getImageData: (x: number, y: number, width: number, height: number): FakeImage => {
      if (!canvasPixels) throw new Error('nothing was put on the canvas');
      const data = new Uint8ClampedArray(width * height * 4);
      for (let row = 0; row < height; row++) {
        const start = ((y + row) * canvasPixels.width + x) * 4;
        data.set(canvasPixels.data.subarray(start, start + width * 4), row * width * 4);
      }
      return { width, height, data };
    },
  };
  /** The [red, green, blue, alpha] of one device pixel of what was put on the canvas. */
  const pixelAt = (px: number, py: number): number[] => Array.from(context.getImageData(px, py, 1, 1).data);
  return { context: context as unknown as Context2D, calls, pixelAt };
}

const style = (overrides: Partial<PaintStyle> = {}): PaintStyle => ({
  colors: mapColors(PALETTES[0].dark, 'dark'),
  colorMode: 'type',
  forced: null,
  font: '12px sans-serif',
  labelColorFor: bestTextOn,
  pixelRatio: 1,
  shading: 'flat',
  ...overrides,
});

function rgbOf(hex: string): number[] {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
}

interface HandRect {
  x: number;
  y: number;
  w: number;
  h: number;
  category?: number;
  /** No ridge, so the tile shades the same everywhere. */
  level?: boolean;
}

/** A layout of exactly these file rectangles, each with one ridge of its own, as a top-level file gets. */
function handLayout(rects: HandRect[]): Layout {
  const count = rects.length;
  const layout: Layout = {
    count,
    x: Float32Array.from(rects, (rect) => rect.x), y: Float32Array.from(rects, (rect) => rect.y),
    w: Float32Array.from(rects, (rect) => rect.w), h: Float32Array.from(rects, (rect) => rect.h),
    id: Int32Array.from(rects, (_, index) => index + 1), kind: new Uint8Array(count).fill(RectKind.File),
    depth: new Uint8Array(count), category: Uint8Array.from(rects, (rect) => rect.category ?? 0),
    age: new Uint8Array(count), weight: new Float64Array(count).fill(1), fileCount: new Uint32Array(count).fill(1),
    folderId: new Int32Array(count), surface: new Float32Array(count * 4),
    frameCount: 0, frameX: new Float32Array(0), frameY: new Float32Array(0), frameW: new Float32Array(0), frameH: new Float32Array(0),
    frameFolderId: new Int32Array(0), omitted: 0, totalFiles: count, totalWeight: count,
    categoryWeight: new Float64Array(CATEGORY_COUNT), ageWeight: new Float64Array(AGE_BUCKET_COUNT), largestChildFolderId: -1,
  };
  rects.forEach((rect, index) => {
    if (!rect.level) addRidge(layout.surface, index * 4, rect.x, rect.y, rect.x + rect.w, rect.y + rect.h, CUSHION_HEIGHT * CUSHION_SCALE);
  });
  return layout;
}

/** The coefficients of rectangle `rect`, in the order brightnessAt takes them. */
function coefficientsOf(layout: Layout, rect: number): [number, number, number, number] {
  const surface = layout.surface;
  return [surface[rect * 4], surface[rect * 4 + 1], surface[rect * 4 + 2], surface[rect * 4 + 3]];
}

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

describe('labels', () => {
  /** The label drawn on the first rectangle when it is `width` wide, or null when none is drawn. */
  function labelAtWidth(name: string, width: number): string | null {
    const { context, calls } = fakeContext();
    const layout = sampleLayout();
    layout.w[0] = width;
    paintLayout(context, layout, 400, 200, style(), null, (rect) => (rect === 0 ? name : ''));
    const text = calls.find((call) => call.name === 'fillText' && call.args[0] !== '');
    return text ? (text.args[0] as string) : null;
  }
  const measure = (text: string) => text.length * 6;
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  it('keeps a name that fits', () => expect(labelAtWidth('abc.txt', 200)).toBe('abc.txt'));

  it('shortens a long name in the middle so it fits, keeping the end with the extension', () => {
    const name = 'a-very-long-file-name-that-goes-on-and-on.txt';
    for (let width = 64; width <= 300; width++) {
      const label = labelAtWidth(name, width);
      expect(label).not.toBeNull();
      expect(measure(label!)).toBeLessThanOrEqual(width - 8);
      if (label !== name) {
        expect(label).toContain('…');
        expect(label!.endsWith('.txt')).toBe(true);
      }
    }
  });

  it('never cuts a name inside a surrogate pair', () => {
    const name = `${'\u{1F600}'.repeat(30)}-notes-${'\u{1F4C1}'.repeat(30)}.txt`;
    for (let width = 64; width <= 400; width++) {
      const label = labelAtWidth(name, width);
      if (label !== null) expect(label).not.toMatch(LONE_SURROGATE);
    }
  });
});

describe('paintCushion', () => {
  const cushion = (overrides: Partial<PaintStyle> = {}) => style({ shading: 'cushion', ...overrides });
  const colors = mapColors(PALETTES[0].dark, 'dark');
  const background = rgbOf(colors.background);
  const isBackground = (pixel: number[]) => pixel.slice(0, 3).every((value, channel) => value === background[channel]);
  /** Red plus green plus blue over a square patch, divided by its pixel count. */
  function patchMean(pixelAt: (px: number, py: number) => number[], left: number, top: number, size: number): number {
    let sum = 0;
    for (let py = top; py < top + size; py++) {
      for (let px = left; px < left + size; px++) sum += pixelAt(px, py).slice(0, 3).reduce((total, value) => total + value, 0);
    }
    return sum / (size * size);
  }

  it('leaves the background where no rectangle is, fully opaque', () => {
    const { context, pixelAt } = fakeContext();
    paintCushion(context, handLayout([{ x: 10, y: 10, w: 20, h: 10 }]), 60, 40, cushion(), null, null);
    for (const [px, py] of [[0, 0], [59, 39], [9, 15], [30, 15], [15, 9], [15, 20], [45, 30]]) {
      const pixel = pixelAt(px, py);
      expect(isBackground(pixel)).toBe(true);
      expect(pixel[3]).toBe(255);
    }
    expect(isBackground(pixelAt(15, 15))).toBe(false);
  });

  it('lights a tile from the top left: its top-left corner is brighter than its bottom-right, and a level tile is even', () => {
    const shaded = fakeContext();
    paintCushion(shaded.context, handLayout([{ x: 0, y: 0, w: 200, h: 120 }]), 200, 120, cushion(), null, null);
    expect(patchMean(shaded.pixelAt, 10, 10, 20)).toBeGreaterThan(patchMean(shaded.pixelAt, 170, 90, 20) * 1.2);

    const level = fakeContext();
    paintCushion(level.context, handLayout([{ x: 0, y: 0, w: 200, h: 120, level: true }]), 200, 120, cushion(), null, null);
    expect(patchMean(level.pixelAt, 10, 10, 20)).toBe(patchMean(level.pixelAt, 170, 90, 20));
  });

  it('shades one tile the same at any size', () => {
    const base = rgbOf(colors.category[0]).reduce((total, value) => total + value, 0);
    /** The brightness painted at a position given as fractions of the tile's width and height. */
    function brightnessAtFraction(width: number, height: number, fractionX: number, fractionY: number): number {
      const { context, pixelAt } = fakeContext();
      paintCushion(context, handLayout([{ x: 0, y: 0, w: width, h: height }]), width, height, cushion(), null, null);
      const pixel = pixelAt(Math.floor(width * fractionX), Math.floor(height * fractionY));
      return pixel.slice(0, 3).reduce((total, value) => total + value, 0) / base;
    }
    for (const [fractionX, fractionY] of [[0.3, 0.3], [0.8, 0.7], [0.5, 0.1]]) {
      expect(brightnessAtFraction(100, 60, fractionX, fractionY)).toBeCloseTo(brightnessAtFraction(300, 180, fractionX, fractionY), 1);
    }
  });

  it('paints every device pixel exactly as brightnessAt and shadeChannel say, at fractional pixel ratios', () => {
    for (const devicePixelRatio of [1, 1.25, 1.5, 2]) {
      const { context, pixelAt } = fakeContext();
      const layout = handLayout([{ x: 3.3, y: 2.7, w: 71.9, h: 40.6, category: 3 }]);
      paintCushion(context, layout, 80, 48, cushion({ pixelRatio: devicePixelRatio }), null, null);
      const base = rgbOf(colors.category[3]);
      const coefficients = coefficientsOf(layout, 0);
      const left = Math.round(3.3 * devicePixelRatio);
      const top = Math.round(2.7 * devicePixelRatio);
      const right = Math.round((3.3 + 71.9) * devicePixelRatio);
      const bottom = Math.round((2.7 + 40.6) * devicePixelRatio);
      for (let py = top; py < bottom; py += 7) {
        for (let px = left; px < right; px += 5) {
          const brightness = brightnessAt(...coefficients, (px + 0.5) / devicePixelRatio, (py + 0.5) / devicePixelRatio);
          expect(pixelAt(px, py).slice(0, 3)).toEqual(base.map((channel) => shadeChannel(channel, brightness)));
        }
      }
    }
  });

  it('lets neighbours touch with no background seam between them', () => {
    for (const devicePixelRatio of [1, 1.25, 1.5, 2]) {
      const { context, pixelAt } = fakeContext();
      const layout = handLayout([{ x: 0, y: 0, w: 50.4, h: 40 }, { x: 50.4, y: 0, w: 49.6, h: 40, category: 1 }]);
      paintCushion(context, layout, 100, 40, cushion({ pixelRatio: devicePixelRatio }), null, null);
      const row = Math.round(20 * devicePixelRatio);
      for (let px = 0; px < Math.round(100 * devicePixelRatio); px++) expect(isBackground(pixelAt(px, row))).toBe(false);
    }
  });

  it('writes nothing past the right edge (no wrap into the next row) and clamps a rectangle that runs off the canvas', () => {
    const atEdge = fakeContext();
    paintCushion(atEdge.context, handLayout([{ x: 5, y: 1, w: 5, h: 2 }]), 10, 5, cushion(), null, null);
    expect(isBackground(atEdge.pixelAt(9, 1))).toBe(false);
    expect(isBackground(atEdge.pixelAt(9, 2))).toBe(false);
    for (const py of [0, 1, 2, 3, 4]) expect(isBackground(atEdge.pixelAt(0, py))).toBe(true);
    expect(isBackground(atEdge.pixelAt(5, 3))).toBe(true);

    const pastEdges = fakeContext();
    paintCushion(pastEdges.context, handLayout([{ x: 7, y: 2, w: 10, h: 9 }, { x: -4, y: -3, w: 6, h: 4 }]), 10, 5, cushion(), null, null);
    for (let py = 0; py < 5; py++) {
      for (let px = 0; px < 10; px++) {
        const inside = (px >= 7 && py >= 2) || (px < 2 && py < 1);
        expect(isBackground(pastEdges.pixelAt(px, py))).toBe(!inside);
      }
    }
  });

  it('blends a dimmed tile toward the background at 0.18 and gives it no label', () => {
    const { context, calls, pixelAt } = fakeContext();
    const layout = handLayout([{ x: 0, y: 0, w: 120, h: 40, category: 2 }]);
    // No rectangle has bucket 9, so the tile counts as outside the highlighted set.
    paintCushion(context, layout, 120, 40, cushion(), new Set([9]), () => 'name-long-enough.txt');
    const base = rgbOf(colors.category[2]);
    for (const [px, py] of [[5, 5], [60, 20], [110, 35]]) {
      const brightness = brightnessAt(...coefficientsOf(layout, 0), px + 0.5, py + 0.5);
      const expected = base.map((channel, index) => Math.round(background[index] * 0.82 + shadeChannel(channel, brightness) * 0.18));
      pixelAt(px, py).slice(0, 3).forEach((value, index) => expect(Math.abs(value - expected[index])).toBeLessThanOrEqual(1));
    }
    expect(calls.filter((call) => call.name === 'fillText')).toHaveLength(0);
  });

  it('paints a rectangle under half a CSS pixel only on the pixels it rounds to, and keeps one device pixel for a thin one', () => {
    const { context, pixelAt } = fakeContext();
    // 5.1 to 5.4 rounds to no column, so it writes nothing. 15.3 to 15.7 rounds to column 15 alone,
    // which no neighbour rounds to, so it fills that column. 10.6 to 11.2 rounds to 11 at both edges,
    // so the one-pixel rule keeps column 11.
    const layout = handLayout([{ x: 5.1, y: 2, w: 0.3, h: 6 }, { x: 15.3, y: 2, w: 0.4, h: 6 }, { x: 10.6, y: 2, w: 0.6, h: 6 }]);
    paintCushion(context, layout, 30, 10, cushion(), null, null);
    for (let px = 0; px < 30; px++) expect(isBackground(pixelAt(px, 4))).toBe(px !== 11 && px !== 15);
  });

  it('leaves no background speck where slivers under half a pixel sit between neighbours', () => {
    for (const devicePixelRatio of [1, 1.25, 2]) {
      const { context, pixelAt } = fakeContext();
      // Eighths add up exactly in Float32, so each sliver starts where the one before it ends.
      const layout = handLayout([
        { x: 0, y: 0, w: 10.25, h: 20 },
        { x: 10.25, y: 0, w: 0.375, h: 20, category: 1 },
        { x: 10.625, y: 0, w: 0.25, h: 20, category: 2 },
        { x: 10.875, y: 0, w: 0.375, h: 20, category: 3 },
        { x: 11.25, y: 0, w: 8.75, h: 20, category: 4 },
      ]);
      paintCushion(context, layout, 20, 20, cushion({ pixelRatio: devicePixelRatio }), null, null);
      const row = Math.round(10 * devicePixelRatio);
      for (let px = 0; px < Math.round(20 * devicePixelRatio); px++) expect(isBackground(pixelAt(px, row))).toBe(false);
    }
  });

  it('writes nothing and throws nothing for a zero-size rectangle', () => {
    const { context, pixelAt } = fakeContext();
    const layout = handLayout([{ x: 5, y: 5, w: 0, h: 0 }, { x: 2, y: 2, w: 6, h: 0 }, { x: 2, y: 2, w: 0, h: 6 }]);
    expect(layout.surface.every(Number.isFinite)).toBe(true);
    expect(() => paintCushion(context, layout, 10, 10, cushion(), null,() => 'name')).not.toThrow();
    for (let py = 0; py < 10; py++) for (let px = 0; px < 10; px++) expect(isBackground(pixelAt(px, py))).toBe(true);
  });

  it('works in device pixels at ratio 2: the buffer is the rounded backing size and edges are rounded device positions', () => {
    const { context, calls, pixelAt } = fakeContext();
    paintCushion(context, handLayout([{ x: 3.3, y: 2.2, w: 10.1, h: 6.1 }]), 50.3, 20.2, cushion({ pixelRatio: 2 }), null, null);
    const put = calls.find((call) => call.name === 'putImageData');
    expect(put?.args).toEqual([101, 40, 0, 0]);
    // Left round(6.6) = 7, right round(26.8) = 27, top round(4.4) = 4, bottom round(16.6) = 17.
    expect(isBackground(pixelAt(6, 10))).toBe(true);
    expect(isBackground(pixelAt(7, 10))).toBe(false);
    expect(isBackground(pixelAt(26, 10))).toBe(false);
    expect(isBackground(pixelAt(27, 10))).toBe(true);
    expect(isBackground(pixelAt(15, 3))).toBe(true);
    expect(isBackground(pixelAt(15, 4))).toBe(false);
    expect(isBackground(pixelAt(15, 16))).toBe(false);
    expect(isBackground(pixelAt(15, 17))).toBe(true);
  });

  it('puts nothing on a canvas with no device pixels', () => {
    const { context, calls } = fakeContext();
    expect(() => paintCushion(context, handLayout([{ x: 0, y: 0, w: 1, h: 1 }]), 0.2, 30, cushion(), null, null)).not.toThrow();
    expect(calls.filter((call) => call.name === 'putImageData' || call.name === 'createImageData')).toHaveLength(0);
  });

  it('draws labels after the pixels, in the text color that reads best over the label row', () => {
    const { context, calls } = fakeContext();
    const layout = sampleLayout();
    paintCushion(context, layout, 400, 200, cushion({ labelColorFor: () => 'flat-only' }), null, (rect) => `name${rect}.rs`);
    const putIndex = calls.findIndex((call) => call.name === 'putImageData');
    const texts = calls.map((call, index) => ({ call, index })).filter(({ call }) => call.name === 'fillText');
    expect(putIndex).toBeGreaterThanOrEqual(0);
    expect(texts.length).toBeGreaterThanOrEqual(1);
    for (const { call, index } of texts) {
      expect(index).toBeGreaterThan(putIndex);
      const [label, textX, textY] = call.args as [string, number, number];
      const rect = Number(/name(\d+)/.exec(label)![1]);
      const coefficients = coefficientsOf(layout, rect);
      const left = brightnessAt(...coefficients, textX, textY);
      const right = brightnessAt(...coefficients, textX + label.length * 6, textY);
      expect(call.fill).toBe(labelColorOn(colors.category[layout.category[rect]], left, right));
    }
  });

  it('reuses one image while the backing size stays the same', () => {
    const first = fakeContext();
    paintCushion(first.context, handLayout([{ x: 0, y: 0, w: 10, h: 10 }]), 37, 23, cushion(), null, null);
    const second = fakeContext();
    paintCushion(second.context, handLayout([{ x: 5, y: 5, w: 10, h: 10 }]), 37, 23, cushion(), null, null);
    expect(second.calls.filter((call) => call.name === 'createImageData')).toHaveLength(0);
    // The reused image starts again from the background, so the first paint leaves nothing behind.
    expect(isBackground(second.pixelAt(1, 1))).toBe(true);
  });

  it('reads three-digit hex colors as their six-digit forms', () => {
    const { context, pixelAt } = fakeContext();
    const shortColors = { ...colors, background: '#123', category: colors.category.map(() => '#F80') };
    const layout = handLayout([{ x: 2, y: 2, w: 20, h: 10 }]);
    paintCushion(context, layout, 30, 15, cushion({ colors: shortColors }), null, null);
    expect(pixelAt(0, 0)).toEqual([0x11, 0x22, 0x33, 255]);
    const brightness = brightnessAt(...coefficientsOf(layout, 0), 10.5, 6.5);
    expect(pixelAt(10, 6).slice(0, 3)).toEqual([0xff, 0x88, 0x00].map((channel) => shadeChannel(channel, brightness)));
  });

  it('paints a 2400 by 520 device-pixel map of 20,000 rectangles in well under a quarter second', () => {
    const rects: HandRect[] = [];
    const columns = 200;
    const rows = 100;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        rects.push({ x: (column * 2400) / columns, y: (row * 520) / rows, w: 2400 / columns, h: 520 / rows, category: (row + column) % 12 });
      }
    }
    const layout = handLayout(rects);
    const { context } = fakeContext();
    paintCushion(context, layout, 2400, 520, cushion(), null, null);
    const started = performance.now();
    paintCushion(context, layout, 2400, 520, cushion(), null, null);
    expect(performance.now() - started).toBeLessThan(250);
  });
});

describe('paintMap', () => {
  const forced = { canvas: 'rgb(0, 0, 0)', text: 'rgb(255, 255, 255)', highlight: 'rgb(0, 0, 255)' };

  it('draws only outlines in forced-colors mode even when cushion shading is chosen', () => {
    const { context, calls } = fakeContext();
    paintMap(context, sampleLayout(), 400, 200, style({ shading: 'cushion', forced }), null, null);
    expect(calls.filter((call) => call.name === 'strokeRect').length).toBeGreaterThan(0);
    expect(calls.some((call) => call.name === 'putImageData')).toBe(false);
  });

  it('paints flat rectangles for flat shading and per-pixel cushions for cushion shading', () => {
    const flat = fakeContext();
    paintMap(flat.context, sampleLayout(), 400, 200, style({ shading: 'flat' }), null, null);
    expect(flat.calls.some((call) => call.name === 'putImageData')).toBe(false);
    expect(flat.calls.filter((call) => call.name === 'fillRect').length).toBeGreaterThan(1);

    const shaded = fakeContext();
    paintMap(shaded.context, sampleLayout(), 400, 200, style({ shading: 'cushion' }), null, null);
    expect(shaded.calls.filter((call) => call.name === 'putImageData')).toHaveLength(1);
    expect(shaded.calls.some((call) => call.name === 'fillRect')).toBe(false);
  });

  it('lets go of the cushion image once a flat paint is asked for, so flat shading holds no full-size buffer', () => {
    const layout = handLayout([{ x: 0, y: 0, w: 10, h: 10 }]);
    paintMap(fakeContext().context, layout, 41, 29, style({ shading: 'cushion' }), null, null);
    const sameSize = fakeContext();
    paintMap(sameSize.context, layout, 41, 29, style({ shading: 'cushion' }), null, null);
    expect(sameSize.calls.filter((call) => call.name === 'createImageData')).toHaveLength(0);

    paintMap(fakeContext().context, layout, 41, 29, style({ shading: 'flat' }), null, null);
    const afterFlat = fakeContext();
    paintMap(afterFlat.context, layout, 41, 29, style({ shading: 'cushion' }), null, null);
    expect(afterFlat.calls.filter((call) => call.name === 'createImageData')).toHaveLength(1);
  });
});
