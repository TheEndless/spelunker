import { beforeEach, describe, expect, it } from 'vitest';
import { PALETTES } from './palettes';
import { handleMessage, type Send } from './treemap.worker';
import { mapColors } from './treemapColors';
import { RectKind, type Layout } from './treemapLayout';
import type { FromWorker, ViewSettings } from './treemapMessages';
import type { Shading } from './treemapPaint';
import type { TreemapRecord } from './treemapTree';

type LayoutReply = Extract<FromWorker, { type: 'layout' }>;

let replies: FromWorker[] = [];
const send: Send = (message) => replies.push(message);
let sequence = 0;
let requestId = 0;

const record = (id: number, folder: string, size: number): TreemapRecord => ({
  id, folder, name: `f${id}.txt`, size, hits: 0, modifiedMs: null,
});

function load(records: TreemapRecord[]) {
  handleMessage({ type: 'reset', now: 0 }, send);
  handleMessage({ type: 'add', records }, send);
}

const view = (zoomFolderId: number | null, shading: Shading = 'cushion'): ViewSettings => ({
  width: 100, height: 100, devicePixelRatio: 1, metric: 'size', colorMode: 'type', zoomFolderId,
  colors: mapColors(PALETTES[0].dark, 'dark'), forced: null, font: '', dimmed: null, shading,
});

function layout(zoomFolderId: number | null = null, shading: Shading = 'cushion'): LayoutReply {
  handleMessage({ type: 'layout', sequence: ++sequence, view: view(zoomFolderId, shading) }, send);
  return replies.at(-1) as LayoutReply;
}

/** A canvas whose context records the name of every drawing call, as the worker's canvas would receive them. */
function recordingCanvas() {
  const calls: string[] = [];
  const record = (name: string) => () => void calls.push(name);
  const context = {
    fillStyle: '', strokeStyle: '', globalAlpha: 1, font: '', textBaseline: '', lineWidth: 1,
    setTransform: record('setTransform'), fillRect: record('fillRect'), strokeRect: record('strokeRect'), fillText: record('fillText'),
    measureText: (text: string) => ({ width: text.length * 6 }),
    createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: record('putImageData'),
  };
  const canvas = { width: 0, height: 0, getContext: () => context } as unknown as OffscreenCanvas;
  return { canvas, calls };
}

function locate(fileId: number) {
  handleMessage({ type: 'locate', requestId: ++requestId, fileId }, send);
  const { rect, zoomFolderId } = replies.at(-1) as Extract<FromWorker, { type: 'located' }>;
  return { rect, zoomFolderId };
}

/** Folder ids are not reset between tests, so look them up by path. */
function folderId(path: string): number {
  for (let id = 0; id < 10_000; id++) {
    handleMessage({ type: 'describe', requestId: ++requestId, folderId: id }, send);
    if ((replies.at(-1) as Extract<FromWorker, { type: 'described' }>).path === path) return id;
  }
  throw new Error(`No folder ${path}`);
}

const describeRect = (layout: Layout, rect: number) => ({ kind: layout.kind[rect], id: layout.id[rect] });

describe('treemap worker', () => {
  beforeEach(() => {
    replies = [];
  });

  describe('a layout that throws', () => {
    // Painting throws once the canvas was resized, which is the worst moment to fail.
    const throwingCanvas = () => ({
      width: 0, height: 0,
      getContext: () => ({ setTransform: () => { throw new RangeError('boom'); } }),
    }) as unknown as OffscreenCanvas;
    const noContextCanvas = () => ({ getContext: () => null }) as unknown as OffscreenCanvas;

    it('still answers its sequence, saying it failed', () => {
      load([record(1, 'C:\\a', 10)]);
      const canvas = throwingCanvas();
      handleMessage({ type: 'attach', canvas }, send);
      try {
        handleMessage({ type: 'layout', sequence: 4242, view: view(null) }, send);
      } finally {
        handleMessage({ type: 'attach', canvas: noContextCanvas() }, send);
      }
      expect(replies.at(-1)).toEqual({ type: 'layoutFailed', sequence: 4242, message: 'RangeError: boom' });
      // The canvas was resized before the failure, so it is emptied rather than left half painted.
      expect(canvas.width).toBe(0);
      expect(canvas.height).toBe(0);
    });

    it('lays out normally afterwards', () => {
      load([record(1, 'C:\\a', 10)]);
      expect(layout().type).toBe('layout');
    });
  });

  describe('the surface of a layout', () => {
    it('is cut to four values per rectangle and travels in a buffer of its own', () => {
      load([record(1, 'C:\\a', 10), record(2, 'C:\\a', 5), record(3, 'C:\\b', 20)]);
      const reply = layout();
      expect(reply.layout.surface.length).toBe(reply.layout.count * 4);
      const buffers = Object.values(reply.layout).filter(ArrayBuffer.isView).map((view) => view.buffer);
      expect(new Set(buffers).size).toBe(buffers.length);
    });
  });

  describe('shading', () => {
    beforeEach(() =>
      load([record(1, 'C:\\a\\one', 100), record(2, 'C:\\a\\one', 60), record(3, 'C:\\a\\two', 100), record(4, 'C:\\a\\two', 40)]),
    );

    /** For each framed folder below the laid-out one, how far its leftmost and topmost rectangles sit inside its frame. */
    function insetsOf(reply: LayoutReply): number[] {
      const result = reply.layout;
      const insets: number[] = [];
      for (let frame = 1; frame < result.frameCount; frame++) {
        let left = Infinity;
        let top = Infinity;
        for (let rect = 0; rect < result.count; rect++) {
          if (result.folderId[rect] !== result.frameFolderId[frame]) continue;
          left = Math.min(left, result.x[rect]);
          top = Math.min(top, result.y[rect]);
        }
        insets.push(left - result.frameX[frame], top - result.frameY[frame]);
      }
      return insets;
    }

    it('lays out with no gap inside folders for cushion shading, since the shading separates them', () => {
      const insets = insetsOf(layout(null, 'cushion'));
      expect(insets).toHaveLength(4);
      for (const inset of insets) expect(inset).toBeCloseTo(0, 5);
    });

    it('keeps the one-pixel gap inside folders for flat shading', () => {
      const insets = insetsOf(layout(null, 'flat'));
      expect(insets).toHaveLength(4);
      for (const inset of insets) expect(inset).toBeCloseTo(1, 5);
    });

    it('paints with the painter the shading names', () => {
      const painted = (shading: Shading) => {
        const { canvas, calls } = recordingCanvas();
        handleMessage({ type: 'attach', canvas }, send);
        try {
          expect(layout(null, shading).painted).toBe(true);
        } finally {
          handleMessage({ type: 'attach', canvas: { getContext: () => null } as unknown as OffscreenCanvas }, send);
        }
        return calls;
      };
      const cushion = painted('cushion');
      expect(cushion).toContain('putImageData');
      expect(cushion).not.toContain('fillRect');
      const flat = painted('flat');
      expect(flat).toContain('fillRect');
      expect(flat).not.toContain('putImageData');
    });
  });

  describe('zoom fallback', () => {
    beforeEach(() =>
      load([
        record(1, 'C:\\x\\y\\deep', 100),
        record(2, 'C:\\x\\y', 100),
        record(3, 'C:\\x\\y\\other', 100),
        record(4, 'C:\\z', 100),
      ]),
    );

    it('zooms out to the nearest surviving ancestor when the zoomed folder is removed', () => {
      const deep = folderId('C:\\x\\y\\deep');
      expect(layout(deep).zoomFolderId).toBe(deep);
      handleMessage({ type: 'remove', ids: [1] }, send);
      const reply = layout(deep);
      expect(reply.zoomFolderId).toBe(folderId('C:\\x\\y'));
      expect(reply.crumbs.at(-1)!.label).toBe('y');
    });

    it('falls back to the top for a folder id it does not know', () => {
      expect(layout(999_999).zoomFolderId).toBe(folderId('C:'));
    });

    it('says which metric the layout was made with', () => {
      expect(layout().metric).toBe('size');
      handleMessage({ type: 'layout', sequence: ++sequence, view: { ...view(null), metric: 'matches' } }, send);
      expect((replies.at(-1) as LayoutReply).metric).toBe('matches');
    });

    it('names the heaviest folder directly under the laid-out folder', () => {
      expect(layout().largestFolder).toBe('x');
      expect(layout(folderId('C:\\z')).largestFolder).toBe('');
    });
  });

  describe('locate', () => {
    // In a 100 by 100 map, folder a holds one huge file and two tiny ones that fold into a
    // small-files group. Folder b is a 0.2 pixel wide strip, so it is drawn as one block.
    beforeEach(() =>
      load([
        record(1, 'C:\\a', 1_000_000),
        record(2, 'C:\\a', 1),
        record(3, 'C:\\a', 1),
        record(4, 'C:\\b', 2_000),
        record(5, 'C:\\b\\sub', 10),
        record(6, 'C:\\a', 0),
      ]),
    );

    it('finds a file drawn on its own', () => {
      const reply = layout();
      const { rect, zoomFolderId } = locate(1);
      expect(describeRect(reply.layout, rect)).toEqual({ kind: RectKind.File, id: 1 });
      expect(zoomFolderId).toBeNull();
    });

    it('finds a file folded into its folder small-files group', () => {
      const reply = layout();
      const { rect } = locate(2);
      expect(describeRect(reply.layout, rect)).toEqual({ kind: RectKind.SmallFiles, id: folderId('C:\\a') });
    });

    it('finds a file inside a folder drawn as one block', () => {
      const reply = layout();
      const block = { kind: RectKind.FolderBlock, id: folderId('C:\\b') };
      expect(describeRect(reply.layout, locate(4).rect)).toEqual(block);
      expect(describeRect(reply.layout, locate(5).rect)).toEqual(block);
    });

    it('does not place a zero-size file, which is not drawn', () => {
      layout();
      expect(locate(6)).toEqual({ rect: -1, zoomFolderId: null });
    });

    it('asks to zoom out for a file outside the zoomed view', () => {
      layout(folderId('C:\\a'));
      expect(locate(4)).toEqual({ rect: -1, zoomFolderId: folderId('C:') });
    });

    it('does not place a removed file', () => {
      layout();
      handleMessage({ type: 'remove', ids: [2] }, send);
      expect(locate(2)).toEqual({ rect: -1, zoomFolderId: null });
    });
  });
});
